# Tasks

Implementation order follows the dependency graph below. Each group includes its own tests and documentation; milestone gates validate complete behavior across groups. All commands and packages named here are to be implemented, not existing functionality.

Milestones: M1 = groups 1-5; M2 = groups 6-11; M3 = groups 12-13; M4 = groups 14-16; M5 = group 17. References are the matching capability specs and numbered decisions in `design.md`.

## 1. M1: Package boundaries and contributor foundation

- [x] 1.1 Establish the pnpm workspace with contracts, core, adapters, and CLI packages, strict TypeScript, explicit exports, and a supported Node LTS matrix; verify clean install and package builds without cloud credentials or Python.
- [x] 1.2 Add formatting, linting, type checks, dependency/cycle checks, and Vitest with minimal useful fixtures; verify CI rejects an intentional forbidden vendor import into core and a cross-package deep import.
- [x] 1.3 Document the feature/module ownership map, dependency direction, local developer commands, and architectural decision process; verify every initial module has a stated responsibility and the documented development commands run from a fresh checkout.
- [x] 1.4 Establish package allowlists, lockfile policy, and separate public samples from private workspaces; verify a package dry-run lists no workspace state, browser session, credential file, or generated personal media.

## 2. M1: Public records, action schemas, and provider ports

- [x] 2.1 Define versioned workspace/settings, brief, source/evidence, plan/scene, approval, and batch schemas; verify valid examples, unknown keys, unsupported versions, and malformed references through contract tests.
- [x] 2.2 Define artifact, timeline, caption, attempt/operation, quality, delivery, and event schemas with stable IDs and consistent media time/frame-rate types; verify round trips and frame-rounding boundary fixtures.
- [ ] 2.3 Define responsibility-specific provider ports and descriptors for runners, readers, capture, speech, alignment, assets, rendering, storage, persistence, queueing, and isolation; verify fake compatible and incompatible providers through a reusable conformance harness.
- [ ] 2.4 Define action envelopes, error/exit-code mappings, expected revisions, idempotency keys, cursor pagination, and asynchronous operation responses; verify JSON Schema generation and public-schema compatibility checks.
- [ ] 2.5 Add capability/configuration negotiation, explicit provider wiring, and selection/fallback policies; verify unsupported language/custom scenes fail before dispatch and a voice-changing fallback cannot bypass authorization.
- [ ] 2.6 Document contract evolution and a complete small voice-provider example; verify the example registers and passes its conformance suite without importing core internals or modifying stage logic.

## 3. M1: Workspace organization and source registration

- [ ] 3.1 Implement idempotent initialization, configurable internal/external content roots, automatic unique job folders, and private-state ignore guidance; verify repeated initialization preserves existing app files and duplicate titles never overwrite jobs.
- [ ] 3.2 Implement profile/preset resolution with the documented precedence, policy ceilings, setting origins, and revision snapshots; verify job overrides work while content profiles cannot relax workspace limits or silently change approved settings.
- [ ] 3.3 Implement input copying/reference registration, allowed-root checks, fingerprints, and immutable original handling; verify external codebase references remain untouched and symlink/path traversal cannot escape the allowed scope.
- [ ] 3.4 Implement readable brief/job/plan projections and deliberate import of edited files as validated revisions; verify stale/conflicting edits are surfaced and no external edit is silently ignored or accepted as approval.
- [ ] 3.5 Add workspace/profile examples and folder-layout documentation; verify a fresh dedicated workspace and an existing app repository both create a discoverable sample job through the public interface.

## 4. M1: Local durable metadata, artifacts, and state transitions

- [ ] 4.1 Implement SQLite migrations/repository semantics for jobs, revisions, stages, attempts, approvals, evidence, usage, locks, events, and dispatch outbox; verify migration, transactional revision conflict, and repository conformance fixtures.
- [ ] 4.2 Implement pure stage eligibility/transitions and job lifecycle/wait/delivery outcomes; verify planning, approval, missing prerequisite, failure, cancellation, and invalidation transitions reject illegal operations.
- [ ] 4.3 Implement local artifact staging, checksums, manifest validation, atomic acceptance, and orphan retention; verify partial writes and crashes before metadata commit never become successful stage artifacts.
- [ ] 4.4 Implement input lineage/fingerprints and dependent invalidation; verify caption-style, narration, source, and aspect-ratio changes invalidate only affected work with no stale final-delivery pointer.
- [ ] 4.5 Implement operation receipts, failure classes, reservation/actual usage accounting, bounded retries/deadlines, and pause/cancel semantics; verify concurrent budget requests, uncertain external outcomes, and cancellation preserve correct state.
- [ ] 4.6 Document state ownership, readable file projections, and local recovery rules; verify an interrupted fixture is inspectable and recoverable without reading private database tables manually.

