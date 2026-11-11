import { createHash } from 'node:crypto';
import { mkdir, open, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import {
  artifactManifestSchema,
  digestSchema,
  idSchema,
  type JsonObject,
  type OperationContext,
  type ProviderDescriptor,
  type ProviderReadiness,
  timestampSchema,
  type VoiceProvider,
} from '@tutorialx/contracts';

export const recordedVoiceDescriptor: ProviderDescriptor & { kind: 'voice' } = {
  id: 'example-recorded-voice',
  kind: 'voice',
  version: '1.0.0',
  contractVersion: 1,
  configurationSchema: {
    type: 'object',
    properties: { voiceId: { const: 'recorded' }, language: { const: 'en-US' } },
    required: ['voiceId', 'language'],
    additionalProperties: false,
  },
  capabilities: {
    languages: ['en-US'],
    features: [],
    formats: ['audio/wav'],
    modalities: ['audio'],
  },
  runtime: { platforms: ['linux', 'darwin', 'win32'], dependencies: [], memoryMiB: 16, gpu: false },
  execution: {
    location: 'local',
    maxDurationMs: 5000,
    cancellation: 'cooperative',
    sideEffect: 'pure',
    idempotency: 'none',
    permissions: ['read-assets', 'write-work'],
  },
  pricing: 'free',
};

export interface RecordingFixture {
  /** Trusted, explicitly supplied path; never resolved from source-content instructions. */
  path: string;
  text: string;
  workspaceId: string;
  settingsDigest: string;
}

const maximumBytes = 5 * 1024 * 1024;

/** Deliberately supports canonical 44-byte-header, mono, 16-bit, 16 kHz PCM WAV only. */
async function readRecording(path: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const file = await open(path, 'r');
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size <= 44 || stat.size > maximumBytes)
      throw new Error('Recording must be a bounded PCM WAV file.');
    const buffer = Buffer.alloc(maximumBytes + 1);
    let length = 0;
    while (length < buffer.length) {
      signal?.throwIfAborted();
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, length);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    const bytes = buffer.subarray(0, length);
    const dataBytes = bytes.length - 44;
    if (
      bytes.length > maximumBytes ||
      bytes.length <= 44 ||
      dataBytes % 2 !== 0 ||
      bytes.toString('ascii', 0, 4) !== 'RIFF' ||
      bytes.readUInt32LE(4) !== bytes.length - 8 ||
      bytes.toString('ascii', 8, 16) !== 'WAVEfmt ' ||
      bytes.readUInt32LE(16) !== 16 ||
      bytes.readUInt16LE(20) !== 1 ||
      bytes.readUInt16LE(22) !== 1 ||
      bytes.readUInt32LE(24) !== 16000 ||
      bytes.readUInt32LE(28) !== 32000 ||
      bytes.readUInt16LE(32) !== 2 ||
      bytes.readUInt16LE(34) !== 16 ||
      bytes.toString('ascii', 36, 40) !== 'data' ||
      bytes.readUInt32LE(40) !== dataBytes
    )
      throw new Error('Recording format is unsupported or incomplete.');
    return { bytes, durationUs: Math.round((dataBytes / 32000) * 1_000_000) };
  } finally {
    await file.close();
  }
}

/** A complete fixed-phrase adapter, not a general speech synthesizer. */
export function createRecordedVoiceProvider(
  config: JsonObject,
  fixture: RecordingFixture,
): VoiceProvider {
  fixture = { ...fixture };
  idSchema.parse(fixture.workspaceId);
  digestSchema.parse(fixture.settingsDigest);
  if (!fixture.text || fixture.text.length > 20_000)
    throw new Error('A bounded exact transcript is required.');
  const validateConfiguration = (candidate: JsonObject): ProviderReadiness => ({
    ready:
      Object.keys(candidate).length === 2 &&
      candidate.voiceId === 'recorded' &&
      candidate.language === 'en-US',
    diagnostics: [],
  });
  if (!validateConfiguration(config).ready)
    throw new Error('Invalid recorded-voice configuration.');
  const checkOperation = (context: OperationContext) => {
    context.signal.throwIfAborted();
    timestampSchema.parse(context.deadlineAt);
    if (Date.parse(context.deadlineAt) <= Date.now())
      throw new Error('Recorded-voice deadline exceeded.');
  };
  return {
    descriptor: structuredClone(recordedVoiceDescriptor),
    validateConfiguration,
    readiness: async () => {
      try {
        await readRecording(fixture.path);
        return { ready: true, diagnostics: [] };
      } catch {
        return {
          ready: false,
          diagnostics: [
            {
              code: 'RECORDING_UNAVAILABLE',
              message: 'Supply a canonical mono 16-bit 16 kHz PCM WAV recording (maximum 5 MiB).',
              classification: 'permanent',
              retryable: false,
            },
          ],
        };
      }
    },
    voices: async (context) => {
      checkOperation(context);
      return [
        {
          id: 'recorded',
          name: 'Supplied fixed-phrase recording',
          language: 'en-US',
          controls: [],
        },
      ];
    },
    estimate: async (_operation, _input, context) => {
      checkOperation(context);
      return { expectedUsdMicros: 0, upperBoundUsdMicros: 0, validUntil: null, uncertainty: [] };
    },
    synthesize: async (request, context) => {
      checkOperation(context);
      if (
        request.text !== fixture.text ||
        request.language !== 'en-US' ||
        request.voiceId !== 'recorded' ||
        request.pace !== 1 ||
        request.tone !== '' ||
        Object.keys(request.pronunciations).length !== 0
      )
        throw new Error(
          'Only the exact recorded phrase, voice, language, and unchanged delivery are supported.',
        );
      const operationId = idSchema.parse(context.operationId);
      idSchema.parse(request.sceneId);
      idSchema.parse(context.jobId);
      idSchema.parse(context.attemptId);
      const { bytes, durationUs } = await readRecording(fixture.path, context.signal);
      checkOperation(context);
      // The engine supplies a private, contained attempt directory at the trust boundary.
      await mkdir(context.outputDirectory, { recursive: true });
      const relativePath = `${operationId}.wav`;
      const destination = join(context.outputDirectory, relativePath);
      // Never overwrite an existing result, even on an accidentally repeated invocation.
      const output = await open(destination, 'wx');
      try {
        await output.writeFile(bytes, { signal: context.signal });
        await output.close();
        checkOperation(context);
        return {
          audio: artifactManifestSchema.parse({
            schemaVersion: 1,
            id: operationId,
            createdAt: new Date().toISOString(),
            workspaceId: fixture.workspaceId,
            jobId: context.jobId,
            kind: 'audio',
            mimeType: 'audio/wav',
            storage: { kind: 'local', path: relativePath },
            digest: createHash('sha256').update(bytes).digest('hex'),
            sizeBytes: bytes.length,
            media: {
              durationUs,
              width: null,
              height: null,
              frameRate: null,
              videoCodec: null,
              audioCodec: 'pcm_s16le',
              sampleRate: 16000,
              channels: 1,
            },
            provenance: {
              stageId: 'voice',
              attemptId: context.attemptId,
              inputDigests: [createHash('sha256').update(bytes).digest('hex')],
              provider: {
                id: recordedVoiceDescriptor.id,
                version: recordedVoiceDescriptor.version,
              },
              settingsDigest: fixture.settingsDigest,
              templateDigest: null,
            },
          }),
          words: null,
          providerRequestId: null,
          actualUsdMicros: 0,
        };
      } catch (error) {
        await output.close();
        await unlink(destination);
        throw error;
      }
    },
  };
}
