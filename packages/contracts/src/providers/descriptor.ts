import { z } from 'zod';
import {
  idSchema,
  jsonObjectSchema,
  languageSchema,
  positiveIntegerSchema,
  timestampSchema,
  usdMicrosSchema,
} from '../common.js';
import { diagnosticSchema } from '../execution.js';

export const providerKindSchema = z.enum([
  'agent',
  'research',
  'capture',
  'voice',
  'alignment',
  'assets',
  'renderer',
  'storage',
  'persistence',
  'queue',
  'isolation',
]);
export const providerDescriptorSchema = z.strictObject({
  id: idSchema,
  kind: providerKindSchema,
  version: z.string().min(1).max(100),
  contractVersion: z.literal(1),
  configurationSchema: jsonObjectSchema,
  capabilities: z.strictObject({
    features: z.array(z.string().min(1).max(100)).max(1000),
    languages: z.array(languageSchema).max(1000),
    formats: z.array(z.string().min(1).max(100)).max(1000),
    modalities: z.array(z.enum(['text', 'image', 'audio', 'video'])).max(4),
  }),
  runtime: z.strictObject({
    platforms: z
      .array(z.enum(['darwin', 'linux', 'win32']))
      .min(1)
      .max(3),
    dependencies: z
      .array(
        z.strictObject({
          id: idSchema,
          versionRange: z.string().min(1).max(100),
          optional: z.boolean(),
        }),
      )
      .max(100),
    memoryMiB: positiveIntegerSchema,
    gpu: z.boolean(),
  }),
  execution: z.strictObject({
    location: z.enum(['local', 'remote']),
    maxDurationMs: positiveIntegerSchema,
    cancellation: z.enum(['cooperative', 'best-effort', 'unsupported']),
    sideEffect: z.enum(['pure', 'idempotent', 'reconcilable', 'uncertain']),
    idempotency: z.enum(['supported', 'reconcilable', 'none']),
    permissions: z
      .array(
        z.enum(['read-assets', 'write-work', 'network', 'subprocess', 'browser', 'credentials']),
      )
      .max(6),
  }),
  pricing: z.enum(['free', 'metered', 'unknown']),
});

export const costEstimateSchema = z
  .strictObject({
    expectedUsdMicros: usdMicrosSchema,
    upperBoundUsdMicros: usdMicrosSchema.nullable(),
    validUntil: timestampSchema.nullable(),
    uncertainty: z.array(z.string().min(1).max(1000)).max(100),
  })
  .refine(
    (value) =>
      value.upperBoundUsdMicros === null || value.upperBoundUsdMicros >= value.expectedUsdMicros,
    'A known upper bound cannot be lower than the expected cost.',
  );

export const providerReadinessSchema = z.strictObject({
  ready: z.boolean(),
  diagnostics: z.array(diagnosticSchema).max(100),
});

export type ProviderKind = z.infer<typeof providerKindSchema>;
export type ProviderDescriptor = z.infer<typeof providerDescriptorSchema>;
export type CostEstimate = z.infer<typeof costEstimateSchema>;
export type ProviderReadiness = z.infer<typeof providerReadinessSchema>;
export type JsonObject = z.infer<typeof jsonObjectSchema>;

export interface OperationContext {
  readonly operationId: string;
  readonly jobId: string;
  readonly attemptId: string;
  readonly outputDirectory: string;
  readonly deadlineAt: string;
  readonly reservationId: string | null;
  readonly signal: AbortSignal;
}

export interface BaseProvider<Kind extends ProviderKind> {
  readonly descriptor: ProviderDescriptor & { kind: Kind };
  validateConfiguration(config: JsonObject): ProviderReadiness;
  readiness(): Promise<ProviderReadiness>;
  estimate(operation: string, input: JsonObject, context: OperationContext): Promise<CostEstimate>;
}
