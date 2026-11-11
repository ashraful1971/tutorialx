# Spec Delta

## Purpose

Convert a request and research into a production-ready, reviewable script and scene plan with explicit creative settings, output variants, and authorization boundaries.

## ADDED Requirements

### Requirement: Normalize a complete production brief
The system SHALL resolve a brief containing purpose, audience, recipe, language, duration target, aspect ratios, resolution, frame rate, voice, captions, branding, audio choices, materials, and execution policy. Defaults SHALL be visible and user overrides SHALL be validated.

#### Scenario: Use a reel preset with a voice override
- **WHEN** a user selects a saved reel preset and names another voice
- **THEN** the reviewable brief shows the preset's format and duration with the explicitly selected voice and all effective caption settings

### Requirement: Plan supported recipes and output variants
The system SHALL plan browser tutorials, animated explainers, supplied-asset videos, reels, and mixed scenes. It SHALL distinguish video purpose from aspect ratio and plan framing, text size, and caption placement separately for each requested variant.

#### Scenario: Produce landscape and vertical versions
- **WHEN** one tutorial requests both variants
- **THEN** the scene plan reuses compatible content while identifying variant-specific framing and readable layouts instead of assuming a center crop is sufficient

### Requirement: Produce a reviewable script and storyboard
The plan SHALL contain natural narration, ordered scenes, evidence references, visual intentions, capture actions, expected results, timing estimates, asset needs, and a conclusion or call to action when requested. Required actions SHALL be feasible with available providers and materials.

#### Scenario: Review a screen tutorial before production
- **WHEN** planning completes for a plugin feature
- **THEN** the user can read the spoken words alongside the corresponding screen actions, estimated duration, and evidence before recording or final narration begins

### Requirement: Separate embedded and sidecar caption settings
The system SHALL support captions embedded in the video, separate subtitle files, both, or neither. Styling SHALL apply to embedded captions independently of sidecar format, language, and timing requirements.

#### Scenario: Request both caption forms
- **WHEN** the brief selects styled embedded captions and an SRT sidecar
- **THEN** the plan schedules both outputs using the same final approved words and aligned timing

### Requirement: Require revision-bound approval by default
The default policy SHALL pause after research and planning. Approval SHALL identify the plan, settings, evidence, and selected provider revisions it authorizes. No approval SHALL be inferred from silence, a timeout, or a response that does not approve production.

#### Scenario: Approve a particular script revision
- **WHEN** a user approves revision three of a plan
- **THEN** production can use revision three but cannot silently adopt revision four's materially changed narration or actions

### Requirement: Support explicit bounded autonomy
The system SHALL support an explicitly selected autonomous policy covering recipe, sources, providers, review requirements, permitted mutations, and spending limits. It SHALL retain unresolved blockers and quality gates even when human script review is waived.

#### Scenario: Run a topic list without script review
- **WHEN** the user supplies a compatible autonomous policy for the batch
- **THEN** complete supported plans can proceed automatically while jobs with missing access or unsupported claims are flagged individually

### Requirement: Estimate usage before authorizing paid work
The plan SHALL disclose projected work, estimated provider charges, uncertainty, and relevant local resource needs. Paid operations SHALL require a configured spending authorization; unknown costs SHALL be identified and constrained rather than treated as zero.

#### Scenario: A pricing estimate is unavailable
- **WHEN** a selected paid provider cannot produce a reliable estimate
- **THEN** the plan discloses that limitation and execution requires an explicit maximum authorization compatible with that provider's charging behavior

### Requirement: Revise plans with precise impact information
The system SHALL accept targeted feedback, create a new plan revision, show material changes, and identify dependent work requiring regeneration. Material script, action, provider, or policy changes SHALL invalidate the relevant prior approval unless explicitly covered by existing authorization.

#### Scenario: Shorten the introduction after rendering
- **WHEN** the user revises only the introductory narration
- **THEN** the system identifies the changed scene and downstream timing, captions, render, and review work while preserving reusable unaffected research and captures
