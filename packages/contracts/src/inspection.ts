import { z } from 'zod';
import { cursorSchema } from './actions.js';
import { idSchema, nonnegativeIntegerSchema } from './common.js';

export const eventsInputSchema = z.strictObject({
  jobId: idSchema,
  afterCursor: nonnegativeIntegerSchema.default(0),
  limit: z.number().int().min(1).max(100).default(20),
});
export const artifactListInputSchema = z.strictObject({
  jobId: idSchema,
  cursor: cursorSchema.nullable().default(null),
  limit: z.number().int().min(1).max(100).default(20),
});
export const artifactReadInputSchema = z.strictObject({
  jobId: idSchema,
  artifactId: idSchema,
  offset: nonnegativeIntegerSchema.default(0),
  length: z.number().int().min(1).max(65_536).default(16_384),
});
export const INSPECTION_ACTION_SCHEMAS = {
  events: eventsInputSchema,
  'artifact.list': artifactListInputSchema,
  'artifact.read': artifactReadInputSchema,
} as const;
