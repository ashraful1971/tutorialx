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
  type Voice,
  type VoiceProvider,
  type VoiceRequest,
  voiceResultSchema,
} from '@tutorialx/contracts';
import { waveMetadata } from '../research/media.js';

export interface GoogleSpeechTransportResponse {
  status: number;
  body: unknown;
  headers: Readonly<Record<string, string | undefined>>;
}

export interface GoogleSpeechTransport {
  request(
    path: string,
    init: { method: 'GET' | 'POST'; body?: JsonObject },
    signal: AbortSignal,
  ): Promise<GoogleSpeechTransportResponse>;
}

export interface GoogleSpeechOptions {
  workspaceId: string;
  settingsDigest: string;
  accessToken?(): Promise<string>;
  transport?: GoogleSpeechTransport;
  endpoint?: string;
  now?(): string;
}

interface GoogleSpeechConfiguration {
  languages: string[];
  sampleRateHertz: number;
  tonePitches: Record<string, number>;
  usdMicrosPerMillionCharacters: number;
}

const maxAudioBytes = 50 * 1024 * 1024;
const version = '1.0.0';

function configuration(value: JsonObject): GoogleSpeechConfiguration | null {
  const languages = value.languages;
  const sampleRateHertz = value.sampleRateHertz;
  const tonePitches = value.tonePitches;
  const rate = value.usdMicrosPerMillionCharacters;
  if (
    Object.keys(value).some(
      (key) =>
        !['languages', 'sampleRateHertz', 'tonePitches', 'usdMicrosPerMillionCharacters'].includes(
          key,
        ),
    ) ||
    !Array.isArray(languages) ||
    languages.length === 0 ||
    languages.length > 100 ||
    !languages.every(
      (entry) => typeof entry === 'string' && /^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$/.test(entry),
    ) ||
    !Number.isSafeInteger(sampleRateHertz) ||
    Number(sampleRateHertz) < 8_000 ||
    Number(sampleRateHertz) > 48_000 ||
    !tonePitches ||
    Array.isArray(tonePitches) ||
    typeof tonePitches !== 'object' ||
    Object.keys(tonePitches).length > 20 ||
    !Object.entries(tonePitches).every(
      ([name, pitch]) =>
        name.length > 0 &&
        name.length <= 100 &&
        typeof pitch === 'number' &&
        Number.isFinite(pitch) &&
        pitch >= -20 &&
        pitch <= 20,
    ) ||
    !Number.isSafeInteger(rate) ||
    Number(rate) < 0
  )
    return null;
  return {
    languages: [...new Set(languages as string[])],
    sampleRateHertz: Number(sampleRateHertz),
    tonePitches: { ...(tonePitches as Record<string, number>) },
    usdMicrosPerMillionCharacters: Number(rate),
  };
}

function descriptor(config: GoogleSpeechConfiguration): ProviderDescriptor & { kind: 'voice' } {
  return {
    id: 'google-speech',
    kind: 'voice',
    version,
    contractVersion: 1,
    configurationSchema: {
      type: 'object',
      properties: {
        languages: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 100 },
        sampleRateHertz: { type: 'integer', minimum: 8000, maximum: 48000 },
        tonePitches: { type: 'object', additionalProperties: { type: 'number' } },
        usdMicrosPerMillionCharacters: { type: 'integer', minimum: 0 },
      },
      required: ['languages', 'sampleRateHertz', 'tonePitches', 'usdMicrosPerMillionCharacters'],
      additionalProperties: false,
    },
    capabilities: {
      languages: config.languages,
      features: ['pace', 'tone:pitch', 'pronunciation:ssml-sub', 'timing:ssml-marks'],
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
      location: 'remote',
      maxDurationMs: 120_000,
      cancellation: 'cooperative',
      sideEffect: 'uncertain',
      idempotency: 'none',
      permissions: ['network', 'credentials', 'write-work'],
    },
    pricing: 'metered',
  };
}

function diagnostic(code: string, message: string): ProviderReadiness {
  return {
    ready: false,
    diagnostics: [{ code, message, classification: 'permanent', retryable: false }],
  };
}

function xml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const encoded: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&apos;',
    };
    return encoded[character]!;
  });
}

function markedSsml(text: string, pronunciations: Readonly<Record<string, string>>) {
  const words = text.match(/\S+/gu) ?? [];
  const ssml = words
    .map((word, index) => {
      const spoken = pronunciations[word];
      const content =
        spoken === undefined ? xml(word) : `<sub alias="${xml(spoken)}">${xml(word)}</sub>`;
      return `<mark name="w${index}"/>${content}`;
    })
    .join(' ');
  return { words, ssml: `<speak>${ssml}</speak>` };
}

