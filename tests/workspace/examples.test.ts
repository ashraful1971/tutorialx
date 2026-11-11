import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { effectiveSettingsSchema, jobBriefSchema, profileSchema } from '@tutorialx/contracts';
import { expect, it } from 'vitest';
import { createSampleWorkspace } from '../../examples/workspaces/create-sample.mjs';

it('creates discoverable sample jobs in a dedicated workspace using the documented command', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tutorialx-example-'));
  try {
    const project = join(root, 'dedicated');
    const result = JSON.parse(
      execFileSync(process.execPath, ['examples/workspaces/create-sample.mjs', project], {
        encoding: 'utf8',
      }),
    );
    const brief = jobBriefSchema.parse(
      JSON.parse(await readFile(join(result.directory, 'job.json'), 'utf8')),
    );
    expect(brief.id).toBe(result.jobId);
    expect(brief.profiles).toHaveLength(2);
    expect(await readFile(result.brief, 'utf8')).toContain('My first explainer');
    const snapshot = JSON.parse(await readFile(result.settings, 'utf8'));
    expect(
      effectiveSettingsSchema.parse(snapshot.effective).settings.variants[0]!.aspectRatio,
    ).toBe('9:16');
    expect(snapshot.effective.settings.voice.mode).toBe('none');
    expect(snapshot.effective.settings.audio.music.enabled).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('keeps an existing app intact, stores content externally, and reuses saved profiles', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tutorialx-existing-example-'));
  try {
    const project = join(root, 'plugin');
    const content = join(root, 'private videos');
    await mkdir(project);
    await writeFile(join(project, 'plugin.php'), '<?php // existing app\n');
    const first = await createSampleWorkspace(project, content);
    const path = join(content, 'shared/brands/example_brand.json');
    const brand = profileSchema.parse(JSON.parse(await readFile(path, 'utf8')));
    brand.notes = 'Operator-modified example';
    brand.revision = 2;
    await writeFile(path, JSON.stringify(brand));
    const second = await createSampleWorkspace(project, content);
    expect(second.workspaceId).toBe(first.workspaceId);
    expect(second.jobId).not.toBe(first.jobId);
    expect(await readdir(project)).toEqual(['.tutorialx', 'plugin.php']);
    expect(await readFile(join(project, 'plugin.php'), 'utf8')).toBe('<?php // existing app\n');
    expect(await readdir(join(content, 'jobs'))).toHaveLength(2);
    const snapshot = JSON.parse(await readFile(second.settings, 'utf8'));
    expect(snapshot.profiles[0].profile.notes).toBe('Operator-modified example');
    expect(snapshot.profiles[0].profile.revision).toBe(2);
    expect(first.directory.startsWith(resolve(content))).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