## 5. M1: Mechanical CLI and installable skill

- [ ] 5.1 Implement schema-backed init, job/source creation and inspection, capabilities, context, and submit actions with human/JSON modes; verify stdout stays parseable, responses are bounded, and missing input returns structured next actions without prompting in machine mode.
- [ ] 5.2 Implement plan show/diff/approve/revise and run/pause/resume/cancel/retry/check/export requests with separate operator and worker/creative capabilities; verify stale approval and attempted self-authorization by a restricted role are rejected.
- [ ] 5.3 Implement paginated artifact access and cursor-based redacted events with request/job/attempt correlations; verify reconnection receives only later events and known secret values never appear in public output.
- [ ] 5.4 Implement recipe/provider-specific doctor output, optional dependency discovery, and actionable remedies; verify an absent unused capture/Python/cloud component does not block a supplied-asset recipe.
- [ ] 5.5 Author the TutorialX skill with progressive researcher, writer/director, producer, and reviewer references generated against the action schemas; verify a scripted agent handoff follows the documented actions without invented shell production steps.
- [ ] 5.6 Implement managed skill install/update/remove for documented Codex and Claude Code host locations plus generic installation instructions; verify host-layout fixtures preserve unrelated instructions, preview managed changes, and removal retains user videos.
- [ ] 5.7 Run the M1 foundation gate from a clean machine/container: install the packed package, initialize both workspace styles, submit/validate a plan, inspect next actions, and reload persisted state; record the successful public-command transcript in the quickstart.

## 6. M2: Evidence-backed ingestion and research

- [ ] 6.1 Implement bounded readers for text/Markdown, HTML URLs, PDF/DOCX extraction, code files, and supplied image/audio/video metadata with declared format capabilities; verify each supported fixture yields provenance and unsupported/unreadable sources yield explicit limitations.
- [ ] 6.2 Implement scoped retrieval, exclusion/size limits, source refresh/fingerprints, and local-only processing restrictions; verify large repositories return bounded relevant extracts and hosted requests are denied under local-only policy.
- [ ] 6.3 Implement source/evidence records distinguishing claims, inference, and observed app steps; verify conflicting docs and UI observations block an unsupported tutorial claim while an asset-only topic can proceed with sufficient evidence.
- [ ] 6.4 Implement research task packs and validated external-agent submissions, with source content treated as data; verify malicious reference instructions cannot change job limits, install a provider, or retrieve excluded credentials.
- [ ] 6.5 Implement asset provenance/attribution declarations and missing-access handling; verify a restricted link is reported honestly and an attributed soundtrack remains traceable to delivery requirements.
- [ ] 6.6 Document how to supply topics, links, files, folders, codebases, product profiles, and references; verify examples register materials through the public actions without moving originals.

## 7. M2: Briefs, scripts, storyboards, and approval policy

- [ ] 7.1 Implement recipe definitions and effective brief resolution for tutorial, explainer, asset-based, reel, and mixed production; verify recipe choice remains independent of aspect ratio and unknown settings fail validation.
- [ ] 7.2 Implement schema-checked scripts/scenes with evidence, capture assertions, narration, estimated timing, assets, output variants, and readable review projections; verify a user can review words beside intended actions before final production.
- [ ] 7.3 Implement estimates, explicit research/production allowances, provider preflight, and autonomous-policy evaluation; verify paid operations cannot start without allowance and incomplete topic-only demonstrations remain blocked.
- [ ] 7.4 Bind approvals to plan/settings/evidence/provider digests and implement material-change detection; verify silence, timeout, stale revisions, changed voice, or changed demonstration steps cannot reuse an unrelated approval.
- [ ] 7.5 Implement targeted feedback/revision impact reporting and example tutorial/reel presets including all caption modes, voice controls, branding, and no-music options; verify profile changes do not mutate approved jobs and tutorial examples pause at the review gate.
- [ ] 7.6 Document the review/autonomous modes and operator approval trust model, including hosts without an approval bridge; verify both modes follow the same required evidence and budget gates in acceptance fixtures.

