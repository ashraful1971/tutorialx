import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGoogleSpeechProvider, type GoogleSpeechTransport } from '@tutorialx/adapters';
import {
  inspectProviderConformance,
  type JsonObject,
  type OperationContext,
  voiceResultSchema,
} from '@tutorialx/contracts';
import { afterEach, describe, expect, it } from 'vitest';
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

const config: JsonObject = {
  languages: ['en-US'],
  sampleRateHertz: 24_000,
  tonePitches: { warm: -1 },
  usdMicrosPerMillionCharacters: 4_000_000,
};

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'tutorialx-google-speech-'));
  roots.push(root);
  const calls: Array<{ path: string; body?: JsonObject }> = [];
  const transport: GoogleSpeechTransport = {
    async request(path, init, signal) {
      signal.throwIfAborted();
      calls.push({ path, ...(init.body ? { body: init.body } : {}) });
      if (path === '/v1/voices')
        return {
          status: 200,
          body: {
            voices: [
              { name: 'en-US-Neural2-A', languageCodes: ['en-US'] },
              { name: 'fr-FR-Neural2-A', languageCodes: ['fr-FR'] },
            ],
          },
          headers: {},
        };
      return {
        status: 200,
        body: {
          audioContent: wav().toString('base64'),
          timepoints: [
            { markName: 'w0', timeSeconds: 0 },
            { markName: 'w1', timeSeconds: 0.4 },
          ],
        },
        headers: { 'x-goog-request-id': 'google-request-fixture' },
      };
    },
  };
  const provider = createGoogleSpeechProvider(config, {
    workspaceId: 'workspace_google',
    settingsDigest: digest,
    transport,
    now: () => '2026-11-19T00:00:00.000Z',
  });
  const context: OperationContext = {
    operationId: 'operation_google',
    jobId: 'job_google',
    attemptId: 'attempt_google',
    reservationId: 'reservation_google',
    outputDirectory: join(root, 'output'),
    deadlineAt: '2099-01-01T00:00:00Z',
    signal: new AbortController().signal,
  };
  return { root, calls, provider, context };
}

it('discovers configured voices and passes common provider conformance', async () => {
  const { provider, context } = await fixture();
  expect(
    await inspectProviderConformance(provider, {
      kind: 'voice',
      validConfiguration: config,
      invalidConfiguration: { ...config, unknown: true },
      estimateOperation: 'synthesize',
      estimateInput: { text: 'Hello' },
      context,
    }),
  ).toEqual([]);
  expect(await provider.voices(context)).toEqual([
    {
      id: 'en-US-Neural2-A',
      name: 'en-US-Neural2-A',
      language: 'en-US',
      controls: ['pace', 'tone:warm', 'pronunciations'],
    },
  ]);
});

it('handles delivery controls, pronunciation, timing, receipt, usage, and measured output', async () => {
  const { calls, provider, context } = await fixture();
  const result = voiceResultSchema.parse(
    await provider.synthesize(
      {
        sceneId: 'scene_google',
        text: 'TutorialX works',
        language: 'en-US',
        voiceId: 'en-US-Neural2-A',
        pace: 1.1,
        tone: 'warm',
        pronunciations: { TutorialX: 'Tutorial X' },
      },
      context,
    ),
  );
  const request = calls.at(-1)!.body!;
  expect(request.input).toMatchObject({
    ssml: expect.stringContaining('<sub alias="Tutorial X">TutorialX</sub>'),
  });
  expect(request.audioConfig).toMatchObject({ speakingRate: 1.1, pitch: -1 });
  expect(result.providerRequestId).toBe('google-request-fixture');
  expect(result.actualUsdMicros).toBe(60);
  expect(result.words).toEqual([
    { text: 'TutorialX', range: { startUs: 0, endUs: 400_000 } },
    { text: 'works', range: { startUs: 400_000, endUs: 1_000_000 } },
  ]);
  expect(result.audio.media).toMatchObject({
    durationUs: 1_000_000,
    sampleRate: 24_000,
    channels: 1,
    audioCodec: 'pcm_s16le',
  });
  expect(await readFile(join(context.outputDirectory, 'operation_google.wav'))).toEqual(wav());
});

it('reports missing credentials and rejects unsupported controls, cancellation, and deadlines', async () => {
  const unavailable = createGoogleSpeechProvider(config, {
    workspaceId: 'workspace_google',
    settingsDigest: digest,
  });
  expect(await unavailable.readiness()).toMatchObject({
    ready: false,
    diagnostics: [{ code: 'GOOGLE_SPEECH_CREDENTIAL_MISSING' }],
  });
  const { provider, context } = await fixture();
  const request = {
    sceneId: 'scene_google',
    text: 'Hello world',
    language: 'en-US',
    voiceId: 'en-US-Neural2-A',
    pace: 1,
    tone: '',
    pronunciations: {},
  };
  await expect(provider.synthesize({ ...request, tone: 'unknown' }, context)).rejects.toThrow(
    'TONE_UNSUPPORTED',
  );
  const abort = new AbortController();
  abort.abort(new Error('cancelled google fixture'));
  await expect(provider.synthesize(request, { ...context, signal: abort.signal })).rejects.toThrow(
    'cancelled',
  );
  await expect(
    provider.synthesize(request, { ...context, deadlineAt: '2000-01-01T00:00:00Z' }),
  ).rejects.toThrow('DEADLINE_EXCEEDED');
});

const liveToken = process.env.GOOGLE_SPEECH_ACCESS_TOKEN;
describe.skipIf(!liveToken)('live Google speech', () => {
  it('synthesizes a separately identified real-service smoke segment', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tutorialx-google-speech-live-'));
    roots.push(root);
    const provider = createGoogleSpeechProvider(config, {
      workspaceId: 'workspace_google_live',
      settingsDigest: digest,
      accessToken: async () => liveToken!,
    });
    const context: OperationContext = {
      operationId: 'operation_google_live',
      jobId: 'job_google_live',
      attemptId: 'attempt_google_live',
      reservationId: 'reservation_google_live',
      outputDirectory: join(root, 'output'),
      deadlineAt: new Date(Date.now() + 120_000).toISOString(),
      signal: new AbortController().signal,
    };
    const voices = await provider.voices(context);
    const voice = voices.find((entry) => entry.language === 'en-US');
    expect(voice).toBeDefined();
    const result = await provider.synthesize(
      {
        sceneId: 'scene_google_live',
        text: 'TutorialX live speech smoke test.',
        language: 'en-US',
        voiceId: voice!.id,
        pace: 1,
        tone: '',
        pronunciations: {},
      },
      context,
    );
    expect(result.audio.sizeBytes).toBeGreaterThan(44);
    expect(result.providerRequestId).not.toBeNull();
  });
});
