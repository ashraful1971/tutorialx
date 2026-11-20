import { spawn } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import {
  type AlignmentProvider,
  type ArtifactManifest,
  alignmentResultSchema,
  idSchema,
  type JsonObject,
  languageSchema,
  type OperationContext,
  type ProviderDescriptor,
  type ProviderReadiness,
  timestampSchema,
} from '@tutorialx/contracts';

export interface WhisperXCapabilities {
  version: string;
  pythonVersion: string;
  devices: readonly ('cpu' | 'cuda')[];
}

export interface WhisperXWord {
  text: string;
  startSeconds: number | null;
  endSeconds: number | null;
}

export interface WhisperXAlignment {
  transcript: string;
  words: readonly WhisperXWord[];
}

export interface WhisperXRunner {
  capabilities(signal: AbortSignal): Promise<WhisperXCapabilities>;
  align(
    input: {
      audioPath: string;
      language: string;
      model: string;
      device: 'cpu' | 'cuda';
      computeType: 'int8' | 'float16' | 'float32';
    },
    signal: AbortSignal,
  ): Promise<WhisperXAlignment>;
}

export interface WhisperXOptions {
  audioRoot: string;
  pythonPath: string;
  workerPath: string;
  runner?: WhisperXRunner;
  environment?: Readonly<Record<string, string>>;
  now?(): string;
}

interface WhisperXConfiguration {
  languages: string[];
  model: string;
  device: 'cpu' | 'cuda';
  computeType: 'int8' | 'float16' | 'float32';
  maxDurationMs: number;
}

const providerVersion = '1.0.0';
const whisperXVersion = '3.8.6';
const maximumOutputBytes = 10 * 1024 * 1024;

function configuration(value: JsonObject): WhisperXConfiguration | null {
  const languages = value.languages;
  if (
    Object.keys(value).some(
      (key) => !['languages', 'model', 'device', 'computeType', 'maxDurationMs'].includes(key),
    ) ||
    !Array.isArray(languages) ||
    languages.length === 0 ||
    languages.length > 100 ||
    !languages.every((language) => languageSchema.safeParse(language).success) ||
    typeof value.model !== 'string' ||
    value.model.length === 0 ||
    value.model.length > 200 ||
    !['cpu', 'cuda'].includes(String(value.device)) ||
    !['int8', 'float16', 'float32'].includes(String(value.computeType)) ||
    !Number.isSafeInteger(value.maxDurationMs) ||
    Number(value.maxDurationMs) < 1_000 ||
    Number(value.maxDurationMs) > 24 * 60 * 60 * 1_000 ||
    (value.device === 'cpu' && value.computeType === 'float16')
  )
    return null;
  return {
    languages: [...new Set(languages as string[])],
    model: value.model,
    device: value.device as 'cpu' | 'cuda',
    computeType: value.computeType as 'int8' | 'float16' | 'float32',
    maxDurationMs: Number(value.maxDurationMs),
  };
}

function descriptor(config: WhisperXConfiguration): ProviderDescriptor & { kind: 'alignment' } {
  return {
    id: 'whisperx',
    kind: 'alignment',
    version: providerVersion,
    contractVersion: 1,
    configurationSchema: {
      type: 'object',
      properties: {
        languages: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 100 },
        model: { type: 'string', minLength: 1, maxLength: 200 },
        device: { enum: ['cpu', 'cuda'] },
        computeType: { enum: ['int8', 'float16', 'float32'] },
        maxDurationMs: { type: 'integer', minimum: 1000, maximum: 86_400_000 },
      },
      required: ['languages', 'model', 'device', 'computeType', 'maxDurationMs'],
      additionalProperties: false,
    },
    capabilities: {
      languages: config.languages,
      features: [
        'timing:word',
        'transcription',
        'approved-text-comparison',
        `model:${config.model}`,
      ],
      formats: ['audio/wav'],
      modalities: ['audio', 'text'],
    },
    runtime: {
      platforms: ['darwin', 'linux', 'win32'],
      dependencies: [
        { id: 'python', versionRange: '>=3.10 <3.14', optional: false },
        { id: 'whisperx', versionRange: `=${whisperXVersion}`, optional: false },
      ],
      memoryMiB: config.device === 'cpu' ? 4096 : 8192,
      gpu: config.device === 'cuda',
    },
    execution: {
      location: 'local',
      maxDurationMs: config.maxDurationMs,
      cancellation: 'best-effort',
      sideEffect: 'pure',
      idempotency: 'supported',
      permissions: ['read-assets', 'subprocess'],
    },
    pricing: 'free',
  };
}

