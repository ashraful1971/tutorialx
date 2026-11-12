import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';

export async function probeExecutable(executable: string): Promise<boolean> {
  try {
    await runTool(executable, ['-version'], new AbortController().signal, 100_000, 5000);
    return true;
  } catch {
    return false;
  }
}
export function runTool(
  executable: string,
  args: readonly string[],
  signal: AbortSignal,
  maxBuffer: number,
  timeout: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      executable,
      [...args],
      {
        signal,
        maxBuffer,
        timeout,
        encoding: 'utf8',
        windowsHide: true,
        env: { PATH: process.env.PATH ?? '', LANG: 'C' },
      },
      (error, stdout) =>
        error
          ? reject(
              new Error(
                'Optional media probe is missing, timed out, or could not decode this source.',
              ),
            )
          : resolve(stdout),
    );
  });
}
export async function probeBytes(
  bytes: Buffer,
  executable: string,
  signal: AbortSignal,
  timeout: number,
): Promise<unknown> {
  const root = await mkdtemp(join(tmpdir(), 'tutorialx-reader-'));
  try {
    const path = join(root, 'input.media');
    await writeFile(path, bytes, { mode: 0o600, flag: 'wx' });
    const stdout = await runTool(
      executable,
      [
        '-v',
        'error',
        '-protocol_whitelist',
        'file,pipe',
        '-format_whitelist',
        'mov,matroska,webm,avi,mp3,ogg,flac,wav',
        '-print_format',
        'json',
        '-show_entries',
        'format=duration,format_name:stream=codec_type,codec_name,width,height,sample_rate,channels,avg_frame_rate,duration',
        '-i',
        path,
      ],
      signal,
      256_000,
      timeout,
    );
    return JSON.parse(stdout) as unknown;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
export async function documentText(
  format: 'html' | 'docx' | 'pdf',
  bytes: Uint8Array,
  signal: AbortSignal,
  timeout: number,
  maxPages: number,
  maxOutputBytes: number,
): Promise<{ chunks: { page: number | null; text: string }[]; truncated: boolean }> {
  signal.throwIfAborted();
  const worker = new Worker(new URL('./document-worker.js', import.meta.url), {
    workerData: { format, bytes, maxPages, maxOutputBytes },
    stdout: true,
    stderr: true,
    resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 },
  });
  worker.stdout.resume();
  worker.stderr.resume();
  try {
    return await new Promise((resolve, reject) => {
      const stop = () => {
        void worker.terminate();
        reject(new Error('Document extraction was cancelled or exceeded its deadline.'));
      };
      const timer = setTimeout(stop, timeout);
      const cleanup = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', stop);
      };
      signal.addEventListener('abort', stop, { once: true });
      worker.once(
        'message',
        (message: {
          result?: { chunks: { page: number | null; text: string }[]; truncated: boolean };
          error?: string;
        }) => {
          cleanup();
          message.result
            ? resolve(message.result)
            : reject(new Error(message.error ?? 'Document extraction failed.'));
        },
      );
      worker.once('error', () => {
        cleanup();
        reject(new Error('Document decoder exceeded its resource limit or is unavailable.'));
      });
      worker.once('exit', (code) => {
        cleanup();
        if (code !== 0) reject(new Error('Document decoder exited before producing a result.'));
      });
    });
  } finally {
    await worker.terminate();
  }
}
