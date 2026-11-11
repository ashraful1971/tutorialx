import {
  artifactManifestSchema,
  captionTrackSchema,
  deliveryManifestSchema,
  executionEventSchema,
  microsecondsToFrame,
  operationRecordSchema,
  qualityProfileSchema,
  reviewResultSchema,
  stageAttemptSchema,
  storageReferenceSchema,
  timelineSchema,
} from '@tutorialx/contracts';
import { describe, expect, it } from 'vitest';
import { digest, timestamp } from '../fixtures/contracts.js';

const record = { schemaVersion: 1, id: 'example', createdAt: timestamp };
const media = {
  durationUs: 5_000_000,
  width: 1920,
  height: 1080,
  frameRate: { numerator: 30, denominator: 1 },
  videoCodec: 'h264',
  audioCodec: null,
  sampleRate: null,
  channels: null,
};
const artifact = {
  ...record,
  workspaceId: 'workspace',
  jobId: 'job',
  kind: 'video',
  mimeType: 'video/mp4',
  storage: { kind: 'local', path: 'jobs/job/work/render/video.mp4' },
  digest,
  sizeBytes: 1000,
  media,
  provenance: {
    stageId: 'render',
    attemptId: 'attempt',
    inputDigests: [digest],
    provider: { id: 'hyperframes', version: '1' },
    settingsDigest: digest,
    templateDigest: digest,
  },
};

const timeline = {
  ...record,
  jobId: 'job',
  planId: 'plan',
  planRevision: 1,
  settingsDigest: digest,
  variantId: 'landscape',
  frameRate: { numerator: 30, denominator: 1 },
  durationUs: 5_000_000,
  clips: [
    {
      id: 'clip',
      sceneId: 'intro',
      artifactId: 'capture',
      track: 'visual',
      range: { startUs: 0, endUs: 5_000_000 },
      sourceStartUs: 0,
      playbackRate: 1,
      gainDb: 0,
    },
  ],
  captionTrackId: null,
  intentionalIntervals: [],
};

