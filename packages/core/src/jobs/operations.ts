import {
  type BeginOperation,
  type Diagnostic,
  diagnosticSchema,
  type OperationContext,
  type OperationOutcome,
  type OperationReceipt,
  type OperationRepository,
  type OperationRetryPolicy,
  operationReceiptSchema,
  operationRetryPolicySchema,
  timestampSchema,
  usdMicrosSchema,
} from '@tutorialx/contracts';

export type RetryDecision =
  | { retry: true; availableAt: string }
  | { retry: false; reason: 'failure-class' | 'attempt-limit' | 'deadline' | 'uncertain-outcome' };
/** Retry-after is a minimum, never truncated into an earlier unauthorized request. */
export function operationRetryDecision(input: {
  policy: OperationRetryPolicy;
  sequence: number;
  diagnostic: Diagnostic;
  now: string;
  retryAfterMs?: number;
}): RetryDecision {
  const policy = operationRetryPolicySchema.parse(input.policy);
  const diagnostic = diagnosticSchema.parse(input.diagnostic);
  const now = Date.parse(timestampSchema.parse(input.now));
  if (diagnostic.classification === 'uncertain')
    return { retry: false, reason: 'uncertain-outcome' };
  if (diagnostic.classification !== 'transient' || !diagnostic.retryable)
    return { retry: false, reason: 'failure-class' };
  if (
    !Number.isSafeInteger(input.sequence) ||
    input.sequence < 1 ||
    input.sequence >= policy.maxAttempts
  )
    return { retry: false, reason: 'attempt-limit' };
  if (
    input.retryAfterMs !== undefined &&
    (!Number.isSafeInteger(input.retryAfterMs) || input.retryAfterMs < 0)
  )
    throw new Error('Retry-after must be nonnegative integer milliseconds.');
  const delay = Math.max(
    Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** Math.min(input.sequence - 1, 52)),
    input.retryAfterMs ?? 0,
  );
  const available = now + delay;
  if (!Number.isSafeInteger(available) || available >= Date.parse(policy.deadlineAt))
    return { retry: false, reason: 'deadline' };
  return { retry: true, availableAt: new Date(available).toISOString() };
}

