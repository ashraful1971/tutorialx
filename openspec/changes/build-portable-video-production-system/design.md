# Design

## Context

See `proposal.md` for motivation and scope. Discovery found only the configured OpenSpec root and generated agent workflow files: no application, package manifest, tests, Git repository, or existing capability specs. The implementation is greenfield; this document describes intended behavior and structure, not currently working commands.

The user needs the same product to work as an installed skill inside an app repository, in a standalone video workspace, and eventually as an unattended cloud producer. Inputs range from a topic to a codebase and authenticated browser instance. Output must be a checked upload package, with optional plan review before production. Individual model capabilities, source availability, and provider support vary; portability cannot mean promising equivalent results from every model or transferring arbitrary renderer source unchanged.

## Goals / Non-Goals

**Goals:**

- A small, understandable modular application whose core does not import vendor SDKs or depend on a particular agent host.
- One public action API and one durable job model across CLI, skill, MCP, local worker, and remote worker.
- Broad composition primitives and recipe extensions, with a complete tutorial/explainer/reel path before distributed operation.
- Explicit contracts and mechanical stage execution, minimizing repeated reasoning, duplicated media work, and unnecessarily large model contexts.
- Reproducible installation, inspectable files, tested provider replacement, and clear contribution ownership.

**Non-Goals:**

- Building a generic autonomous-agent framework, a general desktop automation platform, or a nonlinear editing application.
- Making a particular cloud vendor, model gateway, Redis instance, Python runtime, or container daemon mandatory for basic local usage.
- Guaranteeing unattended success without required materials, credentials, model capabilities, or a suitable worker.
- Public multi-tenant SaaS, social publishing, arbitrary native-app recording, and feature-film workflows in the initial release. They require separate adapters and operational product decisions.

## Decisions

### 1. Ship an engine with a skill, not production logic embedded in prompts

The engine owns state, validation, scheduling, artifacts, policy, and tool execution. The skill teaches an external agent how to call the engine and supply research, plans, and review findings. A runner can provide those creative tasks without a chat. The engine does not decide that prose claiming success is equivalent to a completed stage.

```text
Human request / topic list
           |
External skill + CLI / MCP / headless runner
           |
Application actions and policy checks
           |
Job stages + artifact DAG + durable metadata
           |
Agent | Research | Capture | Voice | Alignment | Assets | Renderer
           |
Storage | Persistence | Queue | Isolation adapters
```

Alternatives: a skill-only repository is easy to start but cannot supply durable autonomous execution; a hosted application first creates an unnecessary account/deployment requirement; rewriting an agent harness duplicates existing frameworks. Use the smallest engine that can execute production reliably.

### 2. Use ports and adapters with a functional core and explicit composition

Use TypeScript strict mode on supported Node.js LTS, pnpm workspaces for contributors, npm-compatible distribution for users, and Zod for boundary schemas. Python is an optional isolated speech runtime, managed separately with a locked environment. No Python or model download during base engine installation.

Keep domain transformations pure: resolve settings, validate plans, determine transitions, compute invalidation, calculate timelines, and assess deterministic findings. Inject filesystem, clocks, network, subprocess, persistence, and providers through narrow interfaces at the composition root. Prefer plain functions, discriminated unions, and small cohesive modules over inheritance or mutable singleton managers.

Dependency direction:

```text
contracts <-- core <-- adapters
                 ^        ^
                 |        |
                 +--- CLI/worker/MCP composition roots
```

The core uses ports defined in contracts and never imports adapters. Transport code calls application services, not provider SDKs. Adapters do not import one another to orchestrate a workflow; core stages coordinate them through ports. The optional runner depends only on the public contracts/action client.

Avoid a distributed microservice per stage, generic event bus, service locator, framework-specific domain entities, and speculative abstraction around every helper. Introduce a port when it isolates an external dependency or a requested replacement boundary. Extract a separate publishable adapter package only when its dependency size, runtime, or release lifecycle justifies it.

### 3. Start with a small monorepo and feature-oriented modules

