import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, rename, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  type ArtifactManifest,
  artifactManifestSchema,
  type CaptureLocator,
  type CaptureProvider,
  type CaptureRequest,
  type CaptureStep,
  canonicalJson,
  captureResultSchema,
  type Diagnostic,
  type FocusRegion,
  type JsonObject,
  type OperationContext,
  type ProviderReadiness,
  type ResourceCoordinator,
  type ResourceLease,
} from '@tutorialx/contracts';
import type { Browser, BrowserContextOptions, BrowserType, Locator, Page } from 'playwright';
import { probeMetadata } from '../research/media.js';
import { probeBytes, probeExecutable } from '../research/runtime.js';

interface SessionEnvelope {
  schemaVersion: 1;
  expiresAt: string;
  storageState: NonNullable<BrowserContextOptions['storageState']>;
}

export interface PlaywrightCaptureOptions {
  workspaceId: string;
  privateSessionDirectory: string;
  allowedOrigins: readonly string[];
  settingsDigest: string;
  ffprobePath?: string;
  browser?: 'chromium' | 'firefox' | 'webkit';
  executablePath?: string;
  headless?: boolean;
  assertionTimeoutMs?: number;
  typingDelayMs?: number;
  scrollDurationMs?: number;
  allowedMutationTargets?: readonly string[];
  resourceCoordinator?: Pick<ResourceCoordinator, 'acquireResource' | 'releaseResource'>;
  reconcileFixture?(request: CaptureRequest, context: OperationContext): Promise<void>;
  now?(): string;
}

export class CaptureStepError extends Error {
  readonly code: 'CAPTURE_STEP_ACTION_FAILED' | 'CAPTURE_STEP_ASSERTION_FAILED';
  readonly stepId: string;
  readonly evidence: readonly ArtifactManifest[];

  constructor(
    code: CaptureStepError['code'],
    stepId: string,
    evidence: readonly ArtifactManifest[],
    cause: unknown,
  ) {
    super(`${code}: ${stepId}`, { cause });
    this.name = 'CaptureStepError';
    this.code = code;
    this.stepId = stepId;
    this.evidence = evidence;
  }
}

const diagnostic = (
  code: string,
  message: string,
  classification: Diagnostic['classification'] = 'permanent',
  retryable = false,
): Diagnostic => ({ code, message, classification, retryable });

async function loadPlaywright(): Promise<typeof import('playwright')> {
  try {
    return await import('playwright');
  } catch {
    throw new Error('PLAYWRIGHT_NOT_INSTALLED');
  }
}

function mutationAllowed(target: string, scopes: readonly string[]): boolean {
  try {
    const candidate = new URL(target);
    return scopes.some((scopeValue) => {
      const scope = new URL(scopeValue);
      return candidate.origin === scope.origin && candidate.pathname.startsWith(scope.pathname);
    });
  } catch {
    return false;
  }
}

function hasMutation(request: CaptureRequest): boolean {
  return request.steps.some((step) => step.action === 'click' || step.action === 'fill');
}

