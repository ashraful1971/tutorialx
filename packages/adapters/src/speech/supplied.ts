import { createHash } from 'node:crypto';
import { mkdir, open, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import {
  artifactManifestSchema,
  canonicalJson,
  digestSchema,
  idSchema,
  type JsonObject,
  type OperationContext,
  type ProviderDescriptor,
  type ProviderReadiness,
  timestampSchema,
  type VoiceProvider,
  voiceResultSchema,
} from '@tutorialx/contracts';
import { waveMetadata } from '../research/media.js';
import { normalizeProviderWordTimings, type ProviderWordTiming } from './timing.js';

export interface SuppliedNarrationSegment {
  path: string;
  text: string;
  language: string;
  timings?: readonly ProviderWordTiming[];
}

export interface SuppliedNarrationOptions {
  workspaceId: string;
  settingsDigest: string;
  segments: Readonly<Record<string, SuppliedNarrationSegment>>;
  now?(): string;
}

interface SuppliedNarrationConfiguration {
  maxBytes: number;
}

const version = '1.0.0';

function configuration(value: JsonObject): SuppliedNarrationConfiguration | null {
  if (
    Object.keys(value).some((key) => key !== 'maxBytes') ||
    !Number.isSafeInteger(value.maxBytes) ||
    Number(value.maxBytes) < 45 ||
    Number(value.maxBytes) > 500 * 1024 * 1024
  )
    return null;
  return { maxBytes: Number(value.maxBytes) };
}

function descriptor(languages: readonly string[]): ProviderDescriptor & { kind: 'voice' } {
  return {
    id: 'supplied-narration',
    kind: 'voice',
    version,
    contractVersion: 1,
    configurationSchema: {
      type: 'object',
      properties: { maxBytes: { type: 'integer', minimum: 45, maximum: 524_288_000 } },
      required: ['maxBytes'],
      additionalProperties: false,
    },
    capabilities: {
      languages: [...languages],
      features: ['timing:optional-native'],
      formats: ['audio/wav'],
      modalities: ['audio'],
    },
    runtime: {
      platforms: ['darwin', 'linux', 'win32'],
      dependencies: [],
      memoryMiB: 64,
      gpu: false,
    },
    execution: {
      location: 'local',
      maxDurationMs: 30_000,
      cancellation: 'cooperative',
      sideEffect: 'pure',
      idempotency: 'none',
      permissions: ['read-assets', 'write-work'],
    },
    pricing: 'free',
  };
}

function checkContext(context: OperationContext) {
  context.signal.throwIfAborted();
  timestampSchema.parse(context.deadlineAt);
  if (Date.parse(context.deadlineAt) <= Date.now())
    throw new Error('SUPPLIED_NARRATION_DEADLINE_EXCEEDED');
  idSchema.parse(context.operationId);
  idSchema.parse(context.jobId);
  idSchema.parse(context.attemptId);
}

async function readSegment(
  segment: SuppliedNarrationSegment,
  maximum: number,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const file = await open(segment.path, 'r');
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size <= 44 || stat.size > maximum)
      throw new Error('SUPPLIED_NARRATION_FILE_INVALID');
    const bytes = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < bytes.length) {
      signal?.throwIfAborted();
      const read = await file.read(bytes, offset, bytes.length - offset, offset);
      if (read.bytesRead === 0) break;
      offset += read.bytesRead;
    }
    if (offset !== bytes.length) throw new Error('SUPPLIED_NARRATION_FILE_INCOMPLETE');
    const measured = waveMetadata(bytes);
    if (!measured || measured.kind !== 'audio' || measured.durationUs === null)
      throw new Error('SUPPLIED_NARRATION_FORMAT_UNSUPPORTED');
    return { bytes, measured };
  } finally {
    await file.close();
  }
}

