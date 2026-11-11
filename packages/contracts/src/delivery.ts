import { z } from 'zod';
import { relativeArtifactPathSchema } from './artifacts.js';
import {
  digestSchema,
  idSchema,
  nonnegativeIntegerSchema,
  positiveIntegerSchema,
  recordShape,
} from './common.js';

export const deliveryFileSchema = z.strictObject({
  role: z.enum(['video', 'srt', 'vtt', 'thumbnail', 'quality-report', 'attribution']),
  artifactId: idSchema,
  path: relativeArtifactPathSchema,
  digest: digestSchema,
  sizeBytes: nonnegativeIntegerSchema,
});

export const deliveryManifestSchema = z
  .strictObject({
    ...recordShape,
    jobId: idSchema,
    planId: idSchema,
    planRevision: positiveIntegerSchema,
    variantId: idSchema,
    settingsDigest: digestSchema,
    reviewResultIds: z.array(idSchema).min(1).max(1000),
    files: z.array(deliveryFileSchema).min(1).max(1000),
    providerVersions: z.record(idSchema, z.string().min(1).max(100)),
    templateDigests: z.array(digestSchema).max(2000),
    attribution: z.array(z.string().min(1).max(4000)).max(2000),
  })
  .refine(
    (delivery) =>
      delivery.files.filter((file) => file.role === 'video').length === 1 &&
      new Set(delivery.files.map((file) => file.path)).size === delivery.files.length,
    'Each delivery requires exactly one video and unique output paths.',
  );

export type DeliveryManifest = z.infer<typeof deliveryManifestSchema>;