function validateRequest(request: CaptureRequest, options: PlaywrightCaptureOptions): Diagnostic[] {
  const issues: Diagnostic[] = [];
  let target: URL | null = null;
  try {
    target = new URL(request.target);
  } catch {
    issues.push(diagnostic('CAPTURE_TARGET_INVALID', 'Capture target must be an absolute URL.'));
  }
  if (target && !options.allowedOrigins.includes(target.origin))
    issues.push(diagnostic('CAPTURE_TARGET_DENIED', 'Capture target origin is outside policy.'));
  if (
    !Number.isSafeInteger(request.viewport.width) ||
    !Number.isSafeInteger(request.viewport.height) ||
    request.viewport.width < 320 ||
    request.viewport.width > 7680 ||
    request.viewport.height < 240 ||
    request.viewport.height > 4320
  )
    issues.push(diagnostic('CAPTURE_VIEWPORT_INVALID', 'Capture viewport dimensions are invalid.'));
  let actionTarget = request.target;
  for (const step of request.steps) {
    if (step.action === 'navigate') actionTarget = step.url;
    if (
      (step.action === 'click' || step.action === 'fill') &&
      !mutationAllowed(actionTarget, options.allowedMutationTargets ?? [])
    )
      issues.push(
        diagnostic(
          'CAPTURE_MUTATION_DENIED',
          `Step ${step.id} is outside the configured demo mutation scope.`,
          'policy',
        ),
      );
  }
  if (hasMutation(request) && request.setupRecipeId !== null) {
    if (!options.resourceCoordinator)
      issues.push(
        diagnostic(
          'CAPTURE_FIXTURE_LOCK_REQUIRED',
          'Shared fixture mutation requires an atomic resource coordinator.',
          'policy',
        ),
      );
    if (!options.reconcileFixture)
      issues.push(
        diagnostic(
          'CAPTURE_FIXTURE_RECONCILIATION_REQUIRED',
          'Shared fixture mutation requires a repeatable setup/reconciliation hook.',
          'policy',
        ),
      );
  }
  if (
    request.maskRegions.some(
      (region) =>
        !Number.isFinite(region.x) ||
        !Number.isFinite(region.y) ||
        !Number.isFinite(region.width) ||
        !Number.isFinite(region.height) ||
        region.x < 0 ||
        region.y < 0 ||
        region.width <= 0 ||
        region.height <= 0 ||
        region.x + region.width > 1 ||
        region.y + region.height > 1,
    )
  )
    issues.push(diagnostic('CAPTURE_MASK_INVALID', 'Capture mask regions must fit the viewport.'));
  return issues;
}

function targetAllowed(target: string, allowedOrigins: readonly string[]): boolean {
  try {
    return allowedOrigins.includes(new URL(target).origin);
  } catch {
    return false;
  }
}

function locate(page: Page, target: CaptureLocator): Locator {
  switch (target.by) {
    case 'role':
      return page.getByRole(target.role as Parameters<Page['getByRole']>[0], {
        name: target.name,
      });
    case 'label':
      return page.getByLabel(target.value);
    case 'test-id':
      return page.getByTestId(target.value);
    case 'css':
      return page.locator(target.value);
  }
}

function normalizeFocus(
  box: { x: number; y: number; width: number; height: number } | null,
  viewport: CaptureRequest['viewport'],
): FocusRegion | null {
  if (!box || box.width <= 0 || box.height <= 0) return null;
  const x = Math.max(0, Math.min(1, box.x / viewport.width));
  const y = Math.max(0, Math.min(1, box.y / viewport.height));
  const width = Math.max(0, Math.min(1 - x, box.width / viewport.width));
  const height = Math.max(0, Math.min(1 - y, box.height / viewport.height));
  return width > 0 && height > 0 ? { x, y, width, height } : null;
}

function cursorFor(focus: FocusRegion | null): { x: number; y: number } | null {
  return focus ? { x: focus.x + focus.width / 2, y: focus.y + focus.height / 2 } : null;
}

async function sessionState(
  directory: string,
  reference: string | null,
  now: string,
): Promise<{ state?: BrowserContextOptions['storageState']; diagnostics: Diagnostic[] }> {
  if (reference === null) return { diagnostics: [] };
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(reference))
    return {
      diagnostics: [diagnostic('CAPTURE_SESSION_INVALID', 'Private session reference is invalid.')],
    };
  const root = await realpath(directory);
  const path = resolve(root, `${reference}.json`);
  try {
    const info = await lstat(path);
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      (await realpath(path)).slice(0, root.length) !== root
    )
      throw new Error('unsafe session');
    const envelope = JSON.parse(await readFile(path, 'utf8')) as SessionEnvelope;
    if (envelope.schemaVersion !== 1 || !envelope.storageState || !envelope.expiresAt)
      throw new Error('invalid session');
    if (Date.parse(envelope.expiresAt) <= Date.parse(now))
      return {
        diagnostics: [
          diagnostic(
            'CAPTURE_AUTH_EXPIRED',
            'Saved browser access expired; renew the private session before capture.',
            'policy',
          ),
        ],
      };
    return { state: envelope.storageState, diagnostics: [] };
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
      return {
        diagnostics: [
          diagnostic('CAPTURE_SESSION_MISSING', 'Private browser session reference was not found.'),
        ],
      };
    return {
      diagnostics: [
        diagnostic('CAPTURE_SESSION_INVALID', 'Private browser session could not be validated.'),
      ],
    };
  }
}