export function createSuppliedNarrationProvider(
  configValue: JsonObject,
  options: SuppliedNarrationOptions,
): VoiceProvider {
  const config = configuration(configValue);
  if (!config) throw new Error('Invalid supplied-narration configuration.');
  idSchema.parse(options.workspaceId);
  digestSchema.parse(options.settingsDigest);
  const entries = Object.entries(options.segments);
  if (entries.length === 0 || entries.length > 10_000)
    throw new Error('SUPPLIED_NARRATION_SEGMENTS_INVALID');
  for (const [sceneId, segment] of entries) {
    idSchema.parse(sceneId);
    if (!segment.path || !segment.text || segment.text.length > 20_000)
      throw new Error('SUPPLIED_NARRATION_SEGMENT_INVALID');
  }
  const languages = [...new Set(entries.map(([, segment]) => segment.language))];
  const providerDescriptor = descriptor(languages);
  const now = options.now ?? (() => new Date().toISOString());
  const validateConfiguration = (candidate: JsonObject): ProviderReadiness => ({
    ready: configuration(candidate) !== null,
    diagnostics:
      configuration(candidate) === null
        ? [
            {
              code: 'SUPPLIED_NARRATION_CONFIG_INVALID',
              message: 'Supplied-narration configuration is malformed or contains unknown fields.',
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
      for (const [, segment] of entries) {
        try {
          await readSegment(segment, config.maxBytes);
        } catch {
          return {
            ready: false,
            diagnostics: [
              {
                code: 'SUPPLIED_NARRATION_UNAVAILABLE',
                message:
                  'A supplied narration segment is missing, too large, or not valid WAV audio.',
                classification: 'permanent',
                retryable: false,
              },
            ],
          };
        }
      }
      return { ready: true, diagnostics: [] };
    },
    voices: async (context) => {
      checkContext(context);
      return languages.map((language) => ({
        id: `supplied-${language.toLowerCase()}`,
        name: `Supplied narration (${language})`,
        language,
        controls: [],
      }));
    },
    estimate: async (_operation, _input, context) => {
      checkContext(context);
      return { expectedUsdMicros: 0, upperBoundUsdMicros: 0, validUntil: null, uncertainty: [] };
    },
    synthesize: async (request, context) => {
      checkContext(context);
      const sceneId = idSchema.parse(request.sceneId);
      const segment = options.segments[sceneId];
      if (!segment) throw new Error('SUPPLIED_NARRATION_SCENE_MISSING');
      if (
        request.text !== segment.text ||
        request.language !== segment.language ||
        request.voiceId !== `supplied-${segment.language.toLowerCase()}` ||
        request.pace !== 1 ||
        request.tone !== '' ||
        Object.keys(request.pronunciations).length !== 0
      )
        throw new Error('SUPPLIED_NARRATION_REQUEST_MISMATCH');
      const { bytes, measured } = await readSegment(segment, config.maxBytes, context.signal);
      checkContext(context);
      const words = segment.timings
        ? normalizeProviderWordTimings(segment.timings, measured.durationUs!)
        : null;
      await mkdir(context.outputDirectory, { recursive: true });
      const filename = `${context.operationId}.wav`;
      const destination = join(context.outputDirectory, filename);
      const output = await open(destination, 'wx');
      try {
        await output.writeFile(bytes, { signal: context.signal });
        await output.close();
        const sourceDigest = createHash('sha256').update(bytes).digest('hex');
        const requestDigest = createHash('sha256')
          .update(canonicalJson(JSON.parse(JSON.stringify(request)) as JsonObject))
          .digest('hex');
        return voiceResultSchema.parse({
          audio: artifactManifestSchema.parse({
            schemaVersion: 1,
            id: context.operationId,
            createdAt: now(),
            workspaceId: options.workspaceId,
            jobId: context.jobId,
            kind: 'audio',
            mimeType: 'audio/wav',
            storage: { kind: 'local', path: filename },
            digest: sourceDigest,
            sizeBytes: bytes.length,
            media: {
              durationUs: measured.durationUs,
              width: null,
              height: null,
              frameRate: null,
              videoCodec: null,
              audioCodec: measured.codecs[0] ?? 'pcm_s16le',
              sampleRate: measured.sampleRate,
              channels: measured.channels,
            },
            provenance: {
              stageId: `voice_${sceneId}`,
              attemptId: context.attemptId,
              inputDigests: [sourceDigest, requestDigest],
              provider: { id: providerDescriptor.id, version },
              settingsDigest: options.settingsDigest,
              templateDigest: null,
            },
          }),
          words,
          providerRequestId: null,
          actualUsdMicros: 0,
        });
      } catch (error) {
        await output.close();
        await unlink(destination).catch(() => undefined);
        throw error;
      }
    },
  };
}
