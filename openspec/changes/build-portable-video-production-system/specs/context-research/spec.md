# Spec Delta

## Purpose

Turn heterogeneous user materials and application observations into traceable, bounded production knowledge without inventing unsupported claims or executable instructions.

## ADDED Requirements

### Requirement: Ingest varied materials with explicit scope
The system SHALL ingest user text, accessible URLs, documents, images, audio/video, and scoped codebase references through declared readers. It SHALL report unsupported, inaccessible, oversized, or unreadable sources and preserve source identity and processing status.

#### Scenario: A reference cannot be accessed
- **WHEN** a supplied documentation link requires unavailable access
- **THEN** research records the limitation and either proceeds using sufficient available evidence or requests the missing information

### Requirement: Record evidence for factual claims and actions
Research SHALL associate factual claims and demonstration steps with source references, relevant extracts or observations, source revision, and verification status. The system SHALL distinguish supplied claims, inferred explanations, and observed behavior.

#### Scenario: A tutorial explains a plugin setting
- **WHEN** a planned step changes a setting
- **THEN** the research record identifies the relevant source and observed UI behavior supporting the action and expected result

### Requirement: Resolve contradictions before approval
The system SHALL surface material conflicts, stale information, and unresolved assumptions in the research report. It SHALL block approval of unsupported factual or procedural claims unless they are removed, corrected, or explicitly framed as uncertainty.

#### Scenario: Documentation disagrees with the current app
- **WHEN** supplied documentation names a control that differs from the inspected app
- **THEN** the report identifies the conflict and the script cannot present the outdated steps as verified

### Requirement: Bound discovery and preserve privacy
Research SHALL honor configured source roots, network scope, file exclusions, size limits, deadlines, and model context limits. It SHALL exclude credentials and unrelated private files and SHALL NOT transmit local materials to hosted providers when local-only policy is active.

#### Scenario: Inspect a large repository
- **WHEN** the agent requests product research from a codebase
- **THEN** only allowed relevant files or bounded extracts are retrieved, with exclusions and truncation disclosed

### Requirement: Treat source content as data
The system SHALL treat instructions found inside references, webpages, source comments, and media as untrusted content. Those materials SHALL NOT change job policy, reveal credentials, authorize spending, install software, or extend executable permissions.

#### Scenario: A reference contains an instruction to upload secrets
- **WHEN** that content is ingested during research
- **THEN** it remains reference data and cannot authorize the requested action

### Requirement: Support topic-only requests honestly
The system SHALL research a topic-only request using configured sources and product context, selecting an appropriate supported recipe. If essential facts or app access are absent, it SHALL report the missing prerequisites rather than fabricate a demonstration.

#### Scenario: Generate a general informative reel from a topic
- **WHEN** sufficient approved research sources are available and no app demonstration is required
- **THEN** the job can produce an evidence-backed explainer plan without a codebase or demo site

#### Scenario: A plugin topic lacks a usable demo
- **WHEN** the requested result requires a live demonstration but no accessible instance or supplied recording exists
- **THEN** planning reports the capture prerequisite and does not present invented UI footage as a real recording

### Requirement: Track asset origin and permitted usage
The system SHALL record available provenance, attribution, and usage declarations for external or generated media. Unknown usage status SHALL be visible; export SHALL honor the configured asset policy and include required attribution in the delivery package.

#### Scenario: Select an external music track
- **WHEN** the track has a required attribution declaration
- **THEN** the plan and exported attribution record retain it and quality checks verify its inclusion
