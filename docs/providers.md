# Provider interfaces and conformance

Providers implement one responsibility, not a universal generation method. Import their interfaces and schemas from `@tutorialx/contracts`.

| Responsibility | Port |
| --- | --- |
| Agent task execution | `AgentRunner` |
| Scoped source extraction | `ResearchReader` |
| Verified browser recording | `CaptureProvider` |
| Speech and voice discovery | `VoiceProvider` |
| Measured text/audio alignment | `AlignmentProvider` |
| Supplied/generated visual assets | `AssetProvider` |
| Composition and video rendering | `RendererProvider` |
| Artifact bytes and object references | `StorageProvider` |
| Transactional job metadata | `JobRepository` |
| Atomic shared budgets and resource leases | `ResourceCoordinator` |
| Dispatch transport | `QueueProvider` |
| Isolated executable composition | `IsolationProvider` |

Each provider declares identity, version, contract compatibility, JSON configuration schema, capabilities, platform/runtime needs, execution/side-effect semantics, and pricing. Common methods validate configuration, report readiness, and estimate cost. Missing cost information is `null` with uncertainty, never an invented zero. A free provider must return an actual zero bound.

An operation context supplies stable job/attempt/operation identities, a private output directory, deadline, budget-reservation reference, and abort signal. It does not contain credential values. Concrete adapters receive narrowly scoped credential access through their composition root. Cancellation support and unknown external outcomes must be reported honestly.

Media/agent response types are inferred from their runtime schemas. Validate responses before acceptance and inspect the produced files before committing a stage. A valid manifest is not proof that its bytes exist or that a demonstration succeeded.

`inspectProviderConformance(provider, fixture)` checks descriptor compatibility, valid/invalid configuration handling, readiness shape, and estimates using a provider-specific fixture. Use the common harness plus responsibility-specific output, timeout, cancellation, and live integration checks. The tests under `tests/conformance/` use explicit fake providers; they do not claim working speech or render integrations.

Persistence exposes atomic commits with expected job revisions and optional attempt fencing. Heavy external work happens outside those commits. Shared resource/budget coordination is durable and atomic across jobs; a process-local mutex is insufficient for remote workers. Queue messages contain dispatch references, not media bytes or credentials. Storage uses async byte streams to avoid loading complete videos into memory.
