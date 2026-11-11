import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  inspectProviderConformance,
  type OperationContext,
  voiceResultSchema,
} from '@tutorialx/contracts';
import { selectProvider, wireProviders } from '@tutorialx/core';
import { expect, it } from 'vitest';
import {
  createRecordedVoiceProvider,
  recordedVoiceDescriptor,
} from '../../examples/providers/recorded-voice.js';
import { digest } from '../fixtures/contracts.js';

// Synthetic PCM silence exercises file/contract semantics, not speech quality or alignment.
function pcmFixture() {
  const bytes = Buffer.alloc(32044);
  bytes.write('RIFF');
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(16000, 24);
  bytes.writeUInt32LE(32000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(32000, 40);
  return bytes;
}

async function withProvider(run: (fixture: Awaited<ReturnType<typeof prepare>>) => Promise<void>) {
  const fixture = await prepare();
  try {
    await run(fixture);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
}

async function prepare() {
  const root = await mkdtemp(join(tmpdir(), 'tutorialx-voice-example-'));
  const source = join(root, 'source.wav');
  const bytes = pcmFixture();
  await writeFile(source, bytes);
  const config = { voiceId: 'recorded', language: 'en-US' };
  const provider = createRecordedVoiceProvider(config, {
    path: source,
    text: 'Hello TutorialX.',
    workspaceId: 'workspace',
    settingsDigest: digest,
  });
  const context: OperationContext = {
    jobId: 'job',
    attemptId: 'attempt',
    operationId: 'operation',
    outputDirectory: join(root, 'output'),
    deadlineAt: '2099-01-01T00:00:00Z',
    reservationId: null,
    signal: new AbortController().signal,
  };
  const request = {
    sceneId: 'intro',
    text: 'Hello TutorialX.',
    language: 'en-US',
    voiceId: 'recorded',
    pace: 1,
    tone: '',
    pronunciations: {},
  };
  return { root, source, bytes, config, provider, context, request };
}

it('registers the complete example and passes common conformance through public APIs', async () => {
  await withProvider(async ({ provider, config, context, source }) => {
    expect(
      await inspectProviderConformance(provider, {
        kind: 'voice',
        validConfiguration: config,
        invalidConfiguration: { ...config, unknown: true },
        estimateOperation: 'synthesize',
        estimateInput: {},
        context,
      }),
    ).toEqual([]);
    const wiring = wireProviders([
      {
        descriptor: recordedVoiceDescriptor,
        create: (selection) =>
          createRecordedVoiceProvider(selection.config, {
            path: source,
            text: 'Hello TutorialX.',
            workspaceId: 'workspace',
            settingsDigest: digest,
          }),
      },
    ]);
    expect(wiring.descriptors().map((descriptor) => descriptor.id)).toEqual([
      'example-recorded-voice',
    ]);
    const result = await selectProvider(wiring, {
      kind: 'voice',
      selected: {
        selection: {
          id: recordedVoiceDescriptor.id,
          version: recordedVoiceDescriptor.version,
          config,
          credentialRef: null,
        },
        voiceId: 'recorded',
        visualIdentity: null,
      },
      requirements: {
        languages: ['en-US'],
        features: [],
        formats: ['audio/wav'],
        modalities: ['audio'],
        customScenes: [],
      },
      fallback: { schemaVersion: 1, candidates: [], maxCostUsdMicros: 0 },
      planDigest: digest,
      authorization: null,
      platform: 'linux',
      localOnly: true,
      remainingBudgetUsdMicros: 0,
      operation: 'synthesize',
      estimateInput: {},
      context,
      now: () => Date.now(),
    });
    expect(result.status).toBe('selected');
  });
});

it('writes real fixture bytes with measured metadata, provenance, and no invented word timing', async () => {
  await withProvider(async ({ provider, bytes, source, context, request }) => {
    const result = voiceResultSchema.parse(await provider.synthesize(request, context));
    const output = await readFile(join(context.outputDirectory, 'operation.wav'));
    expect(output).toEqual(bytes);
    expect(await readFile(source)).toEqual(bytes);
    expect(result.audio.digest).toBe(createHash('sha256').update(output).digest('hex'));
    expect(result.audio.sizeBytes).toBe(bytes.length);
    expect(result.audio.media).toMatchObject({
      durationUs: 1_000_000,
      sampleRate: 16000,
      channels: 1,
      audioCodec: 'pcm_s16le',
    });
    expect(result.audio.provenance).toMatchObject({
      attemptId: 'attempt',
      settingsDigest: digest,
      provider: { id: recordedVoiceDescriptor.id, version: recordedVoiceDescriptor.version },
    });
    expect(result.words).toBeNull();
    expect(result.actualUsdMicros).toBe(0);
    await expect(provider.synthesize(request, context)).rejects.toThrow();
    expect(await readFile(join(context.outputDirectory, 'operation.wav'))).toEqual(bytes);
  });
});

it('rejects unsupported words, language, voice, and delivery without creating output', async () => {
  await withProvider(async ({ provider, root, context, request }) => {
    for (const change of [
      { text: 'Other words' },
      { language: 'bn-BD' },
      { voiceId: 'other' },
      { pace: 1.5 },
      { tone: 'warm' },
      { pronunciations: { hello: 'hullo' } },
    ])
      await expect(provider.synthesize({ ...request, ...change }, context)).rejects.toThrow(
        'Only the exact',
      );
    expect(await readdir(root)).toEqual(['source.wav']);
  });
});

it('rejects cancellation, expiration, malformed audio, and unsafe operation identities', async () => {
  await withProvider(async ({ provider, source, root, context, request }) => {
    const abort = new AbortController();
    abort.abort(new Error('cancelled example'));
    await expect(
      provider.synthesize(request, { ...context, signal: abort.signal }),
    ).rejects.toThrow('cancelled');
    await expect(
      provider.synthesize(request, { ...context, deadlineAt: '2020-01-01T00:00:00Z' }),
    ).rejects.toThrow('deadline');
    await expect(
      provider.synthesize(request, { ...context, operationId: '../escape' }),
    ).rejects.toThrow();
    await writeFile(source, 'not WAV audio');
    expect((await provider.readiness()).ready).toBe(false);
    await expect(provider.synthesize(request, context)).rejects.toThrow();
    expect(await readdir(root)).toEqual(['source.wav']);
  });
});

it('keeps the provider implementation independent of core and vendor SDKs', async () => {
  const source = await readFile(
    new URL('../../examples/providers/recorded-voice.ts', import.meta.url),
    'utf8',
  );
  const imports = [...source.matchAll(/from ['"]([^'"]+)['"]/g)].map((match) => match[1]!);
  expect(imports.filter((name) => !name.startsWith('node:'))).toEqual(['@tutorialx/contracts']);
});
