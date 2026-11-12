import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import {
  type DoctorCheck,
  type DoctorInput,
  type DoctorReport,
  doctorInputSchema,
  doctorReportSchema,
  type JsonObject,
  type ProviderDescriptor,
  type ProviderKind,
  type ProviderReadiness,
  type ProviderRequirements,
  providerDescriptorSchema,
  providerReadinessSchema,
} from '@tutorialx/contracts';
import { inspectProviderCompatibility } from '@tutorialx/core';

export interface DoctorProvider {
  descriptor: ProviderDescriptor;
  validateConfiguration(configuration: JsonObject): ProviderReadiness;
  readiness(): Promise<ProviderReadiness>;
}

export interface DoctorDependency {
  id: string;
  versionRange: string;
  optional: boolean;
}

export type DoctorDependencyProbe = (
  dependency: DoctorDependency,
) => Promise<{ available: boolean; compatible: boolean | null }>;

/** Discover known executables without running programs, downloading models or exposing environment values. */
export function createPathDependencyProbe(
  options: { path?: string; platform?: NodeJS.Platform } = {},
): DoctorDependencyProbe {
  const platform = options.platform ?? process.platform;
  const directories = (options.path ?? process.env.PATH ?? '')
    .split(delimiter)
    .filter(Boolean)
    .slice(0, 256);
  const commands: Record<string, string[]> = {
    node: ['node'],
    python: platform === 'win32' ? ['python', 'python3'] : ['python3', 'python'],
    python3: ['python3'],
    ffmpeg: ['ffmpeg'],
    ffprobe: ['ffprobe'],
  };
  return async ({ id }) => {
    for (const command of commands[id] ?? [])
      for (const directory of directories)
        for (const suffix of platform === 'win32' ? ['.exe', '.cmd', '.bat'] : ['']) {
          try {
            await access(join(directory, `${command}${suffix}`), constants.X_OK);
            if (!(await stat(join(directory, `${command}${suffix}`))).isFile()) continue;
            return { available: true, compatible: null };
          } catch {
            // Continue the bounded PATH search. Arbitrary descriptor commands are never executed.
          }
        }
    return { available: false, compatible: null };
  };
}

