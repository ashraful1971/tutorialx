# Operations, usage, and cancellation

`OperationRepository` is the durable boundary for provider requests. `createSqlitePersistence` exposes it as `operations`; `createOperationExecutor` from core wraps a selected provider callback without depending on its SDK. Receipt completion records external outcomes and usage. It never accepts artifacts or declares a job ready: those remain the fenced artifact acceptance and workflow services' responsibilities.

Pass an explicit `OperationRuntime` to `createOperationExecutor(repository, runtime)`.
The local adapter exports `createNativeOperationRuntime()` for system clocks and
timers; tests inject a controlled runtime. Core does not select ambient clocks.

## Dispatch and accounting

Construct an `OperationReceipt` with a stable operation key from job/revision, stage inputs, selected provider/template versions, and relevant parameters. Start with sequence/version one, `state: reserved`, `submittedAt: null`, unknown actual usage, and a conservative upper bound. Supply authorized job and optional shared batch scopes in `BeginOperation.scopes`. The trusted application resolves these limits from workspace/job policy; a provider or creative agent cannot choose spending authority or `uncertainRetryAuthorized`.

`operations.begin` checks the current running job revision, latest running attempt, live lease token, deadline, prior operation outcome, retry count, and all supplied budget scopes in a single SQLite write transaction. The receipt and reservation either both commit or neither does. Concurrent connections cannot overbook a job or batch. Repeating the identical operation ID returns its current receipt with `created: false`; it does not submit a provider request or allocate more budget.

`submitted` rechecks authority and records the durable submission boundary **before** invoking the provider. A crash between this marker and the external call is conservatively uncertain. Providers call the executor callback’s second argument, `await reportRequestId(id)`, immediately after an external submission returns its identity. `operations.identify` persists that identity before polling or awaiting completion, so a crash can still be reconciled. External request IDs are retained once known and cannot be replaced by another request's identity. `createOperationExecutor.execute` sets the operation/attempt/reservation identities and bounded deadline in the provider context and returns its result only on observed success. Receipts and reservations survive a client disconnect; persistent workers and automatic recovery dispatch are implemented separately.

Actual usage settles the reservation atomically with the outcome, even when it exceeds the conservative bound; later dispatch then sees the overspend. Unknown charges retain the upper-bound reservation and cannot be released as unused. Known actual cost can be settled while application effects remain uncertain; cost certainty does not authorize repeating an unknown save or paid request. Receipt updates compare a separate version so a late accounting observation does not change the current job revision or accept stale outputs.

## Failures, retries, and deadlines

`OperationFailure` carries a validated transient, permanent, policy, or uncertain diagnostic plus observed usage when available. Unknown exceptions from an external provider become uncertain with a generic public message; their raw text is not persisted. Providers must sanitize explicit diagnostic messages before returning them.

`operationRetryDecision` applies exponential delay capped by `maxDelayMs`, honors a provider's longer retry-after minimum, and refuses delays at or beyond the absolute deadline or the maximum attempt count. Permanent/policy failures never become automatic retries. Transient retries require observed usage and a persisted `nextAttemptAt`; the worker waits until that time and submits a **new** receipt ID/reservation with the next sequence and unchanged provider/retry policy. The repository independently checks the persisted backoff, attempt limit, and deadline. The executor records this schedule; it does not create a background worker or sleep/repeat provider calls in the client's request.

Uncertain outcomes require `reconcile` using an actual provider observation, or a trusted application decision setting `uncertainRetryAuthorized: true` on the next request. An explicit risk decision still obeys backoff, remaining budget, deadline, and attempt count. The earlier unresolved reservation remains allocated; no exactly-once billing promise is made. Unsubmitted crash reservations can be reconciled only as cancelled with zero usage; that atomic update prevents a stale worker from submitting them afterward.

## Pause, cancel, and resume

Pause the authoritative job through the workflow transition/commit service. Paused jobs cannot begin or submit operations; an already submitted request may finish and retain its charge and valid historical artifacts. Resume must explicitly recheck workflow authorization, provider/evidence/artifact prerequisites, budgets, and deadlines.

Cancel the authoritative job first, then call `executor.cancelJob(jobId)` in the process owning provider calls, or `operations.cancelJob(jobId)` from another process. The lifecycle immediately prevents new requests, including a crash between those steps. The receipt update releases only reservations that never reached submission, marks in-flight effects uncertain, and retains existing completed receipts/artifacts. The executor attempts cooperative termination using `AbortSignal`. Other worker processes call `observeCancellation(id)` after observing durable cancellation. Non-cooperative providers are bounded by the deadline and remain uncertain until their external outcome is observed.

Late provider successes or explicit known-cost failures reconcile accounting while keeping cancelled outcomes cancelled and returning no accepted result. Completion/cancellation races use receipt versions; a competing reconciler's accepted observation cannot be overwritten. A charged cancelled operation is not automatically replayable when the job resumes. A cancelled request that provably never reached submission may be replaced only by a newly authorized, fenced stage attempt. Preserved artifact reuse still requires normal input-lineage and acceptance checks.

`tests/core/operations.test.ts` exercises independent real SQLite connections, competing batch reservations, stale/expired fences, over-bound actual usage, uncertainty/risk authorization, bounded backoff/deadlines, pause/cancel, unsubmitted crash recovery, late charges, external identity preservation, and secret-bearing unknown failures. It uses fake provider callbacks; no live billing service, browser capture, or media production is claimed.
