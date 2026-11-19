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

## Review and autonomous modes

Both modes run the same accepted-evidence, provider capability/readiness, bounded-cost, filesystem/network, mutation, deadline, and quality gates. They differ only in how the exact plan receives production authority:

| Mode | Production authority |
| --- | --- |
| `review` | A trusted operator explicitly approves the current plan revision and its evidence/settings/provider digests. |
| `autonomous` | A separately issued revision-bound policy scope names the allowed recipe, sources, providers, mutation targets, and maximum research/production spending. |

Autonomous mode is not approval inferred from silence. A scope mismatch, missing evidence, failed provider preflight, unknown cost bound, or exhausted allowance stops the job exactly as it does in review mode. Creative roles and workers can submit validated artifacts but cannot expand either form of authority.

An interactive host may expose an approval bridge only when it authenticates the actual operator and conveys the exact revision/decision to the engine. If a host has no such bridge—or its trust model is unknown—the agent must show `plan show`/`plan diff` and direct the operator to `tutorialx plan approve` in the local CLI. Chat text such as “looks good,” an agent-set field, a timeout, or continued conversation is not an approval transport.

Headless execution requires an operator-created autonomous scope before the client disconnects. The scope is persisted independently of the conversation and cannot be minted by the headless runner. Changing a source fingerprint, provider/voice, demonstration action, mutation target, cost allowance, or plan revision requires reevaluation and usually a new scope or human approval.

Tests cover restricted roles, stale revisions, silence, expiry, unverified origins,
changed evidence/voice/actions/settings/providers, material-change reports, and
shared evidence/provider/budget failures in review and autonomous modes.
