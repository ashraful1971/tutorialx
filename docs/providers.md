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

## Explicit assembly and negotiation

`wireProviders` from `@tutorialx/core` accepts an explicit array of `{ descriptor, create(selection) }` registrations. Factories belong in CLI/worker composition code and receive the exact selected configuration and credential reference. Resolve secrets narrowly there, never in core or portable configuration. Registration validates the descriptor, rejects duplicate kind/id/version tuples, and requires an instantiated provider to match its registered descriptor. Nothing discovers, installs, or imports a provider based on job content. `descriptors()` returns a detached discovery snapshot; registration does not invoke factories.

`requirementsForPlan(plan)` derives requirements for the renderer and any capture, synthesis, or configured alignment stages. `selectProvider(wiring, request)` checks exact provider version, platform, processing location, declared capabilities, configuration, readiness, voice discovery/controls, and a fresh conservative estimate. These calls inspect metadata and never synthesize, record, or render. Negotiate every required stage before starting production. The future stage coordinator must also enforce approval, durable budget reservations, leases, artifact acceptance, and output checks; successful negotiation alone grants no production authority.

Feature names are exact and case sensitive; language tags are compared case insensitively with no implicit regional fallback. Empty advertised lists promise no support. Shared requirement vocabulary:

| Descriptor field | Requirement examples |
| --- | --- |
| `capabilities.languages` | `en-US`, `bn-BD` |
| `capabilities.formats` for renderers | `codec:h264`, `container:mp4` |
| `capabilities.features` for visuals | `visual:text`, `visual:browser`, `visual:custom`, `template:my-template` plus scene-declared features |
| Renderer output features | `transition:fade`, `aspect-ratio:9:16`, `resolution:1080x1920`, `frame-rate:30000/1001`, `thumbnail`, `captions:embedded` |
| Renderer audio features | `audio:music`, `audio:effects`, `audio:ducking` |
| Voice features | `voice:pace`, `voice:tone`, `voice:pronunciations`, `timing:word` |
| Voice catalog controls | `pace`, `tone`, `pronunciations` on the particular discovered voice |

Frame-rate feature names use reduced rational values. Providers must advertise each tested output combination accurately and perform combination-specific checks in their own preflight; broad descriptor support is not proof that arbitrary combinations work. Custom scenes require their declared provider and installed template. A different renderer requires a revised/adapted plan rather than an automatic translation. Captions without a configured aligner require word timing from synthesis; supplied audio still requires verified timing at the later alignment stage.

## Selection and fallback policy

The resolved workspace/preset/job settings supply the primary selection. Negotiation receives an ordered, versioned `ProviderFallbackPolicy` containing only explicitly permitted alternatives and a cost ceiling. An empty candidate array disables fallback. Alternatives are tried only when the primary fails negotiation. No undeclared installed provider is considered, and an uncertain production outcome is never a trigger to retry through this API.

A materially different candidate returns `needs-approval` before its factory, readiness, or estimate is called. Provider/configuration/credential-reference changes, provider-scoped voice changes, processing-location changes, and visual identity changes require a trusted `ProviderAuthorization` for the exact plan digest, candidate, and processing location. It must come from the application's operator/approval service. A parsed policy, creative submission, or autonomous mode flag cannot mint that authorization. Stale or partially matching authorization is rejected. Replacing providers conservatively counts as a material change even when two voices have the same display ID.

An explicitly authorized candidate must still pass all capability, local-only, configuration, readiness, and cost checks. The effective cost ceiling is the lower of the configured ceiling and remaining authorized budget. Unknown bounds, expired estimates, contradictory free pricing, and over-limit estimates block selection. Durable reservations and provider-specific handling of unknown charges will be implemented with execution accounting; negotiation never treats unknown costs as free. Rejections contain stable codes and remedies without serializing factory/configuration exceptions, raw provider diagnostics, or credentials.
