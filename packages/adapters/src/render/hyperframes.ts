import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  copyFile,
  link,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  stat,
  unlink,
} from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import {
  artifactManifestSchema,
  canonicalJson,
  type Diagnostic,
  type JsonObject,
  type OperationContext,
  type ProviderDescriptor,
  type ProviderReadiness,
  type RendererProvider,
  type RenderRequest,
  renderResultSchema,
} from '@tutorialx/contracts';

export const HYPERFRAMES_VERSION = '0.9.70';

export interface ProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface ProcessRunner {
  run(
    executable: string,
    args: readonly string[],
    options: { cwd?: string; signal: AbortSignal; maxOutputBytes: number },
  ): Promise<ProcessResult>;
}

export interface HyperframesTemplate {
  directory: string;
  requiredFiles?: readonly string[];
  requiredFonts?: readonly string[];
  assets?: Readonly<Record<string, string>>;
}

export interface HyperframesOptions {
  workspaceId: string;
  settingsDigest: string;
  artifactRoot: string;
  templates: Readonly<Record<string, HyperframesTemplate>>;
  command?: { executable: string; prefixArgs?: readonly string[] };
  ffprobePath?: string;
  runner?: ProcessRunner;
  maxOutputBytes?: number;
  maxDiagnosticBytes?: number;
  now?(): string;
}

interface Config {
  fps: number;
  quality: 'draft' | 'standard' | 'high';
  maxOutputBytes: number;
}

const providerVersion = '1.0.0';

function parseConfig(value: JsonObject): Config | null {
  if (Object.keys(value).some((key) => !['fps', 'quality', 'maxOutputBytes'].includes(key)))
    return null;
  const fps = value.fps;
  const quality = value.quality;
  const maxOutputBytes = value.maxOutputBytes;
  if (
    !Number.isSafeInteger(fps) ||
    Number(fps) < 1 ||
    Number(fps) > 120 ||
    !['draft', 'standard', 'high'].includes(String(quality)) ||
    !Number.isSafeInteger(maxOutputBytes) ||
    Number(maxOutputBytes) < 1
  )
    return null;
  return {
    fps: Number(fps),
    quality: quality as Config['quality'],
    maxOutputBytes: Number(maxOutputBytes),
  };
}

function descriptor(): ProviderDescriptor & { kind: 'renderer' } {
  return {
    id: 'hyperframes',
    kind: 'renderer',
    version: providerVersion,
    contractVersion: 1,
    configurationSchema: {
      type: 'object',
      properties: {
        fps: { type: 'integer', minimum: 1, maximum: 120 },
        quality: { enum: ['draft', 'standard', 'high'] },
        maxOutputBytes: { type: 'integer', minimum: 1 },
      },
      required: ['fps', 'quality', 'maxOutputBytes'],
      additionalProperties: false,
    },
    capabilities: {
      features: ['preflight:json', 'asset-staging', 'font-staging', 'atomic-output'],
      languages: [],
      formats: ['video/mp4'],
      modalities: ['video'],
    },
    runtime: {
      platforms: ['darwin', 'linux', 'win32'],
      dependencies: [
        { id: 'hyperframes', versionRange: `=${HYPERFRAMES_VERSION}`, optional: false },
        { id: 'ffprobe', versionRange: '>=6', optional: false },
      ],
      memoryMiB: 4096,
      gpu: false,
    },
    execution: {
      location: 'local',
      maxDurationMs: 900_000,
      cancellation: 'best-effort',
      sideEffect: 'idempotent',
      idempotency: 'supported',
      permissions: ['read-assets', 'write-work', 'subprocess', 'browser', 'network'],
    },
    pricing: 'free',
  };
}

function failure(code: string, message: string): ProviderReadiness {
  return {
    ready: false,
    diagnostics: [{ code, message, classification: 'permanent', retryable: false }],
  };
}

function deadline(context: OperationContext) {
  context.signal.throwIfAborted();
  if (Date.parse(context.deadlineAt) <= Date.now())
    throw new Error('HYPERFRAMES_DEADLINE_EXCEEDED');
}

function operationSignal(context: OperationContext) {
  deadline(context);
  const remaining = Date.parse(context.deadlineAt) - Date.now();
  return AbortSignal.any([
    context.signal,
    AbortSignal.timeout(Math.min(2_147_483_647, Math.max(1, remaining))),
  ]);
}

function contained(root: string, candidate: string) {
  const path = resolve(root, candidate);
  const rel = relative(resolve(root), path);
  if (rel === '..' || rel.startsWith(`..${sep}`) || rel.includes(`..${sep}`))
    throw new Error('HYPERFRAMES_PATH_ESCAPE');
  return path;
}

