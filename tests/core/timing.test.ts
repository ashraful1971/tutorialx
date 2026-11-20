import { type ArtifactManifest, artifactManifestSchema } from '@tutorialx/contracts';
import { reconcileMeasuredTimeline } from '@tutorialx/core';
import { expect, it } from 'vitest';
import { digest } from '../fixtures/contracts.js';

function artifact(id: string, kind: 'audio' | 'video', durationUs: number) {
  return artifactManifestSchema.parse({
    schemaVersion: 1,
    id,
    createdAt: '2026-11-20T00:00:00.000Z',
    workspaceId: 'workspace_timing',
    jobId: 'job_timing',
    kind,
    mimeType: kind === 'audio' ? 'audio/wav' : 'video/mp4',
    storage: { kind: 'local', path: `${id}.${kind === 'audio' ? 'wav' : 'mp4'}` },
    digest,
    sizeBytes: 100,
    media: {
      durationUs,
      width: kind === 'video' ? 1920 : null,
      height: kind === 'video' ? 1080 : null,
      frameRate: kind === 'video' ? { numerator: 30_000, denominator: 1_001 } : null,
      videoCodec: kind === 'video' ? 'h264' : null,
      audioCodec: kind === 'audio' ? 'pcm_s16le' : null,
      sampleRate: kind === 'audio' ? 24_000 : null,
      channels: kind === 'audio' ? 1 : null,
    },
    provenance: {
      stageId: kind === 'audio' ? 'voice' : 'capture',
      attemptId: `${kind}_attempt`,
      inputDigests: [digest],
      provider: null,
      settingsDigest: digest,
      templateDigest: null,
    },
  });
}

function input() {
  return {
    id: 'timeline_measured',
    createdAt: '2026-11-20T00:00:00.000Z',
    jobId: 'job_timing',
    planId: 'plan_timing',
    planRevision: 1,
    settingsDigest: digest,
    variantId: 'landscape',
    frameRate: { numerator: 30_000, denominator: 1_001 },
    scenes: [
      {
        sceneId: 'intro',
        narration: artifact('narration_intro', 'audio', 5_000_000),
        visual: artifact('capture_intro', 'video', 4_000_000),
        narrationAnchors: [{ id: 'say_save', atUs: 2_000_000 }],
        actionAnchors: [{ id: 'click_save', atUs: 1_500_000 }],
        bindings: [
          { id: 'save_anchor', narrationAnchorId: 'say_save', actionAnchorId: 'click_save' },
        ],
        allowHold: true,
        allowCutaway: false,
        cutaway: undefined as ArtifactManifest | undefined,
      },
    ],
  };
}

it('aligns narration and essential actions without truncation or playback-rate changes', () => {
  const result = reconcileMeasuredTimeline(input());
  expect(result.scenes[0]).toMatchObject({
    range: { startUs: 0, endUs: 5_000_000 },
    narrationRange: { startUs: 0, endUs: 5_000_000 },
    visualRange: { startUs: 500_000, endUs: 4_500_000 },
    anchors: [{ id: 'save_anchor', narrationAtUs: 2_000_000, actionAtUs: 2_000_000, driftUs: 0 }],
    frames: { start: 0, end: 150 },
  });
  expect(result.timeline.clips).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: 'voice_1',
        range: { startUs: 0, endUs: 5_000_000 },
        sourceStartUs: 0,
        playbackRate: 1,
      }),
      expect.objectContaining({
        id: 'visual_1',
        range: { startUs: 500_000, endUs: 4_500_000 },
        sourceStartUs: 0,
        playbackRate: 1,
      }),
    ]),
  );
  expect(result.timeline.intentionalIntervals).toEqual([
    expect.objectContaining({ kind: 'hold', range: { startUs: 0, endUs: 500_000 } }),
    expect.objectContaining({ kind: 'hold', range: { startUs: 4_500_000, endUs: 5_000_000 } }),
  ]);
});

it('keeps known anchor fixtures within 250 ms and rejects incompatible anchors', () => {
  const near = input();
  near.scenes[0]!.narrationAnchors.push({ id: 'say_done', atUs: 3_000_000 });
  near.scenes[0]!.actionAnchors.push({ id: 'show_done', atUs: 2_300_000 });
  near.scenes[0]!.bindings.push({
    id: 'done_anchor',
    narrationAnchorId: 'say_done',
    actionAnchorId: 'show_done',
  });
  expect(
    reconcileMeasuredTimeline(near).scenes[0]!.anchors.map((anchor) => anchor.driftUs),
  ).toEqual([200_000, 0]);
  near.scenes[0]!.actionAnchors[1] = { id: 'show_done', atUs: 1_500_000 };
  expect(() => reconcileMeasuredTimeline(near)).toThrow('TIMING_ANCHORS_INCOMPATIBLE');
});

it('uses an authorized cutaway for a measured visual gap', () => {
  const value = input();
  value.scenes[0]!.allowHold = false;
  value.scenes[0]!.allowCutaway = true;
  value.scenes[0]!.cutaway = artifact('cutaway_intro', 'video', 2_000_000);
  const result = reconcileMeasuredTimeline(value);
  expect(result.timeline.clips.filter((clip) => clip.id.startsWith('cutaway_'))).toHaveLength(2);
  expect(result.timeline.intentionalIntervals).toEqual([]);
});

it('rejects an unapproved visual gap instead of speeding or truncating media', () => {
  const value = input();
  value.scenes[0]!.allowHold = false;
  expect(() => reconcileMeasuredTimeline(value)).toThrow('TIMING_VISUAL_GAP_UNAUTHORIZED');
});
