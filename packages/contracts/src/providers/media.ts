import type { ArtifactManifest } from '../artifacts.js';
import type { CaptureStep, FocusRegion, PlanRevision, ScenePlan } from '../planning.js';
import type { VideoSettings } from '../settings.js';
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

export interface AssetProvider extends BaseProvider<'assets'> {
  prepare(
    request: {
      scene: ScenePlan;
      supplied: readonly ArtifactManifest[];
      settings: VideoSettings;
    },
    context: OperationContext,
  ): Promise<AssetResult>;
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
