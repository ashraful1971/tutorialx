# Staging and accepting local artifacts

`createLocalArtifactStaging` from `@tutorialx/adapters` owns a private artifact area inside an existing job directory. It receives the workspace/job identities, a clock, optional byte limits, and an explicit media inspector. The `ArtifactStaging` port lets core validate and publish files without filesystem imports.

```text
job/
  work/artifacts/
    store.json
    staging/<receipt-id>/
      intent.json
      bytes.partial           # Interrupted or incomplete stream
      bytes                   # Completed, checksummed stream
      ready.json              # Complete receipt, not execution acceptance
    objects/<attempt-id>/<artifact-id>/<sha256>
```

Each staging operation claims a unique receipt directory. Streaming enforces the declared byte count/digest and a configurable size ceiling (10 GiB by default), checks cancellation/deadlines between chunks, flushes complete files, and preserves partial writes on failure. Input iterators must cooperate with cancellation while awaiting their next chunk. Streams and receipts cannot overwrite earlier attempts. The original provider storage path is replaced with a contained immutable object reference; source files are never moved or modified.

Publication requires a matching completion marker, rechecks bytes, validates structured UTF-8/JSON where applicable, and links a complete file into its immutable object location without replacement. Structured inspection is bounded to 16 MiB by default. Media publication requires the selected inspector to measure the staged file; runtime-valid returned metadata must match the proposed metadata, including equivalent rational frame rates. Missing inspectors or mismatches block publication. Captions, renderer output semantics, and final editorial/technical quality remain the responsibility of their specialized checks.

Published files are read-only by convention and verified before use. File data and supported directory entries are flushed before acceptance. Atomic link publication protects against process interruption; filesystem/hardware power-loss guarantees remain platform dependent. A filesystem owner can still alter their own files, so later checksum verification must detect missing/corrupt outputs.

## Acceptance authority

`acceptStageArtifacts` from core receives the current graph, expected job revision, the dispatch worker's explicit fence, staged receipt IDs, and expected input/provider/settings/template lineage. It reads current repository state and validates every receipt before publication. All outputs must pass; one invalid output leaves the stage incomplete.

Only after complete immutable bytes exist does one fenced `JobRepository.commit` record the artifacts and successful attempt together. The job stays in its existing lifecycle; producing artifacts never labels a delivery ready. A stale revision, changed inputs, different worker/token, expired lease, cancellation, or metadata conflict cannot accept the result. Core never refreshes a stale worker's ownership token on its behalf. SQLite also requires a newer token when an attempt owner changes.

Files and SQLite do not share a filesystem transaction. A failure before metadata commit can leave published bytes with no accepted metadata. They remain retained orphans. If a response fails after the actual commit, bytes are retained too; inspect authoritative metadata before deciding whether to repeat anything. Never delete files merely because the commit call threw.

`verifyAcceptedArtifacts` first requires accepted metadata in the requested job, then verifies its immutable bytes. A published file/receipt alone cannot be retrieved as an accepted result through this service. Previously verified available artifacts can be supplied to stage completion for progress calculation; reuse must recheck availability and current lineage.

## Retained work and recovery

`inspectRetainedArtifacts` returns bounded cursor pages with the receipt's phase, metadata-reference status, and whether its attempt still has an unreconciled running record. Phases are partial, staged, published, or unreadable. Published means a complete-sized regular object is present; the verification service still checks its checksum. A metadata reference alone is not proof the file is available. Missing published objects may leave valid staged bytes available for later recovery.

Inspection and failures do not delete anything. Keep active, uncertain, unreadable, and metadata-referenced work until it is reconciled. Previewable cleanup/retention and restart reconciliation have their own later tasks. A retained object may be accepted only after normal verification, current input authorization, and an active attempt fence.

The tests use real temporary files and SQLite. They include an actually killed worker during a partial write, mismatched/truncated/overlong streams, JSON validation, multi-output atomicity, commit failure/unknown response, provenance/ownership conflicts, scoped paths, cache corruption, and bounded retention inspection. A generated one-second silent PCM WAV exercises actual file measurement through a fixture inspector. It does not claim general video/image probing, speech quality, or a live production provider.