```text
TutorialX/
  packages/
    contracts/src/             # Schemas, versions, portable IDs, provider ports
    core/src/
      workspace/               # Profiles, settings resolution, input registration
      jobs/                    # Revisions, transitions, attempts, lineage
      planning/                # Briefs, evidence requirements, approval policy
      production/              # Stage handlers, timeline, variant planning
      quality/                 # Findings, repair selection, delivery readiness
      batches/                 # Shared limits and item lifecycle
    adapters/src/
      agents/                  # External artifact-submission runner
      research/                # Files, URLs, documents, media metadata/readers
      capture/playwright/
      voice/google/            # Default hosted voice adapter
      voice/kokoro/            # Optional local runtime bridge
      alignment/               # Provided timing + local alignment bridge
      assets/                  # Supplied assets and optional generated media
      render/hyperframes/
      render/remotion/         # Compatibility proof for shared primitives
      persistence/             # SQLite and PostgreSQL
      storage/                 # Local and S3-compatible objects
      queue/                   # Local DB dispatcher and BullMQ
      isolation/               # Trusted declarative execution and containers
      system/                  # Process, clock, environment, redacted logging
    cli/src/
      commands/                # Thin transport handlers
      mcp/                     # Same action handlers exposed through stdio MCP
      worker/                  # Long-running dispatch/process entrypoint
      composition/             # Explicit provider wiring
    runner-eve/                # Optional reference headless agent runner
  skills/tutorialx/
    SKILL.md
    references/                # Role instructions and concise recovery recipes
  templates/<renderer>/        # Versioned visual primitives and branded recipes
  runtimes/speech/              # Optional Python worker and locked dependencies
  examples/                    # Licensed sample inputs, presets, provider examples
  tests/fixtures/              # Demo app/plugin, media, expected acceptance cases
  tests/conformance/           # Portable provider and backend contract suites
  tests/e2e/                   # Public-action production and failure/recovery paths
  docs/                        # Quickstart, architecture, provider and operator guides
  deploy/                      # Container builds and self-hosted deployment example
  .github/                     # Required checks and release automation
```

This is an ownership map, not a requirement to create empty placeholder directories. Inside each feature keep application logic, narrow helpers, and focused tests close together. Use public package exports and explicit module ownership; ban deep cross-package imports, cycles, and vendor imports into core in CI. Do not create a vague shared `utils/` dumping ground.

### 4. Keep the installed tool separate from configurable workspace content

The engine is installed once per device. Managed host-specific skill files reference its stable public commands; installation supports known hosts and a generic documented skill location without assuming every host uses the same directory.

Default project layout:

```text
existing-project/
  <existing source files>
  .agents/skills/tutorialx/     # Example supported host integration only
  .tutorialx/
    workspace.json             # Versioned config and video-root reference
    state.sqlite               # Local metadata, revisions, leases, budgets, outbox
    cache/                     # Bounded derived indexes; not source material
  tutorialx-videos/             # Configurable, including an external private folder
    shared/
      brands/
      products/
      presets/
      references/
    jobs/<stable-id>-<slug>/
      brief.md
      job.json                 # Readable projection; engine metadata is authoritative
      input/                   # Original copies or manifests for source references
      plan/revisions/<n>/      # Research, script, storyboard, settings snapshot
      work/<stage>/<attempt>/  # Audio, capture, render source, preview, logs
      output/<variant>/<id>/   # Immutable accepted delivery revision
      output/current.json      # Atomic pointer to checked current packages
```

Default configuration precedence, lowest to highest: built-in defaults, workspace defaults, selected product profile, selected brand profile, named presets in explicit order, job overrides. Policy limits inherited from a workspace/operator constrain all layers and cannot be loosened by a content profile or agent submission. Unknown keys and contradictory settings fail validation. Snapshot the resolved settings and origins into the plan.

Inputs are immutable by convention and fingerprinted. Source files elsewhere can be referenced with scoped read access; cloud export materializes required content or lists unresolved references. Portable manifests use logical artifact identities and relative/object references, not absolute laptop paths. Secrets are resolved at execution from named credential references and never copied into manifests. Browser storage lives in private runtime state, not shareable inputs.

SQLite is the local authority; human-readable job/plan files are reviewable projections or deliberate submissions through validation. Detect edits by content hash and import them as revisions rather than silently ignoring or overwriting them. Do not sync a live SQLite/WAL database through a file-sync service or run it on shared object storage. Cross-device use is a validated bundle export/import or a remote metadata service. Preserve job IDs but assign new execution ownership and clear active leases on import.

