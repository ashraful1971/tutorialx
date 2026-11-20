import {
  type ArtifactManifest,
  digestSchema,
  type FrameRate,
  idSchema,
  microsecondsToFrame,
  type Timeline,
  timelineSchema,
} from '@tutorialx/contracts';

export interface TimingAnchor {
  id: string;
  atUs: number;
}

export interface SceneTimingInput {
  sceneId: string;
  narration: ArtifactManifest;
  visual: ArtifactManifest;
  cutaway?: ArtifactManifest | undefined;
  narrationAnchors: readonly TimingAnchor[];
  actionAnchors: readonly TimingAnchor[];
  bindings: readonly {
    id: string;
    narrationAnchorId: string;
    actionAnchorId: string;
  }[];
  allowHold: boolean;
  allowCutaway: boolean;
}

export interface MeasuredAnchor {
  id: string;
  narrationAtUs: number;
  actionAtUs: number;
  driftUs: number;
}

export interface MeasuredSceneTiming {
  sceneId: string;
  range: { startUs: number; endUs: number };
  narrationRange: { startUs: number; endUs: number };
  visualRange: { startUs: number; endUs: number };
  anchors: readonly MeasuredAnchor[];
  frames: { start: number; end: number };
}

export interface MeasuredTimelineResult {
  timeline: Timeline;
  scenes: readonly MeasuredSceneTiming[];
}

export interface TimelineReconciliationInput {
  id: string;
  createdAt: string;
  jobId: string;
  planId: string;
  planRevision: number;
  settingsDigest: string;
  variantId: string;
  frameRate: FrameRate;
  scenes: readonly SceneTimingInput[];
  anchorToleranceUs?: number;
}

function duration(artifact: ArtifactManifest, kind: 'audio' | 'video'): number {
  if (artifact.kind !== kind || !artifact.media?.durationUs)
    throw new Error(`TIMING_${kind.toUpperCase()}_INVALID`);
  return artifact.media.durationUs;
}

function anchorMap(values: readonly TimingAnchor[]): Map<string, number> {
  const result = new Map<string, number>();
  for (const value of values) {
    idSchema.parse(value.id);
    if (!Number.isSafeInteger(value.atUs) || value.atUs < 0 || result.has(value.id))
      throw new Error('TIMING_ANCHOR_INVALID');
    result.set(value.id, value.atUs);
  }
  return result;
}

function alignment(
  scene: SceneTimingInput,
  audioDurationUs: number,
  visualDurationUs: number,
  toleranceUs: number,
) {
  const narration = anchorMap(scene.narrationAnchors);
  const actions = anchorMap(scene.actionAnchors);
  const deltas = scene.bindings.map((binding) => {
    idSchema.parse(binding.id);
    const narrationAt = narration.get(binding.narrationAnchorId);
    const actionAt = actions.get(binding.actionAnchorId);
    if (
      narrationAt === undefined ||
      actionAt === undefined ||
      narrationAt > audioDurationUs ||
      actionAt > visualDurationUs
    )
      throw new Error('TIMING_ANCHOR_REFERENCE_INVALID');
    return narrationAt - actionAt;
  });
  const selectedDelta =
    deltas.length === 0 ? 0 : [...deltas].sort((a, b) => a - b)[Math.floor(deltas.length / 2)]!;
  const audioOffsetUs = Math.max(0, -selectedDelta);
  const visualOffsetUs = Math.max(0, selectedDelta);
  const measured = scene.bindings.map((binding) => {
    const narrationAtUs = audioOffsetUs + narration.get(binding.narrationAnchorId)!;
    const actionAtUs = visualOffsetUs + actions.get(binding.actionAnchorId)!;
    const driftUs = Math.abs(narrationAtUs - actionAtUs);
    if (driftUs > toleranceUs) throw new Error('TIMING_ANCHORS_INCOMPATIBLE');
    return { id: binding.id, narrationAtUs, actionAtUs, driftUs };
  });
  return { audioOffsetUs, visualOffsetUs, measured };
}

