# Public action protocol

The same action request/response contracts serve the planned CLI, MCP interface, external agents, and worker control. Transport handlers will use these shared schemas; the envelopes alone are not implemented production commands.

Requests identify API version, request ID, action name, JSON parameters, expected revision, and idempotency identity. Read actions and creation can omit revision semantics through `null`; registered mutation actions require validated preconditions before execution. Actor authority comes from the authenticated transport/operator context, never a caller-supplied `actor` field.

Responses are one of:

- `ok`: the requested synchronous action completed.
- `accepted`: an operation was accepted and has an identity for later inspection. This does not mean a video is finished.
- `waiting`: a concrete prerequisite, approval, access, budget, or capability is needed.
- `error`: a stable code, message, retryability, and bounded details explain failure.

Every response includes request correlation and bounded legal next actions. The CLI maps stable errors/waits through `ERROR_EXIT_CODES`. Machine operation never starts a login prompt or waits indefinitely for approval. Paginated requests have a maximum of 100 items and opaque URL-safe cursors; event cursors remain explicit monotonic integers.

## Schema discovery and compatibility

`PUBLIC_SCHEMAS`, `publicSchema(name)`, and `schemaCatalog()` expose JSON Schema Draft 2020-12 alongside authoritative Zod validators. Cross-field/evidence/policy invariants still require runtime/application validation; JSON Schema describes the interoperable shape and cannot express every semantic rule.

The reviewed initial catalog is checked in under `schemas/v1/catalog.json`. `pnpm schema:check` fails any unreviewed catalog change, conservatively including additive changes. Regenerate with `pnpm schema:update` only after reviewing compatibility and the need for a new contract version or migration. Existing versioned examples are replayed by the contract suite. Before the first release the initial catalog can evolve with explicit review; published breaking changes must preserve the previous version and add a migration/version boundary.

This exact-catalog gate detects schema drift; it does not claim to prove arbitrary semantic backward compatibility. Behavioral contract tests and review remain necessary. Generated schemas are derived from source and never hand-edited.
