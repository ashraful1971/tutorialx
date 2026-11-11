import { z } from 'zod';
import {
  digestSchema,
  frameRateSchema,
  hasUniqueIds,
  idSchema,
  languageSchema,
  microsecondsSchema,
  positiveIntegerSchema,
  recordShape,
} from './common.js';

export const timeRangeSchema = z
  .strictObject({ startUs: microsecondsSchema, endUs: microsecondsSchema })
  .refine((range) => range.endUs > range.startUs, 'Time ranges must have positive duration.');

export const timedWordSchema = z.strictObject({
  text: z.string().min(1).max(500),
  range: timeRangeSchema,
});
export const captionCueSchema = z
  .strictObject({
    id: idSchema,
    sceneId: idSchema,
    text: z.string().min(1).max(4000),
    range: timeRangeSchema,
    words: z.array(timedWordSchema).max(2000),
  })
  .refine(
    (cue) =>
      cue.words.every(
        (word, index) =>
          word.range.startUs >= cue.range.startUs &&
          word.range.endUs <= cue.range.endUs &&
          (index === 0 || word.range.startUs >= (cue.words[index - 1]?.range.endUs ?? 0)),
      ),
    'Word timings must be ordered and fit inside their cue.',
  );

export const captionTrackSchema = z
  .strictObject({
    ...recordShape,
    jobId: idSchema,
    planRevision: positiveIntegerSchema,
    audioArtifactIds: z.array(idSchema).min(1).max(2000),
    language: languageSchema,
    durationUs: microsecondsSchema,
    cues: z
      .array(captionCueSchema)
      .max(100_000)
      .refine(hasUniqueIds, 'Duplicate caption identities.'),
  })
  .refine(
    (track) =>
      track.cues.every(
        (cue, index) =>
          cue.range.endUs <= track.durationUs &&
          (index === 0 || cue.range.startUs >= (track.cues[index - 1]?.range.endUs ?? 0)),
      ),
    'Caption cues must be ordered, nonoverlapping, and inside the track.',
  );

export const timelineClipSchema = z.strictObject({
  id: idSchema,
  sceneId: idSchema,
  artifactId: idSchema,
  track: z.enum(['visual', 'voice', 'music', 'effect']),
  range: timeRangeSchema,
  sourceStartUs: microsecondsSchema,
  playbackRate: z.number().positive().max(4),
  gainDb: z.number().min(-80).max(12),
});

export const timelineSchema = z
  .strictObject({
    ...recordShape,
    jobId: idSchema,
    planId: idSchema,
    planRevision: positiveIntegerSchema,
    settingsDigest: digestSchema,
    variantId: idSchema,
    frameRate: frameRateSchema,
    durationUs: microsecondsSchema.refine((value) => value > 0),
    clips: z
      .array(timelineClipSchema)
      .max(100_000)
      .refine(hasUniqueIds, 'Duplicate clip identities.'),
    captionTrackId: idSchema.nullable(),
    intentionalIntervals: z
      .array(
        z.strictObject({
          sceneId: idSchema,
          kind: z.enum(['hold', 'silence', 'blank']),
          range: timeRangeSchema,
          reason: z.string().min(1).max(1000),
        }),
      )
      .max(10_000),
  })
  .refine(
    (timeline) =>
      timeline.clips.every((clip) => clip.range.endUs <= timeline.durationUs) &&
      timeline.intentionalIntervals.every(
        (interval) => interval.range.endUs <= timeline.durationUs,
      ),
    'Clips and intentional intervals must fit inside the timeline.',
  );

/** Nearest frame; an exact half-frame rounds forward. BigInt avoids intermediate float drift. */
export function microsecondsToFrame(timeUs: number, rate: z.infer<typeof frameRateSchema>): number {
  microsecondsSchema.parse(timeUs);
  frameRateSchema.parse(rate);
  const numerator = BigInt(timeUs) * BigInt(rate.numerator);
  const denominator = 1_000_000n * BigInt(rate.denominator);
  const result = (numerator * 2n + denominator) / (denominator * 2n);
  if (result > BigInt(Number.MAX_SAFE_INTEGER))
    throw new RangeError('Frame count exceeds safe integer range.');
  return Number(result);
}

export type Timeline = z.infer<typeof timelineSchema>;
export type TimelineClip = z.infer<typeof timelineClipSchema>;
export type CaptionTrack = z.infer<typeof captionTrackSchema>;
export type CaptionCue = z.infer<typeof captionCueSchema>;
export type TimeRange = z.infer<typeof timeRangeSchema>;
