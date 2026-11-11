# Spec Delta

## Purpose

Scale the same durable video jobs from one local worker to remote batch production without requiring an open chat or embedding machine-specific paths in portable work.

## ADDED Requirements

### Requirement: Create batches from topic lists and shared context
The system SHALL accept topic lists as structured files or agent-submitted data with shared profiles and per-item overrides. Batch creation SHALL validate items, assign stable identities, report duplicates, and preserve independent job results.

#### Scenario: Submit five plugin features with a shared preset
- **WHEN** a user creates a batch from five topics
- **THEN** five independently inspectable jobs inherit the preset, preserve their per-item overrides, and expose aggregate progress

### Requirement: Apply batch policies without erasing job gates
The system SHALL apply configured script-review or autonomous policies, budgets, deadlines, and provider restrictions across a batch. A blocked job SHALL NOT stop unrelated valid jobs unless the configured batch failure policy requires it.

#### Scenario: One topic lacks evidence
- **WHEN** one job requires missing documentation and the other jobs have sufficient context
- **THEN** the deficient job waits for attention while independent authorized jobs continue

### Requirement: Operate workers independently of chat sessions
The system SHALL support a persistent local worker and a headless remote worker using the same stage contracts. A headless-capable planning/review runner SHALL be required for unattended creative stages; a skill installation alone SHALL NOT be represented as autonomous infrastructure.

#### Scenario: Close the interactive client
- **WHEN** an approved job is assigned to a running worker with necessary runner capabilities
- **THEN** execution continues without the client conversation remaining open

### Requirement: Schedule by resource and capability limits
Workers SHALL advertise capabilities and resource limits. Dispatch SHALL enforce job/workspace concurrency, renderer CPU/memory limits, browser fixture locks, provider rate limits, and available budget; incompatible workers SHALL NOT receive unsupported stages.

#### Scenario: A CPU worker receives a GPU-only speech request
- **WHEN** no compatible worker is available
- **THEN** the stage waits with a capability reason while compatible work continues

### Requirement: Use durable metadata and portable artifact references
Remote execution SHALL use shared durable job metadata and artifact storage with checksums and scoped access. Local-only references SHALL be materialized or rejected before dispatch, and queue payloads SHALL contain references rather than complete media files or credentials.

#### Scenario: Submit a laptop job to a cloud worker
- **WHEN** the job depends on an unuploaded recording
- **THEN** remote preflight requests materialization and does not dispatch work that assumes the laptop path exists in the cloud

### Requirement: Recover safely from duplicate delivery and worker loss
The system SHALL handle duplicate queue deliveries, lost leases, process termination, and storage/queue outages without accepting conflicting stage commits. Reconciliation SHALL restore schedulable work from authoritative job metadata.

#### Scenario: Crash after committing a stage but before acknowledging the queue
- **WHEN** the queue redelivers the stage
- **THEN** the worker observes the accepted completion and does not repeat the already committed production operation

### Requirement: Authenticate and isolate remote access
Remote control SHALL authenticate callers, scope actions and artifact access to authorized workspaces, and keep worker credentials outside job content. Network execution SHALL apply target restrictions and prevent unapproved access to unrelated internal services.

#### Scenario: Request another workspace's artifact
- **WHEN** a caller lacks authorization for that workspace
- **THEN** the service denies access without returning the artifact or its private contents

### Requirement: Provide a reproducible self-hosted cloud path
The project SHALL provide versioned container images, deployment examples, service configuration, health checks, and backup/recovery instructions for remote workers. Cloud services SHALL remain optional for local operation and operator-controlled for remote operation.

#### Scenario: Start a self-hosted batch environment
- **WHEN** an operator follows the documented deployment example and configures required access
- **THEN** the environment can run and recover a sample batch using shared storage without a proprietary hosted TutorialX service