## 8. M2: Verified browser capture and teaching presentation

- [ ] 8.1 Build a small licensed demo app and a WordPress test-plugin fixture with repeatable setup/reset; verify the public feature flow succeeds independently before using it as a recording fixture.
- [ ] 8.2 Implement Playwright preflight, private session references, isolated contexts, explicit viewport/recording sizes, and finalized video probing; verify expired auth and unfinalized/missing recordings cannot succeed.
- [ ] 8.3 Implement approved action execution, robust locators, expected-result assertions, screenshot evidence, action timestamps, and focus coordinates; verify a failed save is reported instead of narrated as success.
- [ ] 8.4 Implement deliberate dwell, readable typing/scrolling, cursor/click presentation metadata, and scene checkpoints; verify cursor markers match actual actions and essential steps remain readable in landscape and vertical fixture previews.
- [ ] 8.5 Implement fixture resource locking, state reconciliation, scoped demo mutations, and masking regions; verify parallel shared-state recordings cannot conflict and retry after a mutation does not create uncontrolled duplicates.
- [ ] 8.6 Document product demo setup, authentication renewal, permitted actions, and capture limitations; verify the WordPress fixture produces a real finalized recording and evidence manifest through public actions.

## 9. M2: Narration, alignment, and measured timelines

- [ ] 9.1 Implement the Google speech provider with voice/language discovery, supported controls, pronunciation handling, segment receipts, usage, and cancellation/timeout diagnostics; verify provider conformance fixtures and record a separately identified real-service synthesis smoke run with configured access.
- [ ] 9.2 Implement supplied-narration input and native provider-timing normalization; verify provided audio works without TTS credentials and missing word timestamps trigger an alignment prerequisite rather than invented cues.
- [ ] 9.3 Implement the optional locked WhisperX runtime bridge, language/model capability reporting, final-audio transcription/alignment, and approved-text comparison; verify CPU-mode fixtures, omitted speech, product terms, numbers, and unalignable words produce accurate results or explicit findings.
- [ ] 9.4 Implement measured scene timing, narration/action anchors, allowed holds/cutaways, duration reconciliation, and rational-frame conversion; verify known alignment fixtures stay within the quality profile's tolerance without truncating narration or speeding essential actions beyond policy.
- [ ] 9.5 Implement shared final caption tracks, SRT/VTT serialization, readable line breaking, and language metadata; verify Unicode text, overlapping/invalid cues, and timeline revisions through meaningful caption fixtures.
- [ ] 9.6 Document voice selection/audition, supplied-audio use, local alignment installation, and timing limitations; verify the documented no-paid-account example uses supplied narration and still produces valid aligned captions.

## 10. M2: HyperFrames composition and output variants

- [ ] 10.1 Implement renderer-neutral common scene/timeline primitives and trusted template compilation; verify title, text, image/video, capture/focus, diagram/callout, transition, audio, and captions validate independently of renderer source.
- [ ] 10.2 Implement a pinned HyperFrames adapter with preflight, reproducible asset/font staging, inspectable diagnostics, resource limits, and atomic output acceptance; verify a real CLI/library render passes media probing and missing fonts/assets fail explicitly.
- [ ] 10.3 Implement branded tutorial/explainer/reel templates and variant-specific framing, safe regions, crop/zoom mapping, and caption layout; verify required controls/text remain visible in landscape, vertical, and square fixtures.
- [ ] 10.4 Implement audio mixing/ducking and explicit no-music/no-effects behavior with FFmpeg utilities where needed; verify voice/background levels and a narration-only render contains no added soundtrack.
- [ ] 10.5 Implement embedded, sidecar, both, and no-caption exports plus requested thumbnail generation; verify all four caption modes use the accepted final timeline and produce only their requested files.
- [ ] 10.6 Implement the supplied-asset provider and optional generated-asset request contract with provenance, explicit cost authorization, and capability failure behavior; verify asset-only production requires no browser or generative-media service.
- [ ] 10.7 Document template/recipe extension, custom-renderer dependencies, and selected renderer setup; verify common examples render through public actions without manual edits to generated source.

## 11. M2: Quality, repairs, and complete local delivery

