import {
  canonicalJson,
  diagnosticSchema,
  idSchema,
  type JobRecord,
  type OperationOutcome,
  type OperationReceipt,
  type OperationRepository,
  operationReceiptSchema,
  positiveIntegerSchema,
  type StageAttempt,
  timestampSchema,
  usdMicrosSchema,
} from '@tutorialx/contracts';
import { sqliteUsage } from './coordination.js';
import { MetadataConflict, MetadataPolicyError, type SqliteDatabase } from './database.js';

export function sqliteOperations(db: SqliteDatabase): OperationRepository {
  const ledger = sqliteUsage(db, (operation) => operation());
  function read(id: string): OperationReceipt | null {
    db.requireReady();
    const row = db.get('SELECT json FROM operation_receipts WHERE id=?', idSchema.parse(id));
    return row ? operationReceiptSchema.parse(JSON.parse(String(row.json))) : null;
  }
  function required(id: string, version: number) {
    positiveIntegerSchema.parse(version);
    const receipt = read(id);
    if (!receipt || receipt.version !== version)
      throw new MetadataConflict('Receipt version changed or is missing.');
    return receipt;
  }
  function save(receipt: OperationReceipt) {
    const value = operationReceiptSchema.parse(receipt);
    db.run('UPDATE operation_receipts SET json=? WHERE id=?', JSON.stringify(value), value.id);
    return value;
  }
  function job(id: string) {
    const value = db.decode<JobRecord>(db.get('SELECT json FROM jobs WHERE id=?', id));
    if (!value) throw new MetadataConflict('Job not found.');
    return value;
  }
  function fence(value: OperationReceipt) {
    const current = job(value.jobId);
    const attempt = db.decode<StageAttempt>(
      db.get('SELECT json FROM attempts WHERE id=?', value.attemptId),
    );
    const latest = attempt
      ? db.get(
          'SELECT attempt_id FROM stages WHERE job_id=? AND id=?',
          value.jobId,
          attempt.stageId,
        )
      : null;
    if (
      current.status.revision !== value.jobRevision ||
      current.status.lifecycle !== 'running' ||
      !attempt ||
      attempt.jobId !== value.jobId ||
      attempt.status !== 'running' ||
      attempt.lease?.token !== value.leaseToken ||
      Date.parse(attempt.lease.expiresAt) <= Date.parse(db.clock()) ||
      latest?.attempt_id !== value.attemptId
    )
      throw new MetadataConflict(
        'Operation requires the current running job and live stage fence.',
      );
    if (Date.parse(value.retryPolicy.deadlineAt) <= Date.parse(db.clock()))
      throw new MetadataPolicyError('Operation deadline exceeded.');
  }
  function outcome(id: string, version: number, input: OperationOutcome, reconciliation: boolean) {
    const old = required(id, version);
    if (
      !(reconciliation
        ? ['reserved', 'uncertain', 'in-flight'].includes(old.state)
        : ['reserved', 'in-flight', 'uncertain'].includes(old.state))
    )
      throw new MetadataConflict('Operation is already terminal or cannot be reconciled.');
    if (old.state === 'reserved' && (input.state !== 'cancelled' || input.actualUsdMicros !== 0))
      throw new MetadataPolicyError(
        'Unsubmitted reservations can only be reconciled as cancelled with zero usage.',
      );
    if (!['succeeded', 'failed', 'uncertain', 'cancelled'].includes(input.state))
      throw new Error('Invalid outcome state.');
    if (
      old.providerRequestId !== null &&
      input.providerRequestId !== null &&
      old.providerRequestId !== input.providerRequestId
    )
      throw new MetadataConflict('External request identity cannot change.');
    if (input.actualUsdMicros !== null) usdMicrosSchema.parse(input.actualUsdMicros);
    if (input.diagnostic !== null) diagnosticSchema.parse(input.diagnostic);
    if (input.nextAttemptAt !== null) timestampSchema.parse(input.nextAttemptAt);
    if (input.state !== 'uncertain' && input.actualUsdMicros === null)
      throw new MetadataPolicyError(
        'Resolved operations require observed usage; otherwise retain an uncertain outcome.',
      );
    if (input.state === 'failed' && !input.diagnostic)
      throw new Error('Failed operations require a diagnostic.');
    if (
      input.nextAttemptAt !== null &&
      (input.state !== 'failed' ||
        input.diagnostic?.classification !== 'transient' ||
        !input.diagnostic.retryable ||
        old.sequence >= old.retryPolicy.maxAttempts ||
        Date.parse(input.nextAttemptAt) >= Date.parse(old.retryPolicy.deadlineAt))
    )
      throw new MetadataPolicyError('Retry exceeds failure policy or deadline.');
    if (
      input.nextAttemptAt !== null &&
      Date.parse(input.nextAttemptAt) <
        Date.parse(old.updatedAt) +
          Math.min(
            old.retryPolicy.maxDelayMs,
            old.retryPolicy.baseDelayMs * 2 ** Math.min(old.sequence - 1, 52),
          )
    )
      throw new MetadataPolicyError('Retry backoff is shorter than the recorded policy.');
    if (input.actualUsdMicros === null) ledger.markUsageUncertain(old.reservationId);
    else ledger.settleUsage(old.reservationId, input.actualUsdMicros);
    // Usage belongs to the external request even when a cancelled/stale worker reports it late.
    const cancelled =
      old.cancelRequestedAt !== null || job(old.jobId).status.lifecycle === 'cancelled';
    return save({
      ...old,
      ...input,
      providerRequestId: input.providerRequestId ?? old.providerRequestId,
      state: cancelled && input.state !== 'uncertain' ? 'cancelled' : input.state,
      version: old.version + 1,
      updatedAt: db.clock(),
    });
  }
  return {
    async read(id) {
      return read(id);
    },
    async list(jobId, cursor, limit) {
      db.requireReady();
      idSchema.parse(jobId);
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
        throw new Error('Receipt limit must be 1–100.');
      if (cursor !== null) idSchema.parse(cursor);
      const rows = db.all(
        'SELECT json FROM operation_receipts WHERE job_id=? AND id>? ORDER BY id LIMIT ?',
        jobId,
        cursor ?? '',
        limit + 1,
      );
      const receipts = rows
        .slice(0, limit)
        .map((row) => operationReceiptSchema.parse(JSON.parse(String(row.json))));
      return { receipts, nextCursor: rows.length > limit ? receipts.at(-1)!.id : null };
    },
    async begin(input) {
      db.requireReady();
      const value = operationReceiptSchema.parse(input.receipt);
      return db.transaction(() => {
        const existing = read(value.id);
        if (existing) {
          for (const field of [
            'jobId',
            'attemptId',
            'leaseToken',
            'operationKey',
            'providerId',
            'sideEffect',
            'sequence',
            'reservationId',
            'reservedUsdMicros',
            'retryPolicy',
          ] as const)
            if (
              canonicalJson({ value: existing[field] }) !== canonicalJson({ value: value[field] })
            )
              throw new MetadataConflict('Operation identity already has another request.');
          return { receipt: existing, created: false };
        }
        fence(value);
        if (
          value.state !== 'reserved' ||
          value.version !== 1 ||
          value.actualUsdMicros !== null ||
          value.providerRequestId !== null ||
          value.cancelRequestedAt !== null ||
          value.diagnostic !== null ||
          value.nextAttemptAt !== null ||
          value.submittedAt !== null
        )
          throw new Error('New operations must start as unsubmitted reservations.');
        if (value.sequence > value.retryPolicy.maxAttempts)
          throw new MetadataPolicyError('Operation attempt limit exceeded.');
        const row = db.get(
          'SELECT json FROM operation_receipts WHERE job_id=? AND operation_key=? ORDER BY sequence DESC LIMIT 1',
          value.jobId,
          value.operationKey,
        );
        const previous = row ? operationReceiptSchema.parse(JSON.parse(String(row.json))) : null;
        if (!previous && value.sequence !== 1)
          throw new MetadataConflict('First operation sequence must be one.');
        if (previous) {
          if (
            value.sequence !== previous.sequence + 1 ||
            canonicalJson({ policy: value.retryPolicy }) !==
              canonicalJson({ policy: previous.retryPolicy }) ||
            value.providerId !== previous.providerId ||
            value.sideEffect !== previous.sideEffect
          )
            throw new MetadataConflict('Retry sequence or provider policy changed.');
          const uncertain = previous.state === 'uncertain' && input.uncertainRetryAuthorized;
          if (
            uncertain &&
            Date.parse(db.clock()) <
              Date.parse(previous.updatedAt) +
                Math.min(
                  previous.retryPolicy.maxDelayMs,
                  previous.retryPolicy.baseDelayMs * 2 ** Math.min(previous.sequence - 1, 52),
                )
          )
            throw new MetadataPolicyError(
              'Authorized uncertain retries must still honor retry backoff.',
            );
          const transient =
            previous.state === 'failed' &&
            previous.diagnostic?.classification === 'transient' &&
            previous.diagnostic.retryable &&
            previous.actualUsdMicros !== null &&
            previous.nextAttemptAt !== null;
          const resumedCancellation =
            previous.state === 'cancelled' &&
            previous.submittedAt === null &&
            previous.actualUsdMicros === 0 &&
            previous.attemptId !== value.attemptId;
          if (!uncertain && !transient && !resumedCancellation)
            throw new MetadataPolicyError(
              'Operation is not safely retryable; reconcile uncertain outcomes first.',
            );
          if (
            previous.nextAttemptAt !== null &&
            Date.parse(previous.nextAttemptAt) > Date.parse(db.clock())
          )
            throw new MetadataPolicyError('Retry backoff has not elapsed.');
        }
        if (!input.scopes.some((scope) => scope.id === value.jobId && scope.kind === 'job'))
          throw new MetadataPolicyError('A job budget scope is required.');
        ledger.reserveUsage({
          id: value.reservationId,
          operationId: value.id,
          scopes: input.scopes,
          reservedUsdMicros: value.reservedUsdMicros,
          actualUsdMicros: null,
          state: 'reserved',
        });
        db.run(
          'INSERT INTO operation_receipts(id,job_id,operation_key,sequence,json) VALUES (?,?,?,?,?)',
          value.id,
          value.jobId,
          value.operationKey,
          value.sequence,
          JSON.stringify(value),
        );
        return { receipt: value, created: true };
      });
    },
    async submitted(id, version, providerRequestId) {
      db.requireReady();
      return db.transaction(() => {
        const old = required(id, version);
        if (old.state !== 'reserved')
          throw new MetadataConflict('Operation has already been submitted.');
        fence(old);
        return save({
          ...old,
          providerRequestId,
          state: 'in-flight',
          submittedAt: db.clock(),
          version: old.version + 1,
          updatedAt: db.clock(),
        });
      });
    },
    async identify(id, version, providerRequestId) {
      db.requireReady();
      operationReceiptSchema.shape.providerRequestId.unwrap().parse(providerRequestId);
      return db.transaction(() => {
        const receipt = required(id, version);
        if (!['in-flight', 'uncertain'].includes(receipt.state))
          throw new MetadataConflict('Only submitted requests can receive an external identity.');
        if (receipt.providerRequestId !== null) {
          if (receipt.providerRequestId !== providerRequestId)
            throw new MetadataConflict('External request identity cannot change.');
          return receipt;
        }
        return save({
          ...receipt,
          providerRequestId,
          version: receipt.version + 1,
          updatedAt: db.clock(),
        });
      });
    },
    async complete(id, version, value) {
      db.requireReady();
      return db.transaction(() => outcome(id, version, value, false));
    },
    async reconcile(id, version, value) {
      db.requireReady();
      return db.transaction(() => outcome(id, version, value, true));
    },
    async cancelJob(jobId) {
      db.requireReady();
      return db.transaction(() => {
        if (job(jobId).status.lifecycle !== 'cancelled')
          throw new MetadataPolicyError(
            'Cancel the authoritative job before cancelling external operations.',
          );
        const rows = db.all('SELECT json FROM operation_receipts WHERE job_id=?', jobId);
        return rows
          .map((row) => operationReceiptSchema.parse(JSON.parse(String(row.json))))
          .filter((receipt) => ['reserved', 'in-flight', 'uncertain'].includes(receipt.state))
          .map((receipt) => {
            if (receipt.cancelRequestedAt !== null) return receipt;
            if (receipt.state === 'reserved') ledger.releaseUsage(receipt.reservationId);
            else if (receipt.state === 'in-flight')
              ledger.markUsageUncertain(receipt.reservationId);
            return save({
              ...receipt,
              state: receipt.state === 'reserved' ? 'cancelled' : 'uncertain',
              actualUsdMicros: receipt.state === 'reserved' ? 0 : receipt.actualUsdMicros,
              cancelRequestedAt: receipt.cancelRequestedAt ?? db.clock(),
              version: receipt.version + 1,
              updatedAt: db.clock(),
            });
          });
      });
    },
  };
}