Imported approvals are retained as history, not blindly accepted as execution authority. Validate an approval's trusted origin and scope against the current operator policy; unverifiable or materially changed imports require fresh authorization. A checksum detects changes but does not authenticate who approved a plan.

### 5. Define versioned contracts before implementing adapters

Publish generated JSON Schemas from one schema source. Each record includes a schema version and stable identity; timestamps are UTC in persistence and displayed in the selected user timezone. Schemas validate at public actions, provider responses, and durable artifact loading, not repeatedly in pure internal loops.

Core records:

| Record | Responsibility |
| --- | --- |
| WorkspaceConfig / EffectiveSettings | Source roots, profiles, provider selections, policy constraints, setting origins |
| JobBrief / BatchManifest | Intent, audience, recipe, topics, overrides, delivery requirements |
| SourceManifest / EvidenceRecord | Source identity, fingerprint, location, claim/action support, verification limits |
| PlanRevision / ScenePlan | Approved words, ordered visual/capture intentions, assets, output variants |
| ApprovalRecord | Plan digest, actor/policy identity, revision, scope, expiry if configured |
| ArtifactManifest | Content hash, media metadata, lineage, provider/version, storage reference |
| Timeline / CaptionTrack | Measured time ranges, rational frame rate, source mappings, final cue timing |
| StageAttempt / OperationRecord | Inputs, lease token, external request identity, outcome, retry policy |
| QualityProfile / Finding / ReviewResult | Versioned thresholds, scene/time evidence, coverage, readiness decision |
| DeliveryManifest | Exact accepted assets, hashes, attribution, quality report, production versions |

Do not confuse job title/slug with identity. Use generated stable IDs; sanitize names and enforce path containment. Use integer microseconds for media time and a numerator/denominator for frame rate, with an explicit deterministic rounding rule at renderer boundaries. This avoids inconsistent milliseconds/seconds and accumulating float errors.

Provider descriptors declare kind, identity/version, contract compatibility, config schema, supported media/languages/features, runtime/dependency requirements, cost estimator, permission needs, timeout/cancellation, and side-effect semantics. Keep contracts specific to each kind; do not force storage and speech into a meaningless universal `generate()` method. A simple explicit registry is an assembly mechanism, not a global service locator.

### 6. Offer a small mechanical action API instead of unrestricted shell work

All commands below are intended public interfaces to implement. The eventual package name must be checked before publication; examples use the product command `tutorialx` without claiming that npm name is available.

| Public action family | Intended operations |
| --- | --- |
| `init`, `skill`, `doctor`, `capabilities` | Workspace setup; skill install/update; selected recipe diagnostics; schema and provider discovery |
| `job create/list/show` | Create from brief/topic/preset; inspect paginated jobs and effective settings |
| `source add/read` | Register references and retrieve bounded, allowed content |
| `job context` | Retrieve a role-specific context pack and legal next actions |
| `job submit` | Submit schema-checked research, plans, reviews, or revision feedback |
| `plan show/diff/approve/revise` | Human-readable or JSON review; revision-bound authorization |
| `job run/pause/resume/cancel/retry` | Request authorized transitions; retry an eligible failed stage |
| `artifact list/read`, `events` | Bounded metadata/content inspection and cursor-based progress |
| `job check/export` | Run required checks; materialize accepted upload packages |
| `job bundle/import`, `clean --dry-run` | Cross-device transfer and explicit cache retention management |
| `batch create/show/run/cancel` | Topic-list execution and independent/aggregate status |
| `worker start`, `mcp serve` | Persistent worker and optional stdio tool interface |

Human output is readable. Machine mode returns an envelope containing API/schema version, request ID, operation ID where asynchronous, data or stable error code, retryability, details, and next actions. Logs go to stderr; structured stdout stays parseable. Long operations return an accepted identity rather than blocking tool calls until rendering finishes. `events` supports cursors, bounded waits, filtering, and redacted detail.

Exit codes distinguish successful requests, invalid input, missing prerequisite, approval wait, revision conflict, policy/budget refusal, provider failure, and internal failure. Stage success is inspected through job state; asynchronous request acceptance is never reported as video completion. Mutating actions require expected revision and idempotency identity where appropriate.

