# Spec Delta

## Purpose

Let interactive agents, unattended runners, and humans operate the same video workflow through discoverable, bounded, structured actions rather than ad hoc production scripts.

## ADDED Requirements

### Requirement: Provide one consistent action surface
The system SHALL expose workspace, job, source, planning, approval, execution, artifact, quality, and batch actions through a CLI and an optional MCP adapter backed by the same authorization and validation rules.

#### Scenario: Inspect a job through two interfaces
- **WHEN** CLI and MCP clients inspect the same job revision
- **THEN** both receive equivalent status, artifact references, blocking reasons, and permitted next actions

### Requirement: Make machine operation deterministic
Each machine-facing action SHALL have a versioned input/output schema, stable error code, request identity, and bounded response. Noninteractive execution SHALL return structured needs-input or needs-approval results instead of opening prompts or waiting indefinitely.

#### Scenario: A headless request lacks a voice credential
- **WHEN** an unattended action selects a provider whose required credential is absent
- **THEN** it returns the missing credential reference and a recoverable blocking code without leaking values or launching interactive login

### Requirement: Discover actions and provider capabilities
The system SHALL expose action schemas, examples, installed provider capabilities, dependency status, and effective execution policy. It SHALL provide a recommended next action for nonterminal jobs without requiring the agent to infer internal state.

#### Scenario: An agent connects for the first time
- **WHEN** the agent requests tool discovery and job context
- **THEN** it can identify valid actions, supported options, and the next legal step from the returned data

### Requirement: Install a portable and maintainable skill
The system SHALL install or update a versioned TutorialX skill for explicitly supported agent hosts without overwriting unrelated instructions. The skill SHALL explain the mechanical workflow, action schemas, review policy, and recovery, and SHALL load specialist instructions only when needed.

#### Scenario: Update an installed skill
- **WHEN** a user updates TutorialX skill files
- **THEN** managed files are updated with a visible diff or backup while user-owned agent configuration is preserved

### Requirement: Support external and headless planning runners
The system SHALL support an external agent submitting validated planning artifacts and a configured headless runner producing the same artifacts autonomously. Runner capabilities SHALL be checked before assignment; no specific commercial coding agent SHALL be required by the engine.

#### Scenario: Produce a topic batch without an open chat
- **WHEN** a headless-capable runner is configured with materials, policy, and budget
- **THEN** the worker can request research, plans, and review independently of an interactive chat session

#### Scenario: A local model lacks a required review capability
- **WHEN** a runner cannot inspect visual evidence required by the quality policy
- **THEN** the system selects an explicitly permitted capable reviewer or reports the unmet requirement instead of claiming equivalent review

### Requirement: Use bounded, evidence-linked handoffs
The system SHALL give a role only the relevant brief, effective settings, approved revision, evidence references, schemas, and remaining limits. Agents SHALL retrieve large artifacts by reference or range rather than receiving full job history by default.

#### Scenario: Repair one scene
- **WHEN** a repair role is assigned a pronunciation defect in one scene
- **THEN** its context identifies that scene, its approved text, defect evidence, and permitted changes without including unrelated recordings or all prior conversations

### Requirement: Validate agent output before state changes
The system SHALL reject malformed, stale, unauthorized, or evidence-incomplete agent submissions with actionable validation errors. An agent response alone SHALL NOT bypass approval, provider, budget, or delivery gates.

#### Scenario: Submit a stale scene plan
- **WHEN** an agent submits a plan based on a superseded job revision
- **THEN** the submission is rejected as a revision conflict and the current revision is identified

### Requirement: Persist handoffs independently of conversations
The system SHALL retain task requests, accepted results, and resumable job state outside the agent conversation. A compatible agent SHALL be able to resume by job identity after validation without receiving the original chat transcript.

#### Scenario: Change agents midway through planning
- **WHEN** a second compatible agent opens an unfinished job
- **THEN** it receives the persisted accepted artifacts and pending actions, with no need to reconstruct the first agent's conversation