/** Only explicit provider diagnostics establish safe no-charge failures. Unknown exceptions stay uncertain. */
export class OperationFailure extends Error {
  readonly diagnostic: Diagnostic;
  constructor(input: {
    diagnostic: Diagnostic;
    actualUsdMicros: number | null;
    providerRequestId?: string;
    retryAfterMs?: number;
  }) {
    super(input.diagnostic.message);
    this.diagnostic = diagnosticSchema.parse(input.diagnostic);
    if (input.actualUsdMicros !== null) usdMicrosSchema.parse(input.actualUsdMicros);
    this.actualUsdMicros = input.actualUsdMicros;
    this.providerRequestId = input.providerRequestId ?? null;
    this.retryAfterMs = input.retryAfterMs;
  }
  readonly actualUsdMicros: number | null;
  readonly providerRequestId: string | null;
  readonly retryAfterMs: number | undefined;
}
export interface OperationExecutionResult<T> {
  receipt: OperationReceipt;
  result: T | null;
}
export interface OperationRuntime {
  now(): string;
  schedule(callback: () => void, delayMs: number): unknown;
  clear(handle: unknown): void;
}
export function createOperationExecutor(
  repository: OperationRepository,
  runtime: OperationRuntime,
) {
  const active = new Map<string, { jobId: string; controller: AbortController }>();
  const generic = (code: string, message: string): Diagnostic => ({
    code,
    message,
    classification: 'uncertain',
    retryable: false,
  });
  async function recordOutcome(receipt: OperationReceipt, outcome: OperationOutcome) {
    try {
      return await repository.complete(receipt.id, receipt.version, outcome);
    } catch (error) {
      const latest = await repository.read(receipt.id);
      if (!latest || latest.version === receipt.version || latest.state !== 'uncertain')
        throw error;
      return repository.reconcile(latest.id, latest.version, outcome);
    }
  }
  return {
    /** Authoritative lifecycle must already be cancelled; process-local abort supplements durable state. */
    async cancelJob(jobId: string) {
      const receipts = await repository.cancelJob(jobId);
      for (const entry of active.values()) if (entry.jobId === jobId) entry.controller.abort();
      return receipts;
    },
    /** Other processes call this after observing durable cancelled receipt state. */
    async observeCancellation(id: string) {
      const receipt = await repository.read(id);
      if (receipt?.cancelRequestedAt) active.get(id)?.controller.abort();
    },
    async execute<T>(input: {
      begin: BeginOperation;
      context: OperationContext;
      execute(
        context: OperationContext,
        reportRequestId: (providerRequestId: string) => Promise<void>,
      ): Promise<{ result: T; actualUsdMicros: number; providerRequestId: string | null }>;
    }): Promise<OperationExecutionResult<T>> {
      input.context.signal.throwIfAborted();
      if (
        input.context.operationId !== input.begin.receipt.id ||
        input.context.jobId !== input.begin.receipt.jobId ||
        input.context.attemptId !== input.begin.receipt.attemptId ||
        input.context.reservationId !== input.begin.receipt.reservationId
      )
        throw new Error('Operation context differs from its durable receipt.');
      const deadline = Math.min(
        Date.parse(timestampSchema.parse(input.context.deadlineAt)),
        Date.parse(input.begin.receipt.retryPolicy.deadlineAt),
      );
      if (deadline <= Date.parse(runtime.now()))
        throw new Error('Operation deadline exceeded before dispatch.');
      const begun = await repository.begin(input.begin);
      if (!begun.created) return { receipt: begun.receipt, result: null };
      let receipt = await repository.submitted(begun.receipt.id, begun.receipt.version, null);
      const controller = new AbortController();
      active.set(receipt.id, { jobId: receipt.jobId, controller });
      let stopped = false;
      let finishStop!: (value: { stopped: true }) => void;
      const stop = new Promise<{ stopped: true }>((resolve) => {
        finishStop = resolve;
      });
      const onAbort = () => {
        stopped = true;
        controller.abort();
        finishStop({ stopped: true });
      };
      input.context.signal.addEventListener('abort', onAbort, { once: true });
      controller.signal.addEventListener(
        'abort',
        () => {
          stopped = true;
          finishStop({ stopped: true });
        },
        { once: true },
      );
      const timer = runtime.schedule(
        onAbort,
        Math.max(0, Math.min(2_147_483_647, deadline - Date.parse(runtime.now()))),
      );
      let late: { result: T; actualUsdMicros: number; providerRequestId: string | null } | null =
        null;
      const work = Promise.resolve()
        .then(async () => {
          const latest = await repository.read(receipt.id);
          if (latest?.cancelRequestedAt || Date.parse(runtime.now()) >= deadline) onAbort();
          if (stopped || input.context.signal.aborted)
            throw new OperationFailure({
              diagnostic: {
                code: 'OPERATION_NOT_SUBMITTED',
                message: 'Operation stopped before invoking its provider.',
                classification: 'policy',
                retryable: false,
              },
              actualUsdMicros: 0,
            });
          return input.execute(
            {
              ...input.context,
              deadlineAt: new Date(deadline).toISOString(),
              signal: controller.signal,
            },
            async (providerRequestId) => {
              const current = await repository.read(receipt.id);
              if (!current) throw new Error('Operation receipt disappeared.');
              receipt = await repository.identify(current.id, current.version, providerRequestId);
            },
          );
        })
        .then((value) => {
          usdMicrosSchema.parse(value.actualUsdMicros);
          operationReceiptSchema.shape.providerRequestId.parse(value.providerRequestId);
          late = value;
          return { value };
        })
        .catch((error: unknown) => ({ error }));
      try {
        const settled = await Promise.race([work, stop]);
        if ('stopped' in settled) {
          // A non-cooperative provider may finish later. Persist uncertainty now; do not await it.
          const current = await repository.read(receipt.id);
          if (current) receipt = current;
          if (receipt.state === 'in-flight')
            receipt = await repository.complete(receipt.id, receipt.version, {
              state: 'uncertain',
              actualUsdMicros: null,
              providerRequestId: null,
              nextAttemptAt: null,
              diagnostic: generic(
                'OPERATION_INTERRUPTED',
                'Operation stopped with an unresolved external outcome; reconcile before retrying.',
              ),
            });
          void work
            .then(async (settledWork) => {
              const lateFailure =
                'error' in settledWork &&
                settledWork.error instanceof OperationFailure &&
                settledWork.error.actualUsdMicros !== null
                  ? settledWork.error
                  : null;
              if (!late && !lateFailure) return;
              const observed = await repository.read(receipt.id);
              if (observed?.state === 'uncertain')
                await repository.reconcile(observed.id, observed.version, {
                  state: late ? 'succeeded' : 'failed',
                  actualUsdMicros: late?.actualUsdMicros ?? lateFailure!.actualUsdMicros,
                  providerRequestId:
                    late?.providerRequestId ?? lateFailure?.providerRequestId ?? null,
                  diagnostic: late ? null : lateFailure!.diagnostic,
                  nextAttemptAt: null,
                });
            })
            .catch(() => {
              /* A competing reconciler owns the durable receipt; retain its result. */
            });
          return { receipt, result: null };
        }
        const current = await repository.read(receipt.id);
        if (current) receipt = current;
        let outcome: OperationOutcome;
        if ('value' in settled)
          outcome = {
            state: 'succeeded',
            actualUsdMicros: settled.value.actualUsdMicros,
            providerRequestId: settled.value.providerRequestId,
            diagnostic: null,
            nextAttemptAt: null,
          };
        else {
          const error = settled.error;
          const known = error instanceof OperationFailure;
          const actual = known ? error.actualUsdMicros : receipt.sideEffect === 'pure' ? 0 : null;
          const diagnostic =
            actual === null
              ? generic(
                  'OPERATION_OUTCOME_UNKNOWN',
                  'Provider outcome is unknown; inspect its receipt before repeating.',
                )
              : known
                ? error.diagnostic
                : {
                    code: 'OPERATION_FAILED',
                    message: 'Provider failed without a diagnostic.',
                    classification: 'permanent' as const,
                    retryable: false,
                  };
          const retry = operationRetryDecision({
            policy: receipt.retryPolicy,
            sequence: receipt.sequence,
            diagnostic,
            now: runtime.now(),
            ...(known && error.retryAfterMs !== undefined
              ? { retryAfterMs: error.retryAfterMs }
              : {}),
          });
          outcome = {
            state: actual === null ? 'uncertain' : 'failed',
            actualUsdMicros: actual,
            providerRequestId: known ? error.providerRequestId : null,
            diagnostic,
            nextAttemptAt: retry.retry ? retry.availableAt : null,
          };
        }
        receipt = await recordOutcome(receipt, outcome);
        return {
          receipt,
          result:
            receipt.state === 'succeeded' && 'value' in settled && !stopped
              ? settled.value.result
              : null,
        };
      } finally {
        runtime.clear(timer);
        input.context.signal.removeEventListener('abort', onAbort);
        active.delete(receipt.id);
      }
    },
  };
}
