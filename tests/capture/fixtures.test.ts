import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { afterEach, describe, expect, it } from 'vitest';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it('runs the demo settings flow and restores deterministic state', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tutorialx-demo-fixture-'));
  roots.push(root);
  const token = 'fixture-test-token';
  const child = spawn(
    process.execPath,
    [
      'tests/fixtures/demo-app/server.mjs',
      '--state',
      join(root, 'state.json'),
      '--fixture-token',
      token,
    ],
    { cwd: resolve('.'), stdio: ['ignore', 'pipe', 'pipe'] },
  );
  try {
    const lines = createInterface({ input: child.stdout });
    const first = await new Promise<string>((resolveLine, reject) => {
      const timer = setTimeout(() => reject(new Error('Fixture did not start.')), 5000);
      lines.once('line', (line) => {
        clearTimeout(timer);
        resolveLine(line);
      });
      child.once('error', reject);
      child.once('exit', (code) => reject(new Error(`Fixture exited ${code}.`)));
    });
    const { origin } = JSON.parse(first) as { origin: string };
    const page = await fetch(`${origin}/admin/settings`);
    expect(await page.text()).toContain('Save changes');
    const saved = await fetch(`${origin}/admin/settings`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ siteTitle: 'Recorded feature', accent: '#ff5500' }),
    });
    expect(saved.status).toBe(303);
    expect(await (await fetch(`${origin}/api/state`)).json()).toEqual({
      siteTitle: 'Recorded feature',
      accent: '#ff5500',
      revision: 2,
    });
    const reset = await fetch(`${origin}/__fixture/reset`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(await reset.json()).toEqual({
      siteTitle: 'TutorialX Demo',
      accent: '#176bff',
      revision: 1,
    });
  } finally {
    child.kill('SIGTERM');
  }
});

const php = spawnSync('php', ['-v'], { encoding: 'utf8' }).status === 0;
describe.skipIf(!php)('WordPress plugin fixture', () => {
  it('runs setup, update, inspection, and reset through its isolated option harness', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tutorialx-wordpress-fixture-'));
    roots.push(root);
    const state = join(root, 'options.json');
    const harness = 'tests/fixtures/wordpress-plugin/harness.php';
    const run = (command: string, input?: object) => {
      const result = spawnSync(
        'php',
        [harness, state, command, ...(input ? [JSON.stringify(input)] : [])],
        { cwd: resolve('.'), encoding: 'utf8' },
      );
      expect(result.status, result.stderr).toBe(0);
      return JSON.parse(result.stdout) as Record<string, unknown>;
    };
    expect(run('setup')).toMatchObject({ site_title: 'TutorialX WordPress Demo', revision: 1 });
    expect(run('update', { site_title: 'Plugin feature', accent: '#00aa44' })).toEqual({
      site_title: 'Plugin feature',
      accent: '#00aa44',
      revision: 2,
    });
    expect(run('show')).toMatchObject({ site_title: 'Plugin feature', revision: 2 });
    expect(run('reset')).toMatchObject({ site_title: 'TutorialX WordPress Demo', revision: 1 });
    expect(
      await readFile('tests/fixtures/wordpress-plugin/tutorialx-fixture.php', 'utf8'),
    ).toContain('SPDX-License-Identifier: Apache-2.0');
  });
});
