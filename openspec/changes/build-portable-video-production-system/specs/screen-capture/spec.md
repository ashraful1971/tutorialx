# Spec Delta

## Purpose

Capture accurate, readable browser demonstrations with repeatable setup, verified outcomes, action timing, and isolation suitable for tutorial production and parallel jobs.

## ADDED Requirements

### Requirement: Preflight the demonstration environment
The system SHALL verify permitted target access, authentication, viewport, application state, and recording prerequisites before capture. Setup and cleanup SHALL be scoped and repeatable; credentials and sessions SHALL remain separate from shareable job content.

#### Scenario: A saved login expires
- **WHEN** capture preflight reaches a login page instead of the expected feature
- **THEN** the job requests renewed access and does not record the login failure as the tutorial demonstration

### Requirement: Use isolated capture sessions and resource locks
Each capture attempt SHALL use an isolated browser session and output location. Jobs that modify a shared application fixture SHALL acquire a resource lock or use separate fixtures even when their browser sessions are isolated.

#### Scenario: Two tutorials change the same demo setting
- **WHEN** both jobs target a shared product configuration
- **THEN** execution serializes the conflicting mutations or provisions separate authorized fixtures to avoid contaminating demonstrations

### Requirement: Verify recorded actions and results
Capture SHALL execute the approved action plan with robust element targeting, explicit expected-state checks, and bounded waits. It SHALL record evidence and timings for each meaningful action and SHALL NOT advance on a visually plausible but unverified result.

#### Scenario: Saving a form returns an error
- **WHEN** an approved step expects successful saving but the application reports failure
- **THEN** capture fails that step with evidence and the narration cannot claim success using the failed footage

### Requirement: Present actions at a natural teaching pace
The system SHALL support deliberate pauses, readable scrolling and typing, visible cursor/click emphasis, and framing hints. Cursor presentation SHALL correspond to actual action coordinates; decorative timing SHALL NOT change the factual order of operations.

#### Scenario: Explain a small control in a vertical reel
- **WHEN** the scene plan highlights a control that would be unreadable at full viewport scale
- **THEN** capture metadata identifies the focus region and the composition uses a readable framing plan for the vertical variant

### Requirement: Produce finalized capture artifacts and timing metadata
The system SHALL finalize recording before accepting it, verify its dimensions and duration, and return media references with action timestamps, focus regions, and outcome evidence. Recording settings SHALL match the intended production resolution rather than tool defaults.

#### Scenario: Close the recording session
- **WHEN** a capture attempt completes
- **THEN** the recording is fully saved, probed, and associated with the scene before the capture stage succeeds

### Requirement: Recover from known states without unsafe replay
Retry SHALL start from a verified checkpoint or reinitialize an authorized fixture. Irreversible or uncertain application mutations SHALL require reconciliation or explicit authorization before repetition.

#### Scenario: A recording fails after creating a sample record
- **WHEN** capture retries the scene
- **THEN** it reuses, removes, or recreates the sample according to the approved fixture policy rather than producing uncontrolled duplicates

### Requirement: Keep sensitive content out of final footage
The system SHALL support selected field masking, recording boundaries, and preflight checks for known sensitive surfaces. Required masking SHALL be verified in final rendered frames; an unresolved exposure SHALL block production-ready delivery.

#### Scenario: A demo page displays a configured secret field
- **WHEN** the page is recorded
- **THEN** the final footage masks that region according to policy and quality review verifies the mask in the exported variant
