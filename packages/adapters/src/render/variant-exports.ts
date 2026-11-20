import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { copyFile, link, mkdir, open, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CaptionTrack, OperationContext, Timeline, VideoSettings } from '@tutorialx/contracts';
import { serializeSrt, serializeWebVtt } from '@tutorialx/core';

export interface VariantExportRequest {
  videoPath: string;
  outputDirectory: string;
  baseName: string;
  timeline: Timeline;
  captions: CaptionTrack | null;
  settings: VideoSettings['captions'];
  thumbnail: boolean;
}

export interface VariantExportFile {
  role: 'video' | 'srt' | 'vtt' | 'thumbnail';
  path: string;
  timelineId: string;
}

export interface VariantExportRunner {
  run(
    executable: string,
    args: readonly string[],
    signal: AbortSignal,
  ): Promise<{ exitCode: number; stdout: string; stderr: string }>;
}

function nativeRunner(): VariantExportRunner {
  return {
    run(executable, args, signal) {
      return new Promise((resolve, reject) => {
        const child = spawn(executable, [...args], {
          stdio: ['ignore', 'pipe', 'pipe'],
          signal,
          env: { ...process.env, NO_COLOR: '1' },
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')));
        child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
        child.once('error', reject);
        child.once('close', (code) => resolve({ exitCode: code ?? -1, stdout, stderr }));
      });
    },
  };
}

function operationSignal(context: OperationContext) {
  context.signal.throwIfAborted();
  const remaining = Date.parse(context.deadlineAt) - Date.now();
  if (!(remaining > 0)) throw new Error('VARIANT_EXPORT_DEADLINE_EXCEEDED');
  return AbortSignal.any([context.signal, AbortSignal.timeout(Math.min(2_147_483_647, remaining))]);
}

function validateBinding(request: VariantExportRequest) {
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(request.baseName))
    throw new Error('VARIANT_EXPORT_NAME_INVALID');
  if (request.settings.mode !== 'none' && !request.captions)
    throw new Error('VARIANT_EXPORT_CAPTIONS_MISSING');
  if (request.captions) {
    const track = request.captions;
    if (
      request.timeline.captionTrackId !== track.id ||
      request.timeline.jobId !== track.jobId ||
      request.timeline.planRevision !== track.planRevision ||
      request.timeline.durationUs !== track.durationUs
    )
      throw new Error('VARIANT_EXPORT_TIMELINE_MISMATCH');
  }
}

async function writeNew(path: string, value: string) {
  const file = await open(path, 'wx', 0o600);
  try {
    await file.writeFile(value, 'utf8');
  } finally {
    await file.close();
  }
}

function escapedSubtitlePath(path: string) {
  return path.replaceAll('\\', '/').replace(/([:'\[\],])/g, '\\$1');
}

export function createVariantExporter(
  options: { ffmpegPath?: string; runner?: VariantExportRunner } = {},
) {
  const processRunner = options.runner ?? nativeRunner();
  return {
    async export(
      request: VariantExportRequest,
      context: OperationContext,
    ): Promise<readonly VariantExportFile[]> {
      validateBinding(request);
      await mkdir(request.outputDirectory, { recursive: true, mode: 0o700 });
      const signal = operationSignal(context);
      const files: VariantExportFile[] = [];
      const video = join(request.outputDirectory, `${request.baseName}.mp4`);
      const embedded = request.settings.mode === 'embedded' || request.settings.mode === 'both';
      let burnSrt: string | null = null;
      if (embedded) {
        burnSrt = join(request.outputDirectory, `.${context.attemptId}.embedded.srt`);
        await writeFile(burnSrt, serializeSrt(request.captions!), { mode: 0o600, flag: 'wx' });
        const partial = join(request.outputDirectory, `.${context.attemptId}.video.partial.mp4`);
        const style = request.settings.style;
        const forceStyle = `FontName=${style.fontFamily},FontSize=${style.fontSize},PrimaryColour=&H${style.color.slice(1)},OutlineColour=&H${style.backgroundColor.slice(1)}`;
        const result = await processRunner.run(
          options.ffmpegPath ?? 'ffmpeg',
          [
            '-hide_banner',
            '-nostdin',
            '-y',
            '-i',
            request.videoPath,
            '-vf',
            `subtitles=${escapedSubtitlePath(burnSrt)}:force_style='${forceStyle}'`,
            '-c:v',
            'libx264',
            '-c:a',
            'copy',
            partial,
          ],
          signal,
        );
        await unlink(burnSrt);
        burnSrt = null;
        if (result.exitCode !== 0) {
          await unlink(partial).catch(() => undefined);
          throw new Error('VARIANT_EXPORT_EMBED_FAILED');
        }
        await link(partial, video);
        await unlink(partial);
      } else await copyFile(request.videoPath, video, constants.COPYFILE_EXCL);
      files.push({ role: 'video', path: video, timelineId: request.timeline.id });

      if (request.settings.mode === 'sidecar' || request.settings.mode === 'both') {
        for (const format of request.settings.formats) {
          const path = join(request.outputDirectory, `${request.baseName}.${format}`);
          await writeNew(
            path,
            format === 'srt' ? serializeSrt(request.captions!) : serializeWebVtt(request.captions!),
          );
          files.push({ role: format, path, timelineId: request.timeline.id });
        }
      }
      if (request.thumbnail) {
        const thumbnail = join(request.outputDirectory, `${request.baseName}.jpg`);
        const partial = join(
          request.outputDirectory,
          `.${context.attemptId}.thumbnail.partial.jpg`,
        );
        const at = Math.max(
          0,
          Math.min(request.timeline.durationUs - 1, request.timeline.durationUs / 10),
        );
        const result = await processRunner.run(
          options.ffmpegPath ?? 'ffmpeg',
          [
            '-hide_banner',
            '-nostdin',
            '-y',
            '-ss',
            (at / 1_000_000).toFixed(6),
            '-i',
            video,
            '-frames:v',
            '1',
            '-update',
            '1',
            partial,
          ],
          signal,
        );
        if (result.exitCode !== 0 || (await stat(partial)).size === 0) {
          await unlink(partial).catch(() => undefined);
          throw new Error('VARIANT_EXPORT_THUMBNAIL_FAILED');
        }
        await link(partial, thumbnail);
        await unlink(partial);
        files.push({ role: 'thumbnail', path: thumbnail, timelineId: request.timeline.id });
      }
      return files;
    },
  };
}
