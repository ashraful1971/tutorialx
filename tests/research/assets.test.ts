import type {
  ArtifactManifest,
  AssetProvenanceDeclaration,
  SourceManifest,
} from '@tutorialx/contracts';
import { assessAssetProvenance } from '@tutorialx/core';
import { expect, it } from 'vitest';
import { samplePlan, timestamp } from '../fixtures/contracts.js';

const digest = 'd'.repeat(64);

function fixture(usage: AssetProvenanceDeclaration['usage'] = 'permitted') {
  const plan = samplePlan();
  plan.effective.settings.voice = { mode: 'none' };
  plan.effective.settings.audio.music = {
    enabled: true,
    assetId: 'soundtrack_asset',
    gainDb: -24,
  };
  const source: SourceManifest = {
    schemaVersion: 1,
    id: 'soundtrack_source',
    createdAt: timestamp,
    jobId: plan.jobId,
    input: { kind: 'media', path: '/fixtures/soundtrack.wav', copy: true },
    contentHash: digest,
    sourceRevision: 'licensed-fixture-v1',
    status: 'available',
    snapshotArtifactId: null,
    reason: null,
    attribution: {
      origin: 'TutorialX fixture soundtrack',
      license: 'CC-BY-4.0',
      requiredText: 'Music: TutorialX fixture soundtrack (CC BY 4.0).',
      usage,
    },
  };
  const artifact: ArtifactManifest = {
    schemaVersion: 1,
    id: 'soundtrack_asset',
    createdAt: timestamp,
    workspaceId: 'workspace_example',
    jobId: plan.jobId,
    kind: 'audio',
    mimeType: 'audio/wav',
    storage: { kind: 'local', path: 'input/soundtrack.wav' },
    digest,
    sizeBytes: 16_044,
    media: {
      durationUs: 1_000_000,
      width: null,
      height: null,
      frameRate: null,
      videoCodec: null,
      audioCodec: 'pcm_s16le',
      sampleRate: 8000,
      channels: 1,
    },
    provenance: {
      stageId: 'source_materialization',
      attemptId: 'attempt_source',
      inputDigests: [digest],
      provider: null,
      settingsDigest: 'e'.repeat(64),
      templateDigest: null,
    },
  };
  const declaration: AssetProvenanceDeclaration = {
    schemaVersion: 1,
    id: 'soundtrack_provenance',
    createdAt: timestamp,
    jobId: plan.jobId,
    artifactId: artifact.id,
    sourceId: source.id,
    origin: source.attribution.origin,
    license: source.attribution.license,
    requiredText: source.attribution.requiredText,
    usage,
    provider: null,
  };
  return { plan, source, artifact, declaration };
}

it('carries an attributed soundtrack into exact delivery attribution requirements', () => {
  const state = fixture();
  expect(
    assessAssetProvenance({
      plan: state.plan,
      artifacts: [state.artifact],
      declarations: [state.declaration],
      sources: [state.source],
    }),
  ).toEqual({
    ready: true,
    attribution: ['Music: TutorialX fixture soundtrack (CC BY 4.0).'],
    issues: [],
  });
});

it('keeps restricted asset usage visible and blocks delivery readiness', () => {
  const state = fixture('restricted');
  const assessment = assessAssetProvenance({
    plan: state.plan,
    artifacts: [state.artifact],
    declarations: [state.declaration],
    sources: [state.source],
  });
  expect(assessment.ready).toBe(false);
  expect(assessment.issues).toContainEqual(
    expect.objectContaining({ code: 'RESTRICTED_USAGE', artifactId: 'soundtrack_asset' }),
  );
});
