# Asset providers

TutorialX treats supplied media and generated media as separate capabilities. The built-in
`supplied-assets` provider resolves already accepted image and video manifests, retains their
original artifact provenance, and carries configured attribution text into the asset result. It is
local, free, and has no browser, network, credentials, subprocess, or generative-media dependency.

An image or video scene negotiates the `assets:supplied` capability and its media modality during
plan preflight. This does not request an `assets:generated:*` capability. Consequently an
asset-only plan using supplied media can run without a capture provider or generative service.

Generated media is optional. A provider exposes `generate` and a matching capability such as
`assets:generated:image`. Every generated request names the scene, prompt, references, output
requirements, reservation identity, and maximum authorized cost. `generateAuthorizedAsset`
checks that capability, requires the operation context to carry the same reservation, rejects an
unknown or excessive upper estimate before dispatch, bounds actual cost, and verifies that output
provenance includes the canonical request digest and selected provider identity. Missing
capability returns `GENERATED_ASSET_CAPABILITY_UNAVAILABLE`; generation never silently replaces
a supplied-asset path.
