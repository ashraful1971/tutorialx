# Managed skill installation

The engine and the skill are separate installations. Installing skill instructions does not install a video renderer, download a model, or configure a provider account. Supply a versioned skill directory containing `SKILL.md` and its references. The installer never synthesizes skill content or fetches remote files.

Supported layouts, checked against the official [OpenAI installation documentation](https://developers.openai.com/api/reference/cli) and [Claude Code skill documentation](https://code.claude.com/docs/en/skills) on November 12, 2026:

| Host | Project scope | User scope |
| --- | --- | --- |
| Codex | `<project>/.agents/skills/tutorialx/` | `<home>/.agents/skills/tutorialx/` |
| Claude Code | `<project>/.claude/skills/tutorialx/` | `<home>/.claude/skills/tutorialx/` |

The same filesystem adapter supports either scope: pass the explicit project directory or user home as `rootDirectory`. There is no implicit global installation and no automatic migration from legacy host directories. For another host, find its documented skill directory and select `generic` with that existing directory as the root; the installer creates only its `tutorialx/` child. Restart the host session or follow its documented reload procedure to discover newly installed instructions.

The CLI includes a versioned TutorialX skill bundle. For a project-scoped preview, save `{ "host": "codex" }` in `skill-preview.json` and run `tutorialx skill install --input skill-preview.json --json`. It returns `data.preview` with before/after text and a fingerprint without writing files. Apply that exact reviewed preview by passing `{ "host": "codex", "apply": true, "fingerprint": "<returned SHA256>" }` through the same command. Choose `claude-code` for its documented layout. `rootDirectory` selects an existing project or home explicitly; relative paths are resolved from the selected workspace. `--workspace` controls the default project root.

`tutorialx skill update` and `tutorialx skill remove` use the same preview/apply pattern. A supplied `packageRoot` requires an explicit `version`; otherwise install/update use the bundled version. `generic` requires `rootDirectory`. These global actions need operator authority and a reviewed apply fingerprint; job revisions and job idempotency keys do not apply. No workspace initialization is required. A stale fingerprint returns a revision conflict, retaining existing files.

The public adapter API is useful for a host integration or the CLI composition root:

```ts
import { createLocalSkillInstaller } from '@tutorialx/adapters';

const installer = createLocalSkillInstaller({
  rootDirectory: '/absolute/path/to/project',
  host: 'codex', // 'claude-code' or 'generic'
});
const preview = await installer.preview({
  operation: 'install', // later: 'update'; removal: { operation: 'remove' }
  packageRoot: '/absolute/path/to/skills/tutorialx',
  version: '0.1.0',
});
// Display preview.destination and each change.path / change.before / change.after.
await installer.apply(preview);
```

Preview performs no writes. It returns the complete before/after text of managed changes, a target path, a package version, and a SHA256 fingerprint. Apply recomputes the plan from the package and the destination and rejects stale previews. Supplied preview change arrays are never used as write instructions. A lock in the explicit root serializes cooperating installers.

The `.tutorialx-managed.json` file records each managed path and checksum. Initial installation refuses collisions with unmanaged files. Updates and removal refuse missing or locally edited managed files; copy or reconcile those changes yourself before trying again. Unknown schema versions, unsafe paths, redirected host directories, and symlink package entries fail before mutation. Packages and existing skill trees are limited to 256 entries, 256 KiB per text file and 2 MiB of text in total. Keep recordings and large assets in the workspace content root.

Updates replace or remove only previously managed files and add explicitly supplied files. Removal deletes managed files and the manager manifest. It leaves directories, user notes and other unmanaged files in place. The installer never edits `AGENTS.md`, `CLAUDE.md`, other skills, workspace metadata, source inputs, or videos. It writes private recovery records under `<root>/.tutorialx/skill-backups/<id>/changes.json`; keep `.tutorialx/` out of version control.

Before the first file change, the installer writes and syncs a recovery record containing the exact destination, operation and before/after text. Individual file replacement uses a fully written temporary file and rename; the manager manifest is written last. If the process stops between files, inspect the matching recovery record and restore each listed `before` value at its relative path (a null value means the file was previously absent), then request a fresh preview. Preserve any newer user edits separately. A stale lock must be removed only after checking that its recorded process is no longer running. Interrupted installation is reported as an error, never a successful installation.

For a generic manual installation, copy the complete skill directory into an unoccupied location supported by your host, retaining `SKILL.md` and relative reference paths. Do not append its instructions to unrelated host configuration files. Manual copies have no TutorialX ownership manifest: the managed installer will refuse to overwrite their files. Keep a backup and use your host's documented manual update/removal procedure, or move the manual copy aside before a managed installation.
