import { timelineSchema } from '@tutorialx/contracts';
import {
  attachCaptionTrack,
  buildFinalCaptionTrack,
  serializeSrt,
  serializeWebVtt,
} from '@tutorialx/core';
import { expect, it } from 'vitest';
import { digest } from '../fixtures/contracts.js';

function input() {
  return {
    id: 'captions_final',
    createdAt: '2026-11-20T00:00:00.000Z',
    jobId: 'job_captions',
    planRevision: 1,
    audioArtifactIds: ['audio_intro'],
    language: 'bn-BD',
    durationUs: 4_000_000,
    words: [
      { sceneId: 'intro', text: 'স্বাগতম', range: { startUs: 100, endUs: 800_100 } },
      { sceneId: 'intro', text: 'TutorialX-এ', range: { startUs: 800_100, endUs: 1_600_100 } },
      { sceneId: 'intro', text: 'আজ', range: { startUs: 1_600_100, endUs: 2_000_100 } },
      { sceneId: 'intro', text: 'শিখুন', range: { startUs: 2_000_100, endUs: 2_800_100 } },
    ],
    maxCharactersPerLine: 18,
    maxLines: 2,
    maxCueDurationUs: 3_000_000,
  };
}

it('builds one Unicode-safe final track with readable line breaks and language metadata', () => {
  const track = buildFinalCaptionTrack(input());
  expect(track.language).toBe('bn-BD');
  expect(track.cues).toHaveLength(1);
  expect(track.cues[0]!.text).toBe('স্বাগতম TutorialX-এ\nআজ শিখুন');
  expect(track.cues[0]!.words.map((word) => word.text)).toEqual([
    'স্বাগতম',
    'TutorialX-এ',
    'আজ',
    'শিখুন',
  ]);
});

it('serializes the same final track to SRT and WebVTT without trimming sub-millisecond edges', () => {
  const track = buildFinalCaptionTrack(input());
  expect(serializeSrt(track)).toContain(
    '1\n00:00:00,000 --> 00:00:02,801\nস্বাগতম TutorialX-এ\nআজ শিখুন',
  );
  expect(serializeWebVtt(track)).toContain(
    'WEBVTT\nLanguage: bn-BD\n\ncue_1\n00:00:00.000 --> 00:00:02.801',
  );
});

it('rejects overlapping and out-of-range word timing', () => {
  const overlap = input();
  overlap.words[1]!.range.startUs = 700_000;
  expect(() => buildFinalCaptionTrack(overlap)).toThrow('CAPTION_WORD_RANGES_INVALID');
  const outside = input();
  outside.words.at(-1)!.range.endUs = outside.durationUs + 1;
  expect(() => buildFinalCaptionTrack(outside)).toThrow('CAPTION_WORD_RANGES_INVALID');
});

it('binds captions only to the matching timeline revision and leaves older tracks immutable', () => {
  const first = buildFinalCaptionTrack(input());
  const revisedInput = input();
  revisedInput.id = 'captions_revised';
  revisedInput.planRevision = 2;
  revisedInput.words[2]!.range = { startUs: 1_700_000, endUs: 2_100_000 };
  revisedInput.words[3]!.range = { startUs: 2_100_000, endUs: 2_900_000 };
  const revised = buildFinalCaptionTrack(revisedInput);
  expect(first.planRevision).toBe(1);
  expect(first.cues[0]!.words[2]!.range.startUs).toBe(1_600_100);
  expect(revised.planRevision).toBe(2);

  const timeline = timelineSchema.parse({
    schemaVersion: 1,
    id: 'timeline_captions',
    createdAt: '2026-11-20T00:00:00.000Z',
    jobId: 'job_captions',
    planId: 'plan_captions',
    planRevision: 2,
    settingsDigest: digest,
    variantId: 'landscape',
    frameRate: { numerator: 30, denominator: 1 },
    durationUs: 4_000_000,
    clips: [],
    captionTrackId: null,
    intentionalIntervals: [],
  });
  expect(attachCaptionTrack(timeline, revised).captionTrackId).toBe('captions_revised');
  expect(() => attachCaptionTrack(timeline, first)).toThrow('CAPTION_TIMELINE_REVISION_MISMATCH');
});
