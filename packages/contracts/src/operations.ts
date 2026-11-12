import { z } from 'zod';
import {
  digestSchema,
  idSchema,
  positiveIntegerSchema,
  recordShape,
  timestampSchema,
  usdMicrosSchema,
} from './common.js';
import { diagnosticSchema, operationRecordSchema } from './execution.js';
import type { UsageReservation } from './providers/coordination.js';

export const operationRetryPolicySchema = z.strictObject({
  maxAttempts: positiveIntegerSchema.max(100),
  baseDelayMs: positiveIntegerSchema.max(86_400_000),
  maxDelayMs: positiveIntegerSchema.max(86_400_000),
  deadlineAt: timestampSchema,
});

/** Independent additive receipt; the public OperationRecord v1 remains supported. */
export const operationReceiptSchema = z.strictObject({
  ...recordShape,
  jobId: idSchema,
  jobRevision: positiveIntegerSchema,
  attemptId: idSchema,
  leaseToken: positiveIntegerSchema,
  operationKey: digestSchema,
  providerId: idSchema,
  sideEffect: operationRecordSchema.shape.sideEffect,
  state: z.enum(['reserved', 'in-flight', 'succeeded', 'failed', 'uncertain', 'cancelled']),
  sequence: positiveIntegerSchema,
  version: positiveIntegerSchema,
  reservationId: idSchema,
  reservedUsdMicros: usdMicrosSchema,
  actualUsdMicros: usdMicrosSchema.nullable(),
  providerRequestId: z.string().min(1).max(1000).nullable(),
  diagnostic: diagnosticSchema.nullable(),
  retryPolicy: operationRetryPolicySchema,
  nextAttemptAt: timestampSchema.nullable(),
  cancelRequestedAt: timestampSchema.nullable(),
  submittedAt: timestampSchema.nullable(),
  updatedAt: timestampSchema,
});
export type OperationReceipt = z.infer<typeof operationReceiptSchema>;
export type OperationRetryPolicy = z.infer<typeof operationRetryPolicySchema>;
export interface BeginOperation {
  receipt: OperationReceipt;
  scopes: UsageReservation['scopes'];
  /** Required only after an unresolved uncertain operation, never inferred from a provider response. */
  uncertainRetryAuthorized: boolean;
}
export interface OperationOutcome {
  state: 'succeeded' | 'failed' | 'uncertain' | 'cancelled';
  /** Null retains the upper-bound reservation; zero is observed no charge. */
  actualUsdMicros: number | null;
  diagnostic: OperationReceipt['diagnostic'];
  providerRequestId: string | null;
  nextAttemptAt: string | null;
}
/** Durable receipt/accounting transaction boundary. Late outcomes record cost, never accept artifacts. */
export interface OperationRepository {
  begin(input: BeginOperation): Promise<{ receipt: OperationReceipt; created: boolean }>;
  read(id: string): Promise<OperationReceipt | null>;
  list(
    jobId: string,
    cursor: string | null,
    limit: number,
  ): Promise<{ receipts: readonly OperationReceipt[]; nextCursor: string | null }>;
  submitted(
    id: string,
    expectedVersion: number,
    providerRequestId: string | null,
  ): Promise<OperationReceipt>;
  /** Persist the external request identity immediately after submission, before awaiting completion. */
  identify(
    id: string,
    expectedVersion: number,
    providerRequestId: string,
  ): Promise<OperationReceipt>;
  complete(
    id: string,
    expectedVersion: number,
    outcome: OperationOutcome,
  ): Promise<OperationReceipt>;
  /** Operator or reconciler supplied observed outcome; unavailable observations remain uncertain. */
  reconcile(
    id: string,
    expectedVersion: number,
    outcome: OperationOutcome,
  ): Promise<OperationReceipt>;
  /** Called after authoritative cancellation; job lifecycle already blocks new submissions. */
  cancelJob(jobId: string): Promise<readonly OperationReceipt[]>;
}
