import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { createPlaywrightCaptureProvider, probeFinalizedCapture } from '@tutorialx/adapters';
import type { CaptureRequest, OperationContext } from '@tutorialx/contracts';
import { afterEach, expect, it } from 'vitest';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function demo(root: string) {
  const child = spawn(
    process.execPath,
    [
      'tests/fixtures/demo-app/server.mjs',
      '--state',
      join(root, 'state.json'),
      '--fixture-token',
      'playwright-test',
    ],
    { cwd: resolve('.'), stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const lines = createInterface({ input: child.stdout });
  const line = await new Promise<string>((resolveLine, reject) => {
    const timer = setTimeout(() => reject(new Error('Fixture did not start.')), 5000);
    lines.once('line', (value) => {
      clearTimeout(timer);
      resolveLine(value);
    });
    child.once('error', reject);
    child.once('exit', (code) => reject(new Error(`Fixture exited ${code}.`)));
  });
  return { child, origin: (JSON.parse(line) as { origin: string }).origin };
}

it('preflights an isolated context and accepts only a closed, probed recording at explicit size', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tutorialx-playwright-'));
  roots.push(root);
  const sessions = join(root, 'sessions');
  const output = join(root, 'output');
  await mkdir(sessions);
  const fixture = await demo(root);
  const provider = createPlaywrightCaptureProvider({
    workspaceId: 'workspace_capture',
    privateSessionDirectory: sessions,
    allowedOrigins: [fixture.origin],
    settingsDigest: 'a'.repeat(64),
    ffprobePath: '/opt/homebrew/bin/ffprobe',
  });
  const request: CaptureRequest = {
    sceneId: 'scene_capture',
    target: `${fixture.origin}/admin/settings`,
    viewport: { width: 640, height: 480 },
    steps: [],
    sessionRef: null,
    setupRecipeId: null,
    maskRegions: [],
  };
  const context: OperationContext = {
    operationId: 'operation_capture',
    jobId: 'job_capture',
    attemptId: 'attempt_capture',
    reservationId: null,
    outputDirectory: output,
    deadlineAt: '2099-01-01T00:00:00Z',
    signal: new AbortController().signal,
  };
  try {
    expect(await provider.readiness()).toEqual({ ready: true, diagnostics: [] });
    expect(await provider.preflight(request, context)).toEqual({ ready: true, diagnostics: [] });
    const result = await provider.capture(request, context);
    const media = result.recording.media;
    expect(media).not.toBeNull();
    if (media === null) throw new Error('Expected probed recording metadata.');
    expect(media).toMatchObject({
      width: 640,
      height: 480,
    });
    expect(media.videoCodec).toMatch(/^vp[89]$/);
    expect(result.recording.sizeBytes).toBeGreaterThan(0);
    expect((await stat(join(output, 'capture.webm'))).size).toBe(result.recording.sizeBytes);
  } finally {
    fixture.child.kill('SIGTERM');
  }
});

it('rejects expired private sessions and missing or malformed finalized recordings', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tutorialx-playwright-policy-'));
  roots.push(root);
  const sessions = join(root, 'sessions');
  await mkdir(sessions);
  await writeFile(
    join(sessions, 'expired.json'),
    JSON.stringify({
      schemaVersion: 1,
      expiresAt: '2000-01-01T00:00:00Z',
      storageState: { cookies: [], origins: [] },
    }),
  );
  const provider = createPlaywrightCaptureProvider({
    workspaceId: 'workspace_capture',
    privateSessionDirectory: sessions,
    allowedOrigins: ['https://demo.example'],
    settingsDigest: 'a'.repeat(64),
    ffprobePath: '/opt/homebrew/bin/ffprobe',
  });
  const preflight = await provider.preflight(
    {
      sceneId: 'scene_capture',
      target: 'https://demo.example/settings',
      viewport: { width: 640, height: 480 },
      steps: [],
      sessionRef: 'expired',
      setupRecipeId: null,
      maskRegions: [],
    },
    {
      operationId: 'operation_capture',
      jobId: 'job_capture',
      attemptId: 'attempt_capture',
      reservationId: null,
      outputDirectory: join(root, 'output'),
      deadlineAt: '2099-01-01T00:00:00Z',
      signal: new AbortController().signal,
    },
  );
  expect(preflight.ready).toBe(false);
  expect(preflight.diagnostics.map((entry) => entry.code)).toContain('CAPTURE_AUTH_EXPIRED');
  await expect(
    probeFinalizedCapture(
      Buffer.alloc(0),
      '/opt/homebrew/bin/ffprobe',
      new AbortController().signal,
      { width: 640, height: 480 },
    ),
  ).rejects.toThrow('UNFINALIZED');
  await expect(
    probeFinalizedCapture(
      Buffer.from('not a video'),
      '/opt/homebrew/bin/ffprobe',
      new AbortController().signal,
      { width: 640, height: 480 },
    ),
  ).rejects.toThrow();
  expect(await readFile(join(sessions, 'expired.json'), 'utf8')).toContain('2000-01-01');
});