export function reconcileMeasuredTimeline(
  input: TimelineReconciliationInput,
): MeasuredTimelineResult {
  idSchema.parse(input.id);
  idSchema.parse(input.jobId);
  idSchema.parse(input.planId);
  idSchema.parse(input.variantId);
  digestSchema.parse(input.settingsDigest);
  if (input.scenes.length === 0 || input.scenes.length > 2_000)
    throw new Error('TIMING_SCENES_INVALID');
  const toleranceUs = input.anchorToleranceUs ?? 250_000;
  if (!Number.isSafeInteger(toleranceUs) || toleranceUs < 0)
    throw new Error('TIMING_TOLERANCE_INVALID');

  const clips: Timeline['clips'][number][] = [];
  const intentionalIntervals: Timeline['intentionalIntervals'][number][] = [];
  const scenes: MeasuredSceneTiming[] = [];
  let cursorUs = 0;

  for (const [index, scene] of input.scenes.entries()) {
    idSchema.parse(scene.sceneId);
    const audioDurationUs = duration(scene.narration, 'audio');
    const visualDurationUs = duration(scene.visual, 'video');
    const aligned = alignment(scene, audioDurationUs, visualDurationUs, toleranceUs);
    const narrationStartUs = cursorUs + aligned.audioOffsetUs;
    const visualStartUs = cursorUs + aligned.visualOffsetUs;
    const narrationEndUs = narrationStartUs + audioDurationUs;
    const visualEndUs = visualStartUs + visualDurationUs;
    const sceneEndUs = Math.max(narrationEndUs, visualEndUs);

    clips.push(
      {
        id: `voice_${index + 1}`,
        sceneId: scene.sceneId,
        artifactId: scene.narration.id,
        track: 'voice',
        range: { startUs: narrationStartUs, endUs: narrationEndUs },
        sourceStartUs: 0,
        playbackRate: 1,
        gainDb: 0,
      },
      {
        id: `visual_${index + 1}`,
        sceneId: scene.sceneId,
        artifactId: scene.visual.id,
        track: 'visual',
        range: { startUs: visualStartUs, endUs: visualEndUs },
        sourceStartUs: 0,
        playbackRate: 1,
        gainDb: 0,
      },
    );

    if (narrationStartUs > cursorUs)
      intentionalIntervals.push({
        sceneId: scene.sceneId,
        kind: 'silence',
        range: { startUs: cursorUs, endUs: narrationStartUs },
        reason: 'Narration starts later to preserve an approved action anchor.',
      });
    if (narrationEndUs < sceneEndUs)
      intentionalIntervals.push({
        sceneId: scene.sceneId,
        kind: 'silence',
        range: { startUs: narrationEndUs, endUs: sceneEndUs },
        reason: 'Measured visual action continues after narration.',
      });

    const visualGaps = [
      ...(visualStartUs > cursorUs ? [{ startUs: cursorUs, endUs: visualStartUs }] : []),
      ...(visualEndUs < sceneEndUs ? [{ startUs: visualEndUs, endUs: sceneEndUs }] : []),
    ];
    for (const [gapIndex, gap] of visualGaps.entries()) {
      const gapDurationUs = gap.endUs - gap.startUs;
      if (scene.allowCutaway && scene.cutaway) {
        if (duration(scene.cutaway, 'video') < gapDurationUs)
          throw new Error('TIMING_CUTAWAY_TOO_SHORT');
        clips.push({
          id: `cutaway_${index + 1}_${gapIndex + 1}`,
          sceneId: scene.sceneId,
          artifactId: scene.cutaway.id,
          track: 'visual',
          range: gap,
          sourceStartUs: 0,
          playbackRate: 1,
          gainDb: 0,
        });
      } else if (scene.allowHold) {
        intentionalIntervals.push({
          sceneId: scene.sceneId,
          kind: 'hold',
          range: gap,
          reason:
            'An explicitly allowed still-frame hold reconciles measured narration and visuals.',
        });
      } else {
        throw new Error('TIMING_VISUAL_GAP_UNAUTHORIZED');
      }
    }

    scenes.push({
      sceneId: scene.sceneId,
      range: { startUs: cursorUs, endUs: sceneEndUs },
      narrationRange: { startUs: narrationStartUs, endUs: narrationEndUs },
      visualRange: { startUs: visualStartUs, endUs: visualEndUs },
      anchors: aligned.measured.map((anchor) => ({
        ...anchor,
        narrationAtUs: cursorUs + anchor.narrationAtUs,
        actionAtUs: cursorUs + anchor.actionAtUs,
      })),
      frames: {
        start: microsecondsToFrame(cursorUs, input.frameRate),
        end: microsecondsToFrame(sceneEndUs, input.frameRate),
      },
    });
    cursorUs = sceneEndUs;
  }

  return {
    timeline: timelineSchema.parse({
      schemaVersion: 1,
      id: input.id,
      createdAt: input.createdAt,
      jobId: input.jobId,
      planId: input.planId,
      planRevision: input.planRevision,
      settingsDigest: input.settingsDigest,
      variantId: input.variantId,
      frameRate: input.frameRate,
      durationUs: cursorUs,
      clips,
      captionTrackId: null,
      intentionalIntervals,
    }),
    scenes,
  };
}