- [ ] 11.1 Implement versioned quality profiles and final-media technical checks for decoding, streams, duration, variant metadata, truncation, plan-aware blank/frozen/silent intervals, loudness/peaks, and cue validity; verify deliberately defective media fails while intentional holds and silence do not.
- [ ] 11.2 Implement review packs with scene/time evidence, final frames/clips, transcript/audio references, and modality/interval coverage; verify all scenes are represented and text-only review cannot pass required visual/audio checks.
- [ ] 11.3 Implement fresh reviewer task submissions and findings for accuracy, demo success, narration fidelity, framing, captions, pacing, and masking; verify a producer's success assertion alone cannot finalize delivery.
- [ ] 11.4 Implement finding-to-stage repair mapping, bounded repairs, rechecks, and renewed approval for material changes; verify a music-level or caption-layout repair reuses valid capture/research and exhaustion ends in needs-attention.
- [ ] 11.5 Implement immutable per-variant delivery packages and current-pointer commit with videos, selected subtitles/thumbnails, checksums, attribution, and quality manifests; verify partial/failed packages never replace the last accepted delivery and nothing is published externally by default.
- [ ] 11.6 Run the M2 integration gate: a real WordPress feature tutorial and an asset-only explainer/reel, both through public actions from materials to approval to checked MP4; document exact dependencies, reviewer evidence, and output inspection results.

## 12. M3: Persistent local worker and recovery proof

- [ ] 12.1 Implement the local outbox dispatcher, persistent worker, renewable leases/fencing, and child-process media execution; verify approved work continues after the CLI disconnects and heavy rendering does not prevent heartbeats.
- [ ] 12.2 Implement reconciliation for interrupted attempts, operation receipts, stale locks, and orphan artifacts; verify crash-before/after artifact commit and expired-worker completion cannot accept partial or conflicting results.
- [ ] 12.3 Implement explicit uncertain-outcome recovery, bounded transient/rate-limit retries, and budget reservations across attempts; verify a simulated timeout-after-paid-submission does not cause an automatic untracked duplicate charge.
- [ ] 12.4 Implement cancellation and restart behavior across capture, synthesis, rendering, and queued stages; verify cancelled jobs dispatch no downstream production and retained artifacts can be reused only after resume authorization.
- [ ] 12.5 Add a recovery guide and failure-injection fixtures; verify a recorded end-to-end interrupted render resumes without repeating unaffected synthesis/capture and reports its accepted attempt lineage.

## 13. M3: Provider replacement and portable workspaces

- [ ] 13.1 Implement optional Kokoro synthesis in an isolated locked Python environment with model/dependency diagnostics; verify voice conformance and a real local-speech render without hosted speech credentials.
- [ ] 13.2 Implement Remotion for the common primitive subset with an equivalent small template pack; verify the same approved script/assets/timeline render through both adapters and unsupported custom scenes fail before production.
- [ ] 13.3 Implement export/import bundles with checksums, portable references, original plan history, secret/session exclusion, and approval-origin validation; verify cross-device/path remapping, missing assets, untrusted approvals, and cleared active leases.
- [ ] 13.4 Implement previewable cleanup/retention and workspace migrations/backups; verify cleanup preserves active/retained dependencies and migration/removal never deletes source inputs or accepted deliveries.
- [ ] 13.5 Document voice/renderer/storage extension recipes and bundle-based device transfer; verify a contributor adds a sample provider without editing core and the M3 gate demonstrates swaps, portability, and caption-style regeneration with zero new capture/TTS calls.

## 14. M4: Headless runner and optional agent interface

- [ ] 14.1 Implement the optional eve runner package through the AgentRunner port, with pinned-version documentation, durable task/session correlation, deadlines, cancellation, and validated results; verify restarting reasoning does not duplicate or assume ownership of engine production stages.
- [ ] 14.2 Add hosted gateway, explicit direct-provider, and compatible local-model configuration profiles with capability probes and context limits; verify a local-only fixture sends nothing to hosted services and an incapable reviewer yields needs-attention.
- [ ] 14.3 Implement fresh role context, schema-correction limits, evidence retrieval, and per-role tool scopes; verify a research/write/review sequence stays within configured limits and stale results cannot authorize production.
- [ ] 14.4 Implement the optional MCP stdio server from shared action schemas with bounded tool discovery/results; verify CLI/MCP parity, authorization, error shapes, and event cursors through transport conformance tests.
- [ ] 14.5 Document interactive versus headless installation and third-party runner integration; verify a topic-only supported explainer reaches a checked package with a configured headless runner and no open chat, while missing app access blocks a tutorial honestly.

## 15. M4: Batch control and resource-aware scheduling

