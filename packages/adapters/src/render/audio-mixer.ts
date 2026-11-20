import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { link, lstat, mkdir, stat, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { OperationContext } from '@tutorialx/contracts';

export interface AudioMixClip {
  path: string;
  startUs: number;
  sourceStartUs: number;
  durationUs: number;
  gainDb: number;
}

export interface AudioMixInput {
  durationUs: number;
  sampleRate: number;
  voice: readonly AudioMixClip[];
  music: (AudioMixClip & { loop: boolean }) | null;
  effects: readonly AudioMixClip[];
  ducking: boolean;
  outputPath: string;
}

export interface AudioMixResult {
  path: string;
  sizeBytes: number;
  digest: string;
  ffmpegArguments: readonly string[];
}

export interface AudioProcessRunner {
  run(
    executable: string,
    args: readonly string[],
    options: { signal: AbortSignal; maxOutputBytes: number },
  ): Promise<{ exitCode: number; stdout: string; stderr: string }>;
}

export interface FfmpegAudioMixerOptions {
  ffmpegPath?: string;
  runner?: AudioProcessRunner;
  maxOutputBytes?: number;
  maxDiagnosticBytes?: number;
}

function nativeRunner(): AudioProcessRunner {
  return {
    run(executable, args, options) {
      return new Promise((resolve, reject) => {
        const child = spawn(executable, [...args], {
          stdio: ['ignore', 'pipe', 'pipe'],
          signal: options.signal,
          env: { ...process.env, NO_COLOR: '1' },
        });
        let stdout = '';
        let stderr = '';
        let bytes = 0;
        const append = (target: 'stdout' | 'stderr', chunk: Buffer) => {
          bytes += chunk.byteLength;
          if (bytes > options.maxOutputBytes) {
            child.kill('SIGKILL');
            reject(new Error('AUDIO_MIX_DIAGNOSTIC_LIMIT_EXCEEDED'));
            return;
          }
          if (target === 'stdout') stdout += chunk.toString('utf8');
          else stderr += chunk.toString('utf8');
        };
        child.stdout.on('data', (chunk: Buffer) => append('stdout', chunk));
        child.stderr.on('data', (chunk: Buffer) => append('stderr', chunk));
        child.once('error', reject);
        child.once('close', (code) => resolve({ exitCode: code ?? -1, stdout, stderr }));
      });
    },
  };
}

function operationSignal(context: OperationContext) {
  context.signal.throwIfAborted();
  const remaining = Date.parse(context.deadlineAt) - Date.now();
  if (!(remaining > 0)) throw new Error('AUDIO_MIX_DEADLINE_EXCEEDED');
  return AbortSignal.any([context.signal, AbortSignal.timeout(Math.min(2_147_483_647, remaining))]);
}

const seconds = (microseconds: number) => (microseconds / 1_000_000).toFixed(6);

function validateClip(clip: AudioMixClip) {
  if (
    !clip.path ||
    !Number.isSafeInteger(clip.startUs) ||
    clip.startUs < 0 ||
    !Number.isSafeInteger(clip.sourceStartUs) ||
    clip.sourceStartUs < 0 ||
    !Number.isSafeInteger(clip.durationUs) ||
    clip.durationUs <= 0 ||
    !Number.isFinite(clip.gainDb) ||
    clip.gainDb < -80 ||
    clip.gainDb > 12
  )
    throw new Error('AUDIO_MIX_CLIP_INVALID');
}

async function validateFile(path: string) {
  const info = await lstat(path).catch(() => null);
  if (!info?.isFile() || info.isSymbolicLink()) throw new Error('AUDIO_MIX_INPUT_MISSING');
}

function clipFilter(index: number, clip: AudioMixClip, label: string) {
  const delayMs = Math.round(clip.startUs / 1000);
  return `[${index}:a]atrim=start=${seconds(clip.sourceStartUs)}:duration=${seconds(clip.durationUs)},asetpts=PTS-STARTPTS,volume=${clip.gainDb}dB,adelay=${delayMs}:all=1[${label}]`;
}

function mix(labels: readonly string[], output: string) {
  if (labels.length === 1) return `[${labels[0]}]anull[${output}]`;
  return `${labels.map((label) => `[${label}]`).join('')}amix=inputs=${labels.length}:duration=longest:normalize=0[${output}]`;
}

export function buildAudioMixArguments(input: AudioMixInput, partialPath: string) {
  if (
    !Number.isSafeInteger(input.durationUs) ||
    input.durationUs <= 0 ||
    !Number.isSafeInteger(input.sampleRate) ||
    input.sampleRate < 8_000 ||
    input.sampleRate > 192_000 ||
    input.voice.length === 0 ||
    input.voice.length > 2_000 ||
    input.effects.length > 2_000
  )
    throw new Error('AUDIO_MIX_INPUT_INVALID');
  const clips = [...input.voice, ...(input.music ? [input.music] : []), ...input.effects];
  for (const clip of clips) validateClip(clip);
  const args = ['-hide_banner', '-nostdin', '-y'];
  for (const clip of input.voice) args.push('-i', clip.path);
  if (input.music) {
    if (input.music.loop) args.push('-stream_loop', '-1');
    args.push('-i', input.music.path);
  }
  for (const clip of input.effects) args.push('-i', clip.path);

  const filters: string[] = [];
  const voiceLabels = input.voice.map((clip, index) => {
    const label = `voice_${index}`;
    filters.push(clipFilter(index, clip, label));
    return label;
  });
  filters.push(mix(voiceLabels, 'voice_bus'));
  const finalLabels = ['voice_bus'];
  let inputIndex = input.voice.length;
  if (input.music) {
    const label = `music_${inputIndex}`;
    filters.push(clipFilter(inputIndex, input.music, label));
    if (input.ducking) {
      filters.push(
        `[${label}][voice_bus]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=300[ducked_music]`,
      );
      finalLabels.push('ducked_music');
    } else finalLabels.push(label);
    inputIndex++;
  }
  for (const [effectIndex, effect] of input.effects.entries()) {
    const label = `effect_${effectIndex}`;
    filters.push(clipFilter(inputIndex++, effect, label));
    finalLabels.push(label);
  }
  filters.push(mix(finalLabels, 'mixed'));
  filters.push(
    `[mixed]atrim=duration=${seconds(input.durationUs)},aresample=${input.sampleRate}:async=0:first_pts=0[output]`,
  );
  args.push(
    '-filter_complex',
    filters.join(';'),
    '-map',
    '[output]',
    '-vn',
    '-c:a',
    'pcm_s16le',
    '-ar',
    String(input.sampleRate),
    partialPath,
  );
  return args;
}

async function fileDigest(path: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

export function createFfmpegAudioMixer(options: FfmpegAudioMixerOptions = {}) {
  const processRunner = options.runner ?? nativeRunner();
  return {
    async mix(input: AudioMixInput, context: OperationContext): Promise<AudioMixResult> {
      for (const clip of [...input.voice, ...(input.music ? [input.music] : []), ...input.effects])
        await validateFile(clip.path);
      await mkdir(dirname(input.outputPath), { recursive: true, mode: 0o700 });
      const partial = join(
        dirname(input.outputPath),
        `.${context.attemptId}-${context.operationId}.partial.wav`,
      );
      await unlink(partial).catch(() => undefined);
      const args = buildAudioMixArguments(input, partial);
      const result = await processRunner.run(options.ffmpegPath ?? 'ffmpeg', args, {
        signal: operationSignal(context),
        maxOutputBytes: options.maxDiagnosticBytes ?? 4 * 1024 * 1024,
      });
      if (result.exitCode !== 0) {
        await unlink(partial).catch(() => undefined);
        throw new Error('AUDIO_MIX_FFMPEG_FAILED');
      }
      const info = await stat(partial);
      if (
        !info.isFile() ||
        info.size < 44 ||
        info.size > (options.maxOutputBytes ?? 2 * 1024 ** 3)
      ) {
        await unlink(partial).catch(() => undefined);
        throw new Error('AUDIO_MIX_OUTPUT_INVALID');
      }
      await link(partial, input.outputPath);
      await unlink(partial);
      return {
        path: input.outputPath,
        sizeBytes: info.size,
        digest: await fileDigest(input.outputPath),
        ffmpegArguments: args,
      };
    },
  };
}
