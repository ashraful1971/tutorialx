import { z } from 'zod';
import {
  digestSchema,
  hasUniqueIds,
  idSchema,
  jsonObjectSchema,
  microsecondsSchema,
  positiveIntegerSchema,
  profileReferenceSchema,
  recordShape,
  usdMicrosSchema,
} from './common.js';
import { effectiveSettingsSchema, settingsOverridesSchema } from './settings.js';

export const jobBriefSchema = z.strictObject({
  ...recordShape,
  workspaceId: idSchema,
  revision: positiveIntegerSchema,
  title: z.string().min(1).max(200),
  topic: z.string().min(1).max(20_000),
  audience: z.string().min(1).max(1000),
  instructions: z.string().max(30_000),
  sourceIds: z.array(idSchema).max(1000),
  profiles: z.array(profileReferenceSchema).max(100),
  overrides: settingsOverridesSchema,
});

export const focusRegionSchema = z
  .strictObject({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().positive().max(1),
    height: z.number().positive().max(1),
  })
  .refine(
    (region) => region.x + region.width <= 1 && region.y + region.height <= 1,
    'Focus region must fit inside its source frame.',
  );

export const locatorSchema = z.discriminatedUnion('by', [
  z.strictObject({
    by: z.literal('role'),
    role: z.string().min(1).max(100),
    name: z.string().max(500),
  }),
  z.strictObject({ by: z.literal('label'), value: z.string().min(1).max(500) }),
  z.strictObject({ by: z.literal('test-id'), value: z.string().min(1).max(500) }),
  z.strictObject({ by: z.literal('css'), value: z.string().min(1).max(1000) }),
]);

export const assertionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('visible'), locator: locatorSchema }),
  z.strictObject({ kind: z.literal('text'), locator: locatorSchema, text: z.string().max(4000) }),
  z.strictObject({ kind: z.literal('url'), url: z.httpUrl() }),
]);

const captureStepShape = {
  id: idSchema,
  description: z.string().min(1).max(1000),
  evidenceIds: z.array(idSchema).min(1).max(100),
  expected: z.array(assertionSchema).min(1).max(20),
  dwellUs: microsecondsSchema.max(60_000_000),
};

export const captureStepSchema = z.discriminatedUnion('action', [
  z.strictObject({ ...captureStepShape, action: z.literal('navigate'), url: z.httpUrl() }),
  z.strictObject({ ...captureStepShape, action: z.literal('click'), locator: locatorSchema }),
  z.strictObject({
    ...captureStepShape,
    action: z.literal('fill'),
    locator: locatorSchema,
    value: z.string().max(20_000),
  }),
  z.strictObject({ ...captureStepShape, action: z.literal('scroll'), locator: locatorSchema }),
  z.strictObject({ ...captureStepShape, action: z.literal('observe') }),
]);

export const visualSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('text'),
    headline: z.string().max(500),
    body: z.string().max(5000),
  }),
  z.strictObject({
    kind: z.literal('image'),
    assetId: idSchema,
    fit: z.enum(['contain', 'cover']),
  }),
  z.strictObject({
    kind: z.literal('video'),
    assetId: idSchema,
    startUs: microsecondsSchema,
    durationUs: microsecondsSchema.refine((value) => value > 0),
    fit: z.enum(['contain', 'cover']),
  }),
  z.strictObject({
    kind: z.literal('browser'),
    target: z.httpUrl(),
    setupRecipeId: idSchema.nullable(),
    steps: z
      .array(captureStepSchema)
      .min(1)
      .max(200)
      .refine(hasUniqueIds, 'Duplicate capture step identities.'),
    focus: focusRegionSchema.nullable(),
    maskRegions: z.array(focusRegionSchema).max(100),
  }),
  z.strictObject({
    kind: z.literal('diagram'),
    nodes: z
      .array(z.strictObject({ id: idSchema, label: z.string().max(500) }))
      .min(1)
      .max(100)
      .refine(hasUniqueIds, 'Duplicate diagram node identities.'),
    edges: z
      .array(z.strictObject({ from: idSchema, to: idSchema, label: z.string().max(200) }))
      .max(500),
  }),
  z.strictObject({
    kind: z.literal('custom'),
    providerId: idSchema,
    templateId: idSchema,
    data: jsonObjectSchema,
    requiredCapabilities: z.array(z.string().min(1).max(100)).max(100),
  }),
]);

export const scenePlanSchema = z.strictObject({
  id: idSchema,
  title: z.string().min(1).max(200),
  narration: z.string().max(20_000),
  intent: z.string().min(1).max(2000),
  evidenceIds: z.array(idSchema).max(500),
  visual: visualSchema,
  estimatedDurationUs: microsecondsSchema.refine((value) => value > 0),
  transition: z.enum(['cut', 'fade', 'slide']),
  variantFraming: z.record(
    idSchema,
    z.strictObject({
      focus: focusRegionSchema.nullable(),
      notes: z.string().max(2000),
    }),
  ),
});

export const planRevisionSchema = z.strictObject({
  ...recordShape,
  jobId: idSchema,
  revision: positiveIntegerSchema,
  basedOnJobRevision: positiveIntegerSchema,
  researchReportId: idSchema,
  evidenceDigest: digestSchema,
  effective: effectiveSettingsSchema,
  scenes: z
    .array(scenePlanSchema)
    .min(1)
    .max(2000)
    .refine(hasUniqueIds, 'Duplicate scene identities.'),
  costEstimate: z.strictObject({
    expectedUsdMicros: usdMicrosSchema,
    upperBoundUsdMicros: usdMicrosSchema.nullable(),
    uncertainty: z.array(z.string().min(1).max(1000)).max(100),
  }),
  limitations: z.array(z.string().min(1).max(2000)).max(100),
});

export type JobBrief = z.infer<typeof jobBriefSchema>;
export type ScenePlan = z.infer<typeof scenePlanSchema>;
export type PlanRevision = z.infer<typeof planRevisionSchema>;
export type CaptureStep = z.infer<typeof captureStepSchema>;
export type CaptureAssertion = z.infer<typeof assertionSchema>;
export type CaptureLocator = z.infer<typeof locatorSchema>;
export type FocusRegion = z.infer<typeof focusRegionSchema>;
