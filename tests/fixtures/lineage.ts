import { fingerprintJson } from '@tutorialx/adapters';
import type {
  SourceManifest,
  StageInput,
  VideoSettings,
  WorkflowGraph,
} from '@tutorialx/contracts';
import { digest, sampleSettings, timestamp } from './contracts.js';

export function lineageModel() {
  const settings = sampleSettings();
  settings.providers.renderer.id = 'fixture-renderer';
  settings.voice = {
    mode: 'synthesize',
    voiceId: 'fixture',
    pace: 1,
    tone: '',
    pronunciations: {},
  };
  settings.providers.voice = {
    id: 'fixture-voice',
    version: '1',
    config: { model: 'fixture' },
    credentialRef: 'named_speech_key',
  };
  return {
    settings,
    narration: 'An authored fixture introduction.',
    sourceId: 'narration_source',
    sourceDigest: fingerprintJson({ content: 'Authored fixture source' }),
  };
}
export type LineageModel = ReturnType<typeof lineageModel>;

export function lineageInputs(model: LineageModel): StageInput[] {
  const inputs: StageInput[] = [];
  const add = (stageId: string, dependencies: string[], changes: Partial<StageInput> = {}) =>
    inputs.push({
      schemaVersion: 1,
      stageId,
      kind: stageId,
      implementationVersion: '1',
      settings: {},
      parameters: {},
      sourceDigests: {},
      artifactDigests: {},
      templateDigests: {},
      provider: null,
      dataDependencies: dependencies,
      ...changes,
    });
  const sources = { [model.sourceId]: model.sourceDigest };
  add('research', [], {
    settings: { language: model.settings.language },
    parameters: { topic: 'Fixture workflow' },
    sourceDigests: sources,
  });
  add('plan', ['research'], {
    settings: { language: model.settings.language, recipe: model.settings.recipe },
    parameters: { topic: 'Fixture workflow' },
  });
  add('capture', [], {
    settings: { viewport: { width: 1920, height: 1080 } },
    parameters: { actions: ['open', 'save'] },
  });
  add('voice', [], {
    settings: { language: model.settings.language, voice: model.settings.voice },
    parameters: { narration: model.narration },
    sourceDigests: sources,
    provider: model.settings.providers.voice,
  });
  add('alignment', ['voice'], { parameters: { language: model.settings.language } });
  add('timeline', ['capture', 'alignment']);
  add('framing', ['capture'], { settings: { variants: model.settings.variants } });
  add('composition', ['timeline', 'framing'], {
    settings: {
      captions: model.settings.captions,
      brand: model.settings.brand,
      audio: model.settings.audio,
    },
  });
  add('render', ['composition'], {
    provider: model.settings.providers.renderer,
    templateDigests: { template: digest },
  });
  add('quality', ['render', 'research'], {
    settings: { qualityProfileId: model.settings.qualityProfileId },
  });
  add('delivery', ['quality'], { parameters: { planRevision: 1 } });
  return inputs;
}
export function lineageGraph(): WorkflowGraph {
  const dependencies: Record<string, string[]> = {
    research: [],
    plan: ['research'],
    capture: ['plan'],
    voice: ['plan'],
    alignment: ['voice'],
    timeline: ['capture', 'alignment'],
    framing: ['capture'],
    composition: ['timeline', 'framing'],
    render: ['composition'],
    quality: ['render', 'research'],
    delivery: ['quality'],
  };
  return {
    schemaVersion: 1,
    stages: Object.entries(dependencies).map(([id, parents]) => ({
      id,
      kind: id,
      phase:
        id === 'research' || id === 'plan'
          ? 'planning'
          : id === 'quality'
            ? 'quality'
            : id === 'delivery'
              ? 'delivery'
              : 'production',
      inputDigest: digest,
      dependencies: parents,
      requiredArtifactIds: [],
      required: true,
    })),
  };
}
export function lineageSource(model: LineageModel): SourceManifest {
  return {
    schemaVersion: 1,
    id: model.sourceId,
    createdAt: timestamp,
    jobId: 'job_example',
    input: { kind: 'text', text: JSON.stringify({ content: 'Authored fixture source' }) },
    contentHash: model.sourceDigest,
    sourceRevision: null,
    status: 'available',
    snapshotArtifactId: null,
    reason: null,
    attribution: {
      origin: 'Authored TutorialX test fixture',
      license: null,
      requiredText: null,
      usage: 'permitted',
    },
  };
}

export function verticalVariant(settings: VideoSettings) {
  settings.variants[0] = {
    ...settings.variants[0]!,
    aspectRatio: '9:16',
    width: 1080,
    height: 1920,
  };
}
