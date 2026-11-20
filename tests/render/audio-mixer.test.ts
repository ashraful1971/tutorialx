import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type AudioProcessRunner,
  buildAudioMixArguments,
  createFfmpegAudioMixer,
} from '@tutorialx/adapters';
import type { OperationContext } from '@tutorialx/contracts';
import { afterEach, expect, it } from 'vitest';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function context(root: string): OperationContext {
  return {
    operationId: 'operation_mix',
    jobId: 'job_mix',
    attemptId: 'attempt_mix',
    reservationId: null,
    outputDirectory: root,
    deadlineAt: '2099-01-01T00:00:00Z',
    signal: new AbortController().signal,
  };
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'tutorialx-audio-mix-'));
  roots.push(root);
  const voice = join(root, 'voice.wav');
  const music = join(root, 'music.wav');
  await writeFile(voice, 'voice input');
  await writeFile(music, 'music input');
  return { root, voice, music, output: join(root, 'mixed.wav') };
}

const clip = (path: string, gainDb = 0) => ({
  path,
  startUs: 0,
  sourceStartUs: 0,
  durationUs: 1_000_000,
  gainDb,
});

it('builds explicit gain and sidechain ducking without normalizing the mix', async () => {
  const { voice, music, output } = await fixture();
  const args = buildAudioMixArguments(
    {
      durationUs: 1_000_000,
      sampleRate: 48_000,
      voice: [clip(voice)],
      music: { ...clip(music, -24), loop: true },
      effects: [],
      ducking: true,
      outputPath: output,
    },
    '.partial.wav',
  );
  expect(args).toContain('-stream_loop');
  const filters = args[args.indexOf('-filter_complex') + 1];
  expect(filters).toContain('volume=0dB');
  expect(filters).toContain('volume=-24dB');
  expect(filters).toContain('sidechaincompress=threshold=0.03:ratio=8');
  expect(filters).toContain('normalize=0');
});

it('keeps narration-only output free of music, effects, and ducking filters', async () => {
  const { voice, output } = await fixture();
  const args = buildAudioMixArguments(
    {
      durationUs: 1_000_000,
      sampleRate: 48_000,
      voice: [clip(voice)],
      music: null,
      effects: [],
      ducking: false,
      outputPath: output,
    },
    '.partial.wav',
  );
  expect(args.filter((argument) => argument === '-i')).toHaveLength(1);
  expect(args.join(' ')).not.toContain('music');
  expect(args.join(' ')).not.toContain('effect');
  expect(args.join(' ')).not.toContain('sidechaincompress');
});

it('accepts a completed mix atomically after bounded FFmpeg execution', async () => {
  const { root, voice, output } = await fixture();
  const processRunner: AudioProcessRunner = {
    async run(_executable, args) {
      await writeFile(args.at(-1)!, Buffer.alloc(48, 1));
      return { exitCode: 0, stdout: '', stderr: '' };
    },
  };
  const result = await createFfmpegAudioMixer({
    runner: processRunner,
    maxOutputBytes: 1000,
  }).mix(
    {
      durationUs: 1_000_000,
      sampleRate: 48_000,
      voice: [clip(voice)],
      music: null,
      effects: [],
      ducking: false,
      outputPath: output,
    },
    context(root),
  );
  expect(result.sizeBytes).toBe(48);
  expect(await readFile(output)).toEqual(Buffer.alloc(48, 1));
});

const liveFfmpeg = process.env.TUTORIALX_TEST_FFMPEG;
it.skipIf(!liveFfmpeg)('renders a real narration-only WAV with no added soundtrack', async () => {
  const { root, voice, output } = await fixture();
  const generated = spawnSync(
    liveFfmpeg!,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=1',
      '-c:a',
      'pcm_s16le',
      '-y',
      voice,
    ],
    { encoding: 'utf8' },
  );
  expect(generated.status, generated.stderr).toBe(0);
  const result = await createFfmpegAudioMixer({ ffmpegPath: liveFfmpeg! }).mix(
    {
      durationUs: 1_000_000,
      sampleRate: 48_000,
      voice: [clip(voice)],
      music: null,
      effects: [],
      ducking: false,
      outputPath: output,
    },
    context(root),
  );
  expect(result.sizeBytes).toBeGreaterThan(90_000);
  expect(result.ffmpegArguments.filter((argument) => argument === '-i')).toHaveLength(1);
});
