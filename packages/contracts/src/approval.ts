import { z } from 'zod';
import {
  digestSchema,
  idSchema,
  positiveIntegerSchema,
  recordShape,
  timestampSchema,
} from './common.js';

export const approvalRecordSchema = z
  .strictObject({
    ...recordShape,
    jobId: idSchema,
    planId: idSchema,
    planRevision: positiveIntegerSchema,
    planDigest: digestSchema,
    settingsDigest: digestSchema,
    evidenceDigest: digestSchema,
    providersDigest: digestSchema,
    actor: z.strictObject({
      id: idSchema,
      kind: z.enum(['human', 'policy']),
      origin: z.string().min(1).max(1000),
    }),
    scopes: z
      .array(
        z.enum(['research-spend', 'production', 'demo-mutations', 'repair', 'uncertain-retry']),
      )
      .min(1)
      .max(5),
    expiresAt: timestampSchema.nullable(),
    policyId: idSchema.nullable(),
  })
  .refine(
    (record) => record.actor.kind !== 'policy' || record.policyId !== null,
    'Policy approval requires the authorizing policy identity.',
  )
  .refine(
    (record) =>
      record.expiresAt === null || Date.parse(record.expiresAt) > Date.parse(record.createdAt),
    'Approval expiry must follow its creation time.',
  );

export type ApprovalRecord = z.infer<typeof approvalRecordSchema>;
