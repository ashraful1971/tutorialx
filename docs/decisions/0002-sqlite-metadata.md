# ADR 0002: One local SQLite metadata authority

## Context

Workspace folders and review files now exist, but they cannot arbitrate concurrent job revisions, accepted attempts, spending, or worker ownership. The design requires local durable metadata without a cloud account or a heavy base installation. Research records must commit with their owning job revision, while provider interfaces should remain responsibility-specific.

## Decision

Use Node's built-in SQLite client behind explicit public ports. `createSqlitePersistence` supplies `JobRepository`, `ResearchRepository`, `JobRevisionRepository`, and `ResourceCoordinator` on one connection. Research changes join the same transaction as a `JobMutation`; no projection file or second database becomes another authority. Existing `JobRepository` methods remain intact.

Use a transactional versioned migration, a workspace ownership marker, foreign keys, WAL/full synchronous durability, expected job revisions, monotonic event/resource tokens, and immutable accepted record identities. Metadata transactions contain no provider/network/media work. Accepted stage completion requires current attempt fencing. Actual usage remains recorded when it exceeds an estimate; uncertain reservations retain budget.

The SQLite module loads only when selected. Node 22.12 needs its explicit experimental flag; later supported Node LTS versions expose the module without it. Document this provider-specific requirement and fail actionably instead of changing the base package's engine requirement or silently using another backend.

## Alternatives

- A native SQLite package adds installation/build/ABI obligations before the product needs a separate runtime boundary. The built-in client covers these local metadata operations.
- Treating editable JSON/Markdown as authority cannot provide atomic concurrent revisions, shared budget reservations, or lease fencing.
- Requiring PostgreSQL/Redis for local development contradicts the independent local workflow. Their adapters remain later implementation tasks behind the same semantic suite.

## Consequences

SQLite metadata calls are synchronous, bounded to short transactions with a busy timeout. Heavy media work must run outside them and later in separate worker processes so heartbeats remain responsive. The database/WAL belongs on private local storage; transfer/backup must use the later explicit recovery/bundle interfaces.

The repository verifies data shape, identity, atomicity, and fencing. Application services still own legal stage transitions, trusted approval, retries, invalidation, output-byte acceptance, and public redaction. Metadata conformance tests use real disk databases/independent connections and are reusable for PostgreSQL; they do not claim cloud or video-production compatibility.
