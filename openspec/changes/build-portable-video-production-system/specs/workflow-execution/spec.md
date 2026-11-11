# Spec Delta

## Purpose

Execute video jobs as durable, inspectable stages that preserve approvals, recover safely, reuse valid work, and enforce resource limits across interactive and unattended operation.

## ADDED Requirements

### Requirement: Enforce explicit stage transitions
The system SHALL execute dependency-ordered stages with recorded inputs, outputs, attempts, and legal transitions. It SHALL distinguish queued, running, waiting, paused, failed, cancelled, and terminal delivery outcomes; waiting jobs SHALL expose a specific reason and next action.

#### Scenario: Planning requires user approval
- **WHEN** the plan completes under review policy
- **THEN** the job enters a needs-approval wait and production stages cannot run

### Requirement: Commit artifacts before declaring success
The system SHALL validate and durably store stage artifacts and provenance before committing success. Partial files or artifacts from rejected attempts SHALL NOT appear as completed reusable outputs.

#### Scenario: A worker crashes during audio writing
- **WHEN** only a partial audio file exists
- **THEN** the stage remains incomplete and recovery does not reuse that file as valid narration

### Requirement: Recover with leases and fencing
The system SHALL assign bounded worker leases to stage attempts and prevent expired workers from committing results. Recovery SHALL reconcile external outcomes and stored artifacts before resuming an interrupted stage.

#### Scenario: Two workers receive the same stage
- **WHEN** one worker has a valid lease and another receives a duplicate request
- **THEN** only the valid fenced attempt can commit the stage result

### Requirement: Track dependencies and selective invalidation
The system SHALL fingerprint stage inputs, provider versions, settings, templates, and outputs. A revision SHALL invalidate affected dependents and preserve compatible artifacts; cache reuse SHALL be visible and scoped to authorized content.

#### Scenario: Change embedded caption colors
- **WHEN** only embedded caption styling changes
- **THEN** composition, rendering, and delivery checks are invalidated while valid narration, capture, and text alignment remain reusable

### Requirement: Bound retries and reconcile side effects
The system SHALL classify transient, permanent, policy, and uncertain-outcome failures. It SHALL apply bounded attempts, backoff, and deadlines, and SHALL reconcile uncertain paid or app-changing operations before replay unless explicit policy authorizes the risk.

#### Scenario: A save action times out after clicking
- **WHEN** the app might already have saved the setting
- **THEN** recovery checks the actual state before repeating the action and stops for attention if the outcome cannot be established safely

### Requirement: Enforce budgets across concurrent work
The system SHALL track authorized, reserved, and observed provider usage and enforce job and batch limits before dispatch. Concurrency, retry, time, and generation limits SHALL be applied even when model or provider requests are made by an agent.

#### Scenario: Two scenes compete for remaining budget
- **WHEN** both request paid generation that jointly exceeds the remaining authorization
- **THEN** budget reservation permits only affordable dispatch and the other scene waits with a budget reason

### Requirement: Pause and cancel with durable semantics
The system SHALL support explicit pause, resume, and cancellation. Cancellation SHALL stop new dispatch, attempt cooperative termination, preserve completed artifacts, and record operations that remain in flight or uncertain. Resuming SHALL recheck authorization and prerequisites.

#### Scenario: Cancel during rendering
- **WHEN** cancellation is requested for an active render
- **THEN** no downstream delivery is marked ready, the render process is stopped where supported, and prior reusable artifacts are retained

### Requirement: Separate creative roles from execution authority
The system SHALL coordinate research, writing, production, and review through explicit task contracts. It SHALL support sequential role execution and optional delegation, while the engine remains authoritative for policy, state transitions, and artifact acceptance.

#### Scenario: A writer requests direct final export
- **WHEN** required capture or quality stages have not passed
- **THEN** the engine rejects finalization regardless of the writer's response

### Requirement: Preserve observable execution history
The system SHALL record structured events, stage durations, provider usage, input/output identities, errors, and trace correlations with secret redaction. Clients SHALL inspect or follow progress from a cursor without polling full logs or replaying all historical output.

#### Scenario: Reconnect after a long render
- **WHEN** a client resumes progress inspection from its last event cursor
- **THEN** it receives subsequent events and current state without requiring the complete previous log

### Requirement: Execute within explicit filesystem and network boundaries
The system SHALL scope jobs, subprocesses, browser actions, generated compositions, and external extensions to configured permissions. Untrusted code execution SHALL use a supported isolation boundary without ambient secrets; unsupported isolation SHALL block that execution class.

#### Scenario: A generated composition requests an unrelated local file
- **WHEN** rendering attempts to access content outside its staged asset root
- **THEN** access is denied and the attempt produces a diagnosable failure without exposing the file
