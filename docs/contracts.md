# Portable contracts

`@tutorialx/contracts` is the single source for runtime schemas and TypeScript record types. Public records carry `schemaVersion: 1`, a stable path-safe identity, and a UTC creation timestamp. Schemas reject unknown fields and unsupported versions. They do not coerce strings into numbers or execute data found in references.

See [contract evolution](contract-evolution.md) for compatibility review, versioning, and explicit migration rules.

The planning contracts cover workspace configuration, versioned product/brand/preset profiles, complete effective settings and partial overlays, briefs, source/evidence manifests, research, scene plans, approvals, and batch topic manifests. Partial overlays are validated before merging and the complete effective settings are validated again afterward. Validation does not grant permission: the engine must still enforce source roots, policy ceilings, factual evidence, revision ownership, and approval origin.

Use integer microseconds for media time and integer millionths of a US dollar for usage/budget amounts. These have separate named schemas even though both serialize as safe integers. Frame rate is a numerator/denominator pair. A source path is interpreted only by the scoped source adapter; accepting its shape does not permit arbitrary filesystem access.

Narration can be disabled, supplied as an asset, or synthesized through a selected voice provider. Caption settings independently support embedded, sidecar, both, or neither. Sidecar formats are explicit. A provider must support the selected language/voice/controls before production can start.

Contracts prove data shape and local invariants. Application-level checks prove that referenced evidence/assets/variants exist and match the current revision. Approval records retain exact plan/settings/evidence/provider digests; merely parsing an approval record does not establish that its actor is trusted.

See `tests/fixtures/contracts.ts` for complete typed examples and `tests/contracts/planning.test.ts` for rejected malformed, incompatible, or stale-shaped inputs.

## Production records

Artifact manifests contain checksummed storage references, measured media metadata, and input/provider/template lineage. Local paths and object keys are portable relative paths; they cannot escape through parent components or platform-specific absolute paths.

Timelines, clips, caption cues, and review coverage use half-open `[startUs, endUs)` ranges. Word timing stays within its cue; cues are ordered and nonoverlapping. Frame conversion uses exact integer intermediates, nearest-frame rounding, and rounds an exact half-frame forward. The shared conversion is intended for renderer boundaries rather than accumulated floating-point frame calculations.

Execution attempts distinguish status, lease ownership, and wait reasons. Operation receipts distinguish reserved, in-flight, succeeded, failed, uncertain, and cancelled outcomes; an uncertain external result is not equivalent to a failed request that is safe to repeat. Structured events carry request/job/attempt correlations and cursors; logging services must redact their data before accepting an event.

Quality profiles describe measurable thresholds and required modalities. Review results cannot label failed or inconclusive checks as passing. Delivery manifests require exactly one video, explicit review references, unique output paths, and checksums. The engine still verifies that the referenced checks actually passed for the correct revision before committing a ready package.
