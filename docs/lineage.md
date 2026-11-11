# Stage inputs and selective invalidation

`computeStageLineage`, `bindWorkflowLineage`, `diffStageLineage`, and `invalidateWorkflowInputs` are public core services. Composition supplies explicit stage inputs, a fingerprint function, repository ports, and a delivery-pointer store. `fingerprintJson` and `createLocalDeliveryPointerStore` are the local adapters.

## Fingerprints

Each `StageInput` declares the settings and parameters actually consumed by its stage, exact implementation/provider versions, source and accepted artifact digests, template digests, and data dependencies. `StageLineage` retains their hashes and a combined input digest. Provider configuration and credential-reference names enter the configuration hash; their raw values are not stored in lineage. Hashes are identifiers, not encryption or permission to expose sensitive input dictionaries.

Project canonical JSON version one recursively sorts object keys by UTF-16 order, preserves array order, and uses JSON scalar encoding. The local adapter hashes its UTF-8 bytes with SHA-256. This is a project fingerprint format, not a signature protocol. Changing the fingerprint format or stage input semantics requires a version change. Undefined, nonfinite, and other non-JSON inputs are rejected at the input boundary.

Execution ordering and consumed data are separate. A plan can gate capture without making capture consume every narration setting in that plan. Data dependencies must be execution ancestors; their fingerprints propagate transitively. Recipes must enumerate all consumed inputs, including script/action parameters and actual accepted output hashes. A missing input represented by a null digest is distinguishable from an available input; a fingerprint alone does not prove a stage is ready. Rebuild inputs from verified source/artifact manifests before dispatch. The generic lineage service cannot infer a recipe's omitted inputs or approve its content.

The fixture workflow demonstrates these scopes:

| Edit | Invalidated stages | Examples retained |
| --- | --- | --- |
| Caption style | Composition, render, quality, delivery | Voice, alignment, capture, framing, timeline |
| Narration | Voice, alignment, timeline, composition, render, quality, delivery | Capture, framing, research, plan |
| Narration source version | Research, plan, voice, alignment, timeline, composition, render, quality, delivery | Capture, framing |
| Aspect ratio | Framing, composition, render, quality, delivery | Voice, alignment, capture, timeline |

These are the declared dependencies of this fixture, not a universal recipe mapping. A tutorial whose capture consumes revised source actions must include those source/action fingerprints and invalidate that capture too.

## Durable revisions and retained work

`WorkflowRepository.commitWorkflow` atomically commits a job mutation, immutable input snapshot/graph, and optional newly registered sources/evidence. Source/artifact digests must match same-job persisted records. SQLite migration two adds `workflow_revisions` without rewriting existing jobs, revisions, or portable records. `readWorkflow(jobId)` returns the latest snapshot compatible with the current brief revision. A raw brief import makes older snapshots unavailable for reuse; explicit historical reads retain them.

`invalidateWorkflowInputs` compares the expected job revision under the shared delivery guard. It invalidates changed/removed stages' matching attempts, revokes affected running leases, and saves the next graph/lineage with the new brief and status in one transaction. Unaffected attempts remain eligible under their unchanged stage input digest. Previous artifacts, outputs, diagnostics, settings provenance, and historical revisions remain intact. An artifact's original full settings digest is never rewritten to pretend it was produced under newer settings.

The job loses delivery readiness and waits for input; paused jobs stay paused, and cancelled jobs require explicit resume. Invalidation produces no new bytes, calls no provider, dispatches no work, grants no approval, and does not settle/release operation reservations. Subsequent execution must pass current authorization, prerequisite, lease, and byte-verification gates. Operation reconciliation and bounded retries are the next task.

## Current delivery safety

`output/current.json` is a versioned ready pointer or an invalidated tombstone. The local store exclusively claims `output/.current-delivery.lock`; all future publishers must use that same guard and check authoritative job revision/readiness before exposing a delivery. A publisher must not treat the pointer alone as proof of readiness.

Invalidation writes and syncs the tombstone **before** committing metadata, and holds the guard until that commit finishes. This order can conservatively hide an older delivery after a failed metadata commit; it cannot leave that older delivery advertised as current after a successful revision. A retry recognizes an already-written tombstone for the same next revision. A newer pointer is never overwritten. If a commit response is lost, inspect the repository before replaying the revision; do not restore an old ready pointer on an ambiguous outcome.

A killed owner can leave the exclusive lock behind. That blocks changes until its owner and authoritative revision have been reconciled; there is no age-based lock stealing or automatic restoration. Publication and user-facing recovery commands remain later tasks. Raw projection imports retain their conservative whole-workflow invalidation behavior and require the optional `pointer` port when a current pointer exists. Production composition should always supply this port, including before a first delivery, to serialize concurrent publication.

`tests/core/lineage.test.ts` checks deterministic hashes, dependency boundaries, and all four edit scopes. `tests/workspace/invalidation.test.ts` exercises real SQLite, accepted immutable JSON files, guarded imports, missing-reference rollback, pre/post-commit failures, and pointer contention. `tests/conformance/sqlite.test.ts` verifies the v1-to-v2 migration preserves history. These fixtures do not synthesize speech, record an application, or render a video.
