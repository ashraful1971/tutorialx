import { z } from 'zod';
import {
  digestSchema,
  idSchema,
  jsonObjectSchema,
  positiveIntegerSchema,
  providerSelectionSchema,
} from './common.js';
import { workflowGraphSchema } from './workflow.js';

const digests = z.record(idSchema, digestSchema.nullable());
const providerFingerprint = z.strictObject({
  id: idSchema,
  version: z.string().min(1).max(100),
  configurationDigest: digestSchema,
});
export const stageInputSchema = z.strictObject({
  schemaVersion: z.literal(1),
  stageId: idSchema,
  kind: idSchema,
  implementationVersion: z.string().min(1).max(100),
  settings: jsonObjectSchema,
  parameters: jsonObjectSchema,
  sourceDigests: digests,
  artifactDigests: digests,
  templateDigests: digests,
  provider: providerSelectionSchema.nullable(),
  dataDependencies: z
    .array(idSchema)
    .max(1000)
    .refine((values) => new Set(values).size === values.length, 'Duplicate lineage dependencies.'),
});
export const stageLineageSchema = z.strictObject({
  schemaVersion: z.literal(1),
  stageId: idSchema,
  kind: idSchema,
  implementationVersion: z.string().min(1).max(100),
  settingsDigest: digestSchema,
  parametersDigest: digestSchema,
  sourceDigests: digests,
  artifactDigests: digests,
  templateDigests: digests,
  provider: providerFingerprint.nullable(),
  dependencies: z.record(idSchema, digestSchema),
  inputDigest: digestSchema,
});
export const workflowSnapshotSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    jobId: idSchema,
    jobRevision: positiveIntegerSchema,
    graph: workflowGraphSchema,
    lineage: z.array(stageLineageSchema).min(1).max(10_000),
  })
  .refine(
    (snapshot) =>
      new Set(snapshot.lineage.map((record) => record.stageId)).size === snapshot.lineage.length &&
      snapshot.lineage.length === snapshot.graph.stages.length &&
      snapshot.graph.stages.every((stage) =>
        snapshot.lineage.some(
          (record) =>
            record.stageId === stage.id &&
            record.kind === stage.kind &&
            record.inputDigest === stage.inputDigest,
        ),
      ),
    'Workflow graph and lineage bindings must match exactly.',
  );
const pointerShape = {
  schemaVersion: z.literal(1),
  jobId: idSchema,
  jobRevision: positiveIntegerSchema,
};
export const currentDeliveryPointerSchema = z.discriminatedUnion('status', [
  z.strictObject({
    ...pointerShape,
    status: z.literal('ready'),
    manifestIds: z
      .array(idSchema)
      .min(1)
      .max(1000)
      .refine((values) => new Set(values).size === values.length, 'Duplicate delivery manifests.'),
  }),
  z.strictObject({
    ...pointerShape,
    status: z.literal('invalidated'),
    previousRevision: positiveIntegerSchema.nullable(),
  }),
]);

export type StageInput = z.infer<typeof stageInputSchema>;
export type StageLineage = z.infer<typeof stageLineageSchema>;
export type CurrentDeliveryPointer = z.infer<typeof currentDeliveryPointerSchema>;
export type WorkflowSnapshot = z.infer<typeof workflowSnapshotSchema>;

/** All local delivery publishers/invalidation operations share this exclusive guard. */
export interface DeliveryPointerGuard {
  invalidate(expectedRevision: number, nextRevision: number): Promise<void>;
  release(): Promise<void>;
}
export interface DeliveryPointerStore {
  lock(): Promise<DeliveryPointerGuard>;
}
