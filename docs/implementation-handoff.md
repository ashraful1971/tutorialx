# Implementation handoff

Checkpoint: 2026-11-12. Active OpenSpec change: `build-portable-video-production-system` (spec-driven).

## Current state

19 of 98 tasks are complete: groups 1–3 and tasks 4.1–4.4. The foundation includes workspace/settings/source preparation, revision-aware projections/imports, runnable examples, SQLite metadata/coordination, workflow policy, local artifact staging/publication with fenced atomic metadata acceptance and retained orphan inspection, and durable stage-input lineage with selective invalidation and guarded delivery tombstones.

Stopped after task 4.4 at the user's request. Task 4.5 has not been started.

This is the foundation. Rendering, narration, browser recording, persistent orchestration, and an end-to-end video CLI are not implemented yet. The change remains active; sync final specifications and archive after its implementation is complete.

Validation at this checkpoint: `pnpm check` passed (build, type checking, lint, dependency boundaries, 200 tests, schema drift checks, and package audits). Artifact tests use real files/SQLite, an actually killed worker during a partial write, and failures before/after metadata commit. Lineage tests cover caption style, narration, source, and aspect-ratio edits, retained compatible attempts/bytes, affected running leases, paused state, guarded imports, pointer contention, missing-reference rollback, and SQLite v1-to-v2 history preservation. A generated silent PCM WAV exercises measured metadata through a fixture inspector; the lineage workflow uses accepted JSON fixtures, not production video. General media probing/quality and live production providers are not claimed. Existing schemas remain unchanged; additions are versioned. Tested locally on Linux/Node 24; CI covers the declared matrix.

## Continue on another device

Clone the repository, or pull `main` in an existing clean checkout:

```sh
git clone https://github.com/ashraful1971/tutorialx.git
cd tutorialx
pnpm install --frozen-lockfile
pnpm check
```

Use Node 22.12+ in the Node 22 line, Node 24, or Node 26, and pnpm 11.25.0 as pinned in `package.json`. Install these prerequisites on the new device if needed. No provider credentials, downloaded models, or private video workspace are required for the current checks.

With the OpenSpec CLI available, ask your agent:

```text
Use openspec-apply-change for build-portable-video-production-system.
Read docs/implementation-handoff.md and resume at task 4.5.
Apply, verify, and commit/push completed tasks as instructed by AGENTS.md.
Sync the specs and archive the change when all implementation tasks are complete.
```

The skill lives at `.agents/skills/openspec-apply-change/SKILL.md`. All planning artifacts and the authoritative task checklist are in `openspec/changes/build-portable-video-production-system/`. Refresh progress using `openspec instructions apply --change build-portable-video-production-system --json` before implementing.

## Next task

Task 4.5 implements operation receipts, failure classes, reservation/actual usage accounting, bounded retries/deadlines, and pause/cancel semantics. Verify concurrent budget requests, uncertain external outcomes, and cancellation preserve correct state. Existing SQLite coordination primitives are a foundation, not a complete operation execution service. Keep policy in core and effects in adapters. See `docs/lineage.md`, `docs/artifacts.md`, `docs/workflow.md`, `docs/persistence.md`, and ADRs 0002–0004; the repository conformance suite is reusable for PostgreSQL.

Workflow snapshots use the additive `WorkflowRepository` port and SQLite schema migration two. Every future delivery publisher must share the `output/.current-delivery.lock` guard and check authoritative revision/readiness. Invalidation tombstones precede metadata, so failures can hide an old delivery conservatively. Inspect repository state after ambiguous responses; abandoned locks require reconciliation, not automatic stealing or restoring an old ready pointer. Raw projection imports require the pointer port when a current pointer exists and retain conservative whole-workflow invalidation.

Provider extension guidance is in `docs/providers.md`, `docs/contract-evolution.md`, and `examples/providers/README.md`. The example imports only the public contracts and Node built-ins; its public registration/conformance exercise lives in `tests/conformance/recorded-voice.test.ts`.

Keep the intended portable engine and installable skill architecture. Use the existing contracts instead of coupling core logic to one renderer, voice service, AI host, or cloud platform. Repository-local Git identity and synchronization requirements are in `AGENTS.md`; do not copy machine-specific credentials or private media into Git.
