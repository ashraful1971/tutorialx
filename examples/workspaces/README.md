# Workspace and profile examples

These authored configuration examples contain no recordings, credentials, or third-party media. They create a discoverable private sample job using the public `@tutorialx/core` and `@tutorialx/adapters` APIs. They do not generate a video or claim a configured renderer. The sample renderer version is deliberately `unconfigured`; production must select an installed exact version and pass negotiation/approval.

After `pnpm install --frozen-lockfile` and `pnpm build`, use a dedicated workspace:

```sh
node examples/workspaces/create-sample.mjs /path/to/my-video-workspace
```

Or keep content outside an existing app repository:

```sh
node examples/workspaces/create-sample.mjs /path/to/existing-app /path/to/private-videos
```

Paths are chosen by the operator. The command prints the new job ID, directory, brief, and settings-snapshot paths. Existing app files remain untouched. Repeated runs retain the workspace/profile files and create separate jobs with the same title. Modified compatible example profiles are reused, so each job records the revision/digest that it actually resolved.

`brand.json` sets reusable branding. `preset.json` selects an explainer recipe and a vertical H.264/MP4 output, with no music or effects. `defaults.json` supplies the complete initial settings; narration and captions are disabled in this workspace-only exercise. Profiles are copied once into `shared/brands/` and `shared/presets/`. Each job records its profile references and a detached `input/settings.example.json` snapshot.

The example creates `input`, `plan/revisions`, `work`, and `output` directories without changing application source or requiring another per-video package project. Review the [folder layout and privacy rules](../../docs/workspaces.md) before storing private content. `tests/workspace/examples.test.ts` executes the script against dedicated and existing-app fixtures; it checks discoverable jobs, original-file preservation, external content, repeated runs, and saved profile reuse.
