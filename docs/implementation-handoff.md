# Implementation handoff

Checkpoint: 2026-11-12. Active OpenSpec change: `build-portable-video-production-system` (spec-driven).

## Current state

32 of 98 tasks are complete: groups 1–5, task 6.1, tasks 7.1–7.2, and task 7.4. M1 is complete. This session pulled the other-device work at `d178f6b` before implementation.

The foundation now includes durable operation receipts and usage reservations, bounded retries/deadlines, cancellation accounting, public recovery inspection, a schema-backed CLI, operator-only approval, persisted execution requests, cursor events/artifact reads, recipe diagnostics, and a bundled managed Codex/Claude Code skill. The M1 gate installed four local package tarballs in a clean Linux arm64 Node 22.14.0 container with only read-only packages/script mounted. Both workspace styles retained app files, installed skills, accepted research/plans, and reloaded revision four at the approval wait. See `docs/quickstart.md` and `docs/verification/m1-foundation.json`.

Bounded text/Markdown/code/HTML/DOCX/PDF and media-metadata readers are implemented. Optional PDF extraction and real generated MP4/FLAC probing were exercised locally; temporary binaries and generated media are outside Git. Resolved recipe briefs, shared plan validation, derived production scripts/storyboards, and exact-revision approval are implemented without changing existing version-one schemas.

Rendering, synthesis, verified browser recording, persistent workers, production quality gates, cloud execution, and checked video delivery remain unfinished. Accepted run/check/export requests are durable worker requests, not completed production. Do not archive or claim the complete change is implemented.

Validation: `pnpm check` passed (build, package/test type checking, lint, boundaries, 284 tests passed with one optional media case explicitly skipped, schema checks, and package audits). The optional reader case is exercised separately with `TUTORIALX_TEST_FFMPEG` / `TUTORIALX_TEST_FFPROBE`; its fixture uses actual generated H264/AAC MP4 and FLAC. Existing public schemas were compared structurally with the prior checkpoint and remain unchanged; new schemas are additive. Metadata migration three adds operation receipts while preserving previous history. See `docs/readers.md`, `docs/planning.md`, `docs/approval.md`, and `docs/operations.md` for scope and limits.

All three subagents reached the account usage limit during the next research/planning work. Their written code is preserved, but tasks 6.3 and 6.4 are **not complete**: additive research schemas and core evidence/task-pack helpers are groundwork, without finished public transport integration or the required full acceptance tests. Do not infer completion from exported helper names. Task 7.3 and later planning tasks have not been completed.

The user explicitly deferred real Google speech and WordPress integration testing: “i will test them later.” Keep those live-test criteria visibly pending; do not replace them with fixture-only claims or mark their tasks complete without the required evidence.

## Continue on another device

```sh
git clone https://github.com/ashraful1971/tutorialx.git
cd tutorialx
pnpm install --frozen-lockfile
pnpm check
pnpm foundation:gate --container
```

Use Node 22.12+ in the Node 22 line, Node 24, or Node 26, and pnpm 11.25.0. SQLite on Node 22.12 requires `--experimental-sqlite`; the optional PDF runtime requires Node 22.13+. Docker is needed only for the clean-container gate. Core checks require no cloud credentials or Python. The HTTP source fixture needs local loopback access.

Use `.agents/skills/openspec-apply-change/SKILL.md`, read the active artifacts, and refresh `openspec instructions apply --change build-portable-video-production-system --json` before editing checkboxes. Resume at 6.2, then audit/finish the written 6.3–6.4 groundwork and remaining tasks. Preserve the unchecked live integration criteria deferred by the user.

## Ownership and recovery

Core owns policy and receives explicit effects through ports; adapters own filesystem, clocks/timers, subprocesses, network, and persistence. `createOperationExecutor` requires an injected runtime; the local adapter supplies `createNativeOperationRuntime`. Operation receipt completion/reconciliation accounts for charges but cannot accept stage artifacts. Preserve unknown charges, reconcile side effects before retry, and never treat asynchronous request acceptance as success.

SQLite is authoritative; readable job/plan files are projections or deliberate validated submissions. Every future delivery publisher must share `output/.current-delivery.lock` and check current revision/readiness. Invalidation tombstones precede metadata, so failures can hide an old delivery conservatively. Do not automatically steal abandoned locks or restore old ready pointers. Inspect authoritative state after ambiguous responses.

Repository-local author identity and commit/push requirements are in `AGENTS.md`. Keep private workspaces, credentials, sessions, recordings, and generated media outside Git. The bundled skill and authored verification reports are intentional distributable artifacts. Do not publish packages or containers without a separate release request.
