# Spec Delta

## Purpose

Deliver complete video packages with explicit evidence of technical and editorial checks, preserving honest readiness and targeted repair when production defects remain.

## ADDED Requirements

### Requirement: Define measurable quality policy before production
Each job SHALL resolve a versioned quality profile containing required technical checks, readability and timing thresholds, editorial review criteria, review capability requirements, and repair limits. Passing render execution alone SHALL NOT satisfy delivery readiness.

#### Scenario: A render process exits successfully
- **WHEN** no required quality checks have completed
- **THEN** the job is marked rendered or awaiting checks rather than ready to upload

### Requirement: Inspect final encoded media
The system SHALL check the final file's decodability, dimensions, frame rate, streams, duration, audio presence when required, clipping/loudness policy, and unexpected blank, frozen, silent, or truncated intervals against the scene plan. Intentional holds or silence SHALL be distinguishable from defects.

#### Scenario: A final scene is truncated during encoding
- **WHEN** the final file omits part of the approved ending
- **THEN** duration and content checks fail the affected variant and the delivery is not labeled ready

### Requirement: Review final content against approved evidence
Editorial review SHALL assess claim accuracy, demonstration outcomes, spoken-word fidelity, visible text, pacing, framing, captions, and sensitive regions using the approved plan and final media evidence. It SHALL record findings by scene and time range and disclose inspection coverage.

#### Scenario: Captions cover the demonstrated button
- **WHEN** a rendered frame places required captions over a control needed to understand the step
- **THEN** review identifies the layout defect and requests a targeted repair before readiness

### Requirement: Keep quality review independent from authoring assertions
The quality decision SHALL use fresh review context and inspect artifacts rather than accept the producing agent's claim of success. Missing visual/audio review capability or inconclusive evidence SHALL yield an attention-required result, not an invented passing score.

#### Scenario: Only a text-only reviewer is available
- **WHEN** the quality profile requires visual readability review
- **THEN** the result reports the unavailable review capability and cannot claim full production readiness

### Requirement: Repair narrowly within authorization
The system SHALL map findings to affected scenes and stages, perform bounded authorized repairs, and rerun invalidated checks. Material changes to approved content SHALL return to planning authorization rather than being silently introduced as repairs.

#### Scenario: Repair excessive music volume
- **WHEN** audio mixing fails the resolved quality threshold
- **THEN** the system adjusts the mix and reruns affected render and audio checks without repeating valid research or capture

### Requirement: Report honest delivery outcomes
The system SHALL distinguish ready, needs-attention, failed, and cancelled delivery outcomes with unresolved findings. A final preview or explicit user exception SHALL NOT be labeled as fully checked readiness when required checks remain unmet.

#### Scenario: Repair attempts are exhausted
- **WHEN** a caption defect remains after the configured repair limit
- **THEN** the output remains available as a preview with the defect report and the job ends in needs-attention rather than ready

### Requirement: Export a complete, traceable upload package
For each ready variant, the system SHALL export the video, requested subtitles and thumbnail, and a manifest containing checksums, format details, plan revision, provider/template identities, attribution, and quality result. Only complete packages SHALL be exposed as current ready deliverables.

#### Scenario: Produce a tutorial and reel
- **WHEN** both variants pass required checks
- **THEN** each has a distinct named package with its requested assets and a manifest pointing to the exact accepted files

### Requirement: Keep generation separate from publishing
The system SHALL finish at the configured delivery destination and SHALL NOT upload to a publishing account or send external notifications unless that action and destination have been explicitly configured and authorized.

#### Scenario: Finish an unattended batch
- **WHEN** videos become ready without any publishing integration configured
- **THEN** they are stored at the delivery destination with completion status and are not automatically posted to a social account