function defaultTransport(options: GoogleSpeechOptions): GoogleSpeechTransport | null {
  if (!options.accessToken) return null;
  const endpoint = (options.endpoint ?? 'https://texttospeech.googleapis.com').replace(/\/$/, '');
  return {
    async request(path, init, signal) {
      const token = await options.accessToken!();
      signal.throwIfAborted();
      const response = await fetch(`${endpoint}${path}`, {
        method: init.method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(init.body ? { 'content-type': 'application/json' } : {}),
        },
        ...(init.body ? { body: JSON.stringify(init.body) } : {}),
        signal,
      });
      const body: unknown = await response.json().catch(() => null);
      return {
        status: response.status,
        body,
        headers: {
          'x-goog-request-id': response.headers.get('x-goog-request-id') ?? undefined,
          'x-request-id': response.headers.get('x-request-id') ?? undefined,
        },
      };
    },
  };
}

function operationSignal(context: OperationContext): AbortSignal {
  timestampSchema.parse(context.deadlineAt);
  const remaining = Date.parse(context.deadlineAt) - Date.now();
  if (remaining <= 0) throw new Error('GOOGLE_SPEECH_DEADLINE_EXCEEDED');
  return AbortSignal.any([context.signal, AbortSignal.timeout(Math.min(remaining, 120_000))]);
}

function googleError(response: GoogleSpeechTransportResponse): Error {
  const message =
    response.body && typeof response.body === 'object' && 'error' in response.body
      ? JSON.stringify(response.body).slice(0, 2_000)
      : 'No structured error was returned.';
  return new Error(`GOOGLE_SPEECH_HTTP_${response.status}: ${message}`);
}

