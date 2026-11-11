# ADR 0003: Publish immutable bytes before fenced metadata acceptance

## Context

The local engine now has a durable repository and workflow gates. An adapter returning a manifest does not prove that its output is complete, readable, or owned by the current attempt. SQLite cannot transactionally commit a media file alongside job metadata.

## Decision

Separate local byte staging/publication behind `ArtifactStaging` from core acceptance policy. Each stream has a private unique receipt and complete-file marker. Verify its manifest, byte count/hash, structured encoding, and selected media inspection before publishing an immutable object without replacement.

Core compares the dispatch worker's supplied fence, current input lineage, and expected revision, then commits all manifests and successful attempt state in one repository transaction. Only this metadata commit accepts stage output. A published filename or staging marker grants no success or delivery authority.

Retain partial/staged/published work on failures, including errors returned after a commit may have succeeded. Recovery inspects metadata before adopting or removing bytes. Accepted reuse requires current lineage plus file verification; filesystem-owner changes are detected rather than assumed impossible.

## Alternatives and consequences

- Metadata-first writes could expose partial or missing artifacts after a process crash.
- Replacing a shared final filename could overwrite a prior accepted result.
- Deleting bytes after a commit error could destroy an output that was actually accepted.
- A distributed transaction across filesystem/SQLite would add complexity without eliminating platform-specific storage behavior.

The chosen order can retain harmless orphan bytes, so later reconciliation and previewable retention must respect accepted references and active/uncertain attempts. File publication remains inspectable and repeatable without repeating external paid production. Media inspectors are explicit optional local dependencies; base foundation checks require no downloaded media runtime. Final decode, caption, factual, and editorial checks remain separate quality gates.
