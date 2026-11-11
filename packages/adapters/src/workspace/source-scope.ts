import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { hasCode, isWithin } from './files.js';

export class SourceScopeError extends Error {
  readonly code = 'POLICY_DENIED';
}

export function excludedPath(path: string, patterns: readonly string[]): boolean {
  const normalized = path.replaceAll('\\', '/');
  return patterns.some((pattern) => {
    let expression = '';
    for (let index = 0; index < pattern.length; index++) {
      const char = pattern[index]!;
      if (char === '*' && pattern[index + 1] === '*') {
        expression += '.*';
        index++;
      } else if (char === '*') expression += '[^/]*';
      else if (char === '?') expression += '[^/]';
      else expression += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    return new RegExp(
      pattern.includes('/') ? `^${expression}($|/)` : `(^|/)${expression}($|/)`,
    ).test(normalized);
  });
}

export function createSourceScope(
  project: string,
  allowedRoots: readonly string[],
  exclusions: readonly string[],
  privateRoots: readonly string[],
) {
  const configured = allowedRoots.map((root) => resolve(project, root));
  async function authorize(path: string): Promise<string> {
    const requested = resolve(project, path);
    if (excludedPath(relative(project, requested), exclusions))
      throw new SourceScopeError('Source matches a configured exclusion.');
    const roots: string[] = [];
    for (const root of configured) {
      let canonical = root;
      try {
        canonical = await realpath(root);
      } catch (error) {
        if (!hasCode(error, 'ENOENT')) throw error;
      }
      if (isWithin(root, requested) || isWithin(canonical, requested)) roots.push(root);
    }
    if (!roots.length)
      throw new SourceScopeError('Source is outside the configured allowed roots.');
    for (const privateRoot of privateRoots)
      if (isWithin(privateRoot, requested))
        throw new SourceScopeError('Private workspace state/content is excluded from sources.');
    let actual: string;
    try {
      actual = await realpath(requested);
    } catch (error) {
      if (hasCode(error, 'ENOENT')) return requested;
      throw error;
    }
    for (const privateRoot of privateRoots) {
      let canonical = privateRoot;
      try {
        canonical = await realpath(privateRoot);
      } catch (error) {
        if (!hasCode(error, 'ENOENT')) throw error;
      }
      if (isWithin(canonical, actual))
        throw new SourceScopeError('Private workspace state/content is excluded from sources.');
    }
    if (excludedPath(relative(project, actual), exclusions))
      throw new SourceScopeError('Source matches a configured exclusion.');
    let permitted = false;
    for (const root of roots) {
      const canonical = await realpath(root);
      if (
        isWithin(canonical, actual) &&
        !excludedPath(relative(canonical, actual) || '.', exclusions)
      )
        permitted = true;
    }
    if (!permitted)
      throw new SourceScopeError(
        'Source resolves outside its allowed scope or matches an exclusion.',
      );
    if ((await lstat(requested)).isSymbolicLink())
      throw new SourceScopeError(
        'Symbolic-link sources require an explicit nonredirected reference.',
      );
    return actual;
  }
  return { authorize };
}

export async function readScopedFile(
  path: string,
  maximumBytes: number,
  authorize: (path: string) => Promise<string>,
): Promise<Buffer> {
  await authorize(path);
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink())
    throw new SourceScopeError('Source must be a regular file.');
  if (before.size > maximumBytes)
    throw new Error('Source exceeds the configured file/total byte limit.');
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await file.stat();
    if (opened.dev !== before.dev || opened.ino !== before.ino)
      throw new SourceScopeError('Source changed during access checks.');
    await authorize(path);
    const chunks: Buffer[] = [];
    let count = 0;
    while (count <= maximumBytes) {
      const chunk = Buffer.alloc(Math.min(1024 * 1024, maximumBytes - count + 1));
      const { bytesRead } = await file.read(chunk, 0, chunk.length, null);
      if (!bytesRead) break;
      count += bytesRead;
      chunks.push(chunk.subarray(0, bytesRead));
    }
    if (count > maximumBytes)
      throw new Error('Source exceeds the configured file/total byte limit.');
    const after = await file.stat();
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || count !== after.size)
      throw new Error('Source changed while fingerprinting; retry from a stable input.');
    await authorize(path);
    return Buffer.concat(chunks, count);
  } finally {
    await file.close();
  }
}
