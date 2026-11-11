import { z } from 'zod';
import { idSchema, microsecondsSchema, positiveIntegerSchema, recordShape } from './common.js';
import { timeRangeSchema } from './timeline.js';

export const reviewModalitySchema = z.enum(['text', 'image', 'audio', 'video']);
export const qualityProfileSchema = z.strictObject({
  ...recordShape,
  revision: positiveIntegerSchema,
  requiredChecks: z.array(idSchema).min(1).max(1000),
  requiredModalities: z.array(reviewModalitySchema).min(1).max(4),
  maxSyncErrorUs: microsecondsSchema,
  targetLoudnessLufs: z.number().min(-60).max(0),
  loudnessToleranceLu: z.number().min(0).max(20),
  maxTruePeakDbtp: z.number().min(-60).max(0),
  minTextHeightRatio: z.number().positive().max(1),
  maxRepairs: z.number().int().min(0).max(20),
});

export const qualityFindingSchema = z.strictObject({
  ...recordShape,
  jobId: idSchema,
  sceneId: idSchema.nullable(),
  variantId: idSchema,
  code: z.string().regex(/^[A-Z][A-Z0-9_]{0,99}$/),
  severity: z.enum(['info', 'warning', 'error']),
  message: z.string().min(1).max(4000),
  range: timeRangeSchema.nullable(),
  evidenceArtifactIds: z.array(idSchema).min(1).max(100),
  repair: z.enum([
    'none',
    'plan',
    'capture',
    'voice',
    'alignment',
    'timeline',
    'composition',
    'mix',
    'render',
  ]),
  materialChange: z.boolean(),
});

export const reviewResultSchema = z
  .strictObject({
    ...recordShape,
    jobId: idSchema,
    planRevision: positiveIntegerSchema,
    variantId: idSchema,
    reviewerId: idSchema,
    profileId: idSchema,
    profileRevision: positiveIntegerSchema,
    outcome: z.enum(['pass', 'fail', 'inconclusive']),
    checks: z
      .array(z.strictObject({ id: idSchema, outcome: z.enum(['pass', 'fail', 'inconclusive']) }))
      .max(1000),
    coverage: z
      .array(
        z.strictObject({
          sceneId: idSchema,
          range: timeRangeSchema,
          modalities: z.array(reviewModalitySchema).min(1).max(4),
        }),
      )
      .max(10_000),
    findingIds: z.array(idSchema).max(10_000),
    limitations: z.array(z.string().min(1).max(2000)).max(100),
  })
  .refine(
    (review) =>
      review.outcome !== 'pass' ||
      (review.checks.length > 0 && review.checks.every((check) => check.outcome === 'pass')),
    'Passing review cannot contain failed or inconclusive checks.',
  );

export type QualityProfile = z.infer<typeof qualityProfileSchema>;
export type QualityFinding = z.infer<typeof qualityFindingSchema>;
export type ReviewResult = z.infer<typeof reviewResultSchema>;
export type ReviewModality = z.infer<typeof reviewModalitySchema>;
