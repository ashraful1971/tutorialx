import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLocalWorkspaceLayout } from '@tutorialx/adapters';
import { profileSchema, settingsSchema } from '@tutorialx/contracts';
import { createWorkspaceJob, initializeWorkspace, resolveSettings } from '@tutorialx/core';

const load = async (path) => JSON.parse(await readFile(path, 'utf8'));

/** Repository example using public package exports; this does not execute production. */
export async function createSampleWorkspace(projectDirectory, contentRoot) {
  const project = resolve(projectDirectory);
  const layout = createLocalWorkspaceLayout(project);
  const identity = {
    newId: (prefix) => `${prefix}_${randomUUID()}`,
    now: () => new Date().toISOString(),
  };
  const initialized = await initializeWorkspace(
    layout,
    identity,
    contentRoot === undefined ? {} : { contentRoot },
  );
  const workspace = initialized.configuration;
  const content = resolve(project, workspace.contentRoot);
  const defaults = settingsSchema.parse(await load(new URL('./defaults.json', import.meta.url)));

  async function reusableProfile(sample, target) {
    const supplied = profileSchema.parse(await load(new URL(sample, import.meta.url)));
    const destination = resolve(content, target);
    try {
      await writeFile(destination, `${JSON.stringify(supplied, null, 2)}\n`, {
        flag: 'wx',
        mode: 0o600,
      });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    const profile = profileSchema.parse(await load(destination));
    if (profile.id !== supplied.id || profile.kind !== supplied.kind)
      throw new Error(
        'Existing sample profile has another identity; preserve it and choose another example workspace.',
      );
    return profile;
  }
  const brand = await reusableProfile('./brand.json', 'shared/brands/example_brand.json');
  const preset = await reusableProfile('./preset.json', 'shared/presets/example_vertical.json');
  const settings = resolveSettings({ defaults, workspace, brand, presets: [preset] }, (profile) =>
    createHash('sha256').update(JSON.stringify(profile)).digest('hex'),
  );
  const result = await createWorkspaceJob(layout, identity, {
    title: 'My first explainer',
    topic: 'Explain a useful workflow using supplied evidence.',
    audience: 'Beginners',
    profiles: settings.profiles.map((snapshot) => ({
      id: snapshot.profile.id,
      revision: snapshot.profile.revision,
      digest: snapshot.digest,
    })),
  });
  const directory = resolve(content, result.directory);
  await writeFile(
    resolve(directory, 'input/settings.example.json'),
    `${JSON.stringify(settings, null, 2)}\n`,
    { flag: 'wx', mode: 0o600 },
  );
  return {
    workspaceId: workspace.id,
    jobId: result.brief.id,
    directory,
    brief: resolve(directory, 'brief.md'),
    settings: resolve(directory, 'input/settings.example.json'),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length < 3 || process.argv.length > 4)
      throw new Error(
        'Usage: node examples/workspaces/create-sample.mjs <project-directory> [content-root]',
      );
    process.stdout.write(
      `${JSON.stringify(await createSampleWorkspace(process.argv[2], process.argv[3]), null, 2)}\n`,
    );
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'Example failed.'}\n`);
    process.exitCode = 2;
  }
}
