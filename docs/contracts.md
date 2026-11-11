# Portable contracts

`@tutorialx/contracts` is the single source for runtime schemas and TypeScript record types. Public records carry `schemaVersion: 1`, a stable path-safe identity, and a UTC creation timestamp. Schemas reject unknown fields and unsupported versions. They do not coerce strings into numbers or execute data found in references.

The planning contracts cover workspace configuration, versioned product/brand/preset profiles, complete effective settings and partial overlays, briefs, source/evidence manifests, research, scene plans, approvals, and batch topic manifests. Partial overlays are validated before merging and the complete effective settings are validated again afterward. Validation does not grant permission: the engine must still enforce source roots, policy ceilings, factual evidence, revision ownership, and approval origin.

Use integer microseconds for media time and integer millionths of a US dollar for usage/budget amounts. These have separate named schemas even though both serialize as safe integers. Frame rate is a numerator/denominator pair. A source path is interpreted only by the scoped source adapter; accepting its shape does not permit arbitrary filesystem access.

Narration can be disabled, supplied as an asset, or synthesized through a selected voice provider. Caption settings independently support embedded, sidecar, both, or neither. Sidecar formats are explicit. A provider must support the selected language/voice/controls before production can start.

Contracts prove data shape and local invariants. Application-level checks prove that referenced evidence/assets/variants exist and match the current revision. Approval records retain exact plan/settings/evidence/provider digests; merely parsing an approval record does not establish that its actor is trusted.

See `tests/fixtures/contracts.ts` for complete typed examples and `tests/contracts/planning.test.ts` for rejected malformed, incompatible, or stale-shaped inputs.
