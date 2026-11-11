# Implementation handoff

Checkpoint: 2026-11-11. Active OpenSpec change: `build-portable-video-production-system` (spec-driven).

## Current state

8 of 98 tasks are complete: 1.1–1.4 and 2.1–2.4. The repository has a strict TypeScript workspace, package boundaries, contributor documentation, package audits, validated planning/media/execution contracts, provider interfaces, and a versioned agent action protocol with a generated JSON Schema catalog.

This is the foundation. Rendering, narration, browser recording, persistent orchestration, and an end-to-end video CLI are not implemented yet. The change remains active; sync final specifications and archive after its implementation is complete.

Validation at this checkpoint: `pnpm check` passed (build, type checking, lint, dependency boundaries, 70 tests, schema drift checks, and package audits).

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
Read docs/implementation-handoff.md and resume at task 2.5.
Apply, verify, and commit/push completed tasks as instructed by AGENTS.md.
Sync the specs and archive the change when all implementation tasks are complete.
```

The skill lives at `.agents/skills/openspec-apply-change/SKILL.md`. All planning artifacts and the authoritative task checklist are in `openspec/changes/build-portable-video-production-system/`. Refresh progress using `openspec instructions apply --change build-portable-video-production-system --json` before implementing.

## Next task

Task 2.5 adds capability/configuration negotiation, explicit provider wiring, and selection/fallback policies. It must verify that unsupported languages and custom scenes fail before dispatch, and that a fallback changing the voice cannot bypass authorization. Read the existing design and capability specs before editing; subsequent tasks implement settings resolution, persistence, orchestration, adapters, interfaces, and end-to-end delivery.

Keep the intended portable engine and installable skill architecture. Use the existing contracts instead of coupling core logic to one renderer, voice service, AI host, or cloud platform. Repository-local Git identity and synchronization requirements are in `AGENTS.md`; do not copy machine-specific credentials or private media into Git.