async function browserType(
  playwright: typeof import('playwright'),
  name: PlaywrightCaptureOptions['browser'],
) {
  return playwright[name ?? 'chromium'] as BrowserType;
}

async function pageAuthentication(page: Page): Promise<Diagnostic[]> {
  const url = new URL(page.url());
  const password = await page.locator('input[type="password"]').count();
  if (/\b(login|signin|sign-in)\b/i.test(url.pathname) || password > 0)
    return [
      diagnostic(
        'CAPTURE_AUTH_REQUIRED',
        'Capture reached an authentication surface instead of the approved feature.',
        'policy',
      ),
    ];
  return [];
}

export async function probeFinalizedCapture(
  bytes: Buffer,
  ffprobePath: string,
  signal: AbortSignal,
  expected: { width: number; height: number },
) {
  if (!bytes.length) throw new Error('CAPTURE_RECORDING_UNFINALIZED');
  const media = probeMetadata(await probeBytes(bytes, ffprobePath, signal, 15_000), bytes.length);
  if (
    media.kind !== 'video' ||
    media.width !== expected.width ||
    media.height !== expected.height ||
    media.durationUs === null ||
    media.durationUs <= 0
  )
    throw new Error('CAPTURE_RECORDING_INVALID');
  return media;
}

export function createPlaywrightCaptureProvider(
  options: PlaywrightCaptureOptions,
): CaptureProvider {
  const now = options.now ?? (() => new Date().toISOString());
  const ffprobePath = options.ffprobePath ?? 'ffprobe';
  const assertionTimeoutMs = Math.max(100, Math.min(options.assertionTimeoutMs ?? 5_000, 30_000));
  const typingDelayMs = Math.max(10, Math.min(options.typingDelayMs ?? 35, 250));
  const scrollDurationMs = Math.max(100, Math.min(options.scrollDurationMs ?? 400, 2_000));

  function requestDigest(request: CaptureRequest): string {
    return createHash('sha256')
      .update(canonicalJson(JSON.parse(JSON.stringify(request)) as JsonObject))
      .digest('hex');
  }

  async function screenshotEvidence(
    page: Page,
    request: CaptureRequest,
    context: OperationContext,
    step: CaptureStep,
    index: number,
    suffix: 'verified' | 'failed',
  ): Promise<ArtifactManifest> {
    const filename = `step-${String(index + 1).padStart(3, '0')}-${step.id}-${suffix}.png`;
    const path = resolve(context.outputDirectory, filename);
    const bytes = await page.screenshot({ path, fullPage: false, type: 'png' });
    const evidenceId = createHash('sha256')
      .update(`${context.attemptId}:${step.id}:${index}:${suffix}`)
      .digest('hex')
      .slice(0, 24);
    return artifactManifestSchema.parse({
      schemaVersion: 1,
      id: `capture_evidence_${evidenceId}`,
      createdAt: now(),
      workspaceId: options.workspaceId,
      jobId: context.jobId,
      kind: 'image',
      mimeType: 'image/png',
      storage: {
        kind: 'local',
        path: `work/capture/${context.attemptId}/${filename}`,
      },
      digest: createHash('sha256').update(bytes).digest('hex'),
      sizeBytes: bytes.length,
      media: {
        durationUs: null,
        width: request.viewport.width,
        height: request.viewport.height,
        frameRate: null,
        videoCodec: null,
        audioCodec: null,
        sampleRate: null,
        channels: null,
      },
      provenance: {
        stageId: `capture_${request.sceneId}`,
        attemptId: context.attemptId,
        inputDigests: [requestDigest(request)],
        provider: { id: 'playwright', version: '1.65.1' },
        settingsDigest: options.settingsDigest,
        templateDigest: null,
      },
    });
  }

  async function verifyAssertions(page: Page, step: CaptureStep): Promise<void> {
    for (const expected of step.expected) {
      if (expected.kind === 'visible') {
        await locate(page, expected.locator).waitFor({
          state: 'visible',
          timeout: assertionTimeoutMs,
        });
      } else if (expected.kind === 'text') {
        await locate(page, expected.locator)
          .filter({ hasText: expected.text })
          .waitFor({ state: 'visible', timeout: assertionTimeoutMs });
      } else {
        if (!targetAllowed(expected.url, options.allowedOrigins))
          throw new Error('CAPTURE_EXPECTED_URL_DENIED');
        await page.waitForURL(expected.url, { timeout: assertionTimeoutMs });
      }
    }
    const authentication = await pageAuthentication(page);
    if (authentication.length) throw new Error(authentication[0]!.code);
  }

  async function executeSteps(
    page: Page,
    request: CaptureRequest,
    context: OperationContext,
    captureStarted: bigint,
  ) {
    const evidence: ArtifactManifest[] = [];
    const actions: Array<{
      stepId: string;
      range: { startUs: number; endUs: number };
      focus: FocusRegion | null;
      verified: boolean;
      presentation: {
        interaction: CaptureStep['action'];
        cursor: { x: number; y: number } | null;
        click: boolean;
        checkpointArtifactId: string;
      };
    }> = [];
    const elapsedUs = () => Number((process.hrtime.bigint() - captureStarted) / 1_000n);
    for (const [index, step] of request.steps.entries()) {
      context.signal.throwIfAborted();
      const startUs = elapsedUs();
      let focus: FocusRegion | null = null;
      let phase: 'action' | 'assertion' = 'action';
      try {
        if (step.action === 'navigate') {
          if (!targetAllowed(step.url, options.allowedOrigins))
            throw new Error('CAPTURE_NAVIGATION_DENIED');
          await page.goto(step.url, { waitUntil: 'domcontentloaded', timeout: assertionTimeoutMs });
        } else if (step.action === 'observe') {
          // Assertions below are the observable action for this step.
        } else {
          const locator = locate(page, step.locator);
          await locator.waitFor({ state: 'visible', timeout: assertionTimeoutMs });
          if (step.action === 'scroll') {
            await locator.evaluate((element) =>
              element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' }),
            );
            await page.waitForTimeout(scrollDurationMs);
            focus = normalizeFocus(await locator.boundingBox(), request.viewport);
          } else {
            focus = normalizeFocus(await locator.boundingBox(), request.viewport);
            if (step.action === 'click') await locator.click({ timeout: assertionTimeoutMs });
            else {
              await locator.fill('', { timeout: assertionTimeoutMs });
              if (step.value)
                await locator.pressSequentially(step.value, {
                  delay: typingDelayMs,
                  timeout: assertionTimeoutMs,
                });
            }
          }
        }
        phase = 'assertion';
        await verifyAssertions(page, step);
        if (step.dwellUs > 0) await page.waitForTimeout(Math.ceil(step.dwellUs / 1_000));
        const screenshot = await screenshotEvidence(
          page,
          request,
          context,
          step,
          index,
          'verified',
        );
        evidence.push(screenshot);
        actions.push({
          stepId: step.id,
          range: { startUs, endUs: Math.max(startUs + 1, elapsedUs()) },
          focus,
          verified: true,
          presentation: {
            interaction: step.action,
            cursor: cursorFor(focus),
            click: step.action === 'click',
            checkpointArtifactId: screenshot.id,
          },
        });
      } catch (cause) {
        const failedEvidence: ArtifactManifest[] = [];
        try {
          failedEvidence.push(
            await screenshotEvidence(page, request, context, step, index, 'failed'),
          );
        } catch {
          // The original action/assertion failure remains authoritative if the page is unavailable.
        }
        throw new CaptureStepError(
          phase === 'assertion' ? 'CAPTURE_STEP_ASSERTION_FAILED' : 'CAPTURE_STEP_ACTION_FAILED',
          step.id,
          failedEvidence,
          cause,
        );
      }
    }
    return { evidence, actions };
  }

  async function acquireFixture(
    request: CaptureRequest,
    context: OperationContext,
  ): Promise<ResourceLease | null> {
    if (!hasMutation(request) || request.setupRecipeId === null) return null;
    const coordinator = options.resourceCoordinator;
    if (!coordinator || !options.reconcileFixture)
      throw new Error('CAPTURE_FIXTURE_POLICY_MISSING');
    const lease = await coordinator.acquireResource(
      request.setupRecipeId,
      context.attemptId,
      context.deadlineAt,
    );
    if (!lease) throw new Error('CAPTURE_FIXTURE_BUSY');
    return lease;
  }

  async function readiness(): Promise<ProviderReadiness> {
    const diagnostics: Diagnostic[] = [];
    try {
      const playwright = await loadPlaywright();
      const executable =
        options.executablePath ?? (await browserType(playwright, options.browser)).executablePath();
      await stat(executable);
    } catch {
      diagnostics.push(
        diagnostic(
          'PLAYWRIGHT_BROWSER_MISSING',
          'Install the pinned Playwright browser bundle selected for capture.',
        ),
      );
    }
    if (!(await probeExecutable(ffprobePath)))
      diagnostics.push(
        diagnostic('FFPROBE_MISSING', 'Install FFprobe to validate finalized capture media.'),
      );
    return { ready: diagnostics.length === 0, diagnostics };
  }

  async function open(
    request: CaptureRequest,
    context: OperationContext,
    recordVideo: boolean,
  ): Promise<{ browser: Browser; page: Page; diagnostics: Diagnostic[] }> {
    const diagnostics = validateRequest(request, options);
    const session = await sessionState(options.privateSessionDirectory, request.sessionRef, now());
    diagnostics.push(...session.diagnostics);
    if (diagnostics.length)
      throw Object.assign(new Error('CAPTURE_PREFLIGHT_FAILED'), { diagnostics });
    context.signal.throwIfAborted();
    const playwright = await loadPlaywright();
    const type = await browserType(playwright, options.browser);
    const browser = await type.launch({
      headless: options.headless ?? true,
      ...(options.executablePath ? { executablePath: options.executablePath } : {}),
    });
    try {
      const browserContext = await browser.newContext({
        viewport: request.viewport,
        ...(session.state === undefined ? {} : { storageState: session.state }),
        ...(recordVideo
          ? {
              recordVideo: {
                dir: context.outputDirectory,
                size: request.viewport,
              },
            }
          : {}),
      });
      if (request.maskRegions.length)
        await browserContext.addInitScript(
          (regions) => {
            const install = () => {
              for (const [index, region] of regions.entries()) {
                const mask = document.createElement('div');
                mask.dataset.tutorialxMask = String(index);
                mask.setAttribute('aria-hidden', 'true');
                Object.assign(mask.style, {
                  position: 'fixed',
                  left: `${region.x * 100}%`,
                  top: `${region.y * 100}%`,
                  width: `${region.width * 100}%`,
                  height: `${region.height * 100}%`,
                  background: '#111',
                  pointerEvents: 'none',
                  zIndex: '2147483647',
                });
                document.documentElement.append(mask);
              }
            };
            if (document.readyState === 'loading')
              document.addEventListener('DOMContentLoaded', install, { once: true });
            else install();
          },
          request.maskRegions.map((region) => ({ ...region })),
        );
      const page = await browserContext.newPage();
      await page.goto(request.target, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      diagnostics.push(...(await pageAuthentication(page)));
      return { browser, page, diagnostics };
    } catch (error) {
      await browser.close();
      throw error;
    }
  }

  return {
    descriptor: {
      id: 'playwright',
      kind: 'capture',
      version: '1.65.1',
      contractVersion: 1,
      configurationSchema: { type: 'object', additionalProperties: false },
      capabilities: {
        features: [
          'isolated-context',
          'record-video',
          'private-session-ref',
          'explicit-viewport',
          'verified-actions',
          'screenshot-evidence',
          'focus-coordinates',
          'natural-pacing',
          'scene-checkpoints',
          'fixture-resource-locks',
          'fixture-reconciliation',
          'mask-regions',
        ],
        languages: [],
        formats: ['video/webm'],
        modalities: ['video', 'image'],
      },
      runtime: {
        platforms: ['darwin', 'linux', 'win32'],
        dependencies: [
          { id: 'playwright', versionRange: '1.65.1', optional: false },
          { id: 'ffprobe', versionRange: '5+', optional: false },
        ],
        memoryMiB: 512,
        gpu: false,
      },
      execution: {
        location: 'local',
        maxDurationMs: 30 * 60 * 1000,
        cancellation: 'cooperative',
        sideEffect: 'reconcilable',
        idempotency: 'reconcilable',
        permissions: ['browser', 'network', 'credentials', 'read-assets', 'write-work'],
      },
      pricing: 'free',
    },
    validateConfiguration: (configuration) => ({
      ready: Object.keys(configuration).length === 0,
      diagnostics:
        Object.keys(configuration).length === 0
          ? []
          : [
              diagnostic(
                'CAPTURE_CONFIG_INVALID',
                'Playwright capture accepts no provider config.',
              ),
            ],
    }),
    readiness,
    estimate: async (_operation, _input, context) => {
      context.signal.throwIfAborted();
      return { expectedUsdMicros: 0, upperBoundUsdMicros: 0, validUntil: null, uncertainty: [] };
    },
    preflight: async (request, context) => {
      const base = await readiness();
      if (!base.ready) return base;
      try {
        const opened = await open(request, context, false);
        await opened.page.context().close();
        await opened.browser.close();
        return { ready: opened.diagnostics.length === 0, diagnostics: opened.diagnostics };
      } catch (error) {
        const diagnostics =
          error && typeof error === 'object' && 'diagnostics' in error
            ? (error.diagnostics as Diagnostic[])
            : [
                diagnostic(
                  'CAPTURE_PREFLIGHT_FAILED',
                  'Browser preflight could not reach the approved feature.',
                  'transient',
                  true,
                ),
              ];
        return { ready: false, diagnostics };
      }
    },
    capture: async (request, context) => {
      await mkdir(context.outputDirectory, { recursive: true });
      let lease: ResourceLease | null = null;
      try {
        lease = await acquireFixture(request, context);
        if (lease && options.reconcileFixture) await options.reconcileFixture(request, context);
        const captureStarted = process.hrtime.bigint();
        const opened = await open(request, context, true);
        if (opened.diagnostics.length) {
          await opened.page.context().close();
          await opened.browser.close();
          throw new Error(opened.diagnostics[0]!.code);
        }
        const video = opened.page.video();
        if (!video) {
          await opened.page.context().close();
          await opened.browser.close();
          throw new Error('CAPTURE_RECORDING_MISSING');
        }
        let executed: Awaited<ReturnType<typeof executeSteps>>;
        try {
          executed = await executeSteps(opened.page, request, context, captureStarted);
          await opened.page.waitForTimeout(250);
        } catch (error) {
          await opened.page.context().close();
          await opened.browser.close();
          throw error;
        }
        await opened.page.context().close();
        await opened.browser.close();
        const path = await video.path();
        const acceptedPath = resolve(context.outputDirectory, 'capture.webm');
        await rename(path, acceptedPath);
        const bytes = await readFile(acceptedPath);
        const media = await probeFinalizedCapture(
          bytes,
          ffprobePath,
          context.signal,
          request.viewport,
        );
        const contentDigest = createHash('sha256').update(bytes).digest('hex');
        const artifact = artifactManifestSchema.parse({
          schemaVersion: 1,
          id: `capture_${context.attemptId}`,
          createdAt: now(),
          workspaceId: options.workspaceId,
          jobId: context.jobId,
          kind: 'video',
          mimeType: 'video/webm',
          storage: { kind: 'local', path: `work/capture/${context.attemptId}/capture.webm` },
          digest: contentDigest,
          sizeBytes: bytes.length,
          media: {
            durationUs: media.durationUs,
            width: media.width,
            height: media.height,
            frameRate: media.frameRate,
            videoCodec: media.codecs[0] ?? 'unknown',
            audioCodec: null,
            sampleRate: null,
            channels: null,
          },
          provenance: {
            stageId: `capture_${request.sceneId}`,
            attemptId: context.attemptId,
            inputDigests: [requestDigest(request)],
            provider: { id: 'playwright', version: '1.65.1' },
            settingsDigest: options.settingsDigest,
            templateDigest: null,
          },
        });
        return captureResultSchema.parse({
          recording: artifact,
          evidence: executed.evidence,
          actions: executed.actions,
        });
      } finally {
        if (lease && options.resourceCoordinator)
          await options.resourceCoordinator.releaseResource(lease);
      }
    },
  };
}
