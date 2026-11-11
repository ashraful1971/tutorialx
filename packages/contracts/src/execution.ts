import { z } from 'zod';
import {
  digestSchema,
  idSchema,
  jsonObjectSchema,
  nonnegativeIntegerSchema,
  positiveIntegerSchema,
  recordShape,
  timestampSchema,
  usdMicrosSchema,
} from './common.js';

export const stageStatusSchema = z.enum([
  'pending',
  'eligible',
  'running',
  'waiting',
  'succeeded',
  'failed',
  'cancelled',
  'invalidated',
]);
export const waitReasonSchema = z.enum([
  'input',
  'approval',
  'authentication',
  'budget',
  'capability',
  'uncertain-outcome',
]);
export const failureClassSchema = z.enum(['transient', 'permanent', 'policy', 'uncertain']);
export const diagnosticSchema = z.strictObject({
  code: z.string().regex(/^[A-Z][A-Z0-9_]{0,99}$/),
  message: z.string().min(1).max(4000),
  classification: failureClassSchema,
  retryable: z.boolean(),
});

export const leaseSchema = z.strictObject({
  workerId: idSchema,
  token: positiveIntegerSchema,
  expiresAt: timestampSchema,
});

export const stageAttemptSchema = z
  .strictObject({
    ...recordShape,
    jobId: idSchema,
    jobRevision: positiveIntegerSchema,
    stageId: idSchema,
    stageKind: idSchema,
    attempt: positiveIntegerSchema,
    inputDigest: digestSchema,
    status: stageStatusSchema,
    lease: leaseSchema.nullable(),
    waitReason: waitReasonSchema.nullable(),
    startedAt: timestampSchema.nullable(),
    finishedAt: timestampSchema.nullable(),
    outputArtifactIds: z.array(idSchema).max(10_000),
    diagnostic: diagnosticSchema.nullable(),
  })
  .refine(
    (attempt) => attempt.status !== 'running' || attempt.lease !== null,
    'Running attempts require an execution lease.',
  )
  .refine(
    (attempt) => (attempt.status === 'waiting') === (attempt.waitReason !== null),
    'Waiting status requires a wait reason and other statuses cannot retain one.',
  );

export const operationRecordSchema = z.strictObject({
  ...recordShape,
  jobId: idSchema,
  attemptId: idSchema,
  idempotencyKey: digestSchema,
  providerId: idSchema,
  providerRequestId: z.string().min(1).max(1000).nullable(),
  sideEffect: z.enum(['pure', 'idempotent', 'reconcilable', 'uncertain']),
  status: z.enum(['reserved', 'in-flight', 'succeeded', 'failed', 'uncertain', 'cancelled']),
  reservedUsdMicros: usdMicrosSchema,
  actualUsdMicros: usdMicrosSchema.nullable(),
  diagnostic: diagnosticSchema.nullable(),
});

export const executionEventSchema = z.strictObject({
  ...recordShape,
  workspaceId: idSchema,
  jobId: idSchema.nullable(),
  attemptId: idSchema.nullable(),
  cursor: positiveIntegerSchema,
  requestId: idSchema,
  traceId: idSchema,
  kind: idSchema,
  level: z.enum(['info', 'warning', 'error']),
  data: jsonObjectSchema,
});

export const jobStatusSchema = z
  .strictObject({
    jobId: idSchema,
    revision: positiveIntegerSchema,
    lifecycle: z.enum([
      'queued',
      'running',
      'waiting',
      'paused',
      'failed',
      'cancelled',
      'finished',
    ]),
    waitReason: waitReasonSchema.nullable(),
    delivery: z.enum(['ready', 'needs-attention', 'failed', 'cancelled']).nullable(),
    completedStages: nonnegativeIntegerSchema,
    totalStages: nonnegativeIntegerSchema,
  })
  .refine((job) => job.completedStages <= job.totalStages, 'Completed stages exceed total stages.');

export type StageAttempt = z.infer<typeof stageAttemptSchema>;
export type StageStatus = z.infer<typeof stageStatusSchema>;
export type WaitReason = z.infer<typeof waitReasonSchema>;
export type OperationRecord = z.infer<typeof operationRecordSchema>;
export type ExecutionEvent = z.infer<typeof executionEventSchema>;
export type JobStatus = z.infer<typeof jobStatusSchema>;
export type Diagnostic = z.infer<typeof diagnosticSchema>;
