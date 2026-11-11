import { z } from 'zod';
import { digestSchema, hasUniqueIds, idSchema } from './common.js';

const unique = (values: readonly string[]) => new Set(values).size === values.length;
export const stageDefinitionSchema = z.strictObject({
  id: idSchema,
  kind: idSchema,
  phase: z.enum(['planning', 'production', 'quality', 'delivery']),
  inputDigest: digestSchema,
  dependencies: z.array(idSchema).max(1000).refine(unique, 'Duplicate stage dependencies.'),
  requiredArtifactIds: z
    .array(idSchema)
    .max(10_000)
    .refine(unique, 'Duplicate required artifacts.'),
  required: z.boolean(),
});
export const workflowGraphSchema = z.strictObject({
  schemaVersion: z.literal(1),
  stages: z
    .array(stageDefinitionSchema)
    .min(1)
    .max(10_000)
    .refine(hasUniqueIds, 'Duplicate stage identities.')
    .refine(
      (stages) => stages.some((stage) => stage.required),
      'A workflow requires at least one required stage.',
    ),
});
export type StageDefinition = z.infer<typeof stageDefinitionSchema>;
export type WorkflowGraph = z.infer<typeof workflowGraphSchema>;
