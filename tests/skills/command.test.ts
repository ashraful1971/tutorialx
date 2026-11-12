import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { type ActionResponse, SKILL_MANIFEST, skillCommandInputSchema } from '@tutorialx/contracts';
import { describe, expect, it } from 'vitest';
import { createActionService, runCommand } from '../../packages/cli/src/index.js';

describe('managed skill command routes', () => {
  it('previews and applies the bundled skill through parseable CLI responses, retaining user content on removal', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'tutorialx-skill-command-'));
    const invoke = async (operation: string, input: object) => {
      let stdout = '';
      const exitCode = await runCommand(
        ['skill', operation, '--input', '-', '--json'],
        {
          stdout: (text) => {
            stdout += text;
          },
          stderr: () => {},
          stdin: (async function* () {
            yield JSON.stringify(input);
          })(),
        },
        root,
      );
      return { response: JSON.parse(stdout) as ActionResponse, exitCode };
    };
    try {
      const preview = await invoke('install', { host: 'codex' });
      expect(preview.response.status).toBe('ok');
      if (preview.response.status !== 'ok') throw new Error(JSON.stringify(preview));
      expect(preview.response.data.applied).toBe(false);
      const proposed = preview.response.data.preview as { fingerprint: string; changes: unknown[] };
      expect(proposed.changes.length).toBe(8);
      expect(await readdir(root)).toEqual([]);
      const apply = await invoke('install', {
        host: 'codex',
        apply: true,
        fingerprint: proposed.fingerprint,
      });
      expect(apply.exitCode).toBe(0);
      expect(apply.response.status === 'ok' && apply.response.data.applied).toBe(true);
      const destination = resolve(root, '.agents/skills/tutorialx');
      expect(await readFile(resolve(destination, 'SKILL.md'), 'utf8')).toContain('name: tutorialx');
      expect(JSON.parse(await readFile(resolve(destination, SKILL_MANIFEST), 'utf8')).version).toBe(
        '0.1.0',
      );
      await writeFile(resolve(destination, 'notes.md'), 'User-owned notes');
      const remove = await invoke('remove', { host: 'codex' });
      if (remove.response.status !== 'ok') throw new Error(JSON.stringify(remove));
      const old = remove.response.data.preview as { fingerprint: string };
      await writeFile(resolve(destination, 'another.md'), 'A concurrent note');
      const stale = await invoke('remove', {
        host: 'codex',
        apply: true,
        fingerprint: old.fingerprint,
      });
      expect(stale.response.status === 'error' && stale.response.error.code).toBe(
        'REVISION_CONFLICT',
      );
      const refreshed = await invoke('remove', { host: 'codex' });
      if (refreshed.response.status !== 'ok') throw new Error(JSON.stringify(refreshed));
      const current = refreshed.response.data.preview as { fingerprint: string };
      expect(
        (await invoke('remove', { host: 'codex', apply: true, fingerprint: current.fingerprint }))
          .exitCode,
      ).toBe(0);
      expect(await readFile(resolve(destination, 'notes.md'), 'utf8')).toBe('User-owned notes');
      expect(await readFile(resolve(destination, 'another.md'), 'utf8')).toBe('A concurrent note');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('requires explicit generic roots, versioned supplied packages and reviewed apply fingerprints', () => {
    expect(skillCommandInputSchema.safeParse({ host: 'generic' }).success).toBe(false);
    expect(skillCommandInputSchema.safeParse({ host: 'codex', apply: true }).success).toBe(false);
    expect(
      skillCommandInputSchema.safeParse({ host: 'codex', packageRoot: '/package' }).success,
    ).toBe(false);
    expect(
      skillCommandInputSchema.safeParse({ host: 'codex', rootDirectory: '/project' }).success,
    ).toBe(true);
  });

  it('refuses a creative or worker identity even if the action name is in its scope', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'tutorialx-skill-authority-'));
    try {
      for (const principalRole of ['creative', 'worker'] as const) {
        const service = createActionService({
          projectDirectory: root,
          authority: {
            actorId: principalRole,
            actions: ['skill.install'],
            roles: [],
            principalRole,
          },
        });
        const response = await service.execute({
          apiVersion: 1,
          requestId: 'request_install',
          action: 'skill.install',
          params: { host: 'codex' },
          expectedRevision: null,
          idempotencyKey: null,
        });
        expect(response.status === 'error' && response.error.code).toBe('POLICY_DENIED');
      }
      expect(await readdir(root)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
