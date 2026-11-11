# Spec Delta

## Purpose

Make TutorialX straightforward to install, understand, extend, test, and release as an open-source product without bundling personal content or forcing every optional production dependency on every user.

## ADDED Requirements

### Requirement: Offer a documented minimal installation
The project SHALL provide an installable versioned engine and a one-time workspace/skill setup path. Basic discovery, planning-file validation, and configuration SHALL work without cloud accounts, GPU models, or every media provider installed.

#### Scenario: Install on a clean supported machine
- **WHEN** a user installs the published package and follows the quickstart
- **THEN** the CLI runs, creates an example workspace, validates an example plan, and identifies additional dependencies for the selected production recipe

### Requirement: Diagnose only relevant production prerequisites
The system SHALL report platform support, selected provider versions, browser/media executables, optional speech runtimes, missing credentials, and remediation steps. Diagnostics SHALL distinguish required failures from unused optional capabilities.

#### Scenario: Use hosted speech without Python installed
- **WHEN** the selected recipe uses a hosted voice provider
- **THEN** missing local Python speech dependencies do not block that recipe and remain listed as optional

### Requirement: Verify supported platform and host compatibility
Releases SHALL publish an explicit tested support matrix for engine, provider bundles, operating systems, and supported agent hosts. Core installation SHALL be tested on macOS, Linux, and Windows; limitations in a selected provider SHALL be disclosed before execution.

#### Scenario: Select an unavailable provider on a supported OS
- **WHEN** the core engine works on the user's OS but a selected local speech provider does not
- **THEN** diagnostics identify the provider-specific limitation and available compatible alternatives without claiming the entire stack is supported

### Requirement: Preserve user content during upgrade and removal
Upgrades SHALL validate engine, skill, and workspace compatibility and preview migrations or managed-file changes. Removal of the engine or installed skill SHALL NOT delete private inputs, plans, profiles, or finished videos.

#### Scenario: Remove TutorialX from a plugin project
- **WHEN** the user removes managed skill integration
- **THEN** managed integration files can be removed while the user's video workspace and plugin source remain intact

### Requirement: Publish maintainable extension and contribution guidance
The project SHALL document module ownership, dependency direction, provider contracts, example extensions, local development, quality checks, and release steps. Contributors SHALL have a scaffold or complete example plus conformance tests for adding a provider without editing core workflow logic.

#### Scenario: Add a new voice backend
- **WHEN** a contributor follows the voice-provider guide
- **THEN** they can implement, register, configure, and test the backend through the documented extension surface without changing unrelated modules

### Requirement: Enforce module boundaries and reproducible checks
The project SHALL automate formatting, static checks, public-schema checks, dependency-boundary rules, contract tests, and representative end-to-end verification. Releases SHALL use locked dependencies and include declared compatibility and migration information.

#### Scenario: A provider-specific import is added to the domain core
- **WHEN** the repository's required checks run
- **THEN** the dependency-boundary check fails with the forbidden dependency path

### Requirement: Distribute code without private or unlicensed sample content
Published packages and container images SHALL contain only intentional distributable code, templates, documentation, and sample assets. Release checks SHALL exclude credentials, browser sessions, personal workspaces, generated private videos, and third-party model weights not explicitly approved for distribution.

#### Scenario: Inspect the release package
- **WHEN** release packaging checks enumerate included files
- **THEN** no private job or credential material is present and bundled sample assets have recorded provenance and applicable license notices

### Requirement: Provide an honest compatibility demonstration
The release SHALL document a complete beginner workflow and demonstrate a real checked video, interrupted-job recovery, a provider swap, and a headless batch. Simulated-provider tests SHALL be identified separately from verified live integrations.

#### Scenario: Follow the public production example
- **WHEN** a user supplies the documented dependencies and chosen provider access
- **THEN** the example reaches a checked upload package through the same public commands available to agents, without undocumented manual editing