describe('measured media and execution contracts', () => {
  it('round-trips artifact, timeline, and operational records', () => {
    expect(artifactManifestSchema.parse(JSON.parse(JSON.stringify(artifact)))).toEqual(artifact);
    expect(timelineSchema.parse(JSON.parse(JSON.stringify(timeline)))).toEqual(timeline);
    const operation = {
      ...record,
      jobId: 'job',
      attemptId: 'attempt',
      idempotencyKey: digest,
      providerId: 'voice',
      providerRequestId: 'external-123',
      sideEffect: 'reconcilable',
      status: 'uncertain',
      reservedUsdMicros: 10_000,
      actualUsdMicros: null,
      diagnostic: null,
    };
    expect(operationRecordSchema.parse(JSON.parse(JSON.stringify(operation)))).toEqual(operation);
    const event = {
      ...record,
      workspaceId: 'workspace',
      jobId: 'job',
      attemptId: 'attempt',
      cursor: 1,
      requestId: 'request',
      traceId: 'trace',
      kind: 'attempt_started',
      level: 'info',
      data: { stageId: 'render' },
    };
    expect(executionEventSchema.parse(JSON.parse(JSON.stringify(event)))).toEqual(event);
  });

  it.each([
    '../secret',
    '/absolute/path',
    'C:\\private\\secret',
    'work/../secret',
    'work//video',
    'work/\0secret',
  ])('rejects nonportable artifact path %s', (path) =>
    expect(storageReferenceSchema.safeParse({ kind: 'local', path }).success).toBe(false),
  );

  it('rejects media artifacts without measured metadata', () => {
    expect(artifactManifestSchema.safeParse({ ...artifact, media: null }).success).toBe(false);
    expect(
      artifactManifestSchema.safeParse({ ...artifact, media: { ...media, width: null } }).success,
    ).toBe(false);
    expect(
      artifactManifestSchema.safeParse({ ...artifact, media: { ...media, durationUs: 0 } }).success,
    ).toBe(false);
    expect(artifactManifestSchema.safeParse({ ...artifact, sizeBytes: -1 }).success).toBe(false);
    expect(artifactManifestSchema.safeParse({ ...artifact, schemaVersion: 2 }).success).toBe(false);
  });

  it('rejects clips outside the final duration and backwards intervals', () => {
    expect(timelineSchema.safeParse({ ...timeline, durationUs: 1_000_000 }).success).toBe(false);
    expect(
      timelineSchema.safeParse({
        ...timeline,
        clips: [{ ...timeline.clips[0], range: { startUs: 4, endUs: 2 } }],
      }).success,
    ).toBe(false);
  });

  it('requires caption cues and words to be ordered and inside their track', () => {
    const cue = {
      id: 'cue_one',
      sceneId: 'intro',
      text: 'Welcome',
      range: { startUs: 0, endUs: 1_000_000 },
      words: [{ text: 'Welcome', range: { startUs: 0, endUs: 800_000 } }],
    };
    const track = {
      ...record,
      jobId: 'job',
      planRevision: 1,
      audioArtifactIds: ['audio'],
      language: 'en-US',
      durationUs: 5_000_000,
      cues: [cue],
    };
    expect(captionTrackSchema.safeParse(track).success).toBe(true);
    expect(
      captionTrackSchema.safeParse({ ...track, cues: [cue, { ...cue, id: 'cue_two' }] }).success,
    ).toBe(false);
    expect(
      captionTrackSchema.safeParse({
        ...track,
        cues: [{ ...cue, words: [{ text: 'Welcome', range: { startUs: 0, endUs: 2_000_000 } }] }],
      }).success,
    ).toBe(false);
  });

  it('requires leases for running attempts and reasons for waits', () => {
    const attempt = {
      ...record,
      jobId: 'job',
      jobRevision: 1,
      stageId: 'render',
      stageKind: 'render',
      attempt: 1,
      inputDigest: digest,
      status: 'waiting',
      lease: null,
      waitReason: 'approval',
      startedAt: null,
      finishedAt: null,
      outputArtifactIds: [],
      diagnostic: null,
    };
    expect(stageAttemptSchema.safeParse(attempt).success).toBe(true);
    expect(stageAttemptSchema.safeParse({ ...attempt, waitReason: null }).success).toBe(false);
    expect(
      stageAttemptSchema.safeParse({ ...attempt, status: 'running', waitReason: null }).success,
    ).toBe(false);
  });

  it('rejects a passing review containing an inconclusive check', () => {
    const profile = {
      ...record,
      revision: 1,
      requiredChecks: ['decode'],
      requiredModalities: ['image'],
      maxSyncErrorUs: 250_000,
      targetLoudnessLufs: -16,
      loudnessToleranceLu: 1,
      maxTruePeakDbtp: -1,
      minTextHeightRatio: 0.03,
      maxRepairs: 2,
    };
    expect(qualityProfileSchema.safeParse(profile).success).toBe(true);
    expect(
      reviewResultSchema.safeParse({
        ...record,
        jobId: 'job',
        planRevision: 1,
        variantId: 'landscape',
        reviewerId: 'reviewer',
        profileId: 'standard',
        profileRevision: 1,
        outcome: 'pass',
        checks: [{ id: 'decode', outcome: 'inconclusive' }],
        coverage: [],
        findingIds: [],
        limitations: [],
      }).success,
    ).toBe(false);
  });

  it('requires one video, review references, and unique delivery paths', () => {
    const file = { role: 'video', artifactId: 'video', path: 'video.mp4', digest, sizeBytes: 1000 };
    const delivery = {
      ...record,
      jobId: 'job',
      planId: 'plan',
      planRevision: 1,
      variantId: 'landscape',
      settingsDigest: digest,
      reviewResultIds: ['review'],
      files: [file],
      providerVersions: { hyperframes: '1' },
      templateDigests: [digest],
      attribution: [],
    };
    expect(deliveryManifestSchema.parse(JSON.parse(JSON.stringify(delivery)))).toEqual(delivery);
    expect(deliveryManifestSchema.safeParse({ ...delivery, files: [file, file] }).success).toBe(
      false,
    );
    expect(deliveryManifestSchema.safeParse({ ...delivery, reviewResultIds: [] }).success).toBe(
      false,
    );
  });
});

describe('frame rounding at the renderer boundary', () => {
  it('rounds exact half frames forward', () => {
    const rate = { numerator: 20, denominator: 1 };
    expect(microsecondsToFrame(24_999, rate)).toBe(0);
    expect(microsecondsToFrame(25_000, rate)).toBe(1);
    expect(microsecondsToFrame(25_001, rate)).toBe(1);
  });

  it('preserves rational rates and long-duration timing', () => {
    expect(microsecondsToFrame(1_001_000_000, { numerator: 30_000, denominator: 1001 })).toBe(
      30_000,
    );
    expect(microsecondsToFrame(3_600_000_000, { numerator: 30_000, denominator: 1001 })).toBe(
      107_892,
    );
    expect(microsecondsToFrame(108_000_000_000, { numerator: 30, denominator: 1 })).toBe(3_240_000);
  });

  it('rejects fractional microseconds, negative times, and invalid denominators', () => {
    expect(() => microsecondsToFrame(0.5, { numerator: 30, denominator: 1 })).toThrow();
    expect(() => microsecondsToFrame(-1, { numerator: 30, denominator: 1 })).toThrow();
    expect(() => microsecondsToFrame(1, { numerator: 30, denominator: 0 })).toThrow();
  });
});
