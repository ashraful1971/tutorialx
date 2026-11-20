import { z } from 'zod';
import { relativeArtifactPathSchema } from './artifacts.js';
import {
  digestSchema,
  frameRateSchema,
  hasUniqueIds,
  idSchema,
  microsecondsSchema,
  positiveIntegerSchema,
  recordShape,
} from './common.js';
import { focusRegionSchema } from './planning.js';
import { timeRangeSchema } from './timeline.js';

export const compositionPrimitiveSchema = z.enum([
  'title',
  'text',
  'image',
  'video',
  'capture',
  'focus',
  'diagram',
  'callout',
  'transition',
  'audio',
  'captions',
]);

const nodeShape = {
  id: idSchema,
  sceneId: idSchema,
  layer: z.number().int().min(-1000).max(1000),
  range: timeRangeSchema,
};

const fit = z.enum(['contain', 'cover']);
const crop = focusRegionSchema.nullable();

export const compositionNodeSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    ...nodeShape,
    kind: z.literal('title'),
    text: z.string().min(1).max(500),
    subtitle: z.string().max(1000).nullable(),
    align: z.enum(['start', 'center', 'end']),
  }),
  z.strictObject({
    ...nodeShape,
    kind: z.literal('text'),
    text: z.string().min(1).max(10_000),
    align: z.enum(['start', 'center', 'end']),
  }),
  z.strictObject({
    ...nodeShape,
    kind: z.literal('image'),
    artifactId: idSchema,
    fit,
    crop,
  }),
  z.strictObject({
    ...nodeShape,
    kind: z.literal('video'),
    artifactId: idSchema,
    fit,
    crop,
    sourceStartUs: microsecondsSchema,
    playbackRate: z.number().positive().max(4),
  }),
  z.strictObject({
    ...nodeShape,
    kind: z.literal('capture'),
    artifactId: idSchema,
    fit,
    crop,
    sourceStartUs: microsecondsSchema,
    playbackRate: z.number().positive().max(4),
    masks: z.array(focusRegionSchema).max(100),
  }),
  z.strictObject({
    ...nodeShape,
    kind: z.literal('focus'),
    sourceNodeId: idSchema,
    region: focusRegionSchema,
    zoom: z.number().min(1).max(8),
  }),
  z.strictObject({
    ...nodeShape,
    kind: z.literal('diagram'),
    nodes: z
      .array(z.strictObject({ id: idSchema, label: z.string().min(1).max(500) }))
      .min(1)
      .max(100)
      .refine(hasUniqueIds, 'Duplicate diagram node identities.'),
    edges: z
      .array(z.strictObject({ from: idSchema, to: idSchema, label: z.string().max(200) }))
      .max(500),
  }),
  z.strictObject({
    ...nodeShape,
    kind: z.literal('callout'),
    sourceNodeId: idSchema,
    text: z.string().min(1).max(1000),
    region: focusRegionSchema,
  }),
  z.strictObject({
    ...nodeShape,
    kind: z.literal('transition'),
    fromSceneId: idSchema,
    toSceneId: idSchema,
    style: z.enum(['cut', 'fade', 'slide']),
    durationUs: microsecondsSchema,
  }),
  z.strictObject({
    ...nodeShape,
    kind: z.literal('audio'),
    artifactId: idSchema,
    role: z.enum(['voice', 'music', 'effect']),
    sourceStartUs: microsecondsSchema,
    gainDb: z.number().min(-80).max(12),
  }),
  z.strictObject({
    ...nodeShape,
    kind: z.literal('captions'),
    captionTrackId: idSchema,
    fontFamily: z.string().min(1).max(200),
    fontSize: positiveIntegerSchema.max(500),
    color: z.string().regex(/^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/),
    backgroundColor: z.string().regex(/^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/),
    position: z.enum(['top', 'center', 'bottom']),
  }),
]);

export const trustedTemplateSchema = z.strictObject({
  id: idSchema,
  version: z.string().min(1).max(100),
  digest: digestSchema,
  trusted: z.literal(true),
  source: z.strictObject({ kind: z.literal('builtin'), path: relativeArtifactPathSchema }),
  supportedPrimitives: z.array(compositionPrimitiveSchema).min(1).max(11),
  allowedFontFamilies: z.array(z.string().min(1).max(200)).max(100),
  maxNodes: positiveIntegerSchema.max(100_000),
});

export const compositionGraphSchema = z
  .strictObject({
    ...recordShape,
    jobId: idSchema,
    planId: idSchema,
    planRevision: positiveIntegerSchema,
    settingsDigest: digestSchema,
    template: trustedTemplateSchema.pick({ id: true, version: true, digest: true }),
    variant: z.strictObject({
      id: idSchema,
      width: positiveIntegerSchema.max(16_384),
      height: positiveIntegerSchema.max(16_384),
      frameRate: frameRateSchema,
    }),
    durationUs: microsecondsSchema.refine((value) => value > 0),
    assetIds: z.array(idSchema).max(100_000),
    captionTrackId: idSchema.nullable(),
    nodes: z
      .array(compositionNodeSchema)
      .min(1)
      .max(100_000)
      .refine(hasUniqueIds, 'Duplicate composition node identities.'),
  })
  .superRefine((graph, context) => {
    const nodeIds = new Set(graph.nodes.map((node) => node.id));
    const assetIds = new Set(graph.assetIds);
    for (const [index, node] of graph.nodes.entries()) {
      if (node.range.endUs > graph.durationUs)
        context.addIssue({
          code: 'custom',
          path: ['nodes', index, 'range'],
          message: 'Node exceeds composition duration.',
        });
      if ('artifactId' in node && !assetIds.has(node.artifactId))
        context.addIssue({
          code: 'custom',
          path: ['nodes', index, 'artifactId'],
          message: 'Node references an unstaged asset.',
        });
      if ('sourceNodeId' in node && !nodeIds.has(node.sourceNodeId))
        context.addIssue({
          code: 'custom',
          path: ['nodes', index, 'sourceNodeId'],
          message: 'Node references an unknown source node.',
        });
      if (node.kind === 'captions' && graph.captionTrackId !== node.captionTrackId)
        context.addIssue({
          code: 'custom',
          path: ['nodes', index, 'captionTrackId'],
          message: 'Caption node does not use the accepted final track.',
        });
    }
  });

export type CompositionPrimitive = z.infer<typeof compositionPrimitiveSchema>;
export type CompositionNode = z.infer<typeof compositionNodeSchema>;
export type TrustedTemplate = z.infer<typeof trustedTemplateSchema>;
export type CompositionGraph = z.infer<typeof compositionGraphSchema>;