async function regular(path: string, code: string) {
  let info;
  try {
    info = await lstat(path);
  } catch {
    throw new Error(code);
  }
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(code);
}

async function copyTree(source: string, destination: string): Promise<void> {
  const info = await lstat(source);
  if (info.isSymbolicLink()) throw new Error('HYPERFRAMES_TEMPLATE_SYMLINK');
  if (info.isDirectory()) {
    await mkdir(destination, { recursive: true, mode: 0o700 });
    const entries = (await readdir(source)).filter((name) => name !== '.hyperframes').sort();
    for (const entry of entries) await copyTree(join(source, entry), join(destination, entry));
    return;
  }
  if (!info.isFile()) throw new Error('HYPERFRAMES_TEMPLATE_UNSUPPORTED_FILE');
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  const output = await open(destination, 'wx', 0o600);
  await output.close();
  await copyFile(source, destination);
}

async function fileDigest(path: string) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest('hex');
}

async function treeDigest(root: string, current = root): Promise<string> {
  const digest = createHash('sha256');
  for (const name of (await readdir(current)).sort()) {
    const path = join(current, name);
    const info = await lstat(path);
    if (info.isSymbolicLink()) throw new Error('HYPERFRAMES_STAGE_SYMLINK');
    const relativePath = relative(root, path).split(sep).join('/');
    digest.update(relativePath).update('\0');
    digest.update(info.isDirectory() ? await treeDigest(root, path) : await fileDigest(path));
    digest.update('\0');
  }
  return digest.digest('hex');
}

function defaultRunner(): ProcessRunner {
  return {
    run(executable, args, options) {
      return new Promise((resolveResult, reject) => {
        const child = spawn(executable, [...args], {
          cwd: options.cwd,
          stdio: ['ignore', 'pipe', 'pipe'],
          signal: options.signal,
          env: { ...process.env, NO_COLOR: '1' },
        });
        let stdout = '';
        let stderr = '';
        let size = 0;
        const append = (target: 'stdout' | 'stderr', chunk: Buffer) => {
          size += chunk.byteLength;
          if (size > options.maxOutputBytes) {
            child.kill('SIGKILL');
            reject(new Error('HYPERFRAMES_DIAGNOSTIC_LIMIT_EXCEEDED'));
            return;
          }
          if (target === 'stdout') stdout += chunk.toString('utf8');
          else stderr += chunk.toString('utf8');
        };
        child.stdout.on('data', (chunk: Buffer) => append('stdout', chunk));
        child.stderr.on('data', (chunk: Buffer) => append('stderr', chunk));
        child.once('error', reject);
        child.once('close', (code) => resolveResult({ exitCode: code ?? -1, stdout, stderr }));
      });
    },
  };
}

function findings(report: unknown): Diagnostic[] {
  if (!report || typeof report !== 'object') throw new Error('HYPERFRAMES_CHECK_INVALID_JSON');
  const root = report as Record<string, unknown>;
  const diagnostics: Diagnostic[] = [];
  for (const section of ['lint', 'runtime', 'layout', 'motion', 'contrast', 'craft', 'audio']) {
    const value = root[section];
    if (!value || typeof value !== 'object') continue;
    const list = (value as Record<string, unknown>).findings;
    if (!Array.isArray(list)) continue;
    for (const item of list.slice(0, 100 - diagnostics.length)) {
      if (!item || typeof item !== 'object') continue;
      const record = item as Record<string, unknown>;
      const severity = String(record.severity ?? 'error');
      diagnostics.push({
        code: `HYPERFRAMES_${String(record.code ?? section)
          .replace(/[^a-zA-Z0-9]+/g, '_')
          .toUpperCase()}`.slice(0, 100),
        message: String(record.message ?? `${section} check reported an issue`).slice(0, 4000),
        classification: severity === 'error' ? 'permanent' : 'policy',
        retryable: false,
      });
    }
  }
  return diagnostics;
}

