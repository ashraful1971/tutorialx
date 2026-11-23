import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createFfmpegReviewMediaMaterializer,
  type ReviewMediaProcessRunner,
} from '@tutorialx/adapters';
import { afterEach, expect, it } from 'vitest';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it('extracts a representative final frame and exact final-media clip for every scene', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tutorialx-review-media-'));
  roots.push(root);
  const videoPath = join(root, 'final.mp4');
  const outputDirectory = join(root, 'review');
  await writeFile(videoPath, 'final video');
  const calls: string[][] = [];
  const runner: ReviewMediaProcessRunner = {
    async run(executable, args) {
      calls.push([executable, ...args]);
      await writeFile(args.at(-1)!, args.includes('-frames:v') ? 'frame' : 'clip');
      return { exitCode: 0, stdout: '', stderr: '' };
    },
  };
  const files = await createFfmpegReviewMediaMaterializer({ runner }).materialize({
    videoPath,
    outputDirectory,
    scenes: [
      { sceneId: 'intro', range: { startUs: 0, endUs: 2_000_000 } },
      { sceneId: 'details', range: { startUs: 2_000_000, endUs: 5_000_000 } },
    ],
  });
  expect(files).toHaveLength(4);
  expect(files.map((file) => file.kind)).toEqual([
    'final-frame',
    'final-clip',
    'final-frame',
    'final-clip',
  ]);
  expect(await Promise.all(files.map((file) => readFile(file.path, 'utf8')))).toEqual([
    'frame',
    'clip',
    'frame',
    'clip',
  ]);
  expect(calls.filter((call) => call.includes('-frames:v'))).toHaveLength(2);
  expect(
    calls.filter((call) => call.includes('-t')).map((call) => call[call.indexOf('-t') + 1]),
  ).toEqual(['2.000000', '3.000000']);
  expect(calls.every((call) => call.includes(videoPath))).toBe(true);
});

it('removes completed review files when a later extraction fails', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tutorialx-review-media-'));
  roots.push(root);
  const videoPath = join(root, 'final.mp4');
  const outputDirectory = join(root, 'review');
  await writeFile(videoPath, 'final video');
  let call = 0;
  const runner: ReviewMediaProcessRunner = {
    async run(_executable, args) {
      call++;
      if (call === 4) return { exitCode: 1, stdout: '', stderr: 'fixture failure' };
      await writeFile(args.at(-1)!, 'evidence');
      return { exitCode: 0, stdout: '', stderr: '' };
    },
  };
  await expect(
    createFfmpegReviewMediaMaterializer({ runner }).materialize({
      videoPath,
      outputDirectory,
      scenes: [
        { sceneId: 'intro', range: { startUs: 0, endUs: 2_000_000 } },
        { sceneId: 'details', range: { startUs: 2_000_000, endUs: 5_000_000 } },
      ],
    }),
  ).rejects.toThrow('REVIEW_MEDIA_CLIP_FAILED');
  expect(await readdir(outputDirectory)).toEqual([]);
});
