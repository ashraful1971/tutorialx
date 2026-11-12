# Inspecting and recovering local state

SQLite metadata is authoritative. `job.json`, `brief.md`, and storyboard files are
readable projections, not execution locks or approval credentials. Use deliberate
projection import to create revisions; never edit SQLite tables to make a job
appear successful. See [projections and workspace layout](workspaces.md),
[workflow ownership](workflow.md), and [artifact acceptance](artifacts.md).

The installed engine and creative agent have separate responsibilities. The engine
owns revisions, attempts, leases, usage, and accepted output metadata. Providers
own external requests; their request receipts support outcome reconciliation. An
operator owns permission to spend, approve production, resume, and retry. A
reviewer's or producer's prose does not grant those permissions.

## Read an interrupted job

Stop the affected worker before maintenance. Keep the database, WAL, retained
objects, and sessions private. Open the existing workspace with its recorded
identity; do not initialize another identity against its database. The public
adapter and application APIs expose everything needed for inspection:

```ts
import { createSqlitePersistence } from '@tutorialx/adapters';
import { inspectJobRecovery, releaseInterruptedAttempt } from '@tutorialx/core';

const store = await createSqlitePersistence({
  filename: privateDatabasePath,
  workspaceId,
  now: () => new Date().toISOString(),
});
await store.repository.initialize();
try {
  const report = await inspectJobRecovery({
    repository: store.repository,
    operations: store.operations,
    jobId,
    attempts: { cursor: null, limit: 20 },
    receipts: { cursor: null, limit: 20 },
    now: () => new Date().toISOString(),
  });
  // Display the report and paginate each collection with its returned cursor.
  // A live lease belongs to its worker. Never steal or overwrite it.
  // An interrupted attempt has expired ownership, not permission to replay.
} finally {
  await store.repository.close();
}
```

The report contains lifecycle, revision, wait/delivery state, attempt ownership,
diagnostic codes, operation charge reservations, and suggested recovery steps. It
omits provider payloads, credentials, source text, and unrestricted diagnostics.
Each collection is bounded independently. Read revision history through
`store.revisions.revisions(jobId)` and accepted artifacts through paginated
`store.repository.artifacts`. Inspect retained files through
`inspectRetainedArtifacts`; published bytes without accepted metadata remain
orphans. Verify metadata-referenced bytes through `verifyAcceptedArtifacts`.

## Establish the external outcome before retry

For every reserved, in-flight, or uncertain receipt belonging to an interrupted
attempt, query the provider's recorded request or reconcile the actual app state.
Use `store.operations.reconcile(id, expectedVersion, observedOutcome)` to record
the established outcome and actual charge. The returned receipt version protects
against a concurrent update. If access is unavailable or the outcome cannot be
established, keep it uncertain and retain its reservation. A timeout does not
mean an operation was free or that an app mutation failed.

Never invent an observed zero charge to free a budget. An explicit risk-authorized
repeat keeps the old unknown charge reserved and reserves a separate upper bound
for its new receipt. Legacy version-one operation records also block attempt
release until their owning integration records an established outcome.

Once all outcomes are established, release the expired execution ownership:

```ts
const current = await store.repository.read(jobId);
const recovered = await releaseInterruptedAttempt({
  repository: store.repository,
  operations: store.operations,
  jobId,
  attemptId,
  expectedRevision: current!.status.revision,
  now: () => new Date().toISOString(),
});
```

The service records the expired attempt as a retryable interrupted failure and
advances the job revision. It preserves a paused job, does not resume cancelled
work, accepts no new artifact, and emits no production dispatch. Retained
successful attempts and artifacts remain available for normal lineage and byte
verification. Request a new attempt through authorized scheduling only after
checking current plan approval, prerequisites, budget, attempt limits, and
deadlines. Reuse established operation outcomes by their operation key; a failed
stage does not imply every operation within it should be repeated.

## Conservative local rules

- Pause blocks new dispatch while owned work may finish. Cancellation blocks
  accepting late completion; receipts retain in-flight or uncertain outcomes for
  accounting. Resume always rechecks authorization and prerequisites.
- An expired worker cannot accept output. Never increase its token merely to
  commit old work. Re-verify retained bytes and current inputs under new ownership.
- After an ambiguous commit response, reread authoritative job/artifact metadata
  before any repeat. Keep orphan objects until their ownership is reconciled.
- Delivery pointer locks are separate from stage leases. Inspect an abandoned
  `output/.current-delivery.lock` and authoritative revision/readiness; do not
  automatically steal the lock or restore a stale `current.json`.
- Do not synchronize a live SQLite/WAL through file sync. Stop workers and close
  all connections before a maintenance copy. Automated backup, portable bundles,
  cleanup, and worker reconciliation are tracked separately in the change.

`tests/core/recovery.test.ts` closes and reopens a real SQLite fixture, identifies
expired ownership, retains uncertain paid work, reconciles observed usage, and
recovers through public APIs. It also rejects live/stale recovery and preserves
paused state. These are metadata recovery fixtures, not a claim that interrupted
video production or external providers have been exercised.
