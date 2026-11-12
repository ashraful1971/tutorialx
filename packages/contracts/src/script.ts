import { z } from 'zod';
import { idSchema, microsecondsSchema, positiveIntegerSchema } from './common.js';
import { scenePlanSchema } from './planning.js';
import {
  captionSettingsSchema,
  recipeSchema,
  variantSchema,
  voiceSettingsSchema,
} from './settings.js';

export const scriptSceneSchema = z.strictObject({
  order: positiveIntegerSchema,
  startUs: microsecondsSchema,
  endUs: microsecondsSchema,
  scene: scenePlanSchema,
});
export const productionScriptSchema = z.strictObject({
  schemaVersion: z.literal(1),
  jobId: idSchema,
  planId: idSchema,
  planRevision: positiveIntegerSchema,
  recipe: recipeSchema,
  language: z.string().min(1).max(100),
  estimatedDurationUs: microsecondsSchema,
  timingBasis: z.literal('planning-estimate'),
  variants: z.array(variantSchema).min(1).max(12),
  captions: captionSettingsSchema,
  voice: voiceSettingsSchema,
  scenes: z.array(scriptSceneSchema).min(1).max(2000),
  assetNeeds: z
    .array(
      z.strictObject({
        assetId: idSchema,
        kind: z.enum(['image', 'video', 'audio']),
        sceneIds: z.array(idSchema).max(2000),
        uses: z
          .array(z.enum(['visual', 'voice', 'music', 'logo']))
          .min(1)
          .max(4),
      }),
    )
    .max(4000),
});
export type ProductionScript = z.infer<typeof productionScriptSchema>;
