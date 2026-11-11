# Implementation handoff

Checkpoint: 2026-11-11. Active OpenSpec change: `build-portable-video-production-system` (spec-driven).

## Current state

14 of 98 tasks are complete: 1.1–1.4, 2.1–2.6, and 3.1–3.4. The foundation includes workspace/settings/source preparation plus readable projections and explicit revision imports through the repository port. Imports preserve history, detect stale/conflicting edits, and never mint approval.

This is the foundation. Rendering, narration, browser recording, persistent orchestration, and an end-to-end video CLI are not implemented yet. The change remains active; sync final specifications and archive after its implementation is complete.

Validation at this checkpoint: `pnpm check` passed (build, type checking, lint, dependency boundaries, 141 tests, schema drift checks, and package audits). New schemas are additive. Projection tests exercise real files with a fixture repository, including stale edits, concurrent metadata/file conflicts, and approval/status forgery. SQLite is still pending. Provider checks use fixtures, not live services or speech-quality verification.

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
Read docs/implementation-handoff.md and resume at task 3.5.
Apply, verify, and commit/push completed tasks as instructed by AGENTS.md.
Sync the specs and archive the change when all implementation tasks are complete.
```

The skill lives at `.agents/skills/openspec-apply-change/SKILL.md`. All planning artifacts and the authoritative task checklist are in `openspec/changes/build-portable-video-production-system/`. Refresh progress using `openspec instructions apply --change build-portable-video-production-system --json` before implementing.

## Next task

Task 3.5 adds workspace/profile examples and verifies dedicated and existing-app sample jobs through public APIs. Then implement task 4.1's SQLite repository and coordination semantics. Keep projection files separate from authoritative metadata. See `docs/workspaces.md` for current workspace/settings/source/projection APIs.

Provider extension guidance is in `docs/providers.md`, `docs/contract-evolution.md`, and `examples/providers/README.md`. The example imports only the public contracts and Node built-ins; its public registration/conformance exercise lives in `tests/conformance/recorded-voice.test.ts`.

Keep the intended portable engine and installable skill architecture. Use the existing contracts instead of coupling core logic to one renderer, voice service, AI host, or cloud platform. Repository-local Git identity and synchronization requirements are in `AGENTS.md`; do not copy machine-specific credentials or private media into Git.
