import { lstat, mkdir, readdir, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import {
  type JobBrief,
  jobBriefSchema,
  relativeArtifactPathSchema,
  type WorkspaceConfig,
  type WorkspaceLayout,
  workspaceConfigSchema,
} from '@tutorialx/contracts';
import {
  canonicalRoot,
  hasCode,
  isWithin,
  managedDirectory,
  readRegularFile,
  writeNewFile,
} from './files.js';

export function createLocalWorkspaceLayout(projectDirectory: string): WorkspaceLayout {
  const project = resolve(projectDirectory);
  const configurationPath = resolve(project, '.tutorialx', 'workspace.json');

  async function readConfiguration(): Promise<WorkspaceConfig | null> {
    try {
      const state = await lstat(resolve(project, '.tutorialx'));
      if (!state.isDirectory() || state.isSymbolicLink())
        throw new Error('Workspace state directory is redirected.');
      return workspaceConfigSchema.parse(JSON.parse(await readRegularFile(configurationPath)));
    } catch (error) {
      if (hasCode(error, 'ENOENT')) return null;
      throw error;
    }
  }

  async function roots(configuration: WorkspaceConfig) {
    const root = await canonicalRoot(project);
    const requested = resolve(root, configuration.contentRoot);
    const state = resolve(root, '.tutorialx');
    if (isWithin(requested, root) || isWithin(state, requested) || isWithin(requested, state))
      throw new Error(
        'Content must use a dedicated directory separate from the project and private state.',
      );
    // Reject symlinks under the project before any managed content writes.
    const content = isWithin(root, requested)
      ? await managedDirectory(root, requested)
      : await canonicalRoot(requested);
    const actual = await realpath(content);
    if (isWithin(actual, root) || isWithin(state, actual) || isWithin(actual, state))
      throw new Error('Content root overlaps the project or private state.');
    return { root, content: actual };
  }

  return {
    readConfiguration,
    async initialize(input) {
      const proposed = workspaceConfigSchema.parse(input);
      const existing = await readConfiguration();
      if (existing && existing.contentRoot !== proposed.contentRoot)
        throw new Error('Workspace content root cannot change during initialization.');
      const configuration = existing ?? proposed;
      const { root } = await roots(configuration);
      const state = await managedDirectory(root, resolve(root, '.tutorialx'));
      const created = await writeNewFile(
        resolve(state, 'workspace.json'),
        `${JSON.stringify(configuration, null, 2)}\n`,
      );
      const accepted = (await readConfiguration())!;
      const { content } = await roots(accepted);
      for (const path of ['cache', 'sessions']) await managedDirectory(state, resolve(state, path));
      for (const path of [
        'shared/brands',
        'shared/products',
        'shared/presets',
        'shared/references',
        'jobs',
      ])
        await managedDirectory(content, resolve(content, path));
      // Preserve existing ignore files; report the required patterns in the documentation.
      await writeNewFile(resolve(state, '.gitignore'), '*\n');
      await writeNewFile(resolve(content, '.gitignore'), '*\n');
      return { configuration: accepted, created };
    },
    async createJobDirectory(input, directoryName) {
      const brief: JobBrief = jobBriefSchema.parse(input);
      const configuration = await readConfiguration();
      if (!configuration || brief.workspaceId !== configuration.id)
        throw new Error('Job does not belong to this workspace.');
      relativeArtifactPathSchema.parse(directoryName);
      if (directoryName.includes('/') || !directoryName.startsWith(`${brief.id}-`))
        throw new Error('Invalid job directory identity.');
      const { content } = await roots(configuration);
      const jobs = await managedDirectory(content, resolve(content, 'jobs'));
      if ((await readdir(jobs)).some((entry) => entry.startsWith(`${brief.id}-`)))
        throw new Error('Job identity already has a directory.');
      const directory = resolve(jobs, directoryName);
      // An exclusive directory claim preserves existing jobs with duplicate titles.
      await mkdir(directory, { mode: 0o700 });
      for (const path of ['input', 'plan/revisions', 'work', 'output'])
        await managedDirectory(directory, resolve(directory, path));
      await writeNewFile(resolve(directory, 'job.json'), `${JSON.stringify(brief, null, 2)}\n`);
      await writeNewFile(
        resolve(directory, 'brief.md'),
        `# ${brief.title.replace(/[\r\n]/g, ' ')}\n\n${brief.topic}\n\nAudience: ${brief.audience}\n\n${brief.instructions}\n`,
      );
      const path = relative(content, directory);
      if (isAbsolute(path)) throw new Error('Job directory must remain relative to content root.');
      return path.replaceAll('\\', '/');
    },
  };
}
