import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, rename, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  artifactManifestSchema,
  type CaptureProvider,
  type CaptureRequest,
  canonicalJson,
  captureResultSchema,
  type Diagnostic,
  type JsonObject,
  type OperationContext,
  type ProviderReadiness,
} from '@tutorialx/contracts';
import type { Browser, BrowserContextOptions, BrowserType, Page } from 'playwright';
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
  now?(): string;
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

function validateRequest(request: CaptureRequest, allowedOrigins: readonly string[]): Diagnostic[] {
  const issues: Diagnostic[] = [];
  let target: URL | null = null;
  try {
    target = new URL(request.target);
  } catch {
    issues.push(diagnostic('CAPTURE_TARGET_INVALID', 'Capture target must be an absolute URL.'));
  }
  if (target && !allowedOrigins.includes(target.origin))
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
  return issues;
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
    const diagnostics = validateRequest(request, options.allowedOrigins);
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
        features: ['isolated-context', 'record-video', 'private-session-ref', 'explicit-viewport'],
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
      const opened = await open(request, context, true);
      if (opened.diagnostics.length) {
        await opened.page.context().close();
        await opened.browser.close();
        throw new Error(opened.diagnostics[0]!.code);
      }
      const video = opened.page.video();
      if (!video) throw new Error('CAPTURE_RECORDING_MISSING');
      await opened.page.waitForTimeout(250);
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
          inputDigests: [
            createHash('sha256')
              .update(canonicalJson(JSON.parse(JSON.stringify(request)) as JsonObject))
              .digest('hex'),
          ],
          provider: { id: 'playwright', version: '1.65.1' },
          settingsDigest: options.settingsDigest,
          templateDigest: null,
        },
      });
      return captureResultSchema.parse({ recording: artifact, evidence: [], actions: [] });
    },
  };
}
