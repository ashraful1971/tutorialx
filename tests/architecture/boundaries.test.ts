import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../', import.meta.url));
const cli = resolve(root, 'node_modules/dependency-cruiser/bin/dependency-cruiser.mjs');
const config = resolve(root, '.dependency-cruiser.cjs');

async function checkFixture(files: Record<string, string>) {
  const fixture = await mkdtemp(join(tmpdir(), 'tutorialx-boundaries-'));
  try {
    for (const [name, content] of Object.entries(files)) {
      const path = join(fixture, name);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content);
    }
    const result = spawnSync(
      process.execPath,
      [cli, 'packages', '--config', config, '--output-type', 'err-long'],
      { cwd: fixture, encoding: 'utf8', timeout: 10_000 },
    );
    if (result.error) throw result.error;
    return { status: result.status, report: result.stdout + result.stderr };
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
}

describe('package boundaries', () => {
  it('rejects a vendor SDK imported into core', async () => {
    const result = await checkFixture({
      'packages/core/src/index.ts': "export { video } from 'video-vendor-sdk';",
      'node_modules/video-vendor-sdk/package.json': JSON.stringify({
        name: 'video-vendor-sdk',
        main: 'index.js',
      }),
      'node_modules/video-vendor-sdk/index.js': 'exports.video = true;',
    });
    expect(result.status).toBe(1);
    expect(result.report).toContain('core-only-contracts');
  });

  it('rejects cross-package relative source imports', async () => {
    const result = await checkFixture({
      'packages/core/src/index.ts': "export { version } from '../../contracts/src/index.js';",
      'packages/contracts/src/index.ts': 'export const version = 1;',
    });
    expect(result.status).toBe(1);
    expect(result.report).toContain('no-deep-imports-from-core');
  });

  it('rejects cross-package relative build-output imports', async () => {
    const result = await checkFixture({
      'packages/core/src/index.ts': "export { version } from '../../contracts/dist/index.js';",
      'packages/contracts/dist/index.js': 'export const version = 1;',
    });
    expect(result.status).toBe(1);
    expect(result.report).toContain('no-deep-imports-from-core');
  });

  it('detects a cycle within a package', async () => {
    const result = await checkFixture({
      'packages/core/src/a.ts': "export { b } from './b.js'; export const a = 1;",
      'packages/core/src/b.ts': "export { a } from './a.js'; export const b = 1;",
    });
    expect(result.status).toBe(1);
    expect(result.report).toContain('no-cycles');
  });

  it('accepts independent core modules', async () => {
    const result = await checkFixture({
      'packages/core/src/index.ts': "export { value } from './value.js';",
      'packages/core/src/value.ts': 'export const value = 1;',
    });
    expect(result.status, result.report).toBe(0);
  });
});
