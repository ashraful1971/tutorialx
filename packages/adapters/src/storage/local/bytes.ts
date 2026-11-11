import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { type ArtifactManifest, relativeArtifactPathSchema } from '@tutorialx/contracts';
import { hasCode, isWithin, managedDirectory } from '../../workspace/files.js';

export async function artifactPath(
  root: string,
  path: string,
  createParents = false,
): Promise<string> {
  relativeArtifactPathSchema.parse(path);
  const destination = resolve(root, path);
  if (!isWithin(root, destination)) throw new Error('Artifact path escapes its job root.');
  if (createParents) await managedDirectory(root, dirname(destination));
  else {
    let current = root;
    for (const part of relative(root, dirname(destination)).split(sep).filter(Boolean)) {
      current = resolve(current, part);
      const stat = await lstat(current);
      if (!stat.isDirectory() || stat.isSymbolicLink())
        throw new Error('Artifact parent must not be redirected.');
    }
  }
  return destination;
}

/** File and directory flushes precede metadata acceptance; Windows cannot fsync directories. */
export async function syncDirectory(path: string): Promise<void> {
  let directory;
  try {
    directory = await open(path, 'r');
    await directory.sync();
  } catch (error) {
    if (
      !(
        process.platform === 'win32' &&
        ['EISDIR', 'EINVAL', 'EPERM', 'ENOTSUP', 'EACCES'].some((code) => hasCode(error, code))
      )
    )
      throw error;
  } finally {
    await directory?.close();
  }
}

export async function verifyArtifactBytes(
  root: string,
  path: string,
  manifest: ArtifactManifest,
  check: () => void,
  collect = false,
): Promise<Buffer | null> {
  const location = await artifactPath(root, path);
  const before = await lstat(location);
  if (!before.isFile() || before.isSymbolicLink() || before.size !== manifest.sizeBytes)
    throw new Error('Artifact is missing, redirected, or has an unexpected size.');
  const file = await open(location, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await file.stat();
    if (
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      !isWithin(root, await realpath(location))
    )
      throw new Error('Artifact changed during verification.');
    const digest = createHash('sha256');
    const chunks: Buffer[] = [];
    let size = 0;
    while (true) {
      check();
      const chunk = Buffer.alloc(1024 * 1024);
      const { bytesRead } = await file.read(chunk, 0, chunk.length, null);
      if (!bytesRead) break;
      size += bytesRead;
      if (size > manifest.sizeBytes) throw new Error('Artifact grew while being verified.');
      const bytes = chunk.subarray(0, bytesRead);
      digest.update(bytes);
      if (collect) chunks.push(bytes);
    }
    const after = await file.stat();
    check();
    if (
      size !== manifest.sizeBytes ||
      digest.digest('hex') !== manifest.digest ||
      before.mtimeMs !== after.mtimeMs ||
      before.size !== after.size
    )
      throw new Error('Artifact checksum or stable-file verification failed.');
    return collect ? Buffer.concat(chunks, size) : null;
  } finally {
    await file.close();
  }
}
