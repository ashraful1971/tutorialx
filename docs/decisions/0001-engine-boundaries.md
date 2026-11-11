# ADR 0001: A small engine with explicit adapters

Status: accepted for the initial implementation.

## Context

TutorialX must support multiple agent hosts, renderers, speech providers, and local or remote execution. Prompt-only production scripts make recovery and replacement difficult; making a cloud framework mandatory would complicate the local installation.

## Decision

Use a TypeScript workspace with contracts, core, adapters, and CLI/composition packages. Contracts define portable data and ports. Core implements application decisions against those ports. Adapters implement external effects. Composition roots select and connect adapters explicitly. An installed skill calls the same public actions as a headless runner.

Prefer pure transformations and discriminated unions for domain behavior. Use a state machine and artifact dependencies for production, while preserving a single authority for job state. Keep agent reasoning sessions outside that authority.

## Alternatives

- A skill containing all production logic: small initial footprint, but no dependable durable execution.
- A vendor framework throughout the domain: faster vendor-specific wiring, but harder provider/runtime replacement.
- One service per pipeline stage: additional deployment and synchronization overhead before demand justifies it.

## Consequences

Contracts and failure semantics must be established before providers. Public-package imports and dependency rules are checked automatically. Optional providers can carry different runtimes without forcing them into the base installation. A future framework can implement a runner port without owning or replacing production state.
