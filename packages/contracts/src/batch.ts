import { z } from 'zod';
import {
  hasUniqueIds,
  idSchema,
  positiveIntegerSchema,
  profileReferenceSchema,
  recordShape,
  timestampSchema,
  usdMicrosSchema,
} from './common.js';
import { settingsOverridesSchema } from './settings.js';

export const batchItemSchema = z.strictObject({
  id: idSchema,
  title: z.string().min(1).max(200),
  topic: z.string().min(1).max(20_000),
  instructions: z.string().max(30_000),
  sourceIds: z.array(idSchema).max(1000),
  overrides: settingsOverridesSchema,
});

export const batchManifestSchema = z.strictObject({
  ...recordShape,
  workspaceId: idSchema,
  profiles: z.array(profileReferenceSchema).max(100),
  defaults: settingsOverridesSchema,
  items: z
    .array(batchItemSchema)
    .min(1)
    .max(10_000)
    .refine(hasUniqueIds, 'Duplicate batch item identities.'),
  budgetUsdMicros: usdMicrosSchema,
  deadlineAt: timestampSchema.nullable(),
  concurrency: positiveIntegerSchema.max(1000),
  failurePolicy: z.enum(['continue', 'stop']),
  duplicates: z.enum(['reject', 'skip-existing']),
});

export type BatchManifest = z.infer<typeof batchManifestSchema>;