async function bounded<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Diagnostic timed out.')), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Preflight only: never dispatch production, authenticate, install dependencies or select a fallback. */
export async function diagnoseRecipe(
  rawInput: DoctorInput,
  options: {
    installedProviders: readonly DoctorProvider[];
    platform?: 'darwin' | 'linux' | 'win32';
    probeDependency?: DoctorDependencyProbe;
    timeoutMs?: number;
  },
): Promise<DoctorReport> {
  const input = doctorInputSchema.parse(rawInput);
  if (options.installedProviders.length > 100)
    throw new Error('Doctor registry exceeds 100 providers.');
  const platform = options.platform ?? process.platform;
  const timeoutMs = options.timeoutMs ?? 5000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000)
    throw new Error('Doctor timeout must be 1–30000 milliseconds.');
  const checks: DoctorCheck[] = [];
  const add = (check: DoctorCheck) => checks.push(check);
  const supportedPlatform = platform === 'darwin' || platform === 'linux' || platform === 'win32';
  add({
    kind: 'runtime',
    id: 'platform',
    status: supportedPlatform ? 'ready' : 'unsupported',
    required: true,
    message: supportedPlatform
      ? `Supported platform: ${platform}.`
      : 'Unsupported worker platform.',
    remedy: supportedPlatform ? '' : 'Use a supported macOS, Linux or Windows worker.',
  });
  const settings = input.settings;
  const needed = new Set<ProviderKind>(['renderer']);
  if (input.captureRequired ?? ['tutorial', 'mixed'].includes(settings.recipe))
    needed.add('capture');
  if (settings.voice.mode === 'synthesize') needed.add('voice');
  if (settings.captions.mode !== 'none' && !input.suppliedCaptionTimings) {
    if (settings.providers.alignment) needed.add('alignment');
    else if (settings.voice.mode !== 'synthesize')
      add({
        kind: 'provider',
        id: 'alignment',
        status: 'missing',
        required: true,
        message: 'Caption timing is required for supplied or absent narration.',
        remedy: 'Supply validated caption timings or configure an alignment provider.',
      });
  }
  if (input.headless) needed.add('agent');
  if (input.generateAssets) needed.add('assets');
  const registry = options.installedProviders.map((provider) => ({
    provider,
    descriptor: providerDescriptorSchema.parse(provider.descriptor),
  }));
  const identities = registry.map(
    ({ descriptor }) => `${descriptor.kind}:${descriptor.id}:${descriptor.version}`,
  );
  if (new Set(identities).size !== identities.length)
    throw new Error('Doctor registry contains duplicate provider versions.');

  const probe = options.probeDependency ?? createPathDependencyProbe();
  const probeCache = new Map<string, Promise<{ available: boolean; compatible: boolean | null }>>();
  for (const kind of ['renderer', 'capture', 'voice', 'alignment', 'agent', 'assets'] as const) {
    if (!needed.has(kind)) {
      add({
        kind: 'provider',
        id: kind,
        status: 'skipped',
        required: false,
        message: `The selected recipe does not require ${kind}.`,
        remedy: '',
      });
      continue;
    }
    const selection = settings.providers[kind];
    if (!selection) {
      add({
        kind: 'provider',
        id: kind,
        status: 'missing',
        required: true,
        message: `No ${kind} provider is configured.`,
        remedy: `Configure an explicit ${kind} provider, or supply the corresponding inputs.`,
      });
      continue;
    }
    const selected = registry.find(
      ({ descriptor }) =>
        descriptor.kind === kind &&
        descriptor.id === selection.id &&
        descriptor.version === selection.version,
    );
    const id = `${kind}:${selection.id}:${selection.version}`;
    if (!selected) {
      add({
        kind: 'provider',
        id,
        status: 'missing',
        required: true,
        message: 'The selected provider version is not installed and wired.',
        remedy: `Install and explicitly register ${selection.id} version ${selection.version} for ${kind}.`,
      });
      continue;
    }
    const requirements: ProviderRequirements = {
      languages: kind === 'voice' || kind === 'alignment' ? [settings.language] : [],
      features: kind === 'alignment' ? ['timing:word'] : [],
      formats:
        kind === 'renderer'
          ? [
              ...new Set(
                settings.variants.flatMap((variant) => [
                  `codec:${variant.codec}`,
                  `container:${variant.container}`,
                ]),
              ),
            ]
          : [],
      modalities: [],
      customScenes: [],
    };
    if (
      kind === 'voice' &&
      settings.captions.mode !== 'none' &&
      !input.suppliedCaptionTimings &&
      !settings.providers.alignment
    )
      requirements.features.push('timing:word');
    const issues = supportedPlatform
      ? inspectProviderCompatibility(selected.descriptor, requirements, {
          platform,
          localOnly: settings.policy.localOnly,
        })
      : [];
    if (issues.length) {
      add({
        kind: 'provider',
        id,
        status: 'unsupported',
        required: true,
        message: issues
          .map((issue) => `${issue.code}: ${issue.requirement}`)
          .join('; ')
          .slice(0, 2000),
        remedy: issues
          .map((issue) => issue.remedy)
          .join(' ')
          .slice(0, 2000),
      });
      continue;
    }
    let configuration: ProviderReadiness;
    try {
      configuration = providerReadinessSchema.parse(
        selected.provider.validateConfiguration(selection.config),
      );
    } catch {
      configuration = { ready: false, diagnostics: [] };
    }
    if (!configuration.ready) {
      add({
        kind: 'provider',
        id,
        status: 'error',
        required: true,
        message: 'Provider configuration validation failed; private details are omitted.',
        remedy:
          'Check the selected provider configuration and credential references without exposing secret values.',
      });
      continue;
    }
    let requiredDependencyMissing = false;
    for (const dependency of selected.descriptor.runtime.dependencies) {
      const key = `${dependency.id}:${dependency.versionRange}`;
      try {
        let result = probeCache.get(key);
        if (!result) {
          result = bounded(
            Promise.resolve().then(() => probe(dependency)),
            timeoutMs,
          );
          probeCache.set(key, result);
        }
        const state = await result;
        const ready = state.available && state.compatible !== false;
        if (!ready && !dependency.optional) requiredDependencyMissing = true;
        add({
          kind: 'dependency',
          id: `${id}:${dependency.id}`,
          required: !dependency.optional,
          status: !state.available
            ? 'missing'
            : state.compatible === false
              ? 'unsupported'
              : 'ready',
          message: `${dependency.id} ${dependency.versionRange}: ${
            !state.available
              ? 'not discovered'
              : state.compatible === null
                ? 'discovered; provider readiness must verify version compatibility'
                : state.compatible
                  ? 'compatible'
                  : 'incompatible version'
          }.`,
          remedy: ready
            ? ''
            : `Install or configure ${dependency.id} ${dependency.versionRange} for ${selection.id}; no installation was attempted.`,
        });
      } catch {
        if (!dependency.optional) requiredDependencyMissing = true;
        add({
          kind: 'dependency',
          id: `${id}:${dependency.id}`,
          status: 'error',
          required: !dependency.optional,
          message: 'Dependency discovery failed or timed out; private details are omitted.',
          remedy: `Inspect ${dependency.id} availability and rerun doctor.`,
        });
      }
    }
    if (requiredDependencyMissing) {
      add({
        kind: 'provider',
        id,
        status: 'missing',
        required: true,
        message: 'A required provider dependency is unavailable.',
        remedy: 'Resolve the required dependency checks above before provider readiness.',
      });
      continue;
    }
    try {
      const readiness = providerReadinessSchema.parse(
        await bounded(
          Promise.resolve().then(() => selected.provider.readiness()),
          timeoutMs,
        ),
      );
      add({
        kind: 'provider',
        id,
        status: readiness.ready ? 'ready' : 'missing',
        required: true,
        message: readiness.ready
          ? 'Selected provider configuration and readiness passed.'
          : `Provider readiness failed${
              readiness.diagnostics.length
                ? ` (${readiness.diagnostics
                    .map((entry) => entry.code)
                    .join(', ')
                    .slice(0, 500)})`
                : ''
            }.`,
        remedy: readiness.ready
          ? ''
          : 'Restore this provider’s documented credentials, model files or service availability, then rerun doctor.',
      });
    } catch {
      add({
        kind: 'provider',
        id,
        status: 'error',
        required: true,
        message: 'Provider readiness failed or timed out; private details are omitted.',
        remedy: 'Inspect this provider’s local configuration and availability, then rerun doctor.',
      });
    }
  }
  return doctorReportSchema.parse({
    schemaVersion: 1,
    recipe: settings.recipe,
    ready: checks.every((check) => !check.required || check.status === 'ready'),
    checks,
    nextActions: [
      ...new Set(
        checks
          .filter((check) => check.required && check.status !== 'ready')
          .map((check) => check.remedy),
      ),
    ].slice(0, 100),
  });
}
