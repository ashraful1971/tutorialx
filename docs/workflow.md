# Workflow policy and transitions

`@tutorialx/core` provides pure `validateWorkflowGraph`, `evaluateStageEligibility`, `transitionStage`, and `transitionJob` functions. They perform no file/database/provider work. Application services load authoritative records, validate the graph once, build a trusted context, apply a transition, and commit through expected revisions and attempt fencing.

A version-one workflow graph declares stage identity/kind, planning/production/quality/delivery phase, expected input digest, dependencies, required artifacts, and whether the stage is required for delivery. Duplicate/missing dependencies and cycles are rejected. Validation is iterative so a long valid chain does not consume a recursive call stack.

## Eligibility

Planning may proceed before script approval when its own access/spending prerequisites are met. Every nonplanning stage requires the result of trusted revision-bound production authorization. An autonomous mode setting or a submitted document is not authorization. The later approval service owns actor/digest/policy verification; this layer consumes its decision.

Dependencies count only when the latest matching attempt has the stage's expected input digest, succeeded without unresolved diagnostics, and still has its accepted outputs available. Required artifacts and provider/access/budget prerequisites must also pass. A stored success alone does not prove its files exist. The accepted-artifact set must come from the artifact acceptance/verification service, not an agent assertion.

Paused/cancelled/failed/finished jobs dispatch no new work. Existing running attempts block duplicate dispatch. Failed, cancelled, or previously executed invalidated/waiting attempts are retained; retry creates a new authorized attempt. Uncertain outcomes block for reconciliation rather than automatic repetition. Eligibility returns a stable code, wait reason where applicable, and a suggested public next action.

## Stage transitions

Pending work becomes eligible after its gates pass, then starts only with a live lease. Success/failure requires the latest current input/attempt fence. Success accepts only verified output identities. Waits retain a reason and revoke execution ownership. Cancel/invalidate revoke leases; invalidation retains accepted output references as history. Old inputs, superseded attempts, expired tokens, skipped states, and completion after job cancellation are rejected.

Pausing prevents downstream dispatch while an already running, still-owned attempt may finish. Cancelling prevents accepting that completion as successful work; late external outcomes and usage are reconciled through the [operation service](operations.md). Pure transitions do not stop processes, settle charges, or authorize retries themselves.

## Job outcomes

Run requires at least one eligible stage. Waits carry an explicit reason. Pause/resume and cancel/resume are explicit operations; resumed work rechecks all gates. Failure is distinct from waiting. An invalidated revision clears delivery readiness and waits for input/planning while a paused job remains paused. Ready work already completed in flight can be finalized after explicit resume without dispatching a duplicate stage. None of these transitions infer approval.

Ready delivery requires current production authorization, all required compatible stages, no running attempts, passing final quality evidence, and an accepted package. `needs-attention` is a separate outcome and never implies those checks passed. Rendering success alone cannot produce ready status. Completion counters are derived from compatible accepted stage results rather than copied from a producer's report.

The transition layer does not yet construct production recipes, execute stages, select invalidation edges, perform media checks, or publish deliveries. Those remain their own implementation tasks. `tests/core/workflow.test.ts` exercises legal flows and rejected planning/approval/input/failure/cancellation/invalidation/ready transitions using pure records.
