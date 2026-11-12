import { lstat, readdir, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { WorkspaceConfig } from '@tutorialx/contracts';

export async function unredirectedPath(path: string): Promise<string> {
  const absolute = resolve(path);
  const parts = absolute.split(sep).filter(Boolean);
  let current = resolve(sep);
  for (const part of parts) {
    current = resolve(current, part);
    const state = await lstat(current);
    // macOS intentionally redirects /var and /tmp; canonicalize the project first.
    if (state.isSymbolicLink()) throw new Error('Managed workspace paths cannot be redirected.');
  }
  return absolute;
}

export async function workspaceDatabase(project: string): Promise<string> {
  const state = resolve(await realpath(project), '.tutorialx');
  await unredirectedPath(state);
  const filename = resolve(state, 'metadata.sqlite');
  try {
    const existing = await lstat(filename);
    if (!existing.isFile() || existing.isSymbolicLink())
      throw new Error('Metadata file is redirected.');
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }
  return filename;
}

export async function jobDirectory(project: string, workspace: WorkspaceConfig, jobId: string) {
  const content = await realpath(resolve(await realpath(project), workspace.contentRoot));
  const root = resolve(content, 'jobs');
  await unredirectedPath(root);
  const entries = (await readdir(root)).filter((name) => name.startsWith(`${jobId}-`));
  if (entries.length !== 1) throw new Error('Job directory is missing or ambiguous.');
  const directory = resolve(root, entries[0]!);
  const path = relative(root, directory);
  if (isAbsolute(path) || path === '..' || path.startsWith(`..${sep}`))
    throw new Error('Job directory escapes the managed root.');
  await unredirectedPath(directory);
  return directory;
}
