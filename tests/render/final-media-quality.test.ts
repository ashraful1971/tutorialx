import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyzeFinalMedia, type MediaQualityProcessRunner } from '@tutorialx/adapters';
import { createNarrationQualityProfile } from '@tutorialx/core';
import { afterEach, expect, it } from 'vitest';
import { timestamp } from '../fixtures/contracts.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const profile = createNarrationQualityProfile({
  id: 'quality_analysis',
  createdAt: timestamp,
  channels: 2,
});

async function mediaFile() {
  const root = await mkdtemp(join(tmpdir(), 'tutorialx-quality-'));
  roots.push(root);
  const path = join(root, 'final.mp4');
  await writeFile(path, 'fixture media');
  return path;
}

it('probes, fully decodes, and measures final-media defects with bounded argument arrays', async () => {
  const path = await mediaFile();
  const calls: string[][] = [];
  const runner: MediaQualityProcessRunner = {
    async run(executable, args) {
      calls.push([executable, ...args]);
      if (executable === 'ffprobe')
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            streams: [
              {
                codec_type: 'video',
                codec_name: 'h264',
                width: 1920,
                height: 1080,
                avg_frame_rate: '30000/1000',
                duration: '5.000000',
              },
              {
                codec_type: 'audio',
                codec_name: 'aac',
                sample_rate: '48000',
                channels: 2,
                duration: '5.000000',
              },
            ],
            format: { duration: '5.000000' },
          }),
          stderr: '',
        };
      if (args.includes('-xerror')) return { exitCode: 0, stdout: '', stderr: '' };
      if (args.includes('-vf'))
        return {
          exitCode: 0,
          stdout: '',
          stderr: 'black_start:0 black_end:0.8 black_duration:0.8\nfreeze_start: 1\nfreeze_end: 2',
        };
      if (args.includes('-af'))
        return {
          exitCode: 0,
          stdout: '',
          stderr:
            'silence_start: 2\nsilence_end: 3 | silence_duration: 1\nSummary:\n  I: -16.0 LUFS\n  Peak: -1.2 dBFS',
        };
      throw new Error('unexpected quality command');
    },
  };
  const result = await analyzeFinalMedia(path, profile, { runner });
  expect(result).toMatchObject({
    decodable: true,
    fullyDecoded: true,
    durationUs: 5_000_000,
    videoDurationUs: 5_000_000,
    audioDurationUs: 5_000_000,
    width: 1920,
    height: 1080,
    frameRate: { numerator: 30_000, denominator: 1000 },
    videoStreamCount: 1,
    audioStreamCount: 1,
    loudnessLufs: -16,
    truePeakDbtp: -1.2,
  });
  expect(result.intervals).toEqual([
    { kind: 'blank', range: { startUs: 0, endUs: 800_000 } },
    { kind: 'frozen', range: { startUs: 1_000_000, endUs: 2_000_000 } },
    { kind: 'silent', range: { startUs: 2_000_000, endUs: 3_000_000 } },
  ]);
  expect(calls.find((call) => call.includes('-vf'))?.join(' ')).toContain('pic_th=0.98');
  expect(calls.find((call) => call.includes('-af'))?.join(' ')).toContain('noise=-50dB');
  expect(calls.every((call) => call.includes(path))).toBe(true);
});

it('returns an explicit undecodable observation when FFprobe rejects final bytes', async () => {
  const path = await mediaFile();
  const runner: MediaQualityProcessRunner = {
    async run() {
      return { exitCode: 1, stdout: '', stderr: 'invalid data' };
    },
  };
  await expect(analyzeFinalMedia(path, profile, { runner })).resolves.toMatchObject({
    decodable: false,
    fullyDecoded: false,
    videoStreamCount: 0,
    audioStreamCount: 0,
  });
});