Generate CLI/MCP argument schemas and skill command references from the action schema source to prevent drift. MCP is an optional adapter, not an alternative state machine. Use progressive discovery and role-specific action descriptions to avoid presenting dozens of full tool definitions on every model turn. Do not expose arbitrary shell execution as a standard production action.

Approval is a distinct capability from planning and production. Worker and creative-role credentials cannot mint an operator approval or loosen autonomous policy. An interactive host bridge can convey explicit user approval under its documented trust model; otherwise the operator approves through the human CLI/review surface. Local users retain control of their machine, so this is an application permission boundary, not a claim to sandbox an agent with unrestricted owner access.

### 7. Use role contracts and an optional existing agent runtime

Default interactive mode uses the user's external agent with sequential researcher and writer/director instructions, deterministic production tools, and a fresh reviewer task. No mandatory swarm. Different roles can share a model, but the reviewer receives independent context and final artifact evidence. Parallelize independent videos or separately authorized scenes only when dependencies and resource locks permit it.

For unattended creative work, provide `AgentRunner` as a port. Use eve as the optional reference runner rather than developing a generic conversation harness: it supports durable agent sessions and configuration for hosted or compatible local models. Keep all eve types, tools, and session handling in `runner-eve`; the TutorialX core only sees typed task requests/results and operation IDs. Its default hosted profile can use gateway model identifiers, while direct-provider and local endpoint profiles are explicit choices to meet the user's portability/offline requirements. No gateway credential is required for external-agent operation or a selected local-only profile.

The eve session is reasoning state; the TutorialX job database remains authoritative for media stages, approval, budgets, and deliveries. Do not implement two schedulers that both own the same production step. Map runner task IDs to job attempt IDs, apply an overall deadline, and reject late/stale results. A generic command/JSON submission adapter supports other agents without requiring eve compatibility. It does not bypass their authentication requirements or claim their interactive subscription can run in cloud.

Role task packs include the precise objective, brief, relevant evidence ranges, schema, allowed tools, plan revision, and remaining limits. Persist accepted results, not hidden reasoning traces. Model repair is bounded to a small number of schema-fix attempts with concise validation errors. Tool-calling, structured-output, language, and visual/audio review capabilities are probed; incapable models are not advertised as equivalent.

### 8. Execute a dependency graph with an explicit state machine

```text
Intake -> Materialize -> Research/app reconnaissance -> Plan -> Preflight
                                                              |
                                                  Review or autonomous authorization
                                                              |
                             Asset preparation + Voice + Capture
                                           |
                                     Alignment + Timeline
                                           |
                                Compose each output variant
                                           |
                                 Render -> Technical QA
                                           |
                                     Editorial review
                                           |
                                 Repair/recheck or Deliver
```

Research can inspect the app before approval, but approved production recording, final synthesis, and material demo mutations wait for authorization. Potentially paid research/model calls also require an explicitly configured research allowance; the plan gate is not permission for unlimited pre-approval spending. Passive reconnaissance and mutation authority are distinct.

A job progresses through lifecycle states with separate wait/delivery outcome fields; stages have pending, eligible, leased/running, waiting, succeeded, failed, cancelled, and invalidated statuses. Wait reasons include user input, approval, authentication, budget, capability, and uncertain outcome. Delivery outcomes are ready, needs-attention, failed, or cancelled. Pure transition functions reject illegal operations and stale revisions.

Handlers receive validated inputs, capability-scoped ports, an abort signal, and attempt identity. Completion stages artifacts in a unique attempt location, verifies checksums/schema/media, commits the accepted manifest with a fenced metadata transition, then exposes the artifact. On storage without atomic rename, write immutable objects first and atomically commit the metadata pointer. Unreferenced partial objects are garbage-collected after retention checks. Never hold a DB transaction open during model calls, recording, or rendering.

### 9. Make recovery and caching explicit, not magical exactly-once claims

Persist jobs, revisions, stages, attempts, artifact dependencies, approvals, evidence, operation receipts, resource locks, budget reservations, and dispatch outbox entries in SQLite locally or PostgreSQL remotely. Keep SQL/migrations behind a narrow repository port and run the same semantic persistence suite against both. No event sourcing: an append-only audit/event stream supplements current transactional state.

