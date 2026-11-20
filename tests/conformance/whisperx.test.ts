import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWhisperXAlignmentProvider, type WhisperXRunner } from '@tutorialx/adapters';
import {
  alignmentResultSchema,
  artifactManifestSchema,
  inspectProviderConformance,
  type OperationContext,
} from '@tutorialx/contracts';
import { afterEach, expect, it } from 'vitest';
import { digest, samplePlan } from '../fixtures/contracts.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(output?: Awaited<ReturnType<WhisperXRunner['align']>>) {
  const root = await mkdtemp(join(tmpdir(), 'tutorialx-whisperx-'));
  roots.push(root);
  await writeFile(
    join(root, 'narration.wav'),
    'fixture audio is not decoded by the injected runner',
  );
  const runner: WhisperXRunner = {
    capabilities: async (signal) => {
      signal.throwIfAborted();
      return { version: '3.8.6', pythonVersion: '3.12.16', devices: ['cpu'] };
    },
    align: async (_input, signal) => {
      signal.throwIfAborted();
      return (
        output ?? {
          transcript: 'TutorialX version 42 works',
          words: [
            { text: 'TutorialX', startSeconds: 0, endSeconds: 0.2 },
            { text: 'version', startSeconds: 0.2, endSeconds: 0.4 },
            { text: '42', startSeconds: 0.4, endSeconds: 0.6 },
            { text: 'works', startSeconds: 0.6, endSeconds: 0.9 },
          ],
        }
      );
    },
  };
  const config = {
    languages: ['en-US'],
    model: 'tiny',
    device: 'cpu',
    computeType: 'int8',
    maxDurationMs: 30_000,
  };
  const provider = createWhisperXAlignmentProvider(config, {
    audioRoot: root,
    pythonPath: '/runtime/python',
    workerPath: '/runtime/worker.py',
    runner,
    now: () => '2026-11-20T00:00:00.000Z',
  });
  const context: OperationContext = {
    operationId: 'alignment_operation',
    jobId: 'job_example',
    attemptId: 'alignment_attempt',
    reservationId: null,
    outputDirectory: join(root, 'output'),
    deadlineAt: '2099-01-01T00:00:00Z',
    signal: new AbortController().signal,
  };
  const audio = artifactManifestSchema.parse({
    schemaVersion: 1,
    id: 'narration_audio',
    createdAt: '2026-11-20T00:00:00.000Z',
    workspaceId: 'workspace_example',
    jobId: 'job_example',
    kind: 'audio',
    mimeType: 'audio/wav',
    storage: { kind: 'local', path: 'narration.wav' },
    digest,
    sizeBytes: 48,
    media: {
      durationUs: 1_000_000,
      width: null,
      height: null,
      frameRate: null,
      videoCodec: null,
      audioCodec: 'pcm_s16le',
      sampleRate: 16_000,
      channels: 1,
    },
    provenance: {
      stageId: 'voice_intro',
      attemptId: 'voice_attempt',
      inputDigests: [digest],
      provider: null,
      settingsDigest: digest,
      templateDigest: null,
    },
  });
  const scene = { ...samplePlan().scenes[0]!, narration: 'TutorialX version 42 works' };
  return { root, runner, config, provider, context, audio, scene };
}

it('reports locked CPU capabilities and passes alignment provider conformance', async () => {
  const { provider, config, context } = await fixture();
  expect(
    await inspectProviderConformance(provider, {
      kind: 'alignment',
      validConfiguration: config,
      invalidConfiguration: { ...config, unknown: true },
      estimateOperation: 'align',
      estimateInput: {},
      context,
    }),
  ).toEqual([]);
  expect(await provider.readiness()).toEqual({ ready: true, diagnostics: [] });
  expect(provider.descriptor.runtime).toMatchObject({
    gpu: false,
    dependencies: [
      { id: 'python', versionRange: '>=3.10 <3.14', optional: false },
      { id: 'whisperx', versionRange: '=3.8.6', optional: false },
    ],
  });
});

it('normalizes CPU alignment and preserves product terms and numbers', async () => {
  const { provider, context, audio, scene } = await fixture();
  const result = alignmentResultSchema.parse(
    await provider.align(
      { audio: [audio], scenes: [scene], language: 'en-US', planRevision: 1 },
      context,
    ),
  );
  expect(result.captions.cues[0]).toMatchObject({
    sceneId: 'intro',
    text: 'TutorialX version 42 works',
    range: { startUs: 0, endUs: 900_000 },
  });
  expect(result.captions.cues[0]!.words.map((word) => word.text)).toEqual([
    'TutorialX',
    'version',
    '42',
    'works',
  ]);
  expect(result.deviations).toEqual([]);
});

it('returns explicit findings for omitted and unalignable words without invented ranges', async () => {
  const { provider, context, audio, scene } = await fixture({
    transcript: 'TutorialX 42',
    words: [
      { text: 'TutorialX', startSeconds: 0, endSeconds: 0.3 },
      { text: '42', startSeconds: null, endSeconds: null },
    ],
  });
  const result = await provider.align(
    {
      audio: [audio],
      scenes: [{ ...scene, narration: 'TutorialX version 42 works' }],
      language: 'en-US',
      planRevision: 1,
    },
    context,
  );
  expect(result.captions.cues[0]!.words).toEqual([
    { text: 'TutorialX', range: { startUs: 0, endUs: 300_000 } },
  ]);
  expect(result.deviations).toEqual(
    expect.arrayContaining([
      { expected: 'version', observed: '42', range: null },
      { expected: 'works', observed: '', range: null },
      { expected: '42', observed: '42', range: null },
    ]),
  );
});

it('rejects cancellation, unsupported languages, and scene/audio mismatches', async () => {
  const { provider, context, audio, scene } = await fixture();
  await expect(
    provider.align(
      { audio: [audio], scenes: [scene], language: 'bn-BD', planRevision: 1 },
      context,
    ),
  ).rejects.toThrow('WHISPERX_LANGUAGE_UNSUPPORTED');
  await expect(
    provider.align({ audio: [audio], scenes: [], language: 'en-US', planRevision: 1 }, context),
  ).rejects.toThrow('WHISPERX_SCENE_AUDIO_MISMATCH');
  const abort = new AbortController();
  abort.abort(new Error('cancelled whisperx fixture'));
  await expect(
    provider.align(
      { audio: [audio], scenes: [scene], language: 'en-US', planRevision: 1 },
      { ...context, signal: abort.signal },
    ),
  ).rejects.toThrow('cancelled whisperx fixture');
});
