import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import {
  CaptureStepError,
  createPlaywrightCaptureProvider,
  createSqlitePersistence,
  probeFinalizedCapture,
} from '@tutorialx/adapters';
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
    allowedMutationTargets: [`${fixture.origin}/admin/settings`],
    settingsDigest: 'a'.repeat(64),
    ffprobePath: '/opt/homebrew/bin/ffprobe',
    assertionTimeoutMs: 1_000,
  });
  const request: CaptureRequest = {
    sceneId: 'scene_capture',
    target: `${fixture.origin}/admin/settings`,
    viewport: { width: 640, height: 480 },
    steps: [
      {
        id: 'fill_title',
        description: 'Enter the approved demo title.',
        evidenceIds: ['evidence_settings'],
        expected: [{ kind: 'visible', locator: { by: 'test-id', value: 'site-title' } }],
        dwellUs: 0,
        action: 'fill',
        locator: { by: 'label', value: 'Site title' },
        value: 'Verified Tutorial',
      },
      {
        id: 'fill_accent',
        description: 'Enter the approved accent color.',
        evidenceIds: ['evidence_settings'],
        expected: [{ kind: 'visible', locator: { by: 'test-id', value: 'accent' } }],
        dwellUs: 0,
        action: 'fill',
        locator: { by: 'test-id', value: 'accent' },
        value: '#123abc',
      },
      {
        id: 'save_settings',
        description: 'Save and verify the settings.',
        evidenceIds: ['evidence_settings'],
        expected: [
          {
            kind: 'visible',
            locator: { by: 'css', value: '[role="status"]' },
          },
          {
            kind: 'text',
            locator: { by: 'css', value: '[role="status"]' },
            text: 'Settings saved.',
          },
          { kind: 'url', url: `${fixture.origin}/admin/settings?saved=1` },
        ],
        dwellUs: 0,
        action: 'click',
        locator: { by: 'role', role: 'button', name: 'Save changes' },
      },
      {
        id: 'show_advanced',
        description: 'Scroll the advanced checkpoint into a readable position.',
        evidenceIds: ['evidence_settings'],
        expected: [{ kind: 'visible', locator: { by: 'test-id', value: 'advanced' } }],
        dwellUs: 150_000,
        action: 'scroll',
        locator: { by: 'test-id', value: 'advanced' },
      },
    ],
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
    expect(result.actions).toHaveLength(4);
    expect(result.actions.every((action) => action.verified)).toBe(true);
    expect(result.actions.every((action) => action.range.endUs > action.range.startUs)).toBe(true);
    expect(result.actions.every((action) => action.focus !== null)).toBe(true);
    expect(result.evidence).toHaveLength(4);
    expect(result.evidence.every((artifact) => artifact.kind === 'image')).toBe(true);
    expect(result.evidence.every((artifact) => artifact.media?.width === 640)).toBe(true);
    expect(result.evidence.every((artifact) => artifact.media?.height === 480)).toBe(true);
    expect(result.actions.map((action) => action.presentation?.checkpointArtifactId)).toEqual(
      result.evidence.map((artifact) => artifact.id),
    );
    expect(
      result.actions.filter((action) => action.presentation?.click).map((action) => action.stepId),
    ).toEqual(['save_settings']);
    for (const action of result.actions) {
      expect(action.presentation?.cursor?.x).toBeCloseTo(action.focus!.x + action.focus!.width / 2);
      expect(action.presentation?.cursor?.y).toBeCloseTo(
        action.focus!.y + action.focus!.height / 2,
      );
    }
    expect(
      result.actions.at(-1)!.range.endUs - result.actions.at(-1)!.range.startUs,
    ).toBeGreaterThanOrEqual(500_000);
    expect((await stat(join(output, 'capture.webm'))).size).toBe(result.recording.sizeBytes);
    expect(JSON.parse(await readFile(join(root, 'state.json'), 'utf8'))).toMatchObject({
      siteTitle: 'Verified Tutorial',
      accent: '#123abc',
      revision: 2,
    });
  } finally {
    fixture.child.kill('SIGTERM');
  }
});

