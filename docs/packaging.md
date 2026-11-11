# Package contents and lockfiles

Only built JavaScript, declarations/maps, package metadata, and package README/license files are currently distributable. Each package has a positive `files` allowlist. Source code, development tooling, local environment files, authenticated browser state, databases, and personal video assets are outside that list.

Run:

```sh
pnpm build
pnpm package:audit
```

The audit invokes the package manager's real JSON dry-run for every distributable package, validates the file list, and verifies that public build entrypoints exist. It does not publish or create tarballs. It excludes incremental compiler metadata as well as private workspace files. A change introducing a new distributable data format must update both the package allowlist and its audit rules deliberately.

Keep direct dependency versions exact and commit `pnpm-lock.yaml`. Contributors and CI use frozen-lockfile installation. Never replace the lockfile to work around a failing compatibility check without reviewing the dependency change.

Public examples belong under `examples/` and reusable licensed fixtures under `tests/fixtures/` as those capabilities land. Neither location is an alternative storage location for personal videos. Samples added to a distribution need an explicit allowlist and provenance review.
