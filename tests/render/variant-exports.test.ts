import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createVariantExporter, type VariantExportRunner } from '@tutorialx/adapters';
import { type OperationContext, timelineSchema, type VideoSettings } from '@tutorialx/contracts';
import { attachCaptionTrack, buildFinalCaptionTrack } from '@tutorialx/core';
import { afterEach, expect, it } from 'vitest';
import { digest } from '../fixtures/contracts.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function context(root: string): OperationContext {
  return {
    operationId: 'operation_export',
    jobId: 'job_export',
    attemptId: 'attempt_export',
    reservationId: null,
    outputDirectory: root,
    deadlineAt: '2099-01-01T00:00:00Z',
    signal: new AbortController().signal,
  };
}

function accepted() {
  const captions = buildFinalCaptionTrack({
    id: 'captions_final',
    createdAt: '2026-11-20T00:00:00Z',
    jobId: 'job_export',
    planRevision: 2,
    audioArtifactIds: ['audio_final'],
    language: 'en-US',
    durationUs: 1_000_000,
    words: [{ sceneId: 'intro', text: 'Hello', range: { startUs: 0, endUs: 900_000 } }],
    maxCharactersPerLine: 30,
    maxLines: 2,
    maxCueDurationUs: 2_000_000,
  });
  const timeline = attachCaptionTrack(
    timelineSchema.parse({
      schemaVersion: 1,
      id: 'timeline_accepted',
      createdAt: '2026-11-20T00:00:00Z',
      jobId: 'job_export',
      planId: 'plan_export',
      planRevision: 2,
      settingsDigest: digest,
      variantId: 'landscape',
      frameRate: { numerator: 30, denominator: 1 },
      durationUs: 1_000_000,
      clips: [],
      captionTrackId: null,
      intentionalIntervals: [],
    }),
    captions,
  );
  return { timeline, captions };
}

const style = {
  fontFamily: 'Inter',
  fontSize: 48,
  color: '#ffffff',
  backgroundColor: '#000000cc',
  maxLines: 2,
  position: 'bottom' as const,
};

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'tutorialx-variant-export-'));
  roots.push(root);
  const source = join(root, 'accepted.mp4');
  await writeFile(source, 'accepted video');
  const runner: VariantExportRunner = {
    async run(_executable, args) {
      await writeFile(args.at(-1)!, 'generated media');
      return { exitCode: 0, stdout: '', stderr: '' };
    },
  };
  return { root, source, exporter: createVariantExporter({ runner }) };
}

it.each([
  ['none', [], ['video']],
  ['embedded', [], ['video']],
  ['sidecar', ['srt'], ['video', 'srt']],
  ['both', ['srt', 'vtt'], ['video', 'srt', 'vtt']],
] as const)('exports only requested files for %s captions', async (mode, formats, expected) => {
  const { root, source, exporter } = await fixture();
  const { timeline, captions } = accepted();
  const settings: VideoSettings['captions'] = {
    mode,
    formats: [...formats],
    language: 'en-US',
    style,
  };
  const output = join(root, 'output');
  const files = await exporter.export(
    {
      videoPath: source,
      outputDirectory: output,
      baseName: 'landscape',
      timeline,
      captions,
      settings,
      thumbnail: false,
    },
    context(root),
  );
  expect(files.map((file) => file.role)).toEqual(expected);
  expect(files.every((file) => file.timelineId === 'timeline_accepted')).toBe(true);
  expect((await readdir(output)).sort()).toEqual(
    expected.map((role) => `landscape.${role === 'video' ? 'mp4' : role}`).sort(),
  );
});

it('generates a thumbnail only when the selected variant requests one', async () => {
  const { root, source, exporter } = await fixture();
  const { timeline, captions } = accepted();
  const files = await exporter.export(
    {
      videoPath: source,
      outputDirectory: join(root, 'output'),
      baseName: 'landscape',
      timeline,
      captions,
      settings: { mode: 'none', formats: [], language: 'en-US', style },
      thumbnail: true,
    },
    context(root),
  );
  expect(files.map((file) => file.role)).toEqual(['video', 'thumbnail']);
});

it('rejects a caption track from any timeline revision other than the accepted one', async () => {
  const { root, source, exporter } = await fixture();
  const { timeline, captions } = accepted();
  await expect(
    exporter.export(
      {
        videoPath: source,
        outputDirectory: join(root, 'output'),
        baseName: 'landscape',
        timeline: { ...timeline, captionTrackId: 'stale' },
        captions,
        settings: { mode: 'embedded', formats: [], language: 'en-US', style },
        thumbnail: false,
      },
      context(root),
    ),
  ).rejects.toThrow('VARIANT_EXPORT_TIMELINE_MISMATCH');
});
