import {
  idSchema,
  type JobRecord,
  type JobRepository,
  type OperationRepository,
  type Pagination,
  paginationSchema,
  positiveIntegerSchema,
  type StageAttempt,
  timestampSchema,
} from '@tutorialx/contracts';

export class RecoveryConflict extends Error {
  readonly code = 'REVISION_CONFLICT';
}

function attemptState(attempt: StageAttempt, now: string) {
  if (attempt.status !== 'running') return attempt.status;
  return attempt.lease && Date.parse(attempt.lease.expiresAt) > Date.parse(now)
    ? 'live'
    : 'interrupted';
}

/** Bounded, read-only recovery view. No provider response, secret, or source text is copied. */
export async function inspectJobRecovery(input: {
  repository: JobRepository;
  operations: OperationRepository;
  jobId: string;
  attempts: Pagination;
  receipts: Pagination;
  now(): string;
}) {
  const jobId = idSchema.parse(input.jobId);
  const attemptPage = paginationSchema.parse(input.attempts);
  const receiptPage = paginationSchema.parse(input.receipts);
  const now = timestampSchema.parse(input.now());
  const job = await input.repository.read(jobId);
  if (!job) throw new Error('Job is not available in this workspace.');
  const attempts = [...(await input.repository.attempts(jobId))]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .filter((attempt) => attemptPage.cursor === null || attempt.id > attemptPage.cursor);
  const receipts = await input.operations.list(jobId, receiptPage.cursor, receiptPage.limit);
  const legacy = await input.repository.operations(jobId);
  const current = await input.repository.read(jobId);
  if (current?.status.revision !== job.status.revision)
    throw new RecoveryConflict('Job changed during recovery inspection; inspect again.');
  return {
    jobId,
    revision: job.status.revision,
    lifecycle: job.status.lifecycle,
    waitReason: job.status.waitReason,
    delivery: job.status.delivery,
    inspectedAt: now,
    attempts: {
      items: attempts.slice(0, attemptPage.limit).map((attempt) => ({
        id: attempt.id,
        stageId: attempt.stageId,
        ordinal: attempt.attempt,
        state: attemptState(attempt, now),
        leaseExpiresAt: attempt.lease?.expiresAt ?? null,
        outputArtifactIds: attempt.outputArtifactIds,
        diagnosticCode: attempt.diagnostic?.code ?? null,
        nextStep:
          attemptState(attempt, now) === 'interrupted'
            ? 'Reconcile operation outcomes, then release the expired attempt for an authorized retry.'
            : attempt.status === 'running'
              ? 'Keep the current worker ownership; do not steal a live lease.'
              : attempt.status === 'succeeded'
                ? 'Verify accepted bytes and input lineage before reuse.'
                : 'Recheck prerequisites, authorization, and retry limits before dispatch.',
      })),
      nextCursor: attempts.length > attemptPage.limit ? attempts[attemptPage.limit - 1]!.id : null,
    },
    receipts: {
      items: receipts.receipts.map((receipt) => ({
        id: receipt.id,
        version: receipt.version,
        attemptId: receipt.attemptId,
        state: receipt.state,
        reservedUsdMicros: receipt.reservedUsdMicros,
        actualUsdMicros: receipt.actualUsdMicros,
        needsReconciliation: ['reserved', 'in-flight', 'uncertain'].includes(receipt.state),
      })),
      nextCursor: receipts.nextCursor,
    },
    // Old version-one receipts remain relevant to replay safety, without disclosing their payloads.
    legacyUnresolvedCount: legacy.filter((operation) =>
      ['reserved', 'in-flight', 'uncertain'].includes(operation.status),
    ).length,
  };
}

/** Revoke an expired attempt only after its external outcomes have been established.
 * This does not dispatch, accept orphan bytes, release usage, or authorize production.
 */
export async function releaseInterruptedAttempt(input: {
  repository: JobRepository;
  operations: OperationRepository;
  jobId: string;
  attemptId: string;
  expectedRevision: number;
  now(): string;
}): Promise<JobRecord> {
  const jobId = idSchema.parse(input.jobId);
  const attemptId = idSchema.parse(input.attemptId);
  positiveIntegerSchema.parse(input.expectedRevision);
  const now = timestampSchema.parse(input.now());
  const job = await input.repository.read(jobId);
  if (!job || job.status.revision !== input.expectedRevision)
    throw new RecoveryConflict('Job revision changed before recovery.');
  if (['cancelled', 'finished'].includes(job.status.lifecycle))
    throw new RecoveryConflict(
      'Resume cancelled work explicitly; finished work cannot be recovered.',
    );
  const attempts = await input.repository.attempts(jobId);
  const attempt = attempts.find((item) => item.id === attemptId);
  if (!attempt || attemptState(attempt, now) !== 'interrupted')
    throw new RecoveryConflict('Only an expired running attempt can be released.');
  if (attempts.some((item) => item.stageId === attempt.stageId && item.attempt > attempt.attempt))
    throw new RecoveryConflict('A newer attempt owns this stage.');
  const unresolved = (state: string) => ['reserved', 'in-flight', 'uncertain'].includes(state);
  if (
    (await input.repository.operations(jobId)).some(
      (operation) => operation.attemptId === attemptId && unresolved(operation.status),
    )
  )
    throw new RecoveryConflict(
      'Reconcile the legacy external operation before releasing its attempt.',
    );
  let cursor: string | null = null;
  const seen = new Set<string>();
  do {
    const page = await input.operations.list(jobId, cursor, 100);
    if (
      page.receipts.some((receipt) => receipt.attemptId === attemptId && unresolved(receipt.state))
    )
      throw new RecoveryConflict(
        'Reconcile external outcomes and charges before releasing this attempt.',
      );
    cursor = page.nextCursor;
    if (cursor !== null) {
      if (seen.has(cursor) || seen.size >= 1000)
        throw new RecoveryConflict('Receipt inspection did not finish; no recovery was applied.');
      seen.add(cursor);
    }
  } while (cursor !== null);
  const next: JobRecord = {
    brief: job.brief,
    status: {
      ...job.status,
      revision: job.status.revision + 1,
      lifecycle: job.status.lifecycle === 'paused' ? 'paused' : 'waiting',
      waitReason: job.status.lifecycle === 'paused' ? null : 'input',
      delivery: null,
    },
  };
  await input.repository.commit({
    jobId,
    expectedRevision: input.expectedRevision,
    job: next,
    fence: null,
    attempts: [
      {
        ...attempt,
        status: 'failed',
        lease: null,
        waitReason: null,
        finishedAt: now,
        diagnostic: {
          code: 'INTERRUPTED_ATTEMPT',
          message: 'Expired execution was reconciled; a new authorized attempt is required.',
          classification: 'transient',
          retryable: true,
        },
      },
    ],
    artifacts: [],
    plans: [],
    approvals: [],
    operations: [],
    events: [],
    dispatch: [],
  });
  return next;
}
