# Spec Delta

## Purpose

Keep reusable settings and private video jobs organized independently of the installed TutorialX engine, in existing code projects or dedicated video workspaces.

## ADDED Requirements

### Requirement: Initialize a workspace without a per-video project
The system SHALL support an existing project or a dedicated directory as a workspace. Initialization SHALL be idempotent, preserve unrelated files, and record a configurable video-content root independently of the engine installation.

#### Scenario: Initialize an existing plugin repository twice
- **WHEN** a user initializes TutorialX twice in an existing plugin repository
- **THEN** the same workspace is retained without overwriting plugin files or duplicating settings

#### Scenario: Use an external private content directory
- **WHEN** a workspace selects a video-content root outside the application repository
- **THEN** new jobs and reusable materials are stored there and the project contains only the configured reference and selected skill files

### Requirement: Create predictable job directories automatically
The system SHALL create a unique stable job identity and an understandable folder layout containing input, plan, work, and output areas for each requested video. Human-readable briefs and job status SHALL be discoverable without knowing database internals.

#### Scenario: Request two videos with the same title
- **WHEN** two video requests use the same title
- **THEN** each receives a distinct job identity and directory without overwriting the other

### Requirement: Resolve settings with visible precedence
The system SHALL resolve defaults, workspace settings, selected brand/product profiles, ordered presets, and job overrides in documented precedence. It SHALL expose the effective settings with their origins and reject unknown or incompatible settings.

#### Scenario: Override a preset caption setting
- **WHEN** a job requests separate subtitles while its preset requests embedded captions
- **THEN** the effective job setting selects separate subtitles and identifies the job override as its source

### Requirement: Reuse context without cross-job contamination
The system SHALL support reusable brand, product, pronunciation, and output profiles. Each job SHALL snapshot the profile revisions it uses; subsequent profile changes SHALL NOT silently modify an approved or completed job.

#### Scenario: Change branding after approval
- **WHEN** a brand profile changes after a job plan is approved
- **THEN** that job retains the approved revision until an explicit revision operation adopts the change

### Requirement: Preserve source materials and provenance
The system SHALL accept text instructions, URLs, file or directory references, supplied media, and codebase references. It SHALL preserve originals and identify copied snapshots versus external references, including availability and content fingerprints.

#### Scenario: Reference an external codebase
- **WHEN** a user supplies a readable codebase directory
- **THEN** the job records the source revision or fingerprint and allowed scope without moving or modifying the codebase

### Requirement: Keep private state out of shareable source
The system SHALL provide appropriate ignore rules and separated secret references, browser sessions, generated work, and final media. It SHALL NOT place secret values in briefs, shared profiles, portable bundles, logs, or delivery manifests.

#### Scenario: Export a job using authenticated browser access
- **WHEN** a job bundle is exported
- **THEN** browser sessions and secret values are excluded and required credential references are listed for reconfiguration

### Requirement: Export and import portable jobs
The system SHALL export and import versioned job bundles with manifests and checksums, preserving plans, approvals, lineage, and selected assets. Import SHALL validate compatibility and resolve missing references before execution; it SHALL NOT restore a running lease.

#### Scenario: Resume on another device
- **WHEN** a compatible bundle is imported on another device with the required providers and credentials configured
- **THEN** completed stages are available for reuse and unfinished work can resume after input verification

#### Scenario: A laptop-only asset was not included
- **WHEN** an imported job refers to an unavailable local file
- **THEN** the job reports the missing asset and cannot execute dependent stages until it is supplied or remapped

### Requirement: Clean temporary work without losing deliverables
The system SHALL distinguish disposable cache/work files from source inputs, approved plans, and deliverables. Cleanup SHALL preview its effects and refuse to delete artifacts required by active jobs or retained revisions.

#### Scenario: Clean an interrupted job
- **WHEN** cleanup is requested while a job retains resumable work
- **THEN** required artifacts are preserved and disposable files are identified separately
