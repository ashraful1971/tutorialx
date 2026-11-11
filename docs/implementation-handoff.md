# Implementation handoff

Checkpoint: 2026-11-11. Active OpenSpec change: `build-portable-video-production-system` (spec-driven).

## Current state

16 of 98 tasks are complete: groups 1–3 and task 4.1. The foundation includes workspace/settings/source preparation, revision-aware projections/imports, runnable workspace/profile examples, and real SQLite metadata with revision history, attempt fencing, research records, events/outbox, shared usage reservations, and resource leases.

This is the foundation. Rendering, narration, browser recording, persistent orchestration, and an end-to-end video CLI are not implemented yet. The change remains active; sync final specifications and archive after its implementation is complete.

Validation at this checkpoint: `pnpm check` passed (build, type checking, lint, dependency boundaries, 155 tests, schema drift checks, and package audits). SQLite tests use real disk databases and independent connections, including migration/reopen, atomic rollback, revision/fencing conflicts, budgets/leases, and an edited-brief import/reload. Tested locally on Linux/Node 24; CI covers the declared platform/LTS matrix. Provider/media tests remain fixtures, not live speech/render service verification.

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
Read docs/implementation-handoff.md and resume at task 4.2.
Apply, verify, and commit/push completed tasks as instructed by AGENTS.md.
Sync the specs and archive the change when all implementation tasks are complete.
```

The skill lives at `.agents/skills/openspec-apply-change/SKILL.md`. All planning artifacts and the authoritative task checklist are in `openspec/changes/build-portable-video-production-system/`. Refresh progress using `openspec instructions apply --change build-portable-video-production-system --json` before implementing.

## Next task

Task 4.2 implements pure stage eligibility/transitions and job lifecycle/wait/delivery outcomes. Verify planning/approval gates, missing prerequisites, failures, cancellation, and invalidation reject illegal transitions. Keep domain policy in core and metadata transactions in adapters. See `docs/persistence.md` and ADR 0002 for SQLite ownership/runtime requirements; `tests/conformance/repository-suite.ts` is reusable for the later PostgreSQL backend.

Provider extension guidance is in `docs/providers.md`, `docs/contract-evolution.md`, and `examples/providers/README.md`. The example imports only the public contracts and Node built-ins; its public registration/conformance exercise lives in `tests/conformance/recorded-voice.test.ts`.

Keep the intended portable engine and installable skill architecture. Use the existing contracts instead of coupling core logic to one renderer, voice service, AI host, or cloud platform. Repository-local Git identity and synchronization requirements are in `AGENTS.md`; do not copy machine-specific credentials or private media into Git.
