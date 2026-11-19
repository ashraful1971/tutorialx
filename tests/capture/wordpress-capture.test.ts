import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createPlaywrightCaptureProvider } from '@tutorialx/adapters';
import type { CaptureRequest, OperationContext } from '@tutorialx/contracts';
import { afterEach, describe, expect, it } from 'vitest';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function availablePort(): Promise<number> {
  const reservation = createServer();
  await new Promise<void>((resolveListen, reject) => {
    reservation.once('error', reject);
    reservation.listen(0, '127.0.0.1', resolveListen);
  });
  const address = reservation.address();
  if (!address || typeof address === 'string') throw new Error('Could not reserve a fixture port.');
  await new Promise<void>((resolveClose, reject) =>
    reservation.close((error) => (error ? reject(error) : resolveClose())),
  );
  return address.port;
}

async function wordpress(root: string) {
  const port = await availablePort();
  const origin = `http://127.0.0.1:${port}`;
  const statePath = join(root, 'wordpress-options.json');
  const child = spawn(
    'php',
    ['-S', `127.0.0.1:${port}`, 'tests/fixtures/wordpress-plugin/router.php'],
    {
      cwd: resolve('.'),
      env: {
        ...process.env,
        TUTORIALX_FIXTURE_STATE: statePath,
        TUTORIALX_FIXTURE_TOKEN: 'wordpress-capture-token',
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    },
  );
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk;
  });
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`WordPress fixture exited: ${stderr}`);
    try {
      const response = await fetch(`${origin}/api/state`);
      if (response.ok) return { child, origin, statePath };
    } catch {
      // The PHP development server has not started listening yet.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  child.kill('SIGTERM');
  throw new Error(`WordPress fixture did not start: ${stderr}`);
}

const php = spawnSync('php', ['-v'], { encoding: 'utf8' }).status === 0;
describe.skipIf(!php)('WordPress public capture flow', () => {
  it('produces finalized video and verified evidence manifests through the capture port', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tutorialx-wordpress-capture-'));
    roots.push(root);
    const sessions = join(root, 'sessions');
    const output = join(root, 'output');
    await mkdir(sessions);
    const fixture = await wordpress(root);
    const target = `${fixture.origin}/wp-admin/options-general.php?page=tutorialx-fixture`;
    const provider = createPlaywrightCaptureProvider({
      workspaceId: 'workspace_capture',
      privateSessionDirectory: sessions,
      allowedOrigins: [fixture.origin],
      allowedMutationTargets: [`${fixture.origin}/wp-admin/options-general.php`],
      settingsDigest: 'a'.repeat(64),
      ffprobePath: '/opt/homebrew/bin/ffprobe',
      assertionTimeoutMs: 1_500,
      typingDelayMs: 10,
    });
    const request: CaptureRequest = {
      sceneId: 'scene_wordpress_plugin',
      target,
      viewport: { width: 640, height: 480 },
      steps: [
        {
          id: 'wordpress_title',
          description: 'Enter the approved WordPress fixture title.',
          evidenceIds: ['evidence_wordpress'],
          expected: [{ kind: 'visible', locator: { by: 'test-id', value: 'wp-site-title' } }],
          dwellUs: 0,
          action: 'fill',
          locator: { by: 'label', value: 'Site title' },
          value: 'Recorded WordPress Feature',
        },
        {
          id: 'wordpress_accent',
          description: 'Enter the approved WordPress fixture accent.',
          evidenceIds: ['evidence_wordpress'],
          expected: [{ kind: 'visible', locator: { by: 'test-id', value: 'wp-accent' } }],
          dwellUs: 0,
          action: 'fill',
          locator: { by: 'test-id', value: 'wp-accent' },
          value: '#00aa44',
        },
        {
          id: 'wordpress_save',
          description: 'Save and verify the WordPress plugin settings.',
          evidenceIds: ['evidence_wordpress'],
          expected: [
            { kind: 'visible', locator: { by: 'css', value: '[role="status"]' } },
            {
              kind: 'text',
              locator: { by: 'css', value: '[role="status"]' },
              text: 'Plugin settings saved.',
            },
          ],
          dwellUs: 100_000,
          action: 'click',
          locator: { by: 'role', role: 'button', name: 'Save plugin settings' },
        },
      ],
      sessionRef: null,
      setupRecipeId: null,
      maskRegions: [],
    };
    const context: OperationContext = {
      operationId: 'operation_wordpress_capture',
      jobId: 'job_wordpress_capture',
      attemptId: 'attempt_wordpress_capture',
      reservationId: null,
      outputDirectory: output,
      deadlineAt: '2099-01-01T00:00:00Z',
      signal: new AbortController().signal,
    };
    try {
      expect(await provider.preflight(request, context)).toEqual({ ready: true, diagnostics: [] });
      const result = await provider.capture(request, context);
      expect(result.recording).toMatchObject({ kind: 'video', mimeType: 'video/webm' });
      expect(result.recording.media).toMatchObject({ width: 640, height: 480 });
      expect((await stat(join(output, 'capture.webm'))).size).toBe(result.recording.sizeBytes);
      expect(result.evidence).toHaveLength(3);
      expect(result.evidence.every((entry) => entry.kind === 'image')).toBe(true);
      expect(result.evidence.every((entry) => /^[a-f0-9]{64}$/.test(entry.digest))).toBe(true);
      expect(result.actions.every((entry) => entry.verified)).toBe(true);
      expect(result.actions.map((entry) => entry.presentation?.checkpointArtifactId)).toEqual(
        result.evidence.map((entry) => entry.id),
      );
      const stored = JSON.parse(await readFile(fixture.statePath, 'utf8')) as {
        tutorialx_fixture_settings: object;
      };
      expect(stored.tutorialx_fixture_settings).toMatchObject({
        site_title: 'Recorded WordPress Feature',
        accent: '#00aa44',
        revision: 2,
      });
    } finally {
      fixture.child.kill('SIGTERM');
    }
  });
});