async function stage(
  request: RenderRequest,
  context: OperationContext,
  options: HyperframesOptions,
  purpose: 'preflight' | 'render',
) {
  deadline(context);
  const template = options.templates[request.templateId];
  if (!template) throw new Error('HYPERFRAMES_TEMPLATE_MISSING');
  const templateRoot = await realpath(template.directory).catch(() => {
    throw new Error('HYPERFRAMES_TEMPLATE_MISSING');
  });
  for (const file of template.requiredFiles ?? [])
    await regular(contained(templateRoot, file), 'HYPERFRAMES_ASSET_MISSING');
  for (const font of template.requiredFonts ?? [])
    await regular(contained(templateRoot, font), 'HYPERFRAMES_FONT_MISSING');
  const directory = join(context.outputDirectory, `.hyperframes-${context.attemptId}-${purpose}`);
  await mkdir(context.outputDirectory, { recursive: true, mode: 0o700 });
  await copyTree(templateRoot, directory);
  const byId = new Map(request.assets.map((asset) => [asset.id, asset]));
  const artifactRoot = await realpath(options.artifactRoot).catch(() => {
    throw new Error('HYPERFRAMES_ARTIFACT_ROOT_MISSING');
  });
  for (const [id, target] of Object.entries(template.assets ?? {}).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const asset = byId.get(id);
    if (!asset || asset.storage.kind !== 'local') throw new Error('HYPERFRAMES_ASSET_MISSING');
    const source = await realpath(contained(artifactRoot, asset.storage.path)).catch(() => {
      throw new Error('HYPERFRAMES_ASSET_MISSING');
    });
    contained(artifactRoot, source);
    await regular(source, 'HYPERFRAMES_ASSET_MISSING');
    if ((await fileDigest(source)) !== asset.digest)
      throw new Error('HYPERFRAMES_ASSET_DIGEST_MISMATCH');
    const destination = contained(directory, target);
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    const file = await open(destination, 'wx', 0o600);
    try {
      for await (const chunk of createReadStream(source)) await file.write(chunk);
    } finally {
      await file.close();
    }
  }
  return { directory, digest: await treeDigest(directory) };
}

function command(options: HyperframesOptions) {
  return options.command ?? { executable: 'hyperframes', prefixArgs: [] };
}

async function check(directory: string, context: OperationContext, options: HyperframesOptions) {
  const runner = options.runner ?? defaultRunner();
  const cli = command(options);
  const result = await runner.run(
    cli.executable,
    [...(cli.prefixArgs ?? []), 'check', directory, '--json'],
    {
      signal: operationSignal(context),
      maxOutputBytes: options.maxDiagnosticBytes ?? 4 * 1024 * 1024,
    },
  );
  let report: unknown;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    throw new Error('HYPERFRAMES_CHECK_INVALID_JSON');
  }
  const diagnostics = findings(report);
  const ok = Boolean((report as Record<string, unknown>).ok);
  if (result.exitCode !== 0 || !ok)
    return {
      ready: false,
      diagnostics: diagnostics.length
        ? diagnostics
        : failure('HYPERFRAMES_CHECK_FAILED', 'HyperFrames preflight failed.').diagnostics,
    };
  return { ready: true, diagnostics } satisfies ProviderReadiness;
}

function parseProbe(value: string) {
  const probe = JSON.parse(value) as {
    streams?: Array<Record<string, unknown>>;
    format?: Record<string, unknown>;
  };
  const video = probe.streams?.find((stream) => stream.codec_type === 'video');
  const duration = Number(video?.duration ?? probe.format?.duration);
  const width = Number(video?.width);
  const height = Number(video?.height);
  const [numerator = 0, denominator = 0] = String(video?.avg_frame_rate ?? '')
    .split('/')
    .map(Number);
  const videoCodec = String(video?.codec_name ?? '');
  if (
    !(duration > 0) ||
    !(width > 0) ||
    !(height > 0) ||
    !(numerator > 0) ||
    !(denominator > 0) ||
    !videoCodec
  )
    throw new Error('HYPERFRAMES_OUTPUT_PROBE_FAILED');
  return {
    durationUs: Math.round(duration * 1_000_000),
    width,
    height,
    frameRate: { numerator, denominator },
    videoCodec,
    audioCodec: null,
    sampleRate: null,
    channels: null,
  };
}

