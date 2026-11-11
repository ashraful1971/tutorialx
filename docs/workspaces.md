# Local workspaces

The public `initializeWorkspace` and `createWorkspaceJob` functions from `@tutorialx/core` accept a `WorkspaceLayout` port. `createLocalWorkspaceLayout(projectDirectory)` from `@tutorialx/adapters` implements that port with local files. Composition code supplies a clock and stable ID generator (for example, prefixed UUIDs). No global installation, cloud access, or media runtime is required.

Initialization creates `.tutorialx/workspace.json`, private cache/session directories, and a configurable content tree. The default content root is `tutorialx-videos`; a relative custom path is resolved from the project, and an absolute path supports a separate private disk/folder. Content must use a dedicated directory that does not overlap the project root or `.tutorialx` state. Managed directories inside the project reject symlinks.

```text
project/
  .tutorialx/workspace.json
  .tutorialx/cache/
  .tutorialx/sessions/
  tutorialx-videos/
    shared/brands/
    shared/products/
    shared/presets/
    shared/references/
    jobs/<job-id>-<title-slug>/
      brief.md
      job.json
      input/
      plan/revisions/
      work/
      output/
```

Existing application files and root ignore rules are preserved. Configuration is published without replacement, so repeated or concurrent initialization retains one identity. Reinitialization repairs missing managed directories and refuses an attempted content-root change or an incompatible/malformed existing config. Moving content requires a later explicit migration.

Each job receives a generated stable ID before its title is sanitized into a short display slug. Identical titles create independent folders; files from existing jobs are never overwritten. `job.json` currently contains the validated brief and `brief.md` provides a readable summary. These functions prepare the workspace files; durable workflow state, projections/import, and transport commands are separate tasks and are not available yet.

## Private content and ignore rules

New private-state and content directories receive a `.gitignore` containing `*`. Existing ignore files are retained. If a private directory already has its own rules, ensure those rules exclude its contents. For Git and other source-control systems, also add these explicit project rules where appropriate:

```gitignore
/.tutorialx/
/tutorialx-videos/
```

Replace the second pattern with the configured internal content path. External content needs its own ignore policy if it belongs to another repository. Never force-add secrets, sessions, live SQLite/WAL files, recordings, or personal deliveries. Public examples and generated test fixtures belong in their explicitly reviewed source locations.

Executable coverage in `tests/workspace/initialization.test.ts` creates temporary existing-app and external-content workspaces, exercises repeat/concurrent setup and duplicate titles, and verifies original application files and rejected symlink targets remain untouched.