function subprocessRunner(options: WhisperXOptions): WhisperXRunner {
  const invoke = (command: 'capabilities' | 'align', input: JsonObject, signal: AbortSignal) =>
    new Promise<unknown>((accept, reject) => {
      signal.throwIfAborted();
      const child = spawn(options.pythonPath, ['-I', options.workerPath, command], {
        cwd: dirname(options.workerPath),
        env: {
          ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
          ...(process.env.LANG ? { LANG: process.env.LANG } : {}),
          ...options.environment,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
      const chunks: Buffer[] = [];
      let length = 0;
      let settled = false;
      const finish = (error?: Error, value?: unknown) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', abort);
        error ? reject(error) : accept(value);
      };
      const abort = () => {
        child.kill('SIGKILL');
        finish(signal.reason instanceof Error ? signal.reason : new Error('WHISPERX_CANCELLED'));
      };
      signal.addEventListener('abort', abort, { once: true });
      child.once('error', (error) => finish(error));
      child.stdout.on('data', (chunk: Buffer) => {
        length += chunk.length;
        if (length > maximumOutputBytes) {
          child.kill('SIGKILL');
          finish(new Error('WHISPERX_OUTPUT_TOO_LARGE'));
        } else chunks.push(chunk);
      });
      child.stderr.resume();
      child.once('close', (code) => {
        if (settled) return;
        if (code !== 0) return finish(new Error(`WHISPERX_WORKER_EXIT_${code ?? 'UNKNOWN'}`));
        try {
          finish(undefined, JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown);
        } catch {
          finish(new Error('WHISPERX_OUTPUT_INVALID'));
        }
      });
      child.stdin.end(JSON.stringify(input));
    });
  return {
    capabilities: async (signal) =>
      (await invoke('capabilities', {}, signal)) as WhisperXCapabilities,
    align: async (input, signal) =>
      (await invoke('align', input as unknown as JsonObject, signal)) as WhisperXAlignment,
  };
}

function operationSignal(context: OperationContext, maximumMs: number): AbortSignal {
  timestampSchema.parse(context.deadlineAt);
  const remaining = Date.parse(context.deadlineAt) - Date.now();
  if (remaining <= 0) throw new Error('WHISPERX_DEADLINE_EXCEEDED');
  return AbortSignal.any([context.signal, AbortSignal.timeout(Math.min(remaining, maximumMs))]);
}

async function audioPath(rootValue: string, artifact: ArtifactManifest): Promise<string> {
  if (artifact.kind !== 'audio' || artifact.storage.kind !== 'local')
    throw new Error('WHISPERX_AUDIO_NOT_LOCAL');
  const root = await realpath(rootValue);
  const candidate = await realpath(resolve(root, artifact.storage.path));
  const child = relative(root, candidate);
  if (child.startsWith('..') || isAbsolute(child)) throw new Error('WHISPERX_AUDIO_OUTSIDE_ROOT');
  return candidate;
}

function tokens(value: string): string[] {
  return value.toLocaleLowerCase().match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? [];
}

function deviations(expectedText: string, output: WhisperXAlignment) {
  const expected = tokens(expectedText);
  const observed = tokens(output.transcript);
  const findings: { expected: string; observed: string; range: null }[] = [];
  const length = Math.max(expected.length, observed.length);
  for (let index = 0; index < length; index++) {
    if (expected[index] !== observed[index])
      findings.push({
        expected: expected[index] ?? '',
        observed: observed[index] ?? '',
        range: null,
      });
  }
  for (const word of output.words) {
    if (word.startSeconds === null || word.endSeconds === null)
      findings.push({ expected: word.text, observed: word.text, range: null });
  }
  return findings;
}

function validatedOutput(value: WhisperXAlignment, durationUs: number): WhisperXAlignment {
  if (
    !value ||
    typeof value.transcript !== 'string' ||
    value.transcript.length > 1_000_000 ||
    !Array.isArray(value.words) ||
    value.words.length > 100_000
  )
    throw new Error('WHISPERX_OUTPUT_INVALID');
  let previousEndUs = 0;
  for (const word of value.words) {
    if (!word || typeof word.text !== 'string' || word.text.length === 0 || word.text.length > 500)
      throw new Error('WHISPERX_OUTPUT_INVALID');
    if (word.startSeconds === null || word.endSeconds === null) {
      if (word.startSeconds !== null || word.endSeconds !== null)
        throw new Error('WHISPERX_OUTPUT_INVALID');
      continue;
    }
    if (
      !Number.isFinite(word.startSeconds) ||
      !Number.isFinite(word.endSeconds) ||
      word.startSeconds < 0 ||
      word.endSeconds <= word.startSeconds
    )
      throw new Error('WHISPERX_OUTPUT_INVALID');
    const startUs = Math.round(word.startSeconds * 1_000_000);
    const endUs = Math.round(word.endSeconds * 1_000_000);
    if (startUs < previousEndUs || endUs > durationUs) throw new Error('WHISPERX_OUTPUT_INVALID');
    previousEndUs = endUs;
  }
  return value;
}

export function createWhisperXAlignmentProvider(
  configValue: JsonObject,
  options: WhisperXOptions,
): AlignmentProvider {
  const config = configuration(configValue);
  if (!config) throw new Error('Invalid WhisperX configuration.');
  if (!isAbsolute(options.audioRoot) || !isAbsolute(options.workerPath))
    throw new Error('WhisperX runtime paths must be absolute.');
  const runner = options.runner ?? subprocessRunner(options);
  const providerDescriptor = descriptor(config);
  const now = options.now ?? (() => new Date().toISOString());
  const validateConfiguration = (candidate: JsonObject): ProviderReadiness => ({
    ready: configuration(candidate) !== null,
    diagnostics:
      configuration(candidate) === null
        ? [
            {
              code: 'WHISPERX_CONFIG_INVALID',
              message: 'WhisperX configuration is malformed or contains unknown fields.',
              classification: 'permanent',
              retryable: false,
            },
          ]
        : [],
  });
  return {
    descriptor: providerDescriptor,
    validateConfiguration,
    readiness: async () => {
      try {
        const capabilities = await runner.capabilities(AbortSignal.timeout(5_000));
        if (
          !capabilities ||
          !Array.isArray(capabilities.devices) ||
          capabilities.version !== whisperXVersion ||
          !capabilities.devices.includes(config.device)
        )
          return {
            ready: false,
            diagnostics: [
              {
                code: 'WHISPERX_RUNTIME_INCOMPATIBLE',
                message: `Expected WhisperX ${whisperXVersion} with ${config.device} support.`,
                classification: 'permanent',
                retryable: false,
              },
            ],
          };
        return { ready: true, diagnostics: [] };
      } catch {
        return {
          ready: false,
          diagnostics: [
            {
              code: 'WHISPERX_RUNTIME_UNAVAILABLE',
              message: 'Install the frozen optional WhisperX runtime before selecting alignment.',
              classification: 'permanent',
              retryable: false,
            },
          ],
        };
      }
    },
    estimate: async (_operation, _input, context) => {
      operationSignal(context, config.maxDurationMs).throwIfAborted();
      return {
        expectedUsdMicros: 0,
        upperBoundUsdMicros: 0,
        validUntil: null,
        uncertainty: ['Local runtime duration depends on audio length and available hardware.'],
      };
    },
    align: async (request, context) => {
      idSchema.parse(context.operationId);
      idSchema.parse(context.jobId);
      idSchema.parse(context.attemptId);
      if (!config.languages.includes(request.language))
        throw new Error('WHISPERX_LANGUAGE_UNSUPPORTED');
      if (request.audio.length !== request.scenes.length || request.audio.length === 0)
        throw new Error('WHISPERX_SCENE_AUDIO_MISMATCH');
      const signal = operationSignal(context, config.maxDurationMs);
      const outputs: WhisperXAlignment[] = [];
      for (const [index, artifact] of request.audio.entries()) {
        signal.throwIfAborted();
        const durationUs = artifact.media?.durationUs;
        if (!durationUs) throw new Error('WHISPERX_AUDIO_DURATION_MISSING');
        outputs.push(
          validatedOutput(
            await runner.align(
              {
                audioPath: await audioPath(options.audioRoot, artifact),
                language: request.language,
                model: config.model,
                device: config.device,
                computeType: config.computeType,
              },
              signal,
            ),
            durationUs,
          ),
        );
        if (!request.scenes[index]) throw new Error('WHISPERX_SCENE_AUDIO_MISMATCH');
      }
      let offsetUs = 0;
      const cues = [];
      const allDeviations = [];
      for (const [index, output] of outputs.entries()) {
        const artifact = request.audio[index]!;
        const scene = request.scenes[index]!;
        const durationUs = artifact.media?.durationUs;
        if (!durationUs) throw new Error('WHISPERX_AUDIO_DURATION_MISSING');
        const words = output.words
          .filter((word) => word.startSeconds !== null && word.endSeconds !== null)
          .map((word) => ({
            text: word.text,
            range: {
              startUs: offsetUs + Math.round(word.startSeconds! * 1_000_000),
              endUs: offsetUs + Math.round(word.endSeconds! * 1_000_000),
            },
          }));
        if (words.length > 0)
          cues.push({
            id: `caption_${index + 1}`,
            sceneId: scene.id,
            text: output.transcript,
            range: { startUs: words[0]!.range.startUs, endUs: words.at(-1)!.range.endUs },
            words,
          });
        allDeviations.push(...deviations(scene.narration, output));
        offsetUs += durationUs;
      }
      return alignmentResultSchema.parse({
        captions: {
          schemaVersion: 1,
          id: context.operationId,
          createdAt: now(),
          jobId: context.jobId,
          planRevision: request.planRevision,
          audioArtifactIds: request.audio.map((artifact) => artifact.id),
          language: request.language,
          durationUs: offsetUs,
          cues,
        },
        transcript: outputs.map((output) => output.transcript).join('\n'),
        deviations: allDeviations,
      });
    },
  };
}
