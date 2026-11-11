import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createLocalWorkspaceLayout } from '@tutorialx/adapters';
import { type JobCreation, type WorkspaceConfig } from '@tutorialx/contracts';
import { createWorkspaceJob, initializeWorkspace, type WorkspaceIdentity } from '@tutorialx/core';
import { describe, expect, it } from 'vitest';

const identity: WorkspaceIdentity = {
  newId: (prefix) => `${prefix}_${randomUUID()}`,
  now: () => '2026-11-11T12:00:00Z',
};
const job: JobCreation = {
  title: 'Save plugin settings',
  topic: 'Show a verified settings change.',
  audience: 'Beginners',
};

async function fixture(run: (project: string, root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'tutorialx-workspace-'));
  const project = join(root, 'app');
  await mkdir(project);
  try {
    await run(project, root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe('workspace initialization', () => {
  it('preserves existing app files and configuration across repeated initialization', async () => {
    await fixture(async (project) => {
      await writeFile(join(project, 'plugin.php'), '<?php // existing plugin\n');
      await writeFile(join(project, '.gitignore'), '/vendor/\n');
      const layout = createLocalWorkspaceLayout(project);
      const first = await initializeWorkspace(layout, identity);
      const before = await readFile(join(project, '.tutorialx/workspace.json'), 'utf8');
      const again = await initializeWorkspace(layout, identity);
      expect(first.created).toBe(true);
      expect(again.created).toBe(false);
      expect(again.configuration).toEqual(first.configuration);
      expect(await readFile(join(project, '.tutorialx/workspace.json'), 'utf8')).toBe(before);
      expect(await readFile(join(project, 'plugin.php'), 'utf8')).toBe(
        '<?php // existing plugin\n',
      );
      expect(await readFile(join(project, '.gitignore'), 'utf8')).toBe('/vendor/\n');
      expect(await readFile(join(project, '.tutorialx/.gitignore'), 'utf8')).toBe('*\n');
      expect(await readFile(join(project, 'tutorialx-videos/.gitignore'), 'utf8')).toBe('*\n');
      expect((await stat(join(project, 'tutorialx-videos/shared/presets'))).isDirectory()).toBe(
        true,
      );
    });
  });

  it('keeps content outside the app when an external root is selected', async () => {
    await fixture(async (project, root) => {
      const content = join(root, 'private videos');
      const layout = createLocalWorkspaceLayout(project);
      const result = await initializeWorkspace(layout, identity, { contentRoot: content });
      const created = await createWorkspaceJob(layout, identity, job);
      expect(result.configuration.contentRoot).toBe(content);
      expect(await readdir(project)).toEqual(['.tutorialx']);
      expect(
        JSON.parse(await readFile(resolve(content, created.directory, 'job.json'), 'utf8')).title,
      ).toBe(job.title);
      expect((await stat(resolve(content, created.directory, 'input'))).isDirectory()).toBe(true);
    });
  });

  it('creates unique discoverable folders for identical titles, including concurrent requests', async () => {
    await fixture(async (project) => {
      const layout = createLocalWorkspaceLayout(project);
      await initializeWorkspace(layout, identity);
      const results = await Promise.all(
        Array.from({ length: 5 }, () => createWorkspaceJob(layout, identity, job)),
      );
      expect(new Set(results.map((result) => result.brief.id)).size).toBe(5);
      expect(new Set(results.map((result) => result.directory)).size).toBe(5);
      for (const result of results) {
        expect(result.directory).toMatch(/^jobs\/job_[a-z0-9-]+-save-plugin-settings$/);
        const root = resolve(project, 'tutorialx-videos', result.directory);
        expect(await readFile(join(root, 'brief.md'), 'utf8')).toContain(job.topic);
        for (const name of ['input', 'plan/revisions', 'work', 'output'])
          expect((await stat(join(root, name))).isDirectory()).toBe(true);
      }
    });
  });

  it('retains one configuration under concurrent initialization and repairs missing folders', async () => {
    await fixture(async (project) => {
      const layout = createLocalWorkspaceLayout(project);
      const results = await Promise.all(
        Array.from({ length: 5 }, () => initializeWorkspace(layout, identity)),
      );
      expect(results.filter((result) => result.created)).toHaveLength(1);
      expect(new Set(results.map((result) => result.configuration.id)).size).toBe(1);
      await rm(join(project, 'tutorialx-videos/shared/presets'), { recursive: true });
      await initializeWorkspace(layout, identity);
      expect((await stat(join(project, 'tutorialx-videos/shared/presets'))).isDirectory()).toBe(
        true,
      );
    });
  });

  it('rejects incompatible or malformed existing configuration without replacing it', async () => {
    await fixture(async (project) => {
      const layout = createLocalWorkspaceLayout(project);
      await initializeWorkspace(layout, identity);
      await expect(initializeWorkspace(layout, identity, { contentRoot: 'other' })).rejects.toThrow(
        'migration',
      );
      const file = join(project, '.tutorialx/workspace.json');
      const future = JSON.parse(await readFile(file, 'utf8')) as WorkspaceConfig;
      await writeFile(file, JSON.stringify({ ...future, schemaVersion: 2 }));
      await expect(initializeWorkspace(layout, identity)).rejects.toThrow();
      expect(JSON.parse(await readFile(file, 'utf8')).schemaVersion).toBe(2);
    });
  });

  it('rejects content roots overlapping app or state and blocks managed symlinks', async () => {
    await fixture(async (project, root) => {
      const layout = createLocalWorkspaceLayout(project);
      for (const contentRoot of ['.', '.tutorialx/content', '..'])
        await expect(initializeWorkspace(layout, identity, { contentRoot })).rejects.toThrow(
          'dedicated',
        );
      const outside = join(root, 'outside');
      await mkdir(outside);
      await symlink(outside, join(project, '.tutorialx'), 'junction');
      await expect(initializeWorkspace(layout, identity)).rejects.toThrow('redirected');
      expect(await readdir(outside)).toEqual([]);
    });
  });

  it('rejects redirected content/job directories and preserves existing ignore files', async () => {
    await fixture(async (project, root) => {
      const layout = createLocalWorkspaceLayout(project);
      await initializeWorkspace(layout, identity);
      const content = join(project, 'tutorialx-videos');
      await writeFile(join(content, '.gitignore'), '# existing rules\n');
      await initializeWorkspace(layout, identity);
      expect(await readFile(join(content, '.gitignore'), 'utf8')).toBe('# existing rules\n');
      await rm(join(content, 'jobs'), { recursive: true });
      const outside = join(root, 'outside');
      await mkdir(outside);
      await symlink(outside, join(content, 'jobs'), 'junction');
      await expect(createWorkspaceJob(layout, identity, job)).rejects.toThrow('symlink');
      expect(await readdir(outside)).toEqual([]);
    });
  });

  it('validates requests before accepting caller-supplied identities and sanitizes titles', async () => {
    await fixture(async (project) => {
      const layout = createLocalWorkspaceLayout(project);
      await expect(createWorkspaceJob(layout, identity, job)).rejects.toThrow('Initialize');
      await initializeWorkspace(layout, identity);
      await expect(
        createWorkspaceJob(layout, identity, { ...job, id: 'injected' } as JobCreation),
      ).rejects.toThrow();
      const result = await createWorkspaceJob(layout, identity, {
        ...job,
        title: '../../বাংলা / demo',
      });
      expect(result.directory).not.toContain('..');
      expect(result.directory).toMatch(/-demo$/);
    });
  });
});
