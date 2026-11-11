import { z } from 'zod';
import {
  digestSchema,
  frameRateSchema,
  idSchema,
  microsecondsSchema,
  nonnegativeIntegerSchema,
  positiveIntegerSchema,
  recordShape,
} from './common.js';

export const relativeArtifactPathSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine(
    (path) =>
      !path.startsWith('/') &&
      !path.includes('\\') &&
      !path.includes(':') &&
      !path.includes('\0') &&
      path.split('/').every((part) => part !== '' && part !== '.' && part !== '..'),
    'Artifact paths must be contained, portable relative paths.',
  );

export const storageReferenceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('local'), path: relativeArtifactPathSchema }),
  z.strictObject({
    kind: z.literal('object'),
    bucket: z.string().min(1).max(255),
    key: relativeArtifactPathSchema,
    versionId: z.string().min(1).max(1000).nullable(),
  }),
]);

export const mediaMetadataSchema = z.strictObject({
  durationUs: microsecondsSchema.nullable(),
  width: positiveIntegerSchema.nullable(),
  height: positiveIntegerSchema.nullable(),
  frameRate: frameRateSchema.nullable(),
  videoCodec: z.string().min(1).max(100).nullable(),
  audioCodec: z.string().min(1).max(100).nullable(),
  sampleRate: positiveIntegerSchema.nullable(),
  channels: positiveIntegerSchema.max(64).nullable(),
});

export const artifactManifestSchema = z
  .strictObject({
    ...recordShape,
    workspaceId: idSchema,
    jobId: idSchema,
    kind: z.enum(['video', 'audio', 'image', 'text', 'json', 'html', 'subtitles', 'archive']),
    mimeType: z.string().regex(/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/),
    storage: storageReferenceSchema,
    digest: digestSchema,
    sizeBytes: nonnegativeIntegerSchema,
    media: mediaMetadataSchema.nullable(),
    provenance: z.strictObject({
      stageId: idSchema,
      attemptId: idSchema,
      inputDigests: z.array(digestSchema).max(10_000),
      provider: z.strictObject({ id: idSchema, version: z.string().min(1).max(100) }).nullable(),
      settingsDigest: digestSchema,
      templateDigest: digestSchema.nullable(),
    }),
  })
  .refine(
    (value) => !['video', 'audio', 'image'].includes(value.kind) || value.media !== null,
    'Media artifacts require measured metadata.',
  )
  .refine((value) => {
    const media = value.media;
    if (value.kind === 'video')
      return (
        media !== null &&
        media.width !== null &&
        media.height !== null &&
        media.frameRate !== null &&
        media.videoCodec !== null &&
        media.durationUs !== null &&
        media.durationUs > 0
      );
    if (value.kind === 'audio')
      return (
        media !== null &&
        media.audioCodec !== null &&
        media.sampleRate !== null &&
        media.channels !== null &&
        media.durationUs !== null &&
        media.durationUs > 0
      );
    if (value.kind === 'image')
      return media !== null && media.width !== null && media.height !== null;
    return true;
  }, 'Measured metadata must describe the artifact media kind.');

export type ArtifactManifest = z.infer<typeof artifactManifestSchema>;
export type StorageReference = z.infer<typeof storageReferenceSchema>;
export type MediaMetadata = z.infer<typeof mediaMetadataSchema>;
