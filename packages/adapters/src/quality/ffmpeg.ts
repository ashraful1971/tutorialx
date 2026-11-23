import { spawn } from 'node:child_process';
import { lstat } from 'node:fs/promises';
import type { QualityProfile, TimeRange } from '@tutorialx/contracts';
import {
  type DetectedMediaInterval,
  resolveTechnicalQualityThresholds,
  type TechnicalMediaObservation,
} from '@tutorialx/core';

export interface MediaQualityProcessRunner {
  run(
    executable: string,
    args: readonly string[],
    options: { signal: AbortSignal; maxOutputBytes: number },
  ): Promise<{ exitCode: number; stdout: string; stderr: string }>;
}

export interface FfmpegQualityAnalyzerOptions {
  ffmpegPath?: string;
  ffprobePath?: string;
  runner?: MediaQualityProcessRunner;
  timeoutMs?: number;
  maxDiagnosticBytes?: number;
  signal?: AbortSignal;
}

function nativeRunner(): MediaQualityProcessRunner {
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
            reject(new Error('QUALITY_ANALYSIS_OUTPUT_LIMIT_EXCEEDED'));
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

function finite(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function positiveInteger(value: unknown): number | null {
  const parsed = finite(value);
  return parsed !== null && Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function frameRate(value: unknown) {
  const [numerator = 0, denominator = 0] = String(value ?? '')
    .split('/')
    .map(Number);
  return Number.isSafeInteger(numerator) &&
    numerator > 0 &&
    Number.isSafeInteger(denominator) &&
    denominator > 0
    ? { numerator, denominator }
    : null;
}

interface ProbeResult {
  durationUs: number | null;
  videoDurationUs: number | null;
  audioDurationUs: number | null;
  width: number | null;
  height: number | null;
  frameRate: TechnicalMediaObservation['frameRate'];
  videoStreamCount: number;
  audioStreamCount: number;
  videoCodec: string | null;
  audioCodec: string | null;
  sampleRate: number | null;
  channels: number | null;
}

function parseProbe(value: string): ProbeResult {
  const parsed = JSON.parse(value) as {
    streams?: Array<Record<string, unknown>>;
    format?: Record<string, unknown>;
  };
  if (!Array.isArray(parsed.streams) || parsed.streams.length > 1000)
    throw new Error('QUALITY_PROBE_INVALID');
  const videos = parsed.streams.filter((stream) => stream.codec_type === 'video');
  const audios = parsed.streams.filter((stream) => stream.codec_type === 'audio');
  const video = videos[0];
  const audio = audios[0];
  const duration = finite(parsed.format?.duration ?? video?.duration ?? audio?.duration);
  const videoDuration = finite(video?.duration);
  const audioDuration = finite(audio?.duration);
  return {
    durationUs: duration !== null && duration >= 0 ? Math.round(duration * 1_000_000) : null,
    videoDurationUs:
      videoDuration !== null && videoDuration >= 0 ? Math.round(videoDuration * 1_000_000) : null,
    audioDurationUs:
      audioDuration !== null && audioDuration >= 0 ? Math.round(audioDuration * 1_000_000) : null,
    width: positiveInteger(video?.width),
    height: positiveInteger(video?.height),
    frameRate: frameRate(video?.avg_frame_rate ?? video?.r_frame_rate),
    videoStreamCount: videos.length,
    audioStreamCount: audios.length,
    videoCodec: video?.codec_name ? String(video.codec_name).slice(0, 100) : null,
    audioCodec: audio?.codec_name ? String(audio.codec_name).slice(0, 100) : null,
    sampleRate: positiveInteger(audio?.sample_rate),
    channels: positiveInteger(audio?.channels),
  };
}

function range(startSeconds: number, endSeconds: number, durationUs: number): TimeRange | null {
  const startUs = Math.max(0, Math.round(startSeconds * 1_000_000));
  const endUs = Math.min(durationUs, Math.round(endSeconds * 1_000_000));
  return endUs > startUs ? { startUs, endUs } : null;
}

function pairedIntervals(
  value: string,
  kind: DetectedMediaInterval['kind'],
  startLabel: string,
  endLabel: string,
  durationUs: number,
): DetectedMediaInterval[] {
  const events = [...value.matchAll(new RegExp(`(?:${startLabel}|${endLabel}):\\s*([0-9.]+)`, 'g'))]
    .map((match) => ({
      label: match[0]!.startsWith(startLabel) ? 'start' : 'end',
      seconds: Number(match[1]),
    }))
    .filter((event) => Number.isFinite(event.seconds));
  const intervals: DetectedMediaInterval[] = [];
  let start: number | null = null;
  for (const event of events) {
    if (event.label === 'start') start = event.seconds;
    else if (start !== null) {
      const detected = range(start, event.seconds, durationUs);
      if (detected) intervals.push({ kind, range: detected });
      start = null;
    }
  }
  if (start !== null) {
    const detected = range(start, durationUs / 1_000_000, durationUs);
    if (detected) intervals.push({ kind, range: detected });
  }
  return intervals;
}

function blackIntervals(value: string, durationUs: number): DetectedMediaInterval[] {
  return [...value.matchAll(/black_start:\s*([0-9.]+).*?black_end:\s*([0-9.]+)/g)]
    .map((match) => range(Number(match[1]), Number(match[2]), durationUs))
    .filter((entry): entry is TimeRange => entry !== null)
    .map((detected) => ({ kind: 'blank' as const, range: detected }));
}

function lastMetric(value: string, expression: RegExp): number | null {
  const matches = [...value.matchAll(expression)];
  return matches.length === 0 ? null : finite(matches.at(-1)?.[1]);
}

function emptyObservation(): TechnicalMediaObservation {
  return {
    decodable: false,
    fullyDecoded: false,
    durationUs: null,
    videoDurationUs: null,
    audioDurationUs: null,
    width: null,
    height: null,
    frameRate: null,
    videoStreamCount: 0,
    audioStreamCount: 0,
    videoCodec: null,
    audioCodec: null,
    sampleRate: null,
    channels: null,
    loudnessLufs: null,
    truePeakDbtp: null,
    intervals: [],
  };
}

export async function analyzeFinalMedia(
  path: string,
  profile: QualityProfile,
  options: FfmpegQualityAnalyzerOptions = {},
): Promise<TechnicalMediaObservation> {
  const info = await lstat(path).catch(() => null);
  if (!info?.isFile() || info.isSymbolicLink()) throw new Error('QUALITY_MEDIA_FILE_INVALID');
  const runner = options.runner ?? nativeRunner();
  const timeout = AbortSignal.timeout(options.timeoutMs ?? 120_000);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  const maxOutputBytes = options.maxDiagnosticBytes ?? 8 * 1024 * 1024;
  const probe = await runner.run(
    options.ffprobePath ?? 'ffprobe',
    ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', path],
    { signal, maxOutputBytes },
  );
  if (probe.exitCode !== 0) return emptyObservation();
  let measured: ProbeResult;
  try {
    measured = parseProbe(probe.stdout);
  } catch {
    return emptyObservation();
  }
  const observation: TechnicalMediaObservation = {
    decodable: true,
    fullyDecoded: false,
    ...measured,
    loudnessLufs: null,
    truePeakDbtp: null,
    intervals: [],
  };
  const decode = await runner.run(
    options.ffmpegPath ?? 'ffmpeg',
    [
      '-hide_banner',
      '-nostdin',
      '-v',
      'error',
      '-xerror',
      '-i',
      path,
      '-map',
      '0',
      '-f',
      'null',
      '-',
    ],
    { signal, maxOutputBytes },
  );
  observation.fullyDecoded = decode.exitCode === 0;
  if (measured.durationUs === null) return observation;
  const thresholds = resolveTechnicalQualityThresholds(profile);
  const intervals: DetectedMediaInterval[] = [];
  if (measured.videoStreamCount > 0) {
    const visual = await runner.run(
      options.ffmpegPath ?? 'ffmpeg',
      [
        '-hide_banner',
        '-nostdin',
        '-v',
        'info',
        '-i',
        path,
        '-vf',
        `blackdetect=d=${thresholds.blankMinDurationUs / 1_000_000}:pic_th=${thresholds.blackPixelRatio},freezedetect=n=${thresholds.freezeNoiseDb}dB:d=${thresholds.frozenMinDurationUs / 1_000_000}`,
        '-an',
        '-f',
        'null',
        '-',
      ],
      { signal, maxOutputBytes },
    );
    if (visual.exitCode !== 0) throw new Error('QUALITY_VISUAL_ANALYSIS_FAILED');
    intervals.push(...blackIntervals(visual.stderr, measured.durationUs));
    intervals.push(
      ...pairedIntervals(
        visual.stderr,
        'frozen',
        'freeze_start',
        'freeze_end',
        measured.durationUs,
      ),
    );
  }
  if (measured.audioStreamCount > 0) {
    const audio = await runner.run(
      options.ffmpegPath ?? 'ffmpeg',
      [
        '-hide_banner',
        '-nostdin',
        '-v',
        'info',
        '-i',
        path,
        '-af',
        `silencedetect=noise=${thresholds.silenceNoiseDb}dB:d=${thresholds.silentMinDurationUs / 1_000_000},ebur128=peak=true`,
        '-vn',
        '-f',
        'null',
        '-',
      ],
      { signal, maxOutputBytes },
    );
    if (audio.exitCode !== 0) throw new Error('QUALITY_AUDIO_ANALYSIS_FAILED');
    intervals.push(
      ...pairedIntervals(
        audio.stderr,
        'silent',
        'silence_start',
        'silence_end',
        measured.durationUs,
      ),
    );
    observation.loudnessLufs = lastMetric(audio.stderr, /\bI:\s*(-?[0-9.]+)\s+LUFS/g);
    observation.truePeakDbtp = lastMetric(audio.stderr, /\bPeak:\s*(-?[0-9.]+)\s+dBFS/g);
  }
  observation.intervals = intervals.sort((left, right) => left.range.startUs - right.range.startUs);
  return observation;
}
