import { createHash, randomUUID } from 'node:crypto';
import { lstat, open, realpath, rename, unlink } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { relativeArtifactPathSchema, type WorkspaceProjectionFiles } from '@tutorialx/contracts';
import { hasCode, managedDirectory, readRegularFile } from './files.js';

export class ProjectionFileConflict extends Error {
  readonly code = 'REVISION_CONFLICT';
}

export function createLocalProjectionFiles(jobDirectory: string): WorkspaceProjectionFiles {
  async function locate(path: string, create: boolean) {
    relativeArtifactPathSchema.parse(path);
    if ((await lstat(jobDirectory)).isSymbolicLink())
      throw new Error('Projection root must not be redirected.');
    const root = await realpath(jobDirectory);
    const destination = resolve(root, path);
    if (create) await managedDirectory(root, dirname(destination));
    else {
      let parent = root;
      for (const part of relative(root, dirname(destination)).split(sep).filter(Boolean)) {
        parent = resolve(parent, part);
        try {
          const stat = await lstat(parent);
          if (!stat.isDirectory() || stat.isSymbolicLink())
            throw new Error('Projection parent must not be redirected.');
        } catch (error) {
          if (hasCode(error, 'ENOENT')) return null;
          throw error;
        }
      }
    }
    return destination;
  }
  async function read(path: string) {
    const file = await locate(path, false);
    if (file === null) return null;
    try {
      const content = await readRegularFile(file);
      return { content, digest: createHash('sha256').update(content).digest('hex') };
    } catch (error) {
      if (hasCode(error, 'ENOENT')) return null;
      throw error;
    }
  }
  return {
    read,
    async write(path, expected, content) {
      if (Buffer.byteLength(content) > 4 * 1024 * 1024)
        throw new Error('Projection exceeds the 4 MiB local file limit.');
      const destination = (await locate(path, true))!;
      const lockPath = `${destination}.tutorialx-lock`;
      let lock;
      try {
        lock = await open(lockPath, 'wx', 0o600);
      } catch (error) {
        if (hasCode(error, 'EEXIST'))
          throw new ProjectionFileConflict(
            'Projection is being updated; inspect its lock before retrying.',
          );
        throw error;
      }
      const temporary = resolve(dirname(destination), `.projection-${randomUUID()}.tmp`);
      try {
        const current = await read(path);
        if ((current?.content ?? null) !== expected)
          throw new ProjectionFileConflict(
            'Projection changed since inspection; import or reconcile the edit.',
          );
        const file = await open(temporary, 'wx', 0o600);
        try {
          await file.writeFile(content);
          await file.sync();
        } finally {
          await file.close();
        }
        await rename(temporary, destination);
      } finally {
        await lock.close();
        await unlink(lockPath);
        try {
          await unlink(temporary);
        } catch (error) {
          if (!hasCode(error, 'ENOENT')) throw error;
        }
      }
    },
  };
}
