# Spec Delta

## Purpose

Transform approved scenes and measured media into synchronized, branded video variants while keeping narration, captions, and visual intentions reusable across compatible production providers.

## ADDED Requirements

### Requirement: Represent scenes independently of renderers
The system SHALL store versioned scene intentions, approved narration, evidence, assets, focus regions, caption settings, audio, and output variants independently of renderer source code. Provider-specific scenes SHALL declare their renderer dependency and fallback status.

#### Scenario: Render a common scene with another provider
- **WHEN** two renderers support the scene's required primitives
- **THEN** either can consume the same accepted content and measured timing without rewriting the approved script

### Requirement: Produce controlled and traceable narration
Narration SHALL use the approved text, selected voice/language, pronunciation overrides, and supported delivery controls. The system SHALL retain per-segment audio, provider identity, measured duration, and usage, while supporting supplied narration as an alternative.

#### Scenario: Correct one product-name pronunciation
- **WHEN** a pronunciation override changes for one narration segment
- **THEN** only affected synthesis and dependent alignment, timing, composition, and review are regenerated

### Requirement: Align captions to final narration
The system SHALL derive validated caption timing from final audio using provider timing or a compatible alignment provider. It SHALL compare recognized or aligned words with approved text, flag material deviations, and keep captions synchronized after edits.

#### Scenario: Speech generation omits a sentence
- **WHEN** final audio does not contain a required sentence from the approved script
- **THEN** quality evidence flags the mismatch and captions cannot conceal the omission by displaying unspoken text as though it were narrated

### Requirement: Build timing from measured artifacts
The system SHALL derive final scene timing from measured audio, capture events, and explicit pacing constraints rather than estimated word count alone. It SHALL use consistent time units and explicit frame rounding, and preserve the order and readability of demonstrated actions.

#### Scenario: Narration lasts longer than a captured action
- **WHEN** an explanation exceeds its corresponding action clip
- **THEN** the timeline uses a permitted hold, recapture, or approved pacing adjustment instead of truncating speech or accelerating essential actions beyond the readability policy

### Requirement: Compose mixed visual and audio sources
The system SHALL support supplied images/video, verified captures, text, diagrams, branded layouts, transitions, zooms, and optional music/effects in supported recipes. Asset generation SHALL use explicitly selected compatible providers and budgets; absence of a generative provider SHALL NOT prevent supplied-asset production.

#### Scenario: Produce an informative video without screen recording
- **WHEN** the approved plan uses supplied images, diagrams, and narration only
- **THEN** production completes without an application instance or capture provider

### Requirement: Respect creative audio choices and consistency
The system SHALL honor no-music and no-effects settings, mix background audio beneath narration, and preserve consistent voice identity and pronunciation across a job. An unapproved provider fallback SHALL NOT change the approved creative result.

#### Scenario: Render narration without music
- **WHEN** the effective brief disables music and effects
- **THEN** no automatic soundtrack or transition sound is added to the exported video

### Requirement: Render readable output variants
The system SHALL generate each requested variant using its approved resolution, aspect ratio, frame rate, framing, safe regions, and caption layout. Compatible media SHALL be reused while layout-dependent composition and checks SHALL be performed per variant.

#### Scenario: Convert a landscape tutorial into a reel
- **WHEN** the user requests a vertical variant
- **THEN** the result uses planned framing and readable text and does not merely crop away required controls or explanatory content

### Requirement: Export selected caption forms consistently
The system SHALL generate requested embedded captions and separate SRT or VTT files from the accepted final caption timing. It SHALL use appropriate encoding, cue ordering, line breaks, and language metadata and omit unrequested caption forms.

#### Scenario: Export an SRT-only tutorial
- **WHEN** captions are configured as sidecar SRT only
- **THEN** the exported video contains no embedded captions and its SRT cues match the final audio timeline

### Requirement: Make rendering reproducible and bounded
The system SHALL record renderer, template, font, asset, and configuration versions, validate dependencies before rendering, and enforce render resource limits. It SHALL produce outputs atomically and expose missing assets or unsupported features as explicit failures.

#### Scenario: A required brand font is unavailable
- **WHEN** composition preflight cannot resolve the approved font or authorized fallback
- **THEN** rendering stops with the missing dependency instead of silently substituting an uncontrolled font
