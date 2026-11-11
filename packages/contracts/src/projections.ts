import { z } from 'zod';
import { positiveIntegerSchema } from './common.js';
import { jobStatusSchema } from './execution.js';
import { jobBriefSchema, planRevisionSchema } from './planning.js';

export const jobProjectionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  baseJobRevision: positiveIntegerSchema,
  document: jobBriefSchema,
  status: jobStatusSchema,
});
export const planProjectionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  baseJobRevision: positiveIntegerSchema,
  document: planRevisionSchema,
});

export interface WorkspaceProjectionFiles {
  read(path: string): Promise<{ content: string; digest: string } | null>;
  /** Replace only the exact previously inspected bytes; null means the file must be absent. */
  write(path: string, expected: string | null, content: string): Promise<void>;
}
