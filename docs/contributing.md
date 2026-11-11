# Contributing

## Start

1. Clone the repository and use Node 22.12+, 24, or 26 from the supported LTS lines.
2. Install pnpm 11.25.0 using your preferred supported package-manager installation method.
3. Run `pnpm install --frozen-lockfile`.
4. Run `pnpm check`.

The core installation has no model downloads or provider login. Generated `dist/`, dependency folders, and private video workspaces are ignored. Packages use ESM and explicit `.js` extensions for relative TypeScript imports so compiled output works in Node.

Repository text uses LF on every platform, enforced by `.gitattributes` at checkout. Do not change formatter rules to accommodate a local CRLF checkout; honor the repository attributes.

## Make a focused change

- Find the owner in the [architecture map](architecture.md).
- Keep domain decisions in core and external effects in adapters. Expose only intentional APIs from a package root.
- Update the relevant OpenSpec requirement when observable behavior changes. Never mark a task complete for a mock, partial implementation, or deferred verification.
- Use tests for meaningful behavior and failure handling. Include schemas, provider conformance, and real media checks when the affected capability calls for them.
- Run `pnpm format`, inspect the diff, then run `pnpm check`.
- Update the guide/example alongside the behavior it describes. Do not postpone feature documentation and tests until release.

Dependency analysis runs against built package exports, so `pnpm check` builds before analyzing. Architecture tests use temporary directories and no live accounts. Optional integration tests must clearly identify external prerequisites and never report fixture-only coverage as real-service verification.

## Dependencies and versions

Pin direct dependencies and commit `pnpm-lock.yaml`. Use `workspace:^` for local package links; packing rewrites those references to version ranges. Frozen-lockfile installation is the default for CI. Evaluate upgrades against the analyzer/compiler and runtime support matrix, not just individual package version numbers.

Do not add a vendor SDK to core or make a heavy optional production runtime a base install requirement. An additional publishable package is justified by a distinct dependency/runtime/release boundary, not by every new helper.

## Architectural decisions

Add a numbered file under `docs/decisions/` for a consequential boundary change. State the context, decision, alternatives, and practical consequences. Small implementation details do not need an ADR.

## Review and verification

The `Checks` workflow runs the foundation on Linux, macOS, and Windows against the declared Node LTS lines. This matrix is not a claim that every future media provider supports every platform. Keep provider-specific compatibility separate and report any required check you could not execute.

Do not publish packages, container images, or change repository visibility as part of routine implementation. Release candidates can be packed and inspected locally before publication is separately authorized.
