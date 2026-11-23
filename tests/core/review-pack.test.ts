import { reviewPackSchema, type Timeline } from '@tutorialx/contracts';
import {
  assessReviewPackCoverage,
  buildReviewPack,
  createNarrationQualityProfile,
  type SceneReviewMaterial,
} from '@tutorialx/core';
import { expect, it } from 'vitest';
import { digest, samplePlan, timestamp } from '../fixtures/contracts.js';

function fixture() {
  const first = samplePlan().scenes[0]!;
  const plan = {
    ...samplePlan(),
    scenes: [
      first,
      { ...first, id: 'details', title: 'Details', narration: 'Review the details.' },
    ],
  };
  const timeline: Timeline = {
    schemaVersion: 1,
    id: 'timeline_review',
    createdAt: timestamp,
    jobId: plan.jobId,
    planId: plan.id,
    planRevision: plan.revision,
    settingsDigest: digest,
    variantId: 'landscape',
    frameRate: { numerator: 30, denominator: 1 },
    durationUs: 5_000_000,
    clips: plan.scenes.flatMap((scene, index) => [
      {
        id: `visual_${index + 1}`,
        sceneId: scene.id,
        artifactId: `video_${index + 1}`,
        track: 'visual' as const,
        range: { startUs: index * 2_500_000, endUs: (index + 1) * 2_500_000 },
        sourceStartUs: 0,
        playbackRate: 1,
        gainDb: 0,
      },
    ]),
    captionTrackId: null,
    intentionalIntervals: [],
  };
  const profile = createNarrationQualityProfile({
    id: 'quality_review',
    createdAt: timestamp,
    channels: 2,
  });
  const materials: SceneReviewMaterial[] = plan.scenes.map((scene, index) => ({
    sceneId: scene.id,
    finalFrameArtifactId: `frame_${index + 1}`,
    finalClipArtifactId: `clip_${index + 1}`,
    transcriptArtifactId: `transcript_${index + 1}`,
    audioArtifactId: `audio_${index + 1}`,
    captureEvidenceArtifactIds: [],
  }));
  return { plan, timeline, profile, materials };
}

it('builds a revision-bound pack with final media and complete evidence for every scene', () => {
  const { plan, timeline, profile, materials } = fixture();
  const pack = buildReviewPack({
    id: 'review_pack',
    createdAt: timestamp,
    plan,
    timeline,
    profile,
    finalVideoArtifactId: 'final_video',
    materials,
  });
  expect(pack.scenes.map((scene) => scene.sceneId)).toEqual(['intro', 'details']);
  expect(pack.evidence.filter((item) => item.kind === 'final-frame')).toHaveLength(2);
  expect(pack.evidence.filter((item) => item.kind === 'final-clip')).toHaveLength(2);
  expect(pack.evidence.filter((item) => item.kind === 'transcript')).toHaveLength(2);
  expect(pack.evidence.filter((item) => item.kind === 'audio')).toHaveLength(2);
  expect(
    assessReviewPackCoverage({
      pack,
      profile,
      reviewerModalities: ['text', 'image', 'audio', 'video'],
    }),
  ).toEqual({ ready: true, issues: [] });
  const forged = structuredClone(pack);
  forged.evidence.find((item) => item.kind === 'transcript')!.modalities = ['video'];
  expect(reviewPackSchema.safeParse(forged).success).toBe(false);
});

it('does not let a text-only reviewer pass required visual and audio coverage', () => {
  const { plan, timeline, profile, materials } = fixture();
  const pack = buildReviewPack({
    id: 'review_pack',
    createdAt: timestamp,
    plan,
    timeline,
    profile,
    finalVideoArtifactId: 'final_video',
    materials,
  });
  const assessment = assessReviewPackCoverage({
    pack,
    profile,
    reviewerModalities: ['text'],
  });
  expect(assessment.ready).toBe(false);
  expect(
    assessment.issues
      .filter((issue) => issue.code === 'REVIEWER_MODALITY_MISSING')
      .map((issue) => issue.modality),
  ).toEqual(['image', 'audio', 'video']);
});

it('rejects missing scene, transcript, audio, and browser-capture material', () => {
  const { plan, timeline, profile, materials } = fixture();
  const build = (nextPlan = plan, nextMaterials = materials) =>
    buildReviewPack({
      id: 'review_pack',
      createdAt: timestamp,
      plan: nextPlan,
      timeline,
      profile,
      finalVideoArtifactId: 'final_video',
      materials: nextMaterials,
    });
  expect(() => build(plan, materials.slice(0, 1))).toThrow(
    'REVIEW_PACK_SCENE_MATERIALS_INCOMPLETE',
  );
  expect(() =>
    build(plan, [{ ...materials[0]!, transcriptArtifactId: null }, materials[1]!]),
  ).toThrow('REVIEW_PACK_TRANSCRIPT_MISSING');
  expect(() => build(plan, [{ ...materials[0]!, audioArtifactId: null }, materials[1]!])).toThrow(
    'REVIEW_PACK_AUDIO_MISSING',
  );
  const browserPlan = {
    ...plan,
    scenes: [
      {
        ...plan.scenes[0]!,
        visual: {
          kind: 'browser' as const,
          target: 'https://example.com',
          setupRecipeId: null,
          steps: [
            {
              id: 'observe_page',
              description: 'Observe the page.',
              evidenceIds: ['evidence_page'],
              expected: [{ kind: 'url' as const, url: 'https://example.com' }],
              dwellUs: 1_000_000,
              action: 'observe' as const,
            },
          ],
          focus: null,
          maskRegions: [],
        },
      },
      plan.scenes[1]!,
    ],
  };
  expect(() => build(browserPlan, materials)).toThrow('REVIEW_PACK_CAPTURE_EVIDENCE_MISSING');
});
