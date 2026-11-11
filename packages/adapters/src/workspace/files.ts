import { randomUUID } from 'node:crypto';
import { link, lstat, mkdir, open, readFile, realpath, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

export function isWithin(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`));
}

export function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

/** Reject redirected managed paths. The caller explicitly chooses/canonicalizes the root. */
export async function managedDirectory(root: string, path: string): Promise<string> {
  if (!isWithin(root, path)) throw new Error('Managed path escapes its root.');
  let current = root;
  for (const part of relative(root, path).split(sep).filter(Boolean)) {
    current = resolve(current, part);
    try {
      await mkdir(current, { mode: 0o700 });
    } catch (error) {
      if (!hasCode(error, 'EEXIST')) throw error;
    }
    const stat = await lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error('Managed directory must not be redirected by a symlink.');
  }
  return path;
}

export async function canonicalRoot(path: string): Promise<string> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  return realpath(path);
}

/** Publish a complete file once without replacing an existing destination. */
export async function writeNewFile(path: string, content: string | Uint8Array): Promise<boolean> {
  const temporary = resolve(dirname(path), `.tutorialx-${randomUUID()}.tmp`);
  const file = await open(temporary, 'wx', 0o600);
  try {
    await file.writeFile(content);
    await file.sync();
    await file.close();
    try {
      await link(temporary, path);
      return true;
    } catch (error) {
      if (hasCode(error, 'EEXIST')) return false;
      throw error;
    }
  } finally {
    await file.close();
    await unlink(temporary);
  }
}

export async function readRegularFile(path: string): Promise<string> {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4 * 1024 * 1024)
    throw new Error('Expected a bounded regular workspace file.');
  return readFile(path, 'utf8');
}
