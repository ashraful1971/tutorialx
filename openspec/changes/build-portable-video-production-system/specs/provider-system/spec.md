# Spec Delta

## Purpose

Allow production tools and execution backends to evolve independently through explicit, validated provider contracts with truthful capability and dependency reporting.

## ADDED Requirements

### Requirement: Register versioned providers by responsibility
The system SHALL support separately selected providers for agent running, research, capture, voice, alignment, asset generation, rendering, storage, job persistence, and queueing. Registration SHALL declare provider identity, contract version, configuration schema, capabilities, and runtime requirements.

#### Scenario: Install an additional voice provider
- **WHEN** a compatible provider is explicitly registered
- **THEN** discovery lists its supported languages, voices, timing support, configuration, and dependencies without changes to workflow stages

### Requirement: Negotiate capabilities before production
The system SHALL validate requested settings against provider capabilities before expensive execution. Unsupported language, visual primitive, codec, timing feature, or output variant SHALL produce an actionable incompatibility result rather than silent degradation.

#### Scenario: Switch a renderer with a custom visual scene
- **WHEN** a selected renderer cannot reproduce a renderer-specific scene
- **THEN** planning reports the incompatible scene and required replacement or template adaptation before rendering

### Requirement: Keep provider outputs interoperable
Providers SHALL return contract-valid artifacts, timing units, provenance, usage, and diagnostics. The system SHALL verify referenced outputs and reject incomplete or incompatible results before marking a stage successful.

#### Scenario: A voice service omits word timestamps
- **WHEN** synthesis returns valid audio but no word timing
- **THEN** the output declares timing unavailable and dependent caption production requires a compatible alignment stage

### Requirement: Make provider selection and fallback explicit
The system SHALL support provider selection by workspace, preset, and job settings. A fallback SHALL occur only under a configured policy that preserves required capabilities and cost limits; voice, data-processing location, or material visual changes SHALL require renewed plan authorization.

#### Scenario: A paid speech provider becomes unavailable
- **WHEN** the permitted fallback changes the approved voice identity
- **THEN** the job pauses for a revised plan or uses an existing explicit authorization covering that change, rather than silently changing the voice

### Requirement: Isolate optional dependencies and extensions
The base installation SHALL NOT require all provider runtimes, model downloads, cloud services, or credentials. Missing dependencies SHALL affect only selected capabilities. External executable extensions SHALL require explicit installation and declared permissions.

#### Scenario: Render a supplied-asset video without browser capture
- **WHEN** no capture stage is selected and the capture runtime is absent
- **THEN** unrelated production stages remain usable and diagnostics identify capture as unavailable rather than failing the entire installation

### Requirement: Standardize cancellation, retries, and side effects
Provider contracts SHALL declare timeout, cancellation, retryability, and side-effect semantics. Providers SHALL accept operation identities and report external request identities when available. Unknown external outcomes SHALL NOT be automatically repeated as though no operation occurred.

#### Scenario: A synthesis request times out after submission
- **WHEN** the provider cannot determine whether a billable request completed
- **THEN** the attempt is recorded as uncertain and reconciliation or policy-authorized retry is required before another request

### Requirement: Supply conformance fixtures for extensions
The project SHALL publish executable provider contract tests, fixture inputs, expected failure behavior, and extension instructions. Each shipped provider SHALL pass relevant conformance tests independently of its live-service integration checks.

#### Scenario: A contributor adds a renderer
- **WHEN** the contributor runs renderer conformance fixtures
- **THEN** the tests verify shared scene support, timing, outputs, cancellation, unsupported-feature reporting, and artifact metadata

### Requirement: Version contracts without corrupting existing jobs
The system SHALL identify incompatible contract and artifact versions before execution. Supported migrations SHALL be explicit, preserve original revisions, and invalidate affected cached results; unsupported versions SHALL yield a precise compatibility error.

#### Scenario: Open a job from a newer schema version
- **WHEN** the installed engine does not support that schema version
- **THEN** it refuses mutations and reports the required upgrade rather than partially interpreting the job
