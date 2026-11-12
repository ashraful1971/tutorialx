# Plan approval authority

Approval binds the exact plan identity/revision, effective settings, current
evidence, and selected provider configuration digests. `approvalDigests` uses the
injected canonical fingerprint service. A plan whose evidence snapshot differs
from accepted research cannot be approved. Voice changes, altered demonstrations,
revised narration, and all other changed plan content require a matching approval.

`createPlanApproval` requires an explicit approval decision, an expected plan
revision, and an operator principal supplied by the authenticated transport.
Creative and worker roles cannot mint this authorization. A local CLI controlled
by the machine owner can issue it; an external agent submission cannot claim the
operator role in its payload. Hosts without an authenticated approval bridge must
direct the operator to the approval CLI. Silence, timeouts, and autonomous mode
alone do not authorize production or spending.

`evaluatePlanApproval` checks all digests, scope, timestamps, and expiry against
current accepted inputs. Its `isTrustedApproval` callback must establish issuer
authority independently of checksums and self-declared origin strings. Imported
approvals are historical records until the import trust policy verifies their
origin; never use `() => true` for untrusted bundle content. Explicit autonomous
policy issuance is separate from human approval and must validate its configured
policy identity and limits before providing a trusted policy record.

`comparePlanRevisions` reports material narration, visual/action, provider, voice,
settings, evidence, cost, limitation, and scene-layout/timing changes. A metadata
revision can have no material changes, but it still cannot borrow an approval
for another exact revision. Profile updates do not mutate existing snapshots.
Approval is one gate: stage eligibility still checks prerequisites, budgets,
deadlines, and quality. A production approval does not include uncertain-retry
authority unless that scope was explicitly granted.

Tests cover restricted roles, stale revisions, silence, expiry, unverified origins,
changed evidence/voice/actions/settings/providers, and material-change reports.