- [ ] 15.1 Implement normalized JSON/CSV/agent-submitted topic manifests, stable batch/item IDs, explicit duplicate handling, shared profile snapshots, and per-item overrides; verify rerunning an import cannot create accidental duplicate jobs.
- [ ] 15.2 Implement aggregate status, independent failure handling, review/autonomous policies, and shared budget/deadline enforcement; verify one deficient topic waits while unrelated authorized jobs continue.
- [ ] 15.3 Implement worker capability advertising and CPU/RAM/GPU/disk/browser-fixture/provider-rate scheduling limits; verify conflicting fixture jobs serialize and incompatible worker assignments remain queued with actionable reasons.
- [ ] 15.4 Document batch presets, failure modes, cancellation, and spending behavior; verify a mixed five-topic local batch produces independent outcomes and respects a deliberately constrained shared budget.

## 16. M4: Self-hosted cloud execution and isolation

- [ ] 16.1 Implement PostgreSQL persistence and migrations behind the existing repository port; verify the SQLite semantic conformance suite also passes against PostgreSQL, including revisions, leases, budget reservations, and outbox behavior.
- [ ] 16.2 Implement S3-compatible immutable artifact storage with checksums, scoped access, staged materialization, and retention; verify remote workers reject laptop-only references and interrupted uploads never become accepted outputs.
- [ ] 16.3 Implement BullMQ/Redis dispatch and metadata reconciliation with reference-only queue payloads; verify duplicate delivery, crash-after-commit-before-ack, queue outage, and stale lease cases do not repeat accepted stages.
- [ ] 16.4 Implement the container isolation provider for generated/custom compositions with staged read-only inputs, controlled outputs, no ambient secrets, restricted network, and resource/time limits; verify attempted out-of-root reads and unauthorized network requests are denied while approved templates render.
- [ ] 16.5 Implement the remote control/worker service with scoped workspace authorization, health/readiness/progress endpoints, and secret-safe diagnostics; verify cross-workspace artifact access is denied and configured private demo/model origins remain usable without general internal-network access.
- [ ] 16.6 Deliver versioned container builds and a self-hosted Compose example with metadata, queue, storage, and optional runner services; document deployment, TLS/credential setup, backups, restore, and rollback, and verify the instructions on a clean Linux host/container environment.
- [ ] 16.7 Run the M4 integration gate: a headless remote topic batch with a forced worker restart, independent item failure, cancellation, and verified upload packages; record that the batch runs without an interactive client and that no secrets or media payloads are stored in queue messages.

## 17. M5: Integrated release and contributor acceptance

- [ ] 17.1 Finalize optional dependency bundles and platform manifests for capture, rendering/media tools, local speech/alignment, and cloud workers; verify clean macOS/Linux/Windows core install tests and a truthful per-provider support matrix with no hidden model downloads or login prompts.
- [ ] 17.2 Exercise beginner quickstarts for an existing plugin project and a standalone video workspace from packed release candidates; verify documented commands reach both review-mode and autonomous checked outputs without undocumented source edits.
- [ ] 17.3 Run the complete required static/schema/boundary/conformance/end-to-end suite and separately tagged real integrations; record which services/models were actually exercised and do not label fixture-only coverage as live compatibility.
- [ ] 17.4 Run fixed 60-second tutorial/reel performance fixtures for cold/warm runs and targeted edits; publish named-environment time/usage/RAM/render/cache baselines and investigate repeated regressions above the design threshold before release.
- [ ] 17.5 Run a contributor extension exercise using only the published architecture/provider guides; verify a new sample provider and quality check can be added with focused changes and passing conformance tests, then fix any missing documentation.
- [ ] 17.6 Prepare the proposed Apache-2.0 license, third-party notices, sample-asset provenance, contribution/security guides, changelog, compatibility/migration notes, and release workflow; verify package/image file audits, reproducible artifacts, and SBOM/provenance generation exclude private content and unapproved weights.
- [ ] 17.7 Check prospective package names/namespaces and produce a release-candidate installation/report artifact without publishing; verify all M1-M4 gates, backup/rollback exercises, and open-source distribution checks are complete before declaring implementation ready for release.

## Workflow follow-up

- Review the completed implementation and its production-video evidence before archiving this change.
- Use the explicit OpenSpec archive workflow when implementation and required checks are complete.
- Publish packages, containers, repository visibility changes, or hosted deployments only under a separate release request.