it('keeps a focused essential checkpoint readable in a vertical fixture preview', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tutorialx-playwright-vertical-'));
  roots.push(root);
  const sessions = join(root, 'sessions');
  const output = join(root, 'output');
  await mkdir(sessions);
  const fixture = await demo(root);
  const provider = createPlaywrightCaptureProvider({
    workspaceId: 'workspace_capture',
    privateSessionDirectory: sessions,
    allowedOrigins: [fixture.origin],
    allowedMutationTargets: [`${fixture.origin}/admin/settings`],
    settingsDigest: 'a'.repeat(64),
    ffprobePath: '/opt/homebrew/bin/ffprobe',
    assertionTimeoutMs: 1_000,
    scrollDurationMs: 250,
  });
  try {
    const result = await provider.capture(
      {
        sceneId: 'scene_vertical',
        target: `${fixture.origin}/admin/settings`,
        viewport: { width: 360, height: 640 },
        steps: [
          {
            id: 'vertical_checkpoint',
            description: 'Present the advanced checkpoint in the vertical frame.',
            evidenceIds: ['evidence_settings'],
            expected: [{ kind: 'visible', locator: { by: 'test-id', value: 'advanced' } }],
            dwellUs: 100_000,
            action: 'scroll',
            locator: { by: 'test-id', value: 'advanced' },
          },
        ],
        sessionRef: null,
        setupRecipeId: null,
        maskRegions: [],
      },
      {
        operationId: 'operation_vertical',
        jobId: 'job_capture',
        attemptId: 'attempt_vertical',
        reservationId: null,
        outputDirectory: output,
        deadlineAt: '2099-01-01T00:00:00Z',
        signal: new AbortController().signal,
      },
    );
    expect(result.evidence[0]!.media).toMatchObject({ width: 360, height: 640 });
    expect(result.actions[0]!.focus).toMatchObject({
      width: expect.any(Number),
      height: expect.any(Number),
    });
    expect(result.actions[0]!.focus!.width).toBeGreaterThan(0.25);
    expect(result.actions[0]!.focus!.height).toBeGreaterThan(0.03);
    expect(result.actions[0]!.presentation).toMatchObject({
      interaction: 'scroll',
      click: false,
      checkpointArtifactId: result.evidence[0]!.id,
    });
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

it('locks and reconciles a shared fixture, scopes mutations, masks footage, and retries idempotently', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tutorialx-playwright-shared-'));
  roots.push(root);
  const sessions = join(root, 'sessions');
  await mkdir(sessions);
  const fixture = await demo(root);
  const store = await createSqlitePersistence({
    filename: join(root, 'capture.sqlite'),
    workspaceId: 'workspace_capture',
    now: () => new Date().toISOString(),
  });
  await store.repository.initialize();
  let allowFirstToContinue!: () => void;
  const firstGate = new Promise<void>((resolveGate) => {
    allowFirstToContinue = resolveGate;
  });
  let firstOwnsFixture!: () => void;
  const firstLocked = new Promise<void>((resolveLocked) => {
    firstOwnsFixture = resolveLocked;
  });
  const reconcileFixture = async (_request: CaptureRequest, context: OperationContext) => {
    const response = await fetch(`${fixture.origin}/__fixture/reset`, {
      method: 'POST',
      headers: { authorization: 'Bearer playwright-test' },
    });
    if (!response.ok) throw new Error('Fixture reset failed.');
    if (context.attemptId === 'attempt_lock_owner') {
      firstOwnsFixture();
      await firstGate;
    }
  };
  const provider = createPlaywrightCaptureProvider({
    workspaceId: 'workspace_capture',
    privateSessionDirectory: sessions,
    allowedOrigins: [fixture.origin],
    allowedMutationTargets: [`${fixture.origin}/admin/settings`],
    settingsDigest: 'a'.repeat(64),
    ffprobePath: '/opt/homebrew/bin/ffprobe',
    assertionTimeoutMs: 1_000,
    typingDelayMs: 10,
    resourceCoordinator: store.coordinator,
    reconcileFixture,
  });
  const request: CaptureRequest = {
    sceneId: 'scene_shared_fixture',
    target: `${fixture.origin}/admin/settings`,
    viewport: { width: 640, height: 480 },
    steps: [
      {
        id: 'verify_mask',
        description: 'Verify the configured footage mask exists.',
        evidenceIds: ['evidence_settings'],
        expected: [
          {
            kind: 'visible',
            locator: { by: 'css', value: '[data-tutorialx-mask="0"]' },
          },
        ],
        dwellUs: 0,
        action: 'observe',
      },
      {
        id: 'fill_locked_title',
        description: 'Enter the reconciled fixture title.',
        evidenceIds: ['evidence_settings'],
        expected: [{ kind: 'visible', locator: { by: 'test-id', value: 'site-title' } }],
        dwellUs: 0,
        action: 'fill',
        locator: { by: 'test-id', value: 'site-title' },
        value: 'Locked Tutorial',
      },
      {
        id: 'save_locked_title',
        description: 'Save the reconciled fixture title.',
        evidenceIds: ['evidence_settings'],
        expected: [{ kind: 'visible', locator: { by: 'css', value: '[role="status"]' } }],
        dwellUs: 0,
        action: 'click',
        locator: { by: 'role', role: 'button', name: 'Save changes' },
      },
    ],
    sessionRef: null,
    setupRecipeId: 'fixture_demo',
    maskRegions: [{ x: 0.8, y: 0, width: 0.2, height: 0.1 }],
  };
  const operation = (attemptId: string, output: string): OperationContext => ({
    operationId: `operation_${attemptId}`,
    jobId: 'job_capture',
    attemptId,
    reservationId: null,
    outputDirectory: join(root, output),
    deadlineAt: '2099-01-01T00:00:00Z',
    signal: new AbortController().signal,
  });
  try {
    const denied = createPlaywrightCaptureProvider({
      workspaceId: 'workspace_capture',
      privateSessionDirectory: sessions,
      allowedOrigins: [fixture.origin],
      allowedMutationTargets: [],
      settingsDigest: 'a'.repeat(64),
      ffprobePath: '/opt/homebrew/bin/ffprobe',
      resourceCoordinator: store.coordinator,
      reconcileFixture,
    });
    const deniedPreflight = await denied.preflight(request, operation('attempt_denied', 'denied'));
    expect(deniedPreflight.diagnostics.map((entry) => entry.code)).toContain(
      'CAPTURE_MUTATION_DENIED',
    );

    const first = provider.capture(request, operation('attempt_lock_owner', 'owner'));
    await firstLocked;
    await expect(
      provider.capture(request, operation('attempt_lock_contender', 'contender')),
    ).rejects.toThrow('CAPTURE_FIXTURE_BUSY');
    allowFirstToContinue();
    const firstResult = await first;
    expect(firstResult.evidence).toHaveLength(3);
    expect(firstResult.actions[0]!.presentation?.checkpointArtifactId).toBe(
      firstResult.evidence[0]!.id,
    );

    await provider.capture(request, operation('attempt_lock_retry', 'retry'));
    expect(JSON.parse(await readFile(join(root, 'state.json'), 'utf8'))).toMatchObject({
      siteTitle: 'Locked Tutorial',
      revision: 2,
    });
  } finally {
    allowFirstToContinue();
    await store.repository.close();
    fixture.child.kill('SIGTERM');
  }
});

it('fails an asserted save result and retains screenshot evidence instead of claiming success', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tutorialx-playwright-failed-save-'));
  roots.push(root);
  const sessions = join(root, 'sessions');
  const output = join(root, 'output');
  await mkdir(sessions);
  const fixture = await demo(root);
  const provider = createPlaywrightCaptureProvider({
    workspaceId: 'workspace_capture',
    privateSessionDirectory: sessions,
    allowedOrigins: [fixture.origin],
    allowedMutationTargets: [`${fixture.origin}/admin/settings`],
    settingsDigest: 'a'.repeat(64),
    ffprobePath: '/opt/homebrew/bin/ffprobe',
    assertionTimeoutMs: 500,
  });
  try {
    let failure: unknown;
    try {
      await provider.capture(
        {
          sceneId: 'scene_failed_save',
          target: `${fixture.origin}/admin/settings`,
          viewport: { width: 640, height: 480 },
          steps: [
            {
              id: 'invalid_accent',
              description: 'Enter invalid data for the failure fixture.',
              evidenceIds: ['evidence_settings'],
              expected: [{ kind: 'visible', locator: { by: 'test-id', value: 'accent' } }],
              dwellUs: 0,
              action: 'fill',
              locator: { by: 'label', value: 'Accent color' },
              value: 'not-a-color',
            },
            {
              id: 'save_invalid',
              description: 'The approved plan expects a successful save.',
              evidenceIds: ['evidence_settings'],
              expected: [
                {
                  kind: 'visible',
                  locator: { by: 'css', value: '[role="status"]' },
                },
              ],
              dwellUs: 0,
              action: 'click',
              locator: { by: 'role', role: 'button', name: 'Save changes' },
            },
          ],
          sessionRef: null,
          setupRecipeId: null,
          maskRegions: [],
        },
        {
          operationId: 'operation_failed_save',
          jobId: 'job_capture',
          attemptId: 'attempt_failed_save',
          reservationId: null,
          outputDirectory: output,
          deadlineAt: '2099-01-01T00:00:00Z',
          signal: new AbortController().signal,
        },
      );
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(CaptureStepError);
    const stepFailure = failure as CaptureStepError;
    expect(stepFailure).toMatchObject({
      code: 'CAPTURE_STEP_ASSERTION_FAILED',
      stepId: 'save_invalid',
    });
    expect(stepFailure.evidence).toHaveLength(1);
    expect((await stat(join(output, 'step-002-save_invalid-failed.png'))).size).toBeGreaterThan(0);
    expect(JSON.parse(await readFile(join(root, 'state.json'), 'utf8'))).toMatchObject({
      siteTitle: 'TutorialX Demo',
      accent: '#176bff',
      revision: 1,
    });
  } finally {
    fixture.child.kill('SIGTERM');
  }
});