Use transactional outbox dispatch and renewable leases with monotonically changing fencing tokens. A duplicate queue message consults current metadata; an expired worker cannot commit. A reconciler scans pending outbox entries, interrupted attempts, orphan artifacts, and stale locks. BullMQ is a dispatch mechanism with at-least-once delivery, not the source of truth for job completion.

Use operation keys derived from job/revision, stage, input fingerprints, provider/template versions, and relevant parameters. Apply content caching to repeatable transformations and explicit artifact reuse to expensive external operations. Per-workspace cache is the default; no cross-user content cache. TTL and explicit refresh handle research sources that may change. Revalidate demonstration environment state even if a prior plan is reused.

Side-effect classes are pure, idempotent, reconcilable, or uncertain. Before a paid request, reserve a conservative upper bound and persist its receipt identity. After a crash, query the external request when supported. If an outcome cannot be established, mark it uncertain: the user/policy can authorize repetition, but the product must not promise exactly-once charging. Use attempt/deadline limits for all backoffs, including rate-limit waits.

Invalidation examples: caption color affects composition/render/review; corrected speech affects affected synthesis/alignment and downstream timelines; a changed source claim affects research/planning and relevant production; changing aspect ratio affects framing/capture feasibility, not automatically every source artifact. Mark revision-consistent snapshots; a job never combines current captions with an obsolete final video pointer.

### 10. Represent renderer-neutral intent, then compile to measured composition

Separate `ScenePlan` (intent and estimated timing) from `Timeline` (measured clips and cues) and renderer source (adapter-specific). Initial common primitives are title/text, supplied image/video, browser clip with focus/zoom/cursor overlay, diagram/callout, transition, narration/music/effects, and captions. Recipes are data plus trusted template identifiers, not arbitrary executable plugin code.

HyperFrames is the first renderer because HTML/CSS authoring matches the desired simplicity. Invoke a pinned validated CLI/library behind the renderer adapter; use its inspection/validation facilities where available. Do not depend on undocumented console output. Remotion implements the common subset and a small equivalent template pack as an actual portability test. It is not a requirement to duplicate the entire first template catalog.

Optional `custom-renderer-scene` declares provider identity/version and template/asset requirements. Provider negotiation surfaces incompatible scenes before paid production. Switching renderer may require template adaptation; narration, evidence, and measured timelines remain reusable. Never attempt to translate arbitrary HTML into React automatically as a correctness guarantee.

Measure each synthesized segment and capture clip. Store verified action markers and focus rectangles so narration cues can align with actual clicks/outcomes. Long explanations use deliberate holds, an additional cutaway, or recapture; essential actions are not blindly sped up. Speech delivery controls are provider capabilities, not assumptions. External timing is normalized; missing word timing invokes alignment. Transcription is evidence for comparison with approved text, not a new script authority.

Render approved variants from reusable assets with variant-specific safe areas and font sizes. Preserve source resolution and record crop/zoom mappings. Frame-accurate caption burn-in and SRT/VTT export use the same final cue track. Use FFmpeg for probing/normalization/mixing where needed, not a second ad hoc workflow competing with the renderer. Verify no-music/no-effects settings. Respect asset attribution and data-processing policy.

Use an optional pinned WhisperX worker as the first local transcription/alignment implementation, behind `AlignmentProvider`. Prefer validated provider-native word timing when present. Register the supported language/model combinations and flag unalignable words, numbers, or product terms rather than inventing timestamps. CPU mode is a supported slow fallback for compatible installations; GPU acceleration and diarization are optional and do not enter the base install.

### 11. Treat screen tutorials as verified demonstrations

Playwright performs scoped reconnaissance and recording with explicit viewport/video dimensions, robust locators, result assertions, and isolated browser contexts. The adapter closes contexts before accepting video artifacts and probes finalized output. Raw automation is too fast for teaching; a presentation controller adds deliberate dwell, readable scroll/typing, and synchronized cursor/click overlays based on actual positions.

Use an approved setup/reset recipe per product, read-only by default outside allowed demo mutations. Isolation of browser cookies does not isolate a shared backend: acquire a product-fixture lock or provision independent sample data. Split long demonstrations into verified scenes with checkpoints. Recovery reconciles app state before replaying mutations. Source-code access helps discovery but is not proof of deployed UI behavior.

