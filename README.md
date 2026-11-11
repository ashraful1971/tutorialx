# TutorialX

An open-source video-production engine designed to work through an installable agent skill, a CLI, or unattended workers. The planned workflow turns materials and topics into researched scripts, verified demonstrations, narration, captions, and checked upload packages.

## Current status

Active implementation. Public package APIs support workspace initialization, profile/settings resolution, source registration, provider negotiation, revision-aware projections, [SQLite metadata/coordination](docs/persistence.md), and [artifact staging/acceptance](docs/artifacts.md). Run the [workspace example](examples/workspaces/README.md) to create a sample job in a dedicated folder or an existing app. Video-production commands and the installable TutorialX skill are not ready yet. Follow the [implementation checklist](openspec/changes/build-portable-video-production-system/tasks.md) for verified progress; unchecked tasks are not shipped features.

## Develop locally

Use a supported Node.js LTS line: 22 (22.12 or newer), 24, or 26. The optional future headless runner can have a higher minimum version than the core engine. Development uses pnpm 11.25.0, recorded in `packageManager`; users of the eventual distribution will not need pnpm.

```sh
pnpm install --frozen-lockfile
pnpm check
```

No cloud account, Python environment, browser download, or model weights are needed for these foundation checks.

Useful commands:

| Command | Purpose |
| --- | --- |
| `pnpm build` | Build all four packages in dependency order |
| `pnpm typecheck` | Check package and test types |
| `pnpm lint` | Check formatting and recommended lint rules |
| `pnpm format` | Apply formatting and safe lint fixes |
| `pnpm boundaries` | Reject dependency cycles and forbidden package imports |
| `pnpm test` | Run tests, including negative architecture fixtures |
| `pnpm check` | Run the required local quality checks |
| `pnpm package:audit` | Inspect package dry-runs for unintended files |

See the [architecture](docs/architecture.md), [contributor guide](docs/contributing.md), [workspace APIs and layout](docs/workspaces.md), and [design](openspec/changes/build-portable-video-production-system/design.md).

## Content and credentials

The source repository is separate from private video workspaces. Default runtime content belongs in ignored `.tutorialx/` and `tutorialx-videos/` directories when those capabilities are implemented. Never commit real credentials, authenticated browser sessions, or private recordings. Intentionally distributable test/example assets must have documented provenance.
