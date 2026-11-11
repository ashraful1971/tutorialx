# Proposal

## Why

Producing accurate, natural video tutorials and reels currently requires repeatedly assembling research, scripting, browser recording, narration, editing, and rendering tools. TutorialX will make that process a reusable, open-source product: install its agent skill in an existing project or video workspace, provide a brief or topic list, optionally review the plan, and receive checked upload-ready files through a resumable local or cloud pipeline.

## What Changes

- Introduce a portable TypeScript engine, CLI, optional MCP interface, and installable agent skill. Agent-assisted and unattended execution share the same job contracts; no coding-agent subscription or hosted service is mandatory for the local engine.
- Separate tool installation from private workspace content. Create video jobs automatically with clear input, plan, work, and output directories; support reusable brand/product profiles and per-video settings.
- Establish typed, versioned interfaces for agent runners, research sources, capture, voice, alignment, asset generation, rendering, storage, persistence, and queues. Ship useful defaults and documented extension points instead of hardwiring vendors.
- Support screen tutorials, animated explainers, asset-based videos, reels, and mixed scenes; landscape, vertical, and square variants; selectable voice and language; embedded captions, sidecar subtitles, both, or neither; branding and optional background audio.
- Research supplied materials and observable application behavior, record evidence, produce a script/storyboard, and bind approval to a specific plan revision before production. Explicit autonomous policy supports unattended topic batches.
- Record verified demonstrations, synthesize speech, build a measured timeline, render, inspect the result, repair affected scenes, and export videos, subtitles, thumbnails, and a delivery manifest. Failed checks never masquerade as production-ready output.
- Persist stage results, dependencies, costs, approvals, and attempts. Bound retries and spending; support cancellation, selective regeneration, portable job bundles, isolated workers, and cloud batch execution.
- Make clean module boundaries, contributor documentation, provider conformance tests, realistic end-to-end fixtures, cross-platform installation, release hygiene, and measurable performance part of completion criteria.

## Capabilities

### New Capabilities

- `workspace-management`: Predictable private workspace layout, reusable context/settings, input handling, configuration resolution, and portable job bundles.
- `agent-tooling`: Structured CLI/MCP actions, skill installation, bounded context handoffs, runner integration, and resumable human or headless agent operation.
- `provider-system`: Versioned provider contracts, capability negotiation, isolated dependencies, validation, and extension conformance.
- `context-research`: Evidence-backed ingestion of topics, references, assets, codebases, and application observations, with provenance and uncertainty handling.
- `video-planning`: Validated briefs, reusable presets, scripts, scene plans, estimates, output variants, and revision-bound review/autonomy policies.
- `workflow-execution`: Durable stage orchestration, artifact lineage, idempotency, retries, approvals, budgets, cancellation, and selective invalidation.
- `screen-capture`: Isolated, verifiable browser demonstrations with readable presentation, timing metadata, reusable setup, and safe retry behavior.
- `media-production`: Narration, alignment, renderer-neutral scene/timeline contracts, captions, visual composition, audio mixing, and output variants.
- `quality-delivery`: Technical and editorial checks, evidence-based repair, honest readiness status, and complete upload packages.
- `batch-cloud-execution`: Topic-list jobs, bounded parallel workers, storage/persistence/queue adapters, remote operation, and restart recovery.
- `release-distribution`: Straightforward installation, optional dependency bundles, compatibility diagnostics, contributor guides, and reproducible open-source releases.

### Modified Capabilities

None. The repository has no existing durable capability specs or application implementation.

## Impact

This is a greenfield system. Implementation will add a small workspace monorepo with core/contracts, execution services, adapters, CLI/MCP/worker entrypoints, skills, templates, examples, and documentation. Proposed foundations are Node.js LTS, TypeScript, Zod, HyperFrames, Playwright, FFmpeg/FFprobe, SQLite/local storage, and optional Python speech dependencies; cloud execution adds PostgreSQL, S3-compatible storage, and BullMQ/Redis. External model, voice, and media services are configurable and require user-supplied access only when selected.

Delivery is ordered: a complete local production path first, compatibility and extension proof second, remote batches third, then release hardening. This change plans all three execution environments without making Redis, cloud credentials, GPU packages, or an agent framework prerequisites for local use. Initial recipes cover common tutorial/explainer/reel production; arbitrary feature-film editing, native-desktop automation, public multi-tenant SaaS, and automatic publishing are not first-release promises. The architecture exposes extension points for those future capabilities.
