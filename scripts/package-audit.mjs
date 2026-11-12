import { spawnSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SKILL_FILES } from './skill-files.mjs';

/** @param {string} path */
export function isAllowedPackagePath(path) {
  if (['package.json', 'README.md', 'LICENSE'].includes(path)) return true;
  if (SKILL_FILES.some((name) => path === `dist/skills/tutorialx/${name}`)) return true;
  if (!path.startsWith('dist/')) return false;
  if (path.split('/').some((part) => part.startsWith('.') || part === '..')) return false;
  return /\.(js|d\.ts)(\.map)?$/.test(path);
}

export async function auditPackages() {
  const packageManager = process.env.npm_execpath;
  if (!packageManager) throw new Error('Run the audit with pnpm package:audit.');
  const root = fileURLToPath(new URL('../', import.meta.url));
  const reports = [];
  for (const entry of await readdir(resolve(root, 'packages'), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const cwd = resolve(root, 'packages', entry.name);
    const manifest = JSON.parse(await readFile(resolve(cwd, 'package.json'), 'utf8'));
    if (manifest.private) continue;
    const packed = spawnSync(process.execPath, [packageManager, 'pack', '--dry-run', '--json'], {
      cwd,
      encoding: 'utf8',
      timeout: 30_000,
    });
    if (packed.error) throw packed.error;
    if (packed.status !== 0)
      throw new Error(`Package dry-run failed: ${manifest.name}\n${packed.stderr}`);
    const result = JSON.parse(packed.stdout);
    if (!Array.isArray(result.files) || result.files.length === 0) {
      throw new Error(`No files reported for ${manifest.name}`);
    }
    const paths = result.files.map((file) => file.path);
    const forbidden = paths.filter(
      (path) => typeof path !== 'string' || !isAllowedPackagePath(path),
    );
    if (forbidden.length)
      throw new Error(`Unexpected package files in ${manifest.name}: ${forbidden.join(', ')}`);
    if (!paths.includes('dist/index.js') || !paths.includes('dist/index.d.ts')) {
      throw new Error(`Build ${manifest.name} before auditing it.`);
    }
    reports.push({ name: manifest.name, files: paths.length });
  }
  return reports;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.stdout.write(`${JSON.stringify(await auditPackages(), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
