import {
  type PlanRevision,
  planRevisionSchema,
  type QualityProfile,
  qualityProfileSchema,
  type ReviewModality,
  type ReviewPack,
  reviewPackSchema,
  type Timeline,
  type TimeRange,
  timelineSchema,
} from '@tutorialx/contracts';

export interface SceneReviewMaterial {
  sceneId: string;
  finalFrameArtifactId: string;
  finalClipArtifactId: string;
  transcriptArtifactId: string | null;
  audioArtifactId: string | null;
  captureEvidenceArtifactIds: readonly string[];
}

function sceneRange(timeline: Timeline, sceneId: string): TimeRange {
  const ranges = [
    ...timeline.clips.filter((clip) => clip.sceneId === sceneId).map((clip) => clip.range),
    ...timeline.intentionalIntervals
      .filter((interval) => interval.sceneId === sceneId)
      .map((interval) => interval.range),
  ];
  if (ranges.length === 0) throw new Error('REVIEW_PACK_SCENE_RANGE_MISSING');
  return {
    startUs: Math.min(...ranges.map((range) => range.startUs)),
    endUs: Math.max(...ranges.map((range) => range.endUs)),
  };
}

export function buildReviewPack(input: {
  id: string;
  createdAt: string;
  plan: PlanRevision;
  timeline: Timeline;
  profile: QualityProfile;
  finalVideoArtifactId: string;
  materials: readonly SceneReviewMaterial[];
  limitations?: readonly string[];
}): ReviewPack {
  const plan = planRevisionSchema.parse(input.plan);
  const timeline = timelineSchema.parse(input.timeline);
  const profile = qualityProfileSchema.parse(input.profile);
  if (
    timeline.jobId !== plan.jobId ||
    timeline.planId !== plan.id ||
    timeline.planRevision !== plan.revision
  )
    throw new Error('REVIEW_PACK_TIMELINE_MISMATCH');
  const materials = new Map(input.materials.map((material) => [material.sceneId, material]));
  if (materials.size !== input.materials.length || materials.size !== plan.scenes.length)
    throw new Error('REVIEW_PACK_SCENE_MATERIALS_INCOMPLETE');

  const scenes = plan.scenes.map((scene) => ({
    sceneId: scene.id,
    range: sceneRange(timeline, scene.id),
  }));
  const evidence: ReviewPack['evidence'][number][] = [];
  for (const [index, scene] of plan.scenes.entries()) {
    const material = materials.get(scene.id);
    if (!material) throw new Error('REVIEW_PACK_SCENE_MATERIALS_INCOMPLETE');
    const range = scenes[index]!.range;
    evidence.push(
      {
        id: `review_${index + 1}_frame`,
        sceneId: scene.id,
        kind: 'final-frame',
        artifactId: material.finalFrameArtifactId,
        range,
        modalities: ['image'],
      },
      {
        id: `review_${index + 1}_clip`,
        sceneId: scene.id,
        kind: 'final-clip',
        artifactId: material.finalClipArtifactId,
        range,
        modalities: ['video'],
      },
    );
    if (scene.narration.trim() && !material.transcriptArtifactId)
      throw new Error('REVIEW_PACK_TRANSCRIPT_MISSING');
    if (material.transcriptArtifactId)
      evidence.push({
        id: `review_${index + 1}_transcript`,
        sceneId: scene.id,
        kind: 'transcript',
        artifactId: material.transcriptArtifactId,
        range,
        modalities: ['text'],
      });
    if (profile.requiredModalities.includes('audio') && !material.audioArtifactId)
      throw new Error('REVIEW_PACK_AUDIO_MISSING');
    if (material.audioArtifactId)
      evidence.push({
        id: `review_${index + 1}_audio`,
        sceneId: scene.id,
        kind: 'audio',
        artifactId: material.audioArtifactId,
        range,
        modalities: ['audio'],
      });
    if (scene.visual.kind === 'browser' && material.captureEvidenceArtifactIds.length === 0)
      throw new Error('REVIEW_PACK_CAPTURE_EVIDENCE_MISSING');
    for (const [captureIndex, artifactId] of material.captureEvidenceArtifactIds.entries())
      evidence.push({
        id: `review_${index + 1}_capture_${captureIndex + 1}`,
        sceneId: scene.id,
        kind: 'capture',
        artifactId,
        range,
        modalities: ['image'],
      });
  }
  if ([...materials.keys()].some((sceneId) => !plan.scenes.some((scene) => scene.id === sceneId)))
    throw new Error('REVIEW_PACK_SCENE_MATERIALS_INCOMPLETE');

  return reviewPackSchema.parse({
    schemaVersion: 1,
    id: input.id,
    createdAt: input.createdAt,
    jobId: plan.jobId,
    planRevision: plan.revision,
    variantId: timeline.variantId,
    profileId: profile.id,
    profileRevision: profile.revision,
    finalVideoArtifactId: input.finalVideoArtifactId,
    scenes,
    evidence,
    availableCoverage: evidence.map((item) => ({
      sceneId: item.sceneId,
      range: item.range,
      modalities: item.modalities,
      evidenceIds: [item.id],
    })),
    limitations: [...(input.limitations ?? [])],
  });
}

function covers(range: TimeRange, ranges: readonly TimeRange[]) {
  let cursor = range.startUs;
  for (const candidate of [...ranges].sort((left, right) => left.startUs - right.startUs)) {
    if (candidate.endUs <= cursor || candidate.startUs > cursor) continue;
    cursor = Math.max(cursor, candidate.endUs);
    if (cursor >= range.endUs) return true;
  }
  return false;
}

export interface ReviewCoverageIssue {
  code: 'REVIEWER_MODALITY_MISSING' | 'SCENE_MODALITY_COVERAGE_MISSING';
  sceneId: string | null;
  modality: ReviewModality;
  message: string;
}

export function assessReviewPackCoverage(input: {
  pack: ReviewPack;
  profile: QualityProfile;
  reviewerModalities: readonly ReviewModality[];
}): { ready: boolean; issues: readonly ReviewCoverageIssue[] } {
  const pack = reviewPackSchema.parse(input.pack);
  const profile = qualityProfileSchema.parse(input.profile);
  if (pack.profileId !== profile.id || pack.profileRevision !== profile.revision)
    throw new Error('REVIEW_PACK_PROFILE_MISMATCH');
  const reviewer = new Set(input.reviewerModalities);
  const issues: ReviewCoverageIssue[] = [];
  for (const modality of profile.requiredModalities)
    if (!reviewer.has(modality))
      issues.push({
        code: 'REVIEWER_MODALITY_MISSING',
        sceneId: null,
        modality,
        message: `Reviewer cannot inspect required ${modality} evidence.`,
      });
  for (const scene of pack.scenes)
    for (const modality of profile.requiredModalities) {
      const ranges = pack.availableCoverage
        .filter(
          (coverage) =>
            coverage.sceneId === scene.sceneId && coverage.modalities.includes(modality),
        )
        .map((coverage) => coverage.range);
      if (!covers(scene.range, ranges))
        issues.push({
          code: 'SCENE_MODALITY_COVERAGE_MISSING',
          sceneId: scene.sceneId,
          modality,
          message: `Scene ${scene.sceneId} lacks complete ${modality} evidence coverage.`,
        });
    }
  return { ready: issues.length === 0, issues };
}