Record app/browser versions, viewport, setup identity, action timings, assertions, and screenshot evidence. Handle modal/login/cookie/validation failures explicitly. Login secrets and session tokens are excluded from footage where possible and final masking is verified. Desktop apps without a compatible capture adapter remain an unmet capability, not an invitation for the agent to invent shell automation.

### 12. Isolate execution according to what is being run

The local default executes maintained templates through validated declarative data and staged assets. It does not execute arbitrary user-authored code merely because an agent supplied it. Arbitrary generated HTML/JS, executable plugins, or untrusted imported compositions use a container isolation provider with a read-only staged input root, isolated temporary output, no ambient credentials, resource limits, and network disabled unless specifically needed and allowed. Browser sandboxing alone is not the complete isolation boundary.

Allow provider credentials only to the process that needs them. Host-side provider calls write sanitized artifacts for rendering; do not pass cloud credentials into renderer processes. URL ingestion, browsers, model endpoints, and callbacks have separate allowlists. Explicitly configured private demo/model origins are allowed without opening general access to internal or cloud metadata addresses. Validate redirects, DNS resolution, file paths, symlinks, and remote object identities. Use argument arrays with subprocess APIs rather than shell string interpolation. Bound file size, decompression, media decoding, and document parsing.

Third-party provider packages require explicit installation/trust; a URL in a reference is not authority to install software. Local trusted execution can be an explicit operator mode, clearly recorded, but is never substituted silently for required isolation. Diagnostics explain what is needed when the selected execution class cannot be supported.

### 13. Make readiness an evidence-backed delivery decision

Use deterministic technical checks plus a fresh editorial review, not only a model score. Technical checks inspect final encoded media: full decode/probe, expected streams and duration, variant dimensions/frame rate, missing/truncated audio, plan-aware blank/frozen sections, clipped audio, loudness/peak profile, subtitle cue validity, and asset/font availability. Static layout bounds and sampled final frames check safe areas and required text/control visibility. Editorial review checks factual/demo evidence, narration fidelity, natural pacing, focus, captions, and sensitive regions.

Ship versioned quality profiles with explicit thresholds and fixture calibration. Initial narration defaults target approximately -16 LUFS stereo or -19 LUFS mono and a -1 dBTP true-peak ceiling; these are configurable production targets, not universal platform requirements. Timing tests use known cue/action fixtures with a maximum 250 ms misalignment; intentional holds/silence carry timeline annotations. Readability rules scale with output resolution and are validated on landscape and vertical fixtures. Document any detector's limitations rather than treating heuristic confidence as proof.

Review packs include scene/time ranges, final contact sheets, selected clips, transcript/audio references, and capture evidence. Long videos are chunked so every scene is reviewed; coverage metadata declares which intervals and modalities were inspected. A text-only model cannot pass required visual inspection. Human review can fulfill a missing reviewer capability; autonomous mode still returns needs-attention if required review is unavailable.

Findings include severity, scene/time, evidence, and permitted repair category. A repair planner maps them onto the artifact DAG and bounded attempts. Cosmetic/timing repairs within authorization proceed; a changed factual claim or demonstration returns to plan review. Final `output/current.json` advances only after all required checks pass for that exact revision. Failed previews remain in `work/` and are accessible without being mislabeled ready. Delivery includes exact format metadata, checksums, attribution, and quality evidence. Automatic social publishing is a separate future capability.

### 14. Scale by separating metadata, artifacts, and resource-aware workers

Local mode uses SQLite, filesystem artifacts, and a database-backed dispatcher with no Redis. A long-running worker executes stages independently of the CLI/chat. Heavy rendering, browser, and speech work runs in child processes or isolated containers so it cannot starve lease heartbeats. Default to conservative render concurrency and expose CPU, RAM, GPU, disk, and fixture constraints.

Cloud mode uses PostgreSQL as authority, S3-compatible immutable objects, and BullMQ/Redis dispatch behind the same ports. Build a self-hosted Docker Compose example with a control/worker process, metadata DB, queue, and object store; production operators can replace these endpoints. Large media never enters queue payloads or model context; workers fetch only required artifact ranges/objects. Worker images advertise pinned browser/media/template capabilities. GPU speech is an optional worker class, not added to every image.

