import { z } from 'zod';
import { type ArtifactManifest, artifactManifestSchema } from '../artifacts.js';
import { idSchema, microsecondsSchema, usdMicrosSchema } from '../common.js';
import {
  type CaptureStep,
  type FocusRegion,
  type PlanRevision,
  type ScenePlan,
  scenePlanSchema,
} from '../planning.js';
import { settingsSchema } from '../settings.js';
import type { CaptionTrack, Timeline } from '../timeline.js';
import type { BaseProvider, OperationContext, ProviderReadiness } from './descriptor.js';
import type {
  AlignmentResult,
  AssetResult,
  CaptureResult,
  RenderResult,
  VoiceResult,
} from './responses.js';

export interface Voice {
  id: string;
  name: string;
  language: string;
  controls: readonly string[];
}

export interface VoiceRequest {
  sceneId: string;
  text: string;
  language: string;
  voiceId: string;
  pace: number;
  tone: string;
  pronunciations: Readonly<Record<string, string>>;
}

export interface VoiceProvider extends BaseProvider<'voice'> {
  voices(context: OperationContext): Promise<readonly Voice[]>;
  synthesize(request: VoiceRequest, context: OperationContext): Promise<VoiceResult>;
}

export interface CaptureRequest {
  sceneId: string;
  target: string;
  viewport: { width: number; height: number };
  steps: readonly CaptureStep[];
  sessionRef: string | null;
  setupRecipeId: string | null;
  maskRegions: readonly FocusRegion[];
}

export interface CaptureProvider extends BaseProvider<'capture'> {
  preflight(request: CaptureRequest, context: OperationContext): Promise<ProviderReadiness>;
  capture(request: CaptureRequest, context: OperationContext): Promise<CaptureResult>;
}

export interface AlignmentProvider extends BaseProvider<'alignment'> {
  align(
    request: {
      audio: readonly ArtifactManifest[];
      scenes: readonly ScenePlan[];
      language: string;
      planRevision: number;
    },
    context: OperationContext,
  ): Promise<AlignmentResult>;
}

export const assetPreparationRequestSchema = z.strictObject({
  scene: scenePlanSchema,
  supplied: z.array(artifactManifestSchema).max(2000),
  settings: settingsSchema,
});

export const generatedAssetRequestSchema = z.strictObject({
  sceneId: idSchema,
  kind: z.enum(['image', 'video', 'audio']),
  prompt: z.string().min(1).max(20_000),
  referenceArtifactIds: z.array(idSchema).max(100),
  requirements: z.strictObject({
    mimeTypes: z
      .array(z.string().regex(/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/))
      .min(1)
      .max(20),
    width: z.number().int().positive().max(16_384).nullable(),
    height: z.number().int().positive().max(16_384).nullable(),
    durationUs: microsecondsSchema.nullable(),
  }),
  authorization: z.strictObject({
    reservationId: idSchema,
    maxUsdMicros: usdMicrosSchema,
  }),
});

export type AssetPreparationRequest = z.infer<typeof assetPreparationRequestSchema>;
export type GeneratedAssetRequest = z.infer<typeof generatedAssetRequestSchema>;

export interface AssetProvider extends BaseProvider<'assets'> {
  prepare(request: AssetPreparationRequest, context: OperationContext): Promise<AssetResult>;
  /** Optional by design: supplied-only providers do not imply generative capability. */
  generate?(request: GeneratedAssetRequest, context: OperationContext): Promise<AssetResult>;
}

export interface RenderRequest {
  plan: PlanRevision;
  timeline: Timeline;
  assets: readonly ArtifactManifest[];
  captions: CaptionTrack | null;
  templateId: string;
}

export interface RendererProvider extends BaseProvider<'renderer'> {
  preflight(request: RenderRequest, context: OperationContext): Promise<ProviderReadiness>;
  render(request: RenderRequest, context: OperationContext): Promise<RenderResult>;
}
