import type { CaptionTrack, Timeline } from '@tutorialx/contracts';
import {
  createNarrationQualityProfile,
  evaluateTechnicalQuality,
  resolveTechnicalQualityThresholds,
  type TechnicalMediaObservation,
} from '@tutorialx/core';
import { expect, it } from 'vitest';
import { digest, timestamp } from '../fixtures/contracts.js';

function timeline(intentional = true): Timeline {
  return {
    schemaVersion: 1,
    id: 'timeline_quality',
    createdAt: timestamp,
    jobId: 'job_quality',
    planId: 'plan_quality',
    planRevision: 1,
    settingsDigest: digest,
    variantId: 'landscape',
    frameRate: { numerator: 30, denominator: 1 },
    durationUs: 5_000_000,
    clips: [
      {
        id: 'visual_quality',
        sceneId: 'scene_quality',
        artifactId: 'visual_artifact',
        track: 'visual',
        range: { startUs: 0, endUs: 5_000_000 },
        sourceStartUs: 0,
        playbackRate: 1,
        gainDb: 0,
      },
    ],
    captionTrackId: null,
    intentionalIntervals: intentional
      ? [
          {
            sceneId: 'scene_quality',
            kind: 'hold',
            range: { startUs: 1_000_000, endUs: 2_000_000 },
            reason: 'Approved teaching pause.',
          },
          {
            sceneId: 'scene_quality',
            kind: 'silence',
            range: { startUs: 2_000_000, endUs: 3_000_000 },
            reason: 'Approved visual-only demonstration.',
          },
        ]
      : [],
  };
}

const profile = createNarrationQualityProfile({
  id: 'quality_standard_stereo',
  createdAt: timestamp,
  channels: 2,
});

const healthy: TechnicalMediaObservation = {
  decodable: true,
  fullyDecoded: true,
  durationUs: 5_000_000,
  videoDurationUs: 5_000_000,
  audioDurationUs: 5_000_000,
  width: 1920,
  height: 1080,
  frameRate: { numerator: 60, denominator: 2 },
  videoStreamCount: 1,
  audioStreamCount: 1,
  videoCodec: 'h264',
  audioCodec: 'aac',
  sampleRate: 48_000,
  channels: 2,
  loudnessLufs: -16,
  truePeakDbtp: -1.2,
  intervals: [
    { kind: 'frozen', range: { startUs: 1_000_000, endUs: 2_000_000 } },
    { kind: 'silent', range: { startUs: 2_000_000, endUs: 3_000_000 } },
  ],
};

const expectation = {
  width: 1920,
  height: 1080,
  frameRate: { numerator: 30, denominator: 1 },
  audioRequired: true,
};

it('passes a fully decoded variant and exempts only plan-annotated holds and silence', () => {
  const report = evaluateTechnicalQuality({
    profile,
    timeline: timeline(),
    captions: null,
    expectation,
    observation: healthy,
  });
  expect(report.passed).toBe(true);
  expect(report.findings).toEqual([]);
  expect(report.checks).toHaveLength(7);
});

it('fails deliberately defective final media with actionable technical findings', () => {
  const report = evaluateTechnicalQuality({
    profile,
    timeline: timeline(false),
    captions: null,
    expectation,
    observation: {
      ...healthy,
      fullyDecoded: false,
      durationUs: 4_400_000,
      videoDurationUs: 4_400_000,
      audioDurationUs: 3_900_000,
      width: 1280,
      height: 720,
      frameRate: { numerator: 24, denominator: 1 },
      loudnessLufs: -11,
      truePeakDbtp: -0.2,
      intervals: [
        { kind: 'blank', range: { startUs: 0, endUs: 800_000 } },
        { kind: 'frozen', range: { startUs: 1_000_000, endUs: 2_000_000 } },
        { kind: 'silent', range: { startUs: 2_000_000, endUs: 3_000_000 } },
      ],
    },
  });
  expect(report.passed).toBe(false);
  expect(report.findings.map((entry) => entry.code)).toEqual(
    expect.arrayContaining([
      'MEDIA_DECODE_FAILED',
      'MEDIA_TRUNCATED',
      'VIDEO_TRUNCATED',
      'AUDIO_TRUNCATED',
      'VARIANT_DIMENSIONS_MISMATCH',
      'VARIANT_FRAME_RATE_MISMATCH',
      'UNEXPECTED_BLANK_INTERVAL',
      'UNEXPECTED_FROZEN_INTERVAL',
      'UNEXPECTED_SILENT_INTERVAL',
      'AUDIO_LOUDNESS_OUT_OF_RANGE',
      'AUDIO_TRUE_PEAK_EXCEEDED',
    ]),
  );
});

it('rejects invalid caption cues and resolves calibrated version-one detector thresholds', () => {
  const boundTimeline = { ...timeline(), captionTrackId: 'captions_quality' };
  const invalidCaptions = {
    schemaVersion: 1,
    id: 'captions_quality',
    createdAt: timestamp,
    jobId: 'job_quality',
    planRevision: 1,
    audioArtifactIds: ['audio_quality'],
    language: 'en-US',
    durationUs: 5_000_000,
    cues: [
      {
        id: 'cue_quality',
        sceneId: 'scene_quality',
        text: 'Invalid overlap',
        range: { startUs: 0, endUs: 1_000_000 },
        words: [{ text: 'Invalid', range: { startUs: 900_000, endUs: 1_200_000 } }],
      },
    ],
  } as unknown as CaptionTrack;
  const report = evaluateTechnicalQuality({
    profile,
    timeline: boundTimeline,
    captions: invalidCaptions,
    expectation,
    observation: { ...healthy, intervals: [] },
  });
  expect(report.findings.map((entry) => entry.code)).toContain('CAPTION_CUES_INVALID');
  expect(resolveTechnicalQualityThresholds(profile)).toEqual({
    blankMinDurationUs: 500_000,
    frozenMinDurationUs: 750_000,
    silentMinDurationUs: 750_000,
    blackPixelRatio: 0.98,
    silenceNoiseDb: -50,
    freezeNoiseDb: -60,
  });
  expect(
    createNarrationQualityProfile({ id: 'quality_mono', createdAt: timestamp, channels: 1 })
      .targetLoudnessLufs,
  ).toBe(-19);
});
