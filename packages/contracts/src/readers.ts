import { z } from 'zod';
import { frameRateSchema, nonnegativeIntegerSchema, positiveIntegerSchema } from './common.js';
import type { ResearchReader } from './providers/agents.js';
import { readerResultSchema } from './providers/responses.js';

export const readerFormatCapabilitySchema = z.strictObject({
  format: z.string().min(1).max(100),
  available: z.boolean(),
  extraction: z.enum(['text', 'metadata']),
  dependency: z.string().min(1).max(100).nullable(),
  limitations: z.array(z.string().min(1).max(1000)).max(20),
});
export const sourceMediaMetadataSchema = z.strictObject({
  kind: z.enum(['image', 'audio', 'video']),
  format: z.string().min(1).max(100),
  sizeBytes: nonnegativeIntegerSchema,
  durationUs: nonnegativeIntegerSchema.nullable(),
  width: positiveIntegerSchema.nullable(),
  height: positiveIntegerSchema.nullable(),
  frameRate: frameRateSchema.nullable(),
  sampleRate: positiveIntegerSchema.nullable(),
  channels: positiveIntegerSchema.nullable(),
  codecs: z.array(z.string().min(1).max(100)).max(20),
});
export const sourceReadReportSchema = z.strictObject({
  result: readerResultSchema,
  format: z.string().min(1).max(100),
  bytesRead: nonnegativeIntegerSchema,
  media: sourceMediaMetadataSchema.nullable(),
  limitations: z.array(z.string().min(1).max(1000)).max(100),
});
export type ReaderFormatCapability = z.infer<typeof readerFormatCapabilitySchema>;
export type SourceMediaMetadata = z.infer<typeof sourceMediaMetadataSchema>;
export type SourceReadReport = z.infer<typeof sourceReadReportSchema>;
/** Additive richer inspection; existing ResearchReader.read still returns unmodified ReaderResult v1. */
export interface InspectableResearchReader extends ResearchReader {
  formats(): readonly ReaderFormatCapability[];
  inspect(
    request: Parameters<ResearchReader['read']>[0],
    context: Parameters<ResearchReader['read']>[1],
  ): Promise<SourceReadReport>;
}