Batch input supports JSON, CSV topic rows, and agent-submitted arrays normalized to one manifest. Import is idempotent by batch/item identity, with explicit duplicate handling. Shared profile snapshots and budgets do not share mutable browser state. Independent failures remain per-job. A remote control service uses scoped operator credentials, TLS via deployment ingress, least-privilege object access, and per-workspace resource partitions. This is an operator-managed service, not an unplanned public SaaS.

Cancellation stops new dispatch and propagates to active attempts. Remote health checks distinguish process liveness, dependency readiness, and job progress; no secrets in status. Backup metadata and referenced artifacts consistently, with manifest verification on restore. A stopped worker means stopped production; the product never implies the installed skill continues running by itself.

### 15. Build extension and performance discipline into development

Required checks: formatting, linting, TypeScript, dependency direction/cycles, public schema compatibility, pure domain tests, provider/backend conformance, and representative media end-to-end tests. Prefer tests of approvals, timing, recovery, invalidation, and output validity over tests mirroring private helpers. Live integration checks are opt-in for contributor machines, but release evidence must identify at least one real verified path and distinguish it from simulated fixtures.

Use Vitest for engine/contracts and Playwright for demo-app interaction. Store small licensed audio/video fixtures and expected metadata; generate large fixtures on demand. Public commands must exercise a real HyperFrames render and actual browser capture in Linux CI. Core install/configuration tests run on macOS, Linux, and Windows; full provider support is reported separately. Test redaction, stale approvals, invalid imports, duplicate queue deliveries, lost leases, uncertain billing, concurrent budget reservation, and cancellation.

Record an architecture decision when a meaningful boundary changes, not for every helper. Add contributor guides showing where a new voice provider, renderer primitive, recipe, quality check, and storage backend belong. Require public-contract changes to include compatibility/migration notes. Default extension documentation uses a complete small example and the conformance harness, not a framework essay.

Benchmark the same fixed 60-second recipe fixtures: wall time, model input/output usage, provider calls, peak RAM, render real-time factor, artifact sizes, and cache hits. Compare cold and warm runs on a named machine/image; require diagnosis for a repeated regression above 20% before release rather than inventing a hardware-independent render-speed promise. A caption-style-only edit must show zero new capture/TTS calls. Profile before parallelizing or introducing extra infrastructure.

### 16. Distribute optional capability bundles and maintain a truthful support matrix

Publish the engine/CLI with a small dependency footprint and managed skill assets. Offer explicit bundles/setup commands for browser capture, HyperFrames rendering/media executables, local speech, and cloud workers; show download size and credential/model requirements before installation. Never run a large model download or provider login as a hidden base-package postinstall. Maintain per-platform smoke-tested dependency manifests; use pinned versions and checksums where executable downloads are needed.

Quickstart: install engine, initialize workspace/selected skill host, run recipe-specific doctor, configure the chosen voice/runner, submit a sample request, review the plan, and run to a checked output. An accessible generated or supplied narration sample supports a no-paid-account demonstration; real TTS remains an explicit selectable integration. A dry-run validates plans and estimates work, but must not be advertised as video generation.

Provide Apache-2.0 as the proposed project license, a third-party notice inventory, sample-asset provenance, security/contribution guidance, release notes, changelog, and an SBOM/provenance record. Final publication is outside this planning request. Check naming/namespace availability before publishing and make package allowlists exclude local workspaces, credentials, sessions, caches, generated media, and unapproved model weights.

## Risks / Trade-offs

- [Broad video scope can become an unfinishable framework] -> Ship complete recipes and a common primitive subset first; extensions declare capabilities instead of promising every video format or aesthetic.
- [New dependencies or unstable provider CLIs change] -> Pin supported versions, add adapter contract tests and diagnostics, and keep dependency-specific logic out of core.
- [Framework duplication between eve and engine] -> Let eve own reasoning sessions only; TutorialX exclusively owns production state, policies, artifacts, and delivery.
- [Small/local models fail planning or perceptual checks] -> Probe capabilities, constrain tasks and schemas, use bounded correction, and report unmet review capability honestly.
- [Renderers cannot share arbitrary custom visuals] -> Port the common contract/templates and explicitly label custom renderer dependencies.
- [Automation succeeds technically but teaches poorly] -> Pair verified app outcomes with measured narration/action timing, readability fixtures, and fresh editorial review.
- [External requests cannot guarantee exactly-once side effects] -> Store receipts, reconcile uncertain outcomes, reserve budget, and require explicit policy for repetition.
- [Parallel browser sessions still mutate the same app] -> Use fixture locks or isolated demo instances, not cookies alone.
- [Provider costs or hardware demand vary] -> Estimate conservatively, disclose uncertainty, enforce dispatch-time limits, and publish named-environment benchmarks.
- [Cross-device file sync corrupts execution state] -> Transfer closed versioned bundles or use shared remote metadata; never synchronize active local DB files.
- [Open-source ease conflicts with heavy media dependencies] -> Keep a small base install, explicit capability bundles, container escape hatch, and a tested support matrix.

