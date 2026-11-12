# Foundation quickstart

The foundation supports installed commands, private workspaces, source
registration, research/plan handoffs, explicit approval, durable execution
requests, inspection, diagnostics, and managed agent skills. A queued request is
not a completed video. Media execution and the production integration gates are
tracked separately in the [implementation checklist](../openspec/changes/build-portable-video-production-system/tasks.md).

Use Node 22.12+ in the 22 line, Node 24, or Node 26. SQLite on Node 22.12 needs
`--experimental-sqlite`; Node 22.13+ exposes it without that flag. Contributor
commands use pnpm 11.25.0. No hosted account or Python runtime is needed for this
foundation example.

```sh
pnpm install --frozen-lockfile
pnpm build
node packages/cli/dist/bin.js capabilities --json
```

The release-candidate command is `tutorialx` after installing the locally packed
CLI and its matching local packages. Package publication is a separate release
action. From this checkout, use the built entrypoint above with `--workspace`
to select an existing app directory or a dedicated empty directory:

```sh
node packages/cli/dist/bin.js init --workspace /path/to/project --json
node packages/cli/dist/bin.js schema job.create --json
node packages/cli/dist/bin.js schema job.submit --json
```

`init` preserves existing files. To put videos outside the project, supply
`{"contentRoot":"/path/to/private-videos"}` through `--input` on first
initialization. The content root and `.tutorialx` state remain separate from the
installed engine. For all actions, use `--input file.json` or `--input -` for
bounded JSON stdin; `--json` writes one response envelope and never prompts.

Create a brief using `job create`, supplying title, topic, and audience, with a
stable SHA256 `--idempotency-key`. Register materials with `source create` using
the returned job ID and current `--expected-revision`. `job context JOBID --json`
returns source/evidence references, effective settings, legal next actions, and
the submission schema. Submit evidence-linked research, then a plan, through
`job submit`. Reopen with `job inspect JOBID --json`; every command reloads
authoritative persisted state. Missing input returns structured next actions.

Use `plan show` and `plan diff` for review. `plan approve` requires an explicit
operator decision covering the exact current revision. Creative/worker scopes
cannot approve their own work. `job run`, `job check`, and `job export` record
asynchronous requests for a compatible worker; inspect events for progress rather
than treating request acceptance as success. Pause/cancel semantics and receipt
reconciliation are explained in [local recovery](local-recovery.md).

`skill install` defaults to a preview and uses the bundled versioned skill.
Select `{"host":"codex"}` or `{"host":"claude-code"}` in its input, review
the returned changes, then apply with `apply:true` and that preview fingerprint.
Updates/removal preserve unrelated files and videos. See
[installation details](skill-installation.md) and [recipe diagnostics](doctor.md).

## Reproduce the packed installation gate

```sh
pnpm foundation:gate
pnpm foundation:gate --container
```

The gate packs all four packages, installs those tarballs in a fresh temporary
directory with package scripts disabled, and runs only the installed public
entrypoint. It uses pinned public dependencies from the registry, starts no media
provider, and removes its temporary state unless invoked with `--keep` directly.
It initializes both workspace styles twice, preserves an existing app file,
installs the bundled skill, registers an authored source, submits valid research
and a plan, and reloads the approval wait in fresh command processes.

Successful public-command transcript, 2026-11-12, clean Linux arm64 container /
Node 22.14.0 (`node:22.14.0-bookworm-slim`, 2 CPUs / 2 GiB RAM), with an additional
fresh installation smoke run on macOS arm64 / Node 22.14.0:

| Action | Dedicated workspace | Existing app / external content |
| --- | --- | --- |
| Install four local package tarballs | Passed | Same clean installation |
| `workspace.init` twice | Same workspace retained | App file preserved |
| `skill.install` preview/apply | Bundled Codex skill | Bundled Claude Code skill |
| `job.create` | Revision 1 | Revision 1 |
| `source.create` | Revision 2 | Revision 2 |
| `job.submit` research | Revision 3 | Revision 3 |
| `job.context` writer/director | Accepted references/settings | Accepted references/settings |
| `job.submit` plan | Revision 4 | Revision 4 |
| `job.inspect` in a new process | Revision 4, needs approval | Revision 4, needs approval |
| `plan.show` / `capabilities` | Valid plan and action discovery | Valid plan and action discovery |

The container mounts only read-only package tarballs and the gate script; no
repository, credentials, workspace, or host dependency tree is mounted. The
[machine-readable report](verification/m1-foundation.json) records the public
actions. This demonstrates the M1 foundation gate and does not claim real
narration, recording, rendering, or checked MP4 delivery.
