# Contract evolution

The public source is `packages/contracts/src/`, exported through `@tutorialx/contracts`. `PUBLIC_SCHEMAS` generates the reviewed `schemas/v1/catalog.json`; `pnpm schema:check` rejects drift. TypeScript interfaces describe extension methods; runtime schemas validate inputs, persisted records, responses, and provider descriptors at trust boundaries.

## Review a contract change

1. Identify affected records, provider ports, public actions, durable artifacts, and consumers. Update the relevant OpenSpec requirement if observable behavior changes.
2. Preserve existing v1 semantics and schema output for a compatible extension. Adding a separately named schema or an optional API is additive. With strict objects, adding a field to an existing record is not automatically backward compatible: older readers reject it, even if the new reader marks it optional. Renaming/removing fields, changing units or rounding, requiring new fields, changing authorization meaning, and narrowing accepted values require explicit compatibility review.
3. For an incompatible record change, introduce a distinct versioned reader/schema and explicit migration. Reject unsupported future versions before mutation. Keep original revisions and accepted artifacts; create new revisions and invalidate affected dependents. Never reinterpret an old approval as authorization for changed content, providers, or policy. There are no workspace migrations implemented yet.
4. Version the engine/package API, provider implementation, contract protocol, and templates independently. A provider's `version` is the exact implementation identity used in selection and lineage; `contractVersion: 1` identifies the engine protocol it implements. A provider version string is not a permission to use any semver-compatible version. Changing advertised capabilities or output semantics requires reviewing its version and affected plan approval/cache fingerprints.
5. Add contract/conformance fixtures for accepted and rejected behavior. Document migration and compatibility implications. Run `pnpm schema:update` deliberately, inspect the generated diff, then run `pnpm check`. The catalog check detects drift; it is not an automatic proof of semantic compatibility.

The provider-selection addition introduced `ProviderCandidate`, `ProviderRequirements`, and `ProviderFallbackPolicy` as separate v1 schemas. All previously published schema entries remain structurally unchanged. Existing settings, scenes, and approval records require no migration for this addition. A fallback policy is configuration; trusted revision-bound authorization is supplied separately by the approval service.

## Provider extension exercise

Follow [the recorded-voice example](../examples/providers/README.md), implement the responsibility-specific port using only package-root exports, register an exact descriptor/factory pair, and run the common harness plus output/failure/cancellation tests. A new adapter belongs outside core. Adding a voice backend does not require editing production stage logic; stages receive the selected `VoiceProvider` through explicit composition.

Declare capabilities conservatively. Adding a new feature string does not change the meaning of an existing string. Unknown required features produce an incompatibility, not a guessed equivalent. If a feature's semantics must change, use a new feature identity and review contract/version effects. Missing word timing remains `null`; declaring timestamps would create a capability claim and corresponding conformance obligations.

Simulated fixture results prove only the behavior exercised. A hosted service, optional speech runtime, actual spoken-word quality, and alignment each need their own named integration evidence before being described as supported production paths.

The SQLite addition introduces `ResearchRepository` and `JobRevisionRepository` as separate public ports. Research records share the owning job transaction through `commitResearch`; existing `JobRepository` consumers/implementations retain their original methods. The local database migration version starts at one and does not change portable record schemas.
