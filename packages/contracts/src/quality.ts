import { z } from 'zod';
import {
  hasUniqueIds,
  idSchema,
  microsecondsSchema,
  positiveIntegerSchema,
  recordShape,
} from './common.js';
import { type TimeRange, timeRangeSchema } from './timeline.js';

export const reviewModalitySchema = z.enum(['text', 'image', 'audio', 'video']);
export const technicalQualityThresholdsSchema = z.strictObject({
  blankMinDurationUs: positiveIntegerSchema,
  frozenMinDurationUs: positiveIntegerSchema,
  silentMinDurationUs: positiveIntegerSchema,
  blackPixelRatio: z.number().positive().max(1),
  silenceNoiseDb: z.number().min(-100).max(0),
  freezeNoiseDb: z.number().min(-100).max(0),
});
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
  /** Optional for stored v1 profiles; maintained profiles always resolve explicit detector values. */
  technical: technicalQualityThresholdsSchema.optional(),
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

export const reviewEvidenceSchema = z
  .strictObject({
    id: idSchema,
    sceneId: idSchema,
    kind: z.enum(['final-frame', 'final-clip', 'transcript', 'audio', 'capture']),
    artifactId: idSchema,
    range: timeRangeSchema,
    modalities: z.array(reviewModalitySchema).min(1).max(4),
  })
  .refine((item) => {
    const allowed: Record<typeof item.kind, readonly ReviewModality[]> = {
      'final-frame': ['image'],
      'final-clip': ['video', 'audio'],
      transcript: ['text'],
      audio: ['audio'],
      capture: ['image', 'video'],
    };
    const required: Partial<Record<typeof item.kind, ReviewModality>> = {
      'final-frame': 'image',
      'final-clip': 'video',
      transcript: 'text',
      audio: 'audio',
    };
    return (
      item.modalities.every((modality) => allowed[item.kind].includes(modality)) &&
      (required[item.kind] === undefined || item.modalities.includes(required[item.kind]!))
    );
  }, 'Review evidence modalities must match the evidence kind.');

export const reviewPackSchema = z
  .strictObject({
    ...recordShape,
    jobId: idSchema,
    planRevision: positiveIntegerSchema,
    variantId: idSchema,
    profileId: idSchema,
    profileRevision: positiveIntegerSchema,
    finalVideoArtifactId: idSchema,
    scenes: z
      .array(z.strictObject({ sceneId: idSchema, range: timeRangeSchema }))
      .min(1)
      .max(2000)
      .refine(
        (scenes) => new Set(scenes.map((scene) => scene.sceneId)).size === scenes.length,
        'Duplicate review-pack scenes.',
      ),
    evidence: z
      .array(reviewEvidenceSchema)
      .min(1)
      .max(20_000)
      .refine(hasUniqueIds, 'Duplicate review evidence identities.'),
    availableCoverage: z
      .array(
        z.strictObject({
          sceneId: idSchema,
          range: timeRangeSchema,
          modalities: z.array(reviewModalitySchema).min(1).max(4),
          evidenceIds: z.array(idSchema).min(1).max(100),
        }),
      )
      .max(20_000),
    limitations: z.array(z.string().min(1).max(2000)).max(100),
  })
  .refine((pack) => {
    const scenes = new Map(pack.scenes.map((scene) => [scene.sceneId, scene.range]));
    const evidence = new Map(pack.evidence.map((item) => [item.id, item]));
    const inside = (sceneId: string, range: TimeRange) => {
      const scene = scenes.get(sceneId);
      return scene !== undefined && range.startUs >= scene.startUs && range.endUs <= scene.endUs;
    };
    return (
      pack.evidence.every((item) => inside(item.sceneId, item.range)) &&
      pack.availableCoverage.every((coverage) => {
        const references = coverage.evidenceIds.map((id) => evidence.get(id));
        return (
          inside(coverage.sceneId, coverage.range) &&
          references.every((item) => item?.sceneId === coverage.sceneId) &&
          coverage.modalities.every((modality) =>
            references.some(
              (item) =>
                item?.modalities.includes(modality) &&
                item.range.startUs <= coverage.range.startUs &&
                item.range.endUs >= coverage.range.endUs,
            ),
          )
        );
      })
    );
  }, 'Review evidence and coverage must remain inside their scene and reference known evidence.');

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
export type TechnicalQualityThresholds = z.infer<typeof technicalQualityThresholdsSchema>;
export type QualityFinding = z.infer<typeof qualityFindingSchema>;
export type ReviewEvidence = z.infer<typeof reviewEvidenceSchema>;
export type ReviewPack = z.infer<typeof reviewPackSchema>;
export type ReviewResult = z.infer<typeof reviewResultSchema>;
export type ReviewModality = z.infer<typeof reviewModalitySchema>;
