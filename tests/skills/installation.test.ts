import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalSkillInstaller } from '@tutorialx/adapters';
import { SKILL_MANIFEST, type SkillHost } from '@tutorialx/contracts';
import { supportedSkillDirectory } from '@tutorialx/core';
import { describe, expect, it } from 'vitest';

async function fixture(run: (root: string, supplied: string) => Promise<void>) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'tutorialx-skill-')));
  const supplied = join(root, 'package');
  await mkdir(join(supplied, 'references'), { recursive: true });
  await writeFile(
    join(supplied, 'SKILL.md'),
    '---\nname: tutorialx\ndescription: Fixture\n---\nv1\n',
  );
  await writeFile(join(supplied, 'references/recovery.md'), 'Recovery v1\n');
  try {
    await run(root, supplied);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe('managed host skill installation', () => {
  it.each<SkillHost>(['codex', 'claude-code', 'generic'])(
    'previews, installs, updates and removes only managed files in the %s layout',
    async (host) => {
      await fixture(async (root, supplied) => {
        const installer = createLocalSkillInstaller({ rootDirectory: root, host });
        const destination = join(root, supportedSkillDirectory(host));
        await mkdir(destination, { recursive: true });
        await writeFile(join(destination, 'notes.md'), 'My skill notes\n');
        await writeFile(join(root, 'AGENTS.md'), 'My agent instructions\n');
        await writeFile(join(root, 'CLAUDE.md'), 'My Claude instructions\n');
        await mkdir(join(root, 'tutorialx-videos'));
        await writeFile(join(root, 'tutorialx-videos/video.mp4'), 'personal video');
        const proposed = await installer.preview({
          operation: 'install',
          packageRoot: supplied,
          version: '1.0.0',
        });
        expect(proposed.destination).toBe(destination);
        expect(proposed.changes.find((change) => change.path === 'SKILL.md')).toMatchObject({
          before: null,
          after: expect.stringContaining('v1'),
        });
        expect(await readdir(destination)).toEqual(['notes.md']);
        await installer.apply(proposed);
        await writeFile(join(supplied, 'SKILL.md'), 'Version two\n');
        await rm(join(supplied, 'references/recovery.md'));
        const update = await installer.preview({
          operation: 'update',
          packageRoot: supplied,
          version: '2.0.0',
        });
        expect(update.changes).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ path: 'SKILL.md', before: expect.stringContaining('v1') }),
            { path: 'references/recovery.md', before: 'Recovery v1\n', after: null },
          ]),
        );
        await installer.apply(update);
        expect(JSON.parse(await readFile(join(destination, SKILL_MANIFEST), 'utf8')).version).toBe(
          '2.0.0',
        );
        expect(await readFile(join(destination, 'notes.md'), 'utf8')).toBe('My skill notes\n');
        await installer.apply(await installer.preview({ operation: 'remove' }));
        expect(await readFile(join(destination, 'notes.md'), 'utf8')).toBe('My skill notes\n');
        expect(await readdir(join(destination, 'references'))).toEqual([]);
        expect(await readFile(join(root, 'AGENTS.md'), 'utf8')).toBe('My agent instructions\n');
        expect(await readFile(join(root, 'CLAUDE.md'), 'utf8')).toBe('My Claude instructions\n');
        expect(await readFile(join(root, 'tutorialx-videos/video.mp4'), 'utf8')).toBe(
          'personal video',
        );
        const backups = await readdir(join(root, '.tutorialx/skill-backups'));
        expect(backups).toHaveLength(3);
        const recovered = await Promise.all(
          backups.map(async (id) =>
            JSON.parse(
              await readFile(join(root, '.tutorialx/skill-backups', id, 'changes.json'), 'utf8'),
            ),
          ),
        );
        expect(recovered.some((backup) => backup.operation === 'update')).toBe(true);
      });
    },
  );

  it('refuses unmanaged collisions and managed edits without replacing user content', async () => {
    await fixture(async (root, supplied) => {
      const installer = createLocalSkillInstaller({ rootDirectory: root, host: 'codex' });
      const destination = join(root, supportedSkillDirectory('codex'));
      await mkdir(destination, { recursive: true });
      await writeFile(join(destination, 'SKILL.md'), 'Existing unmanaged skill');
      const install = { operation: 'install' as const, packageRoot: supplied, version: '1' };
      await expect(installer.preview(install)).rejects.toThrow('unmanaged');
      await rm(join(destination, 'SKILL.md'));
      await installer.apply(await installer.preview(install));
      await writeFile(join(destination, 'SKILL.md'), 'My modified managed skill');
      await expect(installer.preview({ operation: 'remove' })).rejects.toThrow('changed');
      await expect(installer.preview({ ...install, operation: 'update' })).rejects.toThrow(
        'changed',
      );
      expect(await readFile(join(destination, 'SKILL.md'), 'utf8')).toBe(
        'My modified managed skill',
      );
    });
  });

  it('rejects stale target/package previews and ignores forged changes', async () => {
    await fixture(async (root, supplied) => {
      const installer = createLocalSkillInstaller({ rootDirectory: root, host: 'claude-code' });
      const request = { operation: 'install' as const, packageRoot: supplied, version: '1' };
      const first = await installer.preview(request);
      await writeFile(join(supplied, 'SKILL.md'), 'Changed package');
      await expect(installer.apply(first)).rejects.toThrow('since preview');
      const second = await installer.preview(request);
      await mkdir(second.destination, { recursive: true });
      await writeFile(join(second.destination, 'notes.md'), 'Concurrent user file');
      await expect(installer.apply(second)).rejects.toThrow('since preview');
      const latest = await installer.preview(request);
      await installer.apply({
        ...latest,
        changes: [{ path: '../AGENTS.md', before: null, after: 'x' }],
      });
      expect(await readFile(join(latest.destination, 'SKILL.md'), 'utf8')).toBe('Changed package');
      expect(await readFile(join(latest.destination, 'notes.md'), 'utf8')).toBe(
        'Concurrent user file',
      );
    });
  });

  it('rejects redirected destinations, symlink packages and unsafe manifest paths', async () => {
    await fixture(async (root, supplied) => {
      const installer = createLocalSkillInstaller({ rootDirectory: root, host: 'codex' });
      const request = { operation: 'install' as const, packageRoot: supplied, version: '1' };
      await mkdir(join(root, 'outside'));
      await symlink(join(root, 'outside'), join(root, '.agents'), 'junction');
      await expect(installer.preview(request)).rejects.toThrow('symlink');
      await rm(join(root, '.agents'));
      await symlink(join(root, 'outside'), join(supplied, 'escape'), 'junction');
      await expect(installer.preview(request)).rejects.toThrow('symlink');
      await rm(join(supplied, 'escape'));
      const destination = join(root, supportedSkillDirectory('codex'));
      await mkdir(destination, { recursive: true });
      await writeFile(
        join(destination, SKILL_MANIFEST),
        JSON.stringify({
          schemaVersion: 1,
          manager: 'tutorialx',
          version: '1',
          files: { '../AGENTS.md': '0'.repeat(64) },
        }),
      );
      await expect(installer.preview({ operation: 'remove' })).rejects.toThrow();
      expect(await readdir(join(root, 'outside'))).toEqual([]);
    });
  });

  it('requires explicit package, valid version and known host without hidden host defaults', async () => {
    await fixture(async (root, supplied) => {
      const installer = createLocalSkillInstaller({ rootDirectory: root, host: 'codex' });
      await expect(installer.preview({ operation: 'install' })).rejects.toThrow('explicit');
      await expect(
        installer.preview({ operation: 'install', packageRoot: supplied }),
      ).rejects.toThrow();
      expect(() => supportedSkillDirectory('invented' as SkillHost)).toThrow();
      expect((await installer.preview({ operation: 'remove' })).changes).toEqual([]);
    });
  });

  it('refuses portable path aliases instead of overwriting unmanaged files', async () => {
    await fixture(async (root, supplied) => {
      const installer = createLocalSkillInstaller({ rootDirectory: root, host: 'codex' });
      const destination = join(root, supportedSkillDirectory('codex'));
      await mkdir(join(destination, 'References'), { recursive: true });
      await writeFile(join(destination, 'References/notes.md'), 'User-owned reference');
      await expect(
        installer.preview({ operation: 'install', packageRoot: supplied, version: '1' }),
      ).rejects.toThrow('collision');
      expect(await readFile(join(destination, 'References/notes.md'), 'utf8')).toBe(
        'User-owned reference',
      );
    });
  });
});
