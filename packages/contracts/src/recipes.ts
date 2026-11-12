import { z } from 'zod';
import { digestSchema, idSchema, positiveIntegerSchema } from './common.js';
import { jobBriefSchema } from './planning.js';
import { effectiveSettingsSchema, recipeSchema } from './settings.js';
import { profileSnapshotSchema } from './workspace.js';

export const recipeDefinitionSchema = z.strictObject({
  id: recipeSchema,
  purpose: z.string().min(1).max(1000),
  supportedVisuals: z
    .array(z.enum(['text', 'image', 'video', 'browser', 'diagram', 'custom']))
    .min(1)
    .max(6),
  requiredMaterials: z.enum(['evidence', 'demonstration', 'assets']),
  suggestedDurationUs: positiveIntegerSchema.nullable(),
});

export const resolvedProductionBriefSchema = z.strictObject({
  schemaVersion: z.literal(1),
  brief: jobBriefSchema,
  workspace: z.strictObject({ id: idSchema, revision: positiveIntegerSchema }),
  recipe: recipeDefinitionSchema,
  effective: effectiveSettingsSchema,
  profiles: z.array(profileSnapshotSchema).max(100),
  materials: z
    .array(
      z.strictObject({
        sourceId: idSchema,
        kind: z.enum(['text', 'url', 'file', 'directory', 'codebase', 'media']),
        digest: digestSchema.nullable(),
        status: z.enum(['pending', 'available', 'inaccessible', 'unsupported', 'missing']),
      }),
    )
    .max(1000),
});

export type RecipeDefinition = z.infer<typeof recipeDefinitionSchema>;
export type ResolvedProductionBrief = z.infer<typeof resolvedProductionBriefSchema>;
