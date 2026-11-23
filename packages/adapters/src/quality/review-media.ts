import { spawn } from 'node:child_process';
import { link, lstat, mkdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { TimeRange } from '@tutorialx/contracts';

export interface ReviewMediaProcessRunner {
  run(
    executable: string,
    args: readonly string[],
    options: { signal: AbortSignal; maxOutputBytes: number },
  ): Promise<{ exitCode: number; stdout: string; stderr: string }>;
}

export interface ReviewSceneRange {
  sceneId: string;
  range: TimeRange;
}

export interface ReviewMediaFile {
  sceneId: string;
  kind: 'final-frame' | 'final-clip';
  path: string;
  range: TimeRange;
}

function nativeRunner(): ReviewMediaProcessRunner {
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
            reject(new Error('REVIEW_MEDIA_OUTPUT_LIMIT_EXCEEDED'));
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

const seconds = (microseconds: number) => (microseconds / 1_000_000).toFixed(6);

export function createFfmpegReviewMediaMaterializer(
  options: {
    ffmpegPath?: string;
    runner?: ReviewMediaProcessRunner;
    maxDiagnosticBytes?: number;
    timeoutMs?: number;
  } = {},
) {
  const runner = options.runner ?? nativeRunner();
  return {
    async materialize(input: {
      videoPath: string;
      outputDirectory: string;
      scenes: readonly ReviewSceneRange[];
      signal?: AbortSignal;
    }): Promise<readonly ReviewMediaFile[]> {
      const source = await lstat(input.videoPath).catch(() => null);
      if (!source?.isFile() || source.isSymbolicLink())
        throw new Error('REVIEW_MEDIA_INPUT_INVALID');
      if (input.scenes.length === 0 || input.scenes.length > 2000)
        throw new Error('REVIEW_MEDIA_SCENES_INVALID');
      const ids = new Set(input.scenes.map((scene) => scene.sceneId));
      if (ids.size !== input.scenes.length) throw new Error('REVIEW_MEDIA_SCENES_INVALID');
      await mkdir(input.outputDirectory, { recursive: true, mode: 0o700 });
      const timeout = AbortSignal.timeout(options.timeoutMs ?? 120_000);
      const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout;
      const files: ReviewMediaFile[] = [];
      try {
        for (const [index, scene] of input.scenes.entries()) {
          if (
            !Number.isSafeInteger(scene.range.startUs) ||
            !Number.isSafeInteger(scene.range.endUs) ||
            scene.range.startUs < 0 ||
            scene.range.endUs <= scene.range.startUs
          )
            throw new Error('REVIEW_MEDIA_RANGE_INVALID');
          const base = `scene-${String(index + 1).padStart(4, '0')}`;
          const frame = join(input.outputDirectory, `${base}-frame.jpg`);
          const framePartial = join(input.outputDirectory, `.${base}-frame.partial.jpg`);
          const midpoint =
            scene.range.startUs + Math.floor((scene.range.endUs - scene.range.startUs) / 2);
          const frameResult = await runner.run(
            options.ffmpegPath ?? 'ffmpeg',
            [
              '-hide_banner',
              '-nostdin',
              '-y',
              '-ss',
              seconds(midpoint),
              '-i',
              input.videoPath,
              '-frames:v',
              '1',
              '-update',
              '1',
              framePartial,
            ],
            { signal, maxOutputBytes: options.maxDiagnosticBytes ?? 4 * 1024 * 1024 },
          );
          if (
            frameResult.exitCode !== 0 ||
            (await stat(framePartial).catch(() => null))?.size === 0
          ) {
            await unlink(framePartial).catch(() => undefined);
            throw new Error('REVIEW_MEDIA_FRAME_FAILED');
          }
          await link(framePartial, frame);
          await unlink(framePartial);
          files.push({
            sceneId: scene.sceneId,
            kind: 'final-frame',
            path: frame,
            range: scene.range,
          });

          const clip = join(input.outputDirectory, `${base}-clip.mp4`);
          const clipPartial = join(input.outputDirectory, `.${base}-clip.partial.mp4`);
          const clipResult = await runner.run(
            options.ffmpegPath ?? 'ffmpeg',
            [
              '-hide_banner',
              '-nostdin',
              '-y',
              '-ss',
              seconds(scene.range.startUs),
              '-i',
              input.videoPath,
              '-t',
              seconds(scene.range.endUs - scene.range.startUs),
              '-map',
              '0:v:0',
              '-map',
              '0:a?',
              '-c:v',
              'libx264',
              '-c:a',
              'aac',
              clipPartial,
            ],
            { signal, maxOutputBytes: options.maxDiagnosticBytes ?? 4 * 1024 * 1024 },
          );
          if (
            clipResult.exitCode !== 0 ||
            (await stat(clipPartial).catch(() => null))?.size === 0
          ) {
            await unlink(clipPartial).catch(() => undefined);
            throw new Error('REVIEW_MEDIA_CLIP_FAILED');
          }
          await link(clipPartial, clip);
          await unlink(clipPartial);
          files.push({
            sceneId: scene.sceneId,
            kind: 'final-clip',
            path: clip,
            range: scene.range,
          });
        }
      } catch (error) {
        await Promise.all(files.map((file) => unlink(file.path).catch(() => undefined)));
        throw error;
      }
      return files;
    },
  };
}