## Migration Plan

There is no application data or prior runtime to migrate. Deliver through independently verifiable milestones, all within the change's implementation scope:

1. **M1 - Contracts and installable foundation:** package boundaries, schemas, workspace/init/doctor, SQLite metadata, structured actions, and skill integration. Demonstrate configuration and validated handoffs, without claiming production video readiness.
2. **M2 - Complete local producer:** supplied materials through research, plan review, capture/narration, timeline, HyperFrames, quality, and upload package. Include one real WordPress-style feature demonstration and one asset-only explainer/reel, not only mocks.
3. **M3 - Extension and recovery proof:** second voice integration, Remotion common-subset render, portable bundles, selective invalidation, failure injection, and fresh-review role execution. Document supported variations and limitations.
4. **M4 - Unattended/self-hosted batches:** optional eve runner with hosted and compatible local-model profiles, local worker operation, PostgreSQL/S3/BullMQ adapters, container isolation, remote authorization, and restart-safe topic batches.
5. **M5 - Open-source release readiness:** clean-machine quickstarts, platform/support matrix, contributor extension exercise, representative live integrations, performance baselines, licensing/package audit, and documented release procedure. Do not publish without a separate request.

Version engine, contracts, templates, and managed skill assets explicitly. A workspace upgrade previews migrations, backs up metadata, and refuses unsupported future versions. Keep original job/plan manifests and immutable deliveries. For rollback, stop workers, pin the prior compatible engine/template images, and restore metadata backup if a forward migration is not reversible; do not overwrite source inputs or accepted exports. Cloud schema changes use additive transitions before removing old fields. Rollback never replays uncertain external operations automatically.

## Reference Checks

Primary documentation reviewed on 2026-11-11. These establish integration surfaces; the contracts and product choices above are TutorialX design decisions. Implementation must check the documentation bundled with the exact pinned package versions.

- [HyperFrames CLI](https://github.com/heygen-com/hyperframes/blob/main/docs/developers/cli.mdx): rendering and agent-oriented inspection surface.
- [HyperFrames voice/audio guide](https://github.com/heygen-com/hyperframes/blob/main/docs/guides/voice-and-audio.mdx): audio and caption facilities.
- [Remotion renderer](https://www.remotion.dev/docs/renderer) and [caption tools](https://www.remotion.dev/docs/captions/): alternate composition/render interface.
- [Playwright video recording](https://playwright.dev/docs/videos) and [browser isolation](https://playwright.dev/docs/browser-contexts): capture lifecycle and session boundaries.
- [FFprobe](https://ffmpeg.org/ffprobe.html): machine-readable encoded-media inspection.
- [MCP tools specification](https://modelcontextprotocol.io/specification/2026-07-28/server/tools): structured tool discovery and invocation.
- [BullMQ idempotent jobs](https://docs.bullmq.io/patterns/idempotent-jobs) and [stalled jobs](https://docs.bullmq.io/guide/jobs/stalled): duplicate/recovery considerations.
- [eve getting started](https://eve.dev/docs/getting-started) and [model configuration](https://github.com/vercel/eve/blob/main/docs/agent-config.md): optional runner framework, including compatible local-model configuration.
- [Google Chirp 3 HD](https://docs.cloud.google.com/text-to-speech/docs/chirp3-hd) and [Kokoro model card](https://huggingface.co/hexgrad/Kokoro-82M): initial hosted/local speech options. Voice choice remains user-configured and auditioned, not a universal quality ranking.
- [WhisperX](https://github.com/m-bain/whisperX): optional local word alignment and transcription, with language/model limitations.
