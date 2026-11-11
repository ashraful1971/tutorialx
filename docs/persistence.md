# Local SQLite metadata

`createSqlitePersistence({ filename, workspaceId, now })` from `@tutorialx/adapters` supplies the public job repository, research repository, revision-history reader, and resource coordinator. All four ports share one connection/transaction authority. Closing `repository` closes the entire store. Use a private workspace path such as `.tutorialx/state.sqlite`; initialize the parent workspace first.

```ts
import { createSqlitePersistence } from '@tutorialx/adapters';

const store = await createSqlitePersistence({
  filename: privateDatabasePath,
  workspaceId,
  now: () => new Date().toISOString(),
});
await store.repository.initialize();
try {
  // Application services receive store.repository / research / coordinator explicitly.
} finally {
  await store.repository.close();
}
```

SQLite is loaded dynamically only when this adapter is selected. It uses the built-in Node client, with no native package compilation or database-service login. Node 22.13+ in the supported 22 line, Node 24, and Node 26 provide it without the flag; Node 22.12 requires starting the entrypoint with `node --experimental-sqlite`. See the [official Node SQLite documentation](https://nodejs.org/api/sqlite.html). Other workspace/provider APIs can load without selecting SQLite. Tests in this implementation were run on Linux with Node 24; the repository CI matrix checks the supported platforms/LTS lines separately.

## Transactions and revisions

Initialization applies schema version one in a transaction and retains a workspace ownership marker. Repeated/concurrent initialization is safe. A future schema or another workspace identity refuses mutation. WAL, foreign keys, a five-second busy timeout, full synchronous durability, and short `BEGIN IMMEDIATE` write transactions are enabled for supported databases.

The schema owns jobs, immutable job revisions, stage/attempt records, immutable artifact/plan/approval/source/evidence records, operation receipts, monotonic event cursors, the dispatch outbox, usage reservations, and resource leases. Runtime records are validated on write and load. Database migrations and portable record schema versions are independent.

`JobRepository.commit` atomically compares the expected revision, advances the job by one revision, and writes associated records/outbox entries. A changed brief must receive the new revision. Plan and evidence history cannot be silently rewritten. `ResearchRepository.commitResearch` joins source/evidence changes to that same job transaction; evidence must match the registered source fingerprint. `JobRevisionRepository.revisions` reads retained job history. These are additive public ports, leaving the existing `JobRepository` method contract intact.

Running attempts commit success only with their current unexpired fencing token and ownership of the latest stage attempt. Lease tokens cannot move backward. A succeeded attempt cannot silently change its outputs, and output artifact IDs must exist in the same job. Metadata persistence does not probe media bytes: artifact staging/checksums/atomic acceptance are implemented separately in task 4.3. Approval records are historical data here; application authorization and stage eligibility remain separate gates.

Job/artifact lists use bounded ID-order cursor pages. Event cursors are assigned monotonically by the repository, replacing the submitted placeholder cursor. Reconnection queries return only later matching job events. Outbox payloads accept only dispatch references/capabilities/revision/time fields; unknown fields are rejected. The outbox remains pending until dispatch acknowledgement, so metadata does not depend on a live queue connection.

## Shared usage and resource ownership

Budget reservations cover one or more job/batch scopes in one transaction. Concurrent connections cannot reserve more than the configured limit. Scope kind/limit changes are rejected rather than implicitly increasing authorization. Replaying the same reservation after settlement does not allocate it again. Uncertain reservations retain their budget and cannot be released as unused. Actual usage is recorded even when it exceeds the reserved amount; subsequent work is blocked by the observed total. Settlement cannot be silently changed later.

Resource leases are durable across connections and restarts. Renew/release require the current owner, token, and lease identity. Expired/released leases receive a strictly newer token on reacquisition. Repeating an identical live acquisition or release is safe; an older renewal/release cannot disturb a newer owner. These primitives do not replace stage scheduling, cancellation, reservation/operation reconciliation, or retry policy.

Keep SQLite and its WAL files on local storage with private directory permissions. Do not synchronize an active database through a file-sync service or object store. Portable bundles, backup/recovery commands, persistent workers, and PostgreSQL are later tasks. Logs/public events must be redacted by their application boundary; the repository stores accepted records and does not infer which arbitrary strings are secrets.

`tests/conformance/repository-suite.ts` is the reusable semantic suite for future backends. The SQLite fixture uses real disk databases and independent connections. It checks revisions, transaction rollback, all associated records, event/outbox behavior, fencing, budgets, uncertain usage, and resource ownership. Additional tests verify migrations, close/reopen, future-version/foreign-workspace refusal, common provider conformance, and a real SQLite-backed edited-brief import. No queue service, cloud backend, or media production is claimed by these tests.
