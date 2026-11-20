import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSuppliedNarrationProvider, normalizeProviderWordTimings } from '@tutorialx/adapters';
import {
  inspectProviderConformance,
  type OperationContext,
  voiceResultSchema,
} from '@tutorialx/contracts';
import { decideNarrationTiming } from '@tutorialx/core';
import { afterEach, expect, it } from 'vitest';
import { digest } from '../fixtures/contracts.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function wav() {
  const bytes = Buffer.alloc(48_044);
  bytes.write('RIFF');
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(24_000, 24);
  bytes.writeUInt32LE(48_000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(48_000, 40);
  return bytes;
}

async function fixture(withTiming = true) {
  const root = await mkdtemp(join(tmpdir(), 'tutorialx-supplied-narration-'));
  roots.push(root);
  const source = join(root, 'narration.wav');
  await writeFile(source, wav());
  const config = { maxBytes: 1_000_000 };
  const provider = createSuppliedNarrationProvider(config, {
    workspaceId: 'workspace_supplied',
    settingsDigest: digest,
    now: () => '2026-11-20T00:00:00.000Z',
    segments: {
      scene_intro: {
        path: source,
        text: 'Hello TutorialX',
        language: 'en-US',
        ...(withTiming
          ? {
              timings: [
                { text: 'Hello', start: 0, end: 400, unit: 'milliseconds' as const },
                { text: 'TutorialX', start: 0.4, unit: 'seconds' as const },
              ],
            }
          : {}),
      },
    },
  });
  const context: OperationContext = {
    operationId: 'operation_supplied',
    jobId: 'job_supplied',
    attemptId: 'attempt_supplied',
    reservationId: null,
    outputDirectory: join(root, 'output'),
    deadlineAt: '2099-01-01T00:00:00Z',
    signal: new AbortController().signal,
  };
  const request = {
    sceneId: 'scene_intro',
    text: 'Hello TutorialX',
    language: 'en-US',
    voiceId: 'supplied-en-us',
    pace: 1,
    tone: '',
    pronunciations: {},
  };
  return { root, source, config, provider, context, request };
}

it('passes voice conformance and copies supplied audio with normalized native timing', async () => {
  const { provider, config, context, request, source } = await fixture();
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
  const result = voiceResultSchema.parse(await provider.synthesize(request, context));
  expect(result.words).toEqual([
    { text: 'Hello', range: { startUs: 0, endUs: 400_000 } },
    { text: 'TutorialX', range: { startUs: 400_000, endUs: 1_000_000 } },
  ]);
  expect(result.audio.media).toMatchObject({
    durationUs: 1_000_000,
    sampleRate: 24_000,
    channels: 1,
  });
  expect(result.audio.provenance.provider).toEqual({ id: 'supplied-narration', version: '1.0.0' });
  expect(await readFile(join(context.outputDirectory, 'operation_supplied.wav'))).toEqual(
    await readFile(source),
  );
  expect(decideNarrationTiming(result)).toMatchObject({ status: 'native-timing' });
});

it('requires alignment when supplied audio has no word timestamps', async () => {
  const { provider, context, request } = await fixture(false);
  const result = voiceResultSchema.parse(await provider.synthesize(request, context));
  expect(result.words).toBeNull();
  expect(decideNarrationTiming(result)).toEqual({
    status: 'alignment-required',
    reason: 'word-timing-unavailable',
    audioArtifactId: 'operation_supplied',
  });
});

it('rejects malformed native timing instead of inventing or repairing cues', () => {
  expect(() =>
    normalizeProviderWordTimings(
      [
        { text: 'late', start: 800, end: 900, unit: 'milliseconds' },
        { text: 'early', start: 200, end: 300, unit: 'milliseconds' },
      ],
      1_000_000,
    ),
  ).toThrow('SUPPLIED_TIMING_RANGE_INVALID');
});

it('rejects changed words, delivery controls, cancellation, deadlines, and malformed audio', async () => {
  const { provider, context, request, source } = await fixture();
  await expect(provider.synthesize({ ...request, text: 'Changed' }, context)).rejects.toThrow(
    'SUPPLIED_NARRATION_REQUEST_MISMATCH',
  );
  await expect(provider.synthesize({ ...request, pace: 1.1 }, context)).rejects.toThrow(
    'SUPPLIED_NARRATION_REQUEST_MISMATCH',
  );
  const abort = new AbortController();
  abort.abort(new Error('cancelled supplied narration'));
  await expect(provider.synthesize(request, { ...context, signal: abort.signal })).rejects.toThrow(
    'cancelled',
  );
  await expect(
    provider.synthesize(request, { ...context, deadlineAt: '2000-01-01T00:00:00Z' }),
  ).rejects.toThrow('SUPPLIED_NARRATION_DEADLINE_EXCEEDED');
  await writeFile(source, 'not WAV audio');
  expect(await provider.readiness()).toMatchObject({
    ready: false,
    diagnostics: [{ code: 'SUPPLIED_NARRATION_UNAVAILABLE' }],
  });
});
