# Architecture and ownership

The [design](../openspec/changes/build-portable-video-production-system/design.md) defines the full target. This document describes the contribution boundaries established by the foundation. Directories for future features are created when their implementation lands, not as empty scaffolding.

## Dependency direction

```text
contracts <-- core
     ^
     +------- adapters

CLI / worker / MCP composition roots wire the packages together.
```

Use package-root exports (`@tutorialx/contracts`, for example). Relative imports are for files inside the same package. Cross-package imports into either `src/` or `dist/` bypass the public API and are rejected. Type-only dependencies count too.

| Location | Owns | Does not own |
| --- | --- | --- |
| `packages/contracts/src/` | Versioned portable records, validation schemas, provider ports, action shapes | File I/O, vendor SDKs, workflow execution |
| `packages/core/src/` | Settings resolution, planning policy, transitions, dependency invalidation, timeline calculations, application services | Provider SDKs, environment variables, concrete databases/processes |
| `packages/adapters/src/` | Filesystem/database/network/media implementations of the ports | Deciding workflow order, skipping approvals, transport presentation |
| `packages/cli/src/` | Argument decoding, output presentation, command/worker/MCP entrypoints, explicit provider wiring | Reimplementing domain rules or vendor behavior |
| `tests/architecture/` | Executable negative cases for dependency rules | Product-specific workflow logic |
| `docs/` | Current developer/operator guidance and architectural decisions | Claims that unimplemented capabilities are available |
| `openspec/` | Versioned behavior requirements, designs, and verified task progress | Runtime state or credentials |

## Feature modules

As the engine grows, core groups related behavior under `workspace`, `jobs`, `planning`, `production`, `quality`, and `batches`. Adapter directories are grouped by responsibility, such as `voice/google`, `render/hyperframes`, `persistence/sqlite`, and `storage/local`.

Keep a feature's small helpers and tests near its owner. Extract a shared module only when its responsibility and consumers are clear. Avoid global provider managers, deep inheritance, an unowned `utils` directory, and a service per pipeline stage.

## Change a boundary deliberately

The dependency analyzer checks imports, re-exports, cycles, and public-package resolution. Its tests create throwaway projects containing intentionally forbidden imports; this catches an analyzer that silently stops understanding our compiler version.

Domain code receives ports explicitly. Composition roots select adapters. Provider responses and public inputs are validated at boundaries; pure calculations do not repeatedly parse the same record. Actual provider SDKs and optional media runtimes are introduced only with their adapters.

See [ADR 0001](decisions/0001-engine-boundaries.md) for the rationale. Record a new decision when a public contract, execution authority, persistence ownership, or package dependency changes.
