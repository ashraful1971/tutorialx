# Recipe diagnostics

Doctor reports the dependencies of the selected recipe and provider versions. It does not install providers, download models, open a login flow, synthesize audio or render video. A successful report is preflight evidence; the production and review gates still determine delivery readiness.

The CLI composition root passes effective `VideoSettings` and an explicit registry to `diagnoseRecipe`. An empty registry reports the configured renderer as unavailable. A provider name in settings alone is never treated as an installed integration. A provider must have an exact matching ID, kind and version and pass configuration, platform, local-only policy, capability and readiness checks.

| Selected behavior | Required provider |
| --- | --- |
| Any video recipe | Renderer |
| Tutorial or mixed recipe, unless `captureRequired` explicitly says all recordings are supplied | Capture |
| Synthesized narration | Voice |
| Captions without supplied timing | Configured alignment provider, or synthesized voice with word timing |
| Headless creative work | Agent runner |
| Requested generated assets | Asset provider |

An asset-video with supplied narration and no requested caption alignment does not require capture, Python, a voice model or hosted credentials. Unused configured providers are marked `skipped`; their readiness methods and dependencies are not probed. Missing optional dependencies are advisory. Missing required dependencies or incompatible versions block the selected provider with a remedy naming the dependency and declared version range.

The built-in discovery probe checks executable files for Node, Python, FFmpeg and FFprobe on `PATH`. It does not execute those files and cannot establish their versions. Output states this explicitly; the selected provider's readiness check must verify pinned version compatibility and any private service or model prerequisites. Providers with other dependencies should supply an explicit `probeDependency` in the composition root. Its result distinguishes unavailable dependencies, known incompatible versions and discovery with unknown compatibility. Doctor never guesses that an unfamiliar dependency is installed.

Readiness and dependency discovery each have a five-second default deadline, configurable from 1 ms to 30 seconds. Timeouts and private exceptions become bounded structured checks. Public output includes diagnostic codes and remedies, omitting raw provider messages, environment values and exception details. Provider readiness implementations remain responsible for being read-only and returning after their own timeout; the reporting deadline does not cancel an arbitrary provider's underlying promise.

The report contains `schemaVersion`, `recipe`, `ready`, bounded `checks`, and deduplicated `nextActions`. Every check states whether it is required. `ready` is true only when every required check passed. Doctor neither switches providers nor relaxes local-only policy to make a report pass. Reconfigure missing dependencies or supply the relevant assets, then run doctor again with the revised effective settings.

Host-specific skill installation is documented separately in [skill-installation.md](skill-installation.md). Installing instructions does not change doctor results for unimplemented media providers.
