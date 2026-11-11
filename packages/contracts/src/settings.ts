import { z } from 'zod';
import {
  frameRateSchema,
  hasUniqueIds,
  idSchema,
  languageSchema,
  microsecondsSchema,
  positiveIntegerSchema,
  providerSelectionSchema,
  timestampSchema,
  usdMicrosSchema,
} from './common.js';

export const recipeSchema = z.enum(['tutorial', 'explainer', 'asset-video', 'reel', 'mixed']);
export const variantSchema = z.strictObject({
  id: idSchema,
  aspectRatio: z.enum(['16:9', '9:16', '1:1', 'custom']),
  width: positiveIntegerSchema.min(64).max(16_384),
  height: positiveIntegerSchema.min(64).max(16_384),
  frameRate: frameRateSchema,
  codec: z.enum(['h264', 'h265', 'vp9', 'av1']),
  container: z.enum(['mp4', 'webm']),
  thumbnail: z.boolean(),
});

export const captionStyleSchema = z.strictObject({
  fontFamily: z.string().min(1).max(100),
  fontSize: positiveIntegerSchema.max(512),
  color: z.string().regex(/^#[a-fA-F0-9]{6}([a-fA-F0-9]{2})?$/),
  backgroundColor: z.string().regex(/^#[a-fA-F0-9]{6}([a-fA-F0-9]{2})?$/),
  maxLines: positiveIntegerSchema.max(6),
  position: z.enum(['top', 'center', 'bottom']),
});

const captionShape = {
  mode: z.enum(['none', 'embedded', 'sidecar', 'both']),
  formats: z.array(z.enum(['srt', 'vtt'])).max(2),
  language: languageSchema,
  style: captionStyleSchema,
};

export const captionSettingsSchema = z
  .strictObject(captionShape)
  .refine(
    (value) =>
      new Set(value.formats).size === value.formats.length &&
      (value.mode === 'sidecar' || value.mode === 'both') === value.formats.length > 0,
    { message: 'Sidecar formats must be unique and selected only for sidecar or both modes.' },
  );

export const voiceSettingsSchema = z.discriminatedUnion('mode', [
  z.strictObject({ mode: z.literal('none') }),
  z.strictObject({ mode: z.literal('supplied'), assetId: idSchema }),
  z.strictObject({
    mode: z.literal('synthesize'),
    voiceId: z.string().min(1).max(200),
    pace: z.number().min(0.25).max(4),
    tone: z.string().max(500),
    pronunciations: z.record(z.string().min(1).max(200), z.string().min(1).max(500)),
  }),
]);

export const audioSettingsSchema = z.strictObject({
  music: z.discriminatedUnion('enabled', [
    z.strictObject({ enabled: z.literal(false) }),
    z.strictObject({
      enabled: z.literal(true),
      assetId: idSchema,
      gainDb: z.number().min(-80).max(0),
    }),
  ]),
  effects: z.boolean(),
  ducking: z.boolean(),
});

export const brandSettingsSchema = z.strictObject({
  name: z.string().max(200),
  logoAssetId: idSchema.nullable(),
  fontFamily: z.string().min(1).max(100),
  primaryColor: z.string().regex(/^#[a-fA-F0-9]{6}$/),
  introTemplate: idSchema.nullable(),
  outroTemplate: idSchema.nullable(),
});

export const executionPolicySchema = z.strictObject({
  mode: z.enum(['review', 'autonomous']),
  localOnly: z.boolean(),
  budgetUsdMicros: usdMicrosSchema,
  researchBudgetUsdMicros: usdMicrosSchema,
  maxAttempts: positiveIntegerSchema.max(20),
  maxRepairs: z.number().int().min(0).max(20),
  deadlineAt: timestampSchema.nullable(),
  allowedOrigins: z.array(z.httpUrl()).max(100),
  mutationTargets: z.array(z.httpUrl()).max(100),
  requiredReviewModalities: z
    .array(z.enum(['text', 'image', 'audio', 'video']))
    .min(1)
    .max(4),
});

export const providerSettingsSchema = z.strictObject({
  renderer: providerSelectionSchema,
  voice: providerSelectionSchema.nullable(),
  capture: providerSelectionSchema.nullable(),
  alignment: providerSelectionSchema.nullable(),
  agent: providerSelectionSchema.nullable(),
  assets: providerSelectionSchema.nullable(),
});

const settingsShape = {
  recipe: recipeSchema,
  language: languageSchema,
  targetDurationUs: microsecondsSchema.nullable(),
  variants: z
    .array(variantSchema)
    .min(1)
    .max(12)
    .refine(hasUniqueIds, 'Duplicate variant identities.'),
  captions: captionSettingsSchema,
  voice: voiceSettingsSchema,
  audio: audioSettingsSchema,
  brand: brandSettingsSchema,
  providers: providerSettingsSchema,
  qualityProfileId: idSchema,
  policy: executionPolicySchema,
};

export const settingsSchema = z
  .strictObject(settingsShape)
  .refine((value) => value.voice.mode !== 'synthesize' || value.providers.voice !== null, {
    message: 'Synthesized narration requires a voice provider.',
    path: ['providers', 'voice'],
  });

/** Validate overlays before merging; validate the full result again with settingsSchema. */
export const settingsOverridesSchema = z.strictObject({
  recipe: recipeSchema.optional(),
  language: languageSchema.optional(),
  targetDurationUs: microsecondsSchema.nullable().optional(),
  variants: settingsShape.variants.optional(),
  captions: z
    .strictObject({ ...captionShape, style: captionStyleSchema.partial() })
    .partial()
    .optional(),
  voice: voiceSettingsSchema.optional(),
  audio: audioSettingsSchema.partial().optional(),
  brand: brandSettingsSchema.partial().optional(),
  providers: providerSettingsSchema.partial().optional(),
  qualityProfileId: idSchema.optional(),
  policy: executionPolicySchema.partial().optional(),
});

export const effectiveSettingsSchema = z.strictObject({
  settings: settingsSchema,
  origins: z.record(z.string().min(1), z.string().min(1)),
});

export type VideoSettings = z.infer<typeof settingsSchema>;
export type SettingsOverrides = z.infer<typeof settingsOverridesSchema>;
export type ExecutionPolicy = z.infer<typeof executionPolicySchema>;
export type EffectiveSettings = z.infer<typeof effectiveSettingsSchema>;
export type OutputVariant = z.infer<typeof variantSchema>;