export function createHyperframesRenderer(
  configValue: JsonObject,
  options: HyperframesOptions,
): RendererProvider {
  const config = parseConfig(configValue);
  const providerDescriptor = descriptor();
  const runner = options.runner ?? defaultRunner();
  async function available(): Promise<ProviderReadiness> {
    if (!config)
      return failure('HYPERFRAMES_CONFIGURATION_INVALID', 'HyperFrames configuration is invalid.');
    const cli = command(options);
    const result = await runner
      .run(cli.executable, [...(cli.prefixArgs ?? []), '--version'], {
        signal: new AbortController().signal,
        maxOutputBytes: 4096,
      })
      .catch(() => null);
    const reported = result?.stdout.match(/\b(\d+\.\d+\.\d+)\b/)?.[1];
    if (!result || result.exitCode !== 0 || reported !== HYPERFRAMES_VERSION)
      return failure(
        'HYPERFRAMES_VERSION_MISMATCH',
        `HyperFrames ${HYPERFRAMES_VERSION} is required.`,
      );
    return { ready: true, diagnostics: [] };
  }
  return {
    descriptor: providerDescriptor,
    validateConfiguration(value) {
      return parseConfig(value)
        ? { ready: true, diagnostics: [] }
        : failure('HYPERFRAMES_CONFIGURATION_INVALID', 'HyperFrames configuration is invalid.');
    },
    readiness: available,
    async estimate() {
      return { expectedUsdMicros: 0, upperBoundUsdMicros: 0, validUntil: null, uncertainty: [] };
    },
    async preflight(request, context) {
      if (!config)
        return failure(
          'HYPERFRAMES_CONFIGURATION_INVALID',
          'HyperFrames configuration is invalid.',
        );
      const readiness = await available();
      if (!readiness.ready) return readiness;
      try {
        const staged = await stage(request, context, options, 'preflight');
        return await check(staged.directory, context, options);
      } catch (error) {
        const reason = error instanceof Error ? error.message : '';
        return failure(
          /^HYPERFRAMES_[A-Z0-9_]+$/.test(reason) ? reason : 'HYPERFRAMES_PREFLIGHT_FAILED',
          'HyperFrames staging or preflight failed.',
        );
      }
    },
    async render(request, context) {
      if (!config) throw new Error('HYPERFRAMES_CONFIGURATION_INVALID');
      deadline(context);
      if (!(await available()).ready) throw new Error('HYPERFRAMES_VERSION_MISMATCH');
      const staged = await stage(request, context, options, 'render');
      const preflight = await check(staged.directory, context, options);
      if (!preflight.ready) throw new Error('HYPERFRAMES_CHECK_FAILED');
      const cli = command(options);
      const finalName = `${context.operationId}.mp4`;
      const finalPath = join(context.outputDirectory, finalName);
      const partial = join(context.outputDirectory, `.${context.operationId}.partial.mp4`);
      await unlink(partial).catch(() => undefined);
      const rendered = await runner.run(
        cli.executable,
        [
          ...(cli.prefixArgs ?? []),
          'render',
          staged.directory,
          '--output',
          partial,
          '--fps',
          String(config.fps),
          '--quality',
          config.quality,
        ],
        {
          signal: operationSignal(context),
          maxOutputBytes: options.maxDiagnosticBytes ?? 4 * 1024 * 1024,
        },
      );
      if (rendered.exitCode !== 0) {
        await unlink(partial).catch(() => undefined);
        throw new Error('HYPERFRAMES_RENDER_FAILED');
      }
      const info = await stat(partial);
      const maximum = Math.min(
        config.maxOutputBytes,
        options.maxOutputBytes ?? config.maxOutputBytes,
      );
      if (!info.isFile() || info.size < 1 || info.size > maximum) {
        await unlink(partial).catch(() => undefined);
        throw new Error('HYPERFRAMES_OUTPUT_LIMIT_EXCEEDED');
      }
      const probe = await runner.run(
        options.ffprobePath ?? 'ffprobe',
        ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', partial],
        {
          signal: operationSignal(context),
          maxOutputBytes: options.maxDiagnosticBytes ?? 4 * 1024 * 1024,
        },
      );
      if (probe.exitCode !== 0) {
        await unlink(partial).catch(() => undefined);
        throw new Error('HYPERFRAMES_OUTPUT_PROBE_FAILED');
      }
      let media;
      try {
        media = parseProbe(probe.stdout);
      } catch {
        await unlink(partial).catch(() => undefined);
        throw new Error('HYPERFRAMES_OUTPUT_PROBE_FAILED');
      }
      const digest = await fileDigest(partial);
      const result = renderResultSchema.parse({
        video: artifactManifestSchema.parse({
          schemaVersion: 1,
          id: context.operationId,
          createdAt: options.now?.() ?? new Date().toISOString(),
          workspaceId: options.workspaceId,
          jobId: context.jobId,
          kind: 'video',
          mimeType: 'video/mp4',
          storage: { kind: 'local', path: finalName },
          digest,
          sizeBytes: info.size,
          media,
          provenance: {
            stageId: 'render',
            attemptId: context.attemptId,
            inputDigests: [
              ...request.assets.map((asset) => asset.digest),
              createHash('sha256').update(canonicalJson(request.timeline)).digest('hex'),
            ],
            provider: { id: 'hyperframes', version: providerVersion },
            settingsDigest: options.settingsDigest,
            templateDigest: staged.digest,
          },
        }),
        thumbnail: null,
        diagnostics: preflight.diagnostics,
      });
      await link(partial, finalPath);
      await unlink(partial);
      return result;
    },
  };
}
