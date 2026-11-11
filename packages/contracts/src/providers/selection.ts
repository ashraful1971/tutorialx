import { z } from 'zod';
import { idSchema, languageSchema, providerSelectionSchema, usdMicrosSchema } from '../common.js';

const capabilityList = z.array(z.string().min(1).max(100)).max(1000);

export const providerRequirementsSchema = z.strictObject({
  languages: z.array(languageSchema).max(1000),
  features: capabilityList,
  formats: capabilityList,
  modalities: z.array(z.enum(['text', 'image', 'audio', 'video'])).max(4),
  customScenes: z
    .array(
      z.strictObject({
        sceneId: idSchema,
        providerId: idSchema,
        templateId: idSchema,
      }),
    )
    .max(2000),
});

export const providerCandidateSchema = z.strictObject({
  selection: providerSelectionSchema,
  voiceId: z.string().min(1).max(200).nullable(),
  // Identifies the reviewed template/layout result, not arbitrary renderer source.
  visualIdentity: idSchema.nullable(),
});

export const providerFallbackPolicySchema = z.strictObject({
  schemaVersion: z.literal(1),
  candidates: z.array(providerCandidateSchema).max(20),
  maxCostUsdMicros: usdMicrosSchema,
});

export type ProviderRequirements = z.infer<typeof providerRequirementsSchema>;
export type ProviderCandidate = z.infer<typeof providerCandidateSchema>;
export type ProviderFallbackPolicy = z.infer<typeof providerFallbackPolicySchema>;