export function createGoogleSpeechProvider(
  configValue: JsonObject,
  options: GoogleSpeechOptions,
): VoiceProvider {
  const config = configuration(configValue);
  if (!config) throw new Error('Invalid Google speech configuration.');
  idSchema.parse(options.workspaceId);
  digestSchema.parse(options.settingsDigest);
  const transport = options.transport ?? defaultTransport(options);
  const now = options.now ?? (() => new Date().toISOString());
  const validateConfiguration = (candidate: JsonObject): ProviderReadiness => ({
    ready: configuration(candidate) !== null,
    diagnostics:
      configuration(candidate) === null
        ? [
            {
              code: 'GOOGLE_SPEECH_CONFIG_INVALID',
              message: 'Google speech configuration is malformed or contains unknown fields.',
              classification: 'permanent',
              retryable: false,
            },
          ]
        : [],
  });
  const listVoices = async (context: OperationContext): Promise<Voice[]> => {
    if (!transport) throw new Error('GOOGLE_SPEECH_CREDENTIAL_MISSING');
    const response = await transport.request(
      '/v1/voices',
      { method: 'GET' },
      operationSignal(context),
    );
    if (response.status < 200 || response.status >= 300) throw googleError(response);
    const body = response.body as { voices?: unknown };
    if (!Array.isArray(body?.voices) || body.voices.length > 10_000)
      throw new Error('GOOGLE_SPEECH_VOICES_INVALID');
    const voices: Voice[] = [];
    for (const value of body.voices) {
      if (!value || typeof value !== 'object') continue;
      const voice = value as { name?: unknown; languageCodes?: unknown };
      if (typeof voice.name !== 'string' || !Array.isArray(voice.languageCodes)) continue;
      for (const language of voice.languageCodes) {
        if (typeof language !== 'string' || !config.languages.includes(language)) continue;
        voices.push({
          id: voice.name,
          name: voice.name,
          language,
          controls: [
            'pace',
            ...Object.keys(config.tonePitches).map((tone) => `tone:${tone}`),
            'pronunciations',
          ],
        });
      }
    }
    return voices;
  };
  return {
    descriptor: descriptor(config),
    validateConfiguration,
    readiness: async () =>
      transport
        ? { ready: true, diagnostics: [] }
        : diagnostic(
            'GOOGLE_SPEECH_CREDENTIAL_MISSING',
            'Configure an access-token supplier for Google Cloud Text-to-Speech.',
          ),
    voices: listVoices,
    estimate: async (_operation, input, context) => {
      operationSignal(context).throwIfAborted();
      const characters = typeof input.text === 'string' ? input.text.length : 0;
      const amount = Math.ceil((characters * config.usdMicrosPerMillionCharacters) / 1_000_000);
      return {
        expectedUsdMicros: amount,
        upperBoundUsdMicros: amount,
        validUntil: null,
        uncertainty: characters ? [] : ['Text length is not available to the estimator.'],
      };
    },
    synthesize: async (request: VoiceRequest, context: OperationContext) => {
      if (!transport) throw new Error('GOOGLE_SPEECH_CREDENTIAL_MISSING');
      idSchema.parse(request.sceneId);
      idSchema.parse(context.operationId);
      idSchema.parse(context.jobId);
      idSchema.parse(context.attemptId);
      if (!request.text || request.text.length > 20_000)
        throw new Error('GOOGLE_SPEECH_TEXT_INVALID');
      if (!config.languages.includes(request.language))
        throw new Error('GOOGLE_SPEECH_LANGUAGE_UNSUPPORTED');
      if (request.pace < 0.25 || request.pace > 2)
        throw new Error('GOOGLE_SPEECH_PACE_UNSUPPORTED');
      const pitch = request.tone === '' ? 0 : config.tonePitches[request.tone];
      if (pitch === undefined) throw new Error('GOOGLE_SPEECH_TONE_UNSUPPORTED');
      if (
        Object.entries(request.pronunciations).some(
          ([written, spoken]) => !written || !spoken || written.length > 200 || spoken.length > 200,
        )
      )
        throw new Error('GOOGLE_SPEECH_PRONUNCIATION_INVALID');
      const marked = markedSsml(request.text, request.pronunciations);
      const response = await transport.request(
        '/v1/text:synthesize',
        {
          method: 'POST',
          body: {
            input: { ssml: marked.ssml },
            voice: { languageCode: request.language, name: request.voiceId },
            audioConfig: {
              audioEncoding: 'LINEAR16',
              sampleRateHertz: config.sampleRateHertz,
              speakingRate: request.pace,
              pitch,
            },
            enableTimePointing: ['SSML_MARK'],
          },
        },
        operationSignal(context),
      );
      if (response.status < 200 || response.status >= 300) throw googleError(response);
      const body = response.body as { audioContent?: unknown; timepoints?: unknown };
      if (
        typeof body.audioContent !== 'string' ||
        !/^[a-zA-Z0-9+/]*={0,2}$/.test(body.audioContent)
      )
        throw new Error('GOOGLE_SPEECH_AUDIO_INVALID');
      const bytes = Buffer.from(body.audioContent, 'base64');
      if (!bytes.length || bytes.length > maxAudioBytes)
        throw new Error('GOOGLE_SPEECH_AUDIO_INVALID');
      const measured = waveMetadata(bytes);
      if (!measured || measured.kind !== 'audio' || measured.durationUs === null)
        throw new Error('GOOGLE_SPEECH_AUDIO_INVALID');
      const points = Array.isArray(body.timepoints)
        ? body.timepoints
            .map((value) => value as { markName?: unknown; timeSeconds?: unknown })
            .filter(
              (value) =>
                typeof value.markName === 'string' &&
                /^w\d+$/.test(value.markName) &&
                typeof value.timeSeconds === 'number' &&
                Number.isFinite(value.timeSeconds) &&
                value.timeSeconds >= 0,
            )
            .map((value) => ({
              index: Number((value.markName as string).slice(1)),
              startUs: Math.round(Number(value.timeSeconds) * 1_000_000),
            }))
            .sort((left, right) => left.index - right.index)
        : [];
      const words =
        points.length === marked.words.length &&
        points.every((point, index) => point.index === index)
          ? points.map((point, index) => ({
              text: marked.words[index]!,
              range: {
                startUs: point.startUs,
                endUs: Math.max(
                  point.startUs + 1,
                  points[index + 1]?.startUs ?? measured.durationUs!,
                ),
              },
            }))
          : null;
      await mkdir(context.outputDirectory, { recursive: true });
      const filename = `${context.operationId}.wav`;
      const destination = join(context.outputDirectory, filename);
      const output = await open(destination, 'wx');
      try {
        await output.writeFile(bytes, { signal: context.signal });
        await output.close();
        const inputDigest = createHash('sha256')
          .update(canonicalJson(JSON.parse(JSON.stringify(request)) as JsonObject))
          .digest('hex');
        const actualUsdMicros = Math.ceil(
          (request.text.length * config.usdMicrosPerMillionCharacters) / 1_000_000,
        );
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
            digest: createHash('sha256').update(bytes).digest('hex'),
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
              stageId: `voice_${request.sceneId}`,
              attemptId: context.attemptId,
              inputDigests: [inputDigest],
              provider: { id: 'google-speech', version },
              settingsDigest: options.settingsDigest,
              templateDigest: null,
            },
          }),
          words,
          providerRequestId:
            response.headers['x-goog-request-id'] ?? response.headers['x-request-id'] ?? null,
          actualUsdMicros,
        });
      } catch (error) {
        await output.close();
        await unlink(destination).catch(() => undefined);
        throw error;
      }
    },
  };
}
