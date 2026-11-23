# Template and recipe extension

TutorialX selects trusted, renderer-neutral templates from declarative recipe data. The engine does
not generate renderer source for each job and operators do not patch staged HTML or JavaScript.
`templateForRecipe` currently maps recipes as follows:

| Recipe | Maintained template |
| --- | --- |
| `tutorial` | `tutorial_branded` |
| `explainer` | `explainer_branded` |
| `asset-video` | `explainer_branded` |
| `reel` | `reel_branded` |
| `mixed` | `tutorial_branded` |

All three template families support the common title, text, image, video, capture, focus, diagram,
callout, transition, audio, and caption primitives. `compileTrustedTemplate` validates the exact
template identity/version/digest, primitive allowlist, staged asset identities, font allowlist, and
node limit before a renderer receives the composition graph. `resolveBrandedLayout` separately
validates landscape, vertical, and square safe regions.

## Select and configure HyperFrames

The built-in renderer selection is `hyperframes` provider version `1.0.0`, backed by HyperFrames
CLI `0.9.70`. Install or expose that exact CLI and FFprobe 6 or newer, then run the recipe-specific
`doctor` action. A valid provider configuration is:

```json
{
  "id": "hyperframes",
  "version": "1.0.0",
  "config": {
    "fps": 30,
    "quality": "standard",
    "maxOutputBytes": 2147483648
  },
  "credentialRef": null
}
```

At the composition root, register each trusted template ID with its maintained source directory,
required files and fonts, and optional logical asset-path mapping. Do not put credentials in this
registration. The adapter copies the selected directory and verified assets into an attempt-scoped
location, runs `hyperframes check --json`, renders a partial output, verifies it with FFprobe, and
only then accepts the immutable result. See [HyperFrames rendering](hyperframes-rendering.md) for
the pinned CLI smoke commands.

## Extend a maintained common template

1. Add or revise the declarative template definition under `packages/core/templates/`.
2. Register its exact ID, semantic version, SHA-256 digest, supported common primitives, fonts, and
   node ceiling in `packages/core/src/production/templates.ts`.
3. Add the recipe mapping to `templateForRecipe`; do not introduce selection logic in a renderer.
4. Exercise every supported output shape and required safe region in `tests/core/templates.test.ts`.
5. Exercise shared graph validation and the renderer adapter's preflight/render conformance tests.
6. Update public documentation and compatibility notes when identity, digest, or support changes.
   Existing approved jobs retain their recorded template identity.

A new recipe should reuse a common template when its visual intent fits. If it needs a new common
primitive, extend the renderer-neutral contract and all claiming adapters before advertising the
capability. Never work around an unsupported primitive by editing generated renderer source.

## Declare renderer-specific scenes

A custom scene is intentionally nonportable. Its plan entry declares `providerId`, `templateId`,
data, and `requiredCapabilities`. Provider negotiation requires `visual:custom`, the exact
`template:<id>` feature, every declared capability, and the selected provider identity before any
paid or destructive production call. Missing support is a capability failure; TutorialX does not
translate arbitrary HyperFrames HTML into another renderer or silently fall back to a common
template.

Custom executable HTML, JavaScript, plugins, or imported compositions also require the configured
isolation provider. A trusted declarative template registration is not permission to execute
untrusted code, access ambient credentials, read outside staged assets, or use the network.
