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

## Resolve profiles and settings

`resolveSettings(input, fingerprint)` from `@tutorialx/core` resolves a new detached snapshot. Supply the complete built-in defaults, versioned workspace config, optional product/brand profiles, ordered preset profiles, and job overrides. The fingerprint callback hashes the validated profile record; its result must be a SHA-256-shaped digest. The return value contains effective settings, per-field origins, the workspace ID/revision, and full profile revision snapshots/digests.

Precedence, lowest to highest: built-in defaults, workspace defaults, product, brand, presets in their supplied order, job overrides. Nested styling and brand fields merge. Arrays, discriminated voice/music choices, and individual provider selections replace their previous value. Unknown keys and contradictory final settings fail validation. Origins use paths such as `captions.style.fontSize` and values such as `preset:vertical@2` or `job`.

Workspace policy ceilings first constrain built-in policy defaults. Every explicit layer is then checked against the ceiling: budgets, attempts/repairs, deadlines, local-only processing, review mode, permitted origins/mutation targets, and required review modalities. Explicit attempts to weaken operator policy are rejected, including a bad profile hidden by a later stricter job override. Origin/target matching uses normalized complete URLs and does not infer authority for a subdomain or a different path. Review requirements can be added but cannot be removed below the ceiling.

The resolver never refreshes an existing job or mutates its inputs. Store the returned settings/profile snapshots with the plan revision. A later profile edit can be adopted only through a new explicit resolution/revision and the subsequent approval checks. The resolver supplies no execution authorization and does not replace revision-bound plan approval. `tests/workspace/settings.test.ts` exercises precedence, origins, snapshots, invalid overlays, and rejected policy changes.

## Register inputs

`registerWorkspaceSource` from core validates an input/attribution request, assigns source identity/time, and calls a `SourceRegistrar`. `createLocalSourceRegistrar` from adapters receives the trusted workspace, project/job directories, job ID, and settings digest. It registers inline text, URL references, files, media files, directories, and codebases without moving or modifying originals.

File/directory references must remain inside configured `sourceRoots`, including after realpath resolution. Excluded names, private state/content, sibling-prefix escapes, and symlink escapes are denied. Directory trees skip excluded entries; a directly requested excluded source is refused. Exclusions support `*`, `?`, and `**`; names without a slash match path components, while slash patterns are relative to the project or selected source root. Default examples exclude `.env`/`.env.*`, `.git`, dependencies, and generated TutorialX directories. Add all project-specific credential/session/private directories to workspace exclusions before registering a broad tree.

References are fingerprinted from bounded reads. Files use a SHA-256 byte digest; directory fingerprints cover a deterministic ordered inventory of relative paths, kinds, sizes, and file digests, including empty directories. Changed inputs get a different fingerprint. An input that changes during a file read is rejected for retry. Missing or inaccessible references have explicit status; URL registration remains pending with no invented content hash until a reader fetches it. No network request occurs during registration.

Copied sources are written to `input/sources/<source-id>/files/`, with a checksummed `snapshot.json` inventory and a `source.json` record. The source manifest retains the original reference and attribution; `snapshotArtifactId` identifies the copied inventory. Returned snapshot artifacts still need normal stage acceptance. References store only their record. Source IDs are claimed exclusively, so duplicate registration identities cannot replace existing files. Failed copies are removed from their newly claimed source directory. Snapshots are immutable by convention; original changes never rewrite them.

Defaults are 16 MiB per file, 64 MiB per source, 10,000 entries, and 32 levels of nesting. Composition code may choose explicit smaller/larger bounds. Registration is local input preparation, not document extraction, factual verification, speech synthesis, or execution authority. Source content remains data, including any apparent instructions inside it. Portable export/import will materialize/remap original path references in its later implementation.
