import { z } from 'zod';
import { digestSchema, idSchema, positiveIntegerSchema, recordShape } from './common.js';
import { executionPolicySchema, settingsOverridesSchema } from './settings.js';

export const workspaceConfigSchema = z.strictObject({
  ...recordShape,
  revision: positiveIntegerSchema,
  contentRoot: z.string().min(1).max(4096),
  sourceRoots: z.array(z.string().min(1).max(4096)).max(100),
  exclusions: z.array(z.string().min(1).max(500)).max(200),
  defaults: settingsOverridesSchema,
  policyCeiling: executionPolicySchema,
});

export const profileSchema = z.strictObject({
  ...recordShape,
  revision: positiveIntegerSchema,
  kind: z.enum(['product', 'brand', 'preset']),
  name: z.string().min(1).max(200),
  settings: settingsOverridesSchema,
  sourceIds: z.array(idSchema).max(1000),
  notes: z.string().max(20_000),
});

export const profileSnapshotSchema = z.strictObject({
  profile: profileSchema,
  digest: digestSchema,
});

export type WorkspaceConfig = z.infer<typeof workspaceConfigSchema>;
export type Profile = z.infer<typeof profileSchema>;
export type ProfileSnapshot = z.infer<typeof profileSnapshotSchema>;
