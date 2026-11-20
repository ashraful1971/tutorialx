import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, expect, it } from 'vitest';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function wav() {
  const bytes = Buffer.alloc(48_044);
  bytes.write('RIFF');
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(24_000, 24);
  bytes.writeUInt32LE(48_000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(48_000, 40);
  return bytes;
}

it('runs the documented no-paid-account supplied narration example with valid captions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tutorialx-no-paid-example-'));
  roots.push(root);
  const source = join(root, 'narration.wav');
  const output = join(root, 'output');
  await writeFile(source, wav());
  const script = resolve('examples/narration/no-paid-account.mjs');
  const manifest = resolve('examples/narration/no-paid-account.json');
  const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>(
    (accept, reject) => {
      const child = spawn(process.execPath, [script, source, manifest, output], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
      child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
      child.once('error', reject);
      child.once('close', (code) =>
        accept({
          code,
          stdout: Buffer.concat(stdout).toString('utf8'),
          stderr: Buffer.concat(stderr).toString('utf8'),
        }),
      );
    },
  );
  expect(result).toMatchObject({ code: 0, stderr: '' });
  expect(JSON.parse(result.stdout)).toEqual({
    audio: { kind: 'local', path: 'narration_no_paid.wav' },
    captions: ['captions.srt', 'captions.vtt'],
    language: 'en-US',
  });
  expect(await readFile(join(output, 'narration_no_paid.wav'))).toEqual(wav());
  expect(await readFile(join(output, 'captions.srt'), 'utf8')).toContain('Welcome to TutorialX');
  expect(await readFile(join(output, 'captions.vtt'), 'utf8')).toContain('Language: en-US');
});
