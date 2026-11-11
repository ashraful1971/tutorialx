# ADR 0004: Persist consumed input lineage and invalidate delivery before metadata

## Context

A full-settings hash invalidates expensive compatible work after a small edit. Filesystem delivery pointers cannot join a SQLite transaction, so clearing metadata first can leave an obsolete ready pointer after a crash.

## Decision

Hash explicit consumed inputs and transitive data dependencies separately from workflow ordering. Bind the resulting lineage to the execution graph and retain immutable snapshots through an additive `WorkflowRepository` port. Keep original artifacts and provenance; revoke only affected attempts and leases. Accepted artifact metadata/bytes and current authorization remain independent reuse prerequisites.

Serialize delivery writers with a shared local guard. Persist an invalidated current-pointer tombstone before committing the new job/attempt/input revision. SQLite schema migration two adds snapshot history in the owning transaction without changing existing portable record schemas. Raw projection imports require the guard when a current pointer exists and keep conservative invalidation until new stage inputs are resolved explicitly.

## Consequences

Recipe authors must declare every consumed input; ordering alone cannot describe data compatibility. Tests exercise both precise preservation and transitive invalidation. A failed metadata transaction can hide a still-valid historical delivery, which is safer than advertising stale output. Failed responses require checking repository state before replay, and abandoned locks require reconciliation. No automatic producer retry, authorization, delivery publication, or reservation release is implied by invalidation.
