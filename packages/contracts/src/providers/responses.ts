import { z } from 'zod';
import { artifactManifestSchema } from '../artifacts.js';
import { idSchema, jsonObjectSchema, usdMicrosSchema } from '../common.js';
import { diagnosticSchema } from '../execution.js';
import { focusRegionSchema } from '../planning.js';
import { evidenceLocatorSchema, sourceManifestSchema } from '../sources.js';
import { captionTrackSchema, timedWordSchema, timeRangeSchema } from '../timeline.js';

const audioArtifactSchema = artifactManifestSchema.refine(
  (artifact) => artifact.kind === 'audio',
  'Expected audio artifact.',
);
const videoArtifactSchema = artifactManifestSchema.refine(
  (artifact) => artifact.kind === 'video',
  'Expected video artifact.',
);

export const voiceResultSchema = z.strictObject({
  audio: audioArtifactSchema,
  words: z.array(timedWordSchema).max(100_000).nullable(),
  providerRequestId: z.string().min(1).max(1000).nullable(),
  actualUsdMicros: usdMicrosSchema.nullable(),
});

export const captureResultSchema = z.strictObject({
  recording: videoArtifactSchema,
  evidence: z.array(artifactManifestSchema).max(10_000),
  actions: z
    .array(
      z.strictObject({
        stepId: idSchema,
        range: timeRangeSchema,
        focus: focusRegionSchema.nullable(),
        verified: z.boolean(),
      }),
    )
    .max(1000),
});

export const alignmentResultSchema = z.strictObject({
  captions: captionTrackSchema,
  transcript: z.string().max(1_000_000),
  deviations: z
    .array(
      z.strictObject({
        expected: z.string().max(4000),
        observed: z.string().max(4000),
        range: timeRangeSchema.nullable(),
      }),
    )
    .max(10_000),
});

export const assetResultSchema = z.strictObject({
  artifacts: z.array(artifactManifestSchema).max(2000),
  attribution: z.array(z.string().min(1).max(4000)).max(2000),
  providerRequestId: z.string().min(1).max(1000).nullable(),
  actualUsdMicros: usdMicrosSchema.nullable(),
});

export const renderResultSchema = z.strictObject({
  video: videoArtifactSchema,
  thumbnail: artifactManifestSchema.refine((artifact) => artifact.kind === 'image').nullable(),
  diagnostics: z.array(diagnosticSchema).max(1000),
});

export const readerResultSchema = z.strictObject({
  source: sourceManifestSchema,
  extracts: z
    .array(z.strictObject({ locator: evidenceLocatorSchema, text: z.string().max(100_000) }))
    .max(10_000),
  artifacts: z.array(artifactManifestSchema).max(2000),
  truncated: z.boolean(),
});

export const agentTaskResultSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.enum(['running', 'waiting']),
    operationId: idSchema,
    reason: z.string().max(2000).nullable(),
  }),
  z.strictObject({
    status: z.literal('completed'),
    operationId: idSchema,
    result: jsonObjectSchema,
  }),
  z.strictObject({
    status: z.enum(['failed', 'cancelled']),
    operationId: idSchema,
    diagnostic: diagnosticSchema,
  }),
]);

export type VoiceResult = z.infer<typeof voiceResultSchema>;
export type CaptureResult = z.infer<typeof captureResultSchema>;
export type AlignmentResult = z.infer<typeof alignmentResultSchema>;
export type AssetResult = z.infer<typeof assetResultSchema>;
export type RenderResult = z.infer<typeof renderResultSchema>;
export type ReaderResult = z.infer<typeof readerResultSchema>;
export type AgentTaskResult = z.infer<typeof agentTaskResultSchema>;
