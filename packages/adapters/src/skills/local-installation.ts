import { createHash, randomUUID } from 'node:crypto';
import { lstat, open, readdir, readFile, realpath, rename, unlink } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import {
  managedSkillManifestSchema,
  SKILL_MANIFEST,
  type SkillFile,
  type SkillHost,
  type SkillInstallationPreview,
  type SkillInstallationRequest,
  type SkillInstaller,
  skillFilePathSchema,
} from '@tutorialx/contracts';
import { planSkillInstallation, supportedSkillDirectory } from '@tutorialx/core';
import { hasCode, managedDirectory } from '../workspace/files.js';

const MAX_FILES = 256;
const MAX_FILE_BYTES = 256 * 1024;
const MAX_PACKAGE_BYTES = 2 * 1024 * 1024;
const sha256 = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');

/** Explicit roots prevent an installation from silently choosing a user/global scope. */
export function createLocalSkillInstaller(options: {
  rootDirectory: string;
  host: SkillHost;
}): SkillInstaller {
  const requestedRoot = resolve(options.rootDirectory);
  const directory = supportedSkillDirectory(options.host);

  async function paths() {
    const root = await realpath(requestedRoot);
    const destination = resolve(root, directory);
    let current = root;
    for (const part of relative(root, destination).split(sep)) {
      current = resolve(current, part);
      try {
        const stat = await lstat(current);
        if (!stat.isDirectory() || stat.isSymbolicLink())
          throw new Error('Skill directory must not be redirected by a symlink.');
      } catch (error) {
        if (hasCode(error, 'ENOENT')) break;
        throw error;
      }
    }
    return { root, destination };
  }

  async function snapshot(root: string, supplied: boolean) {
    const files: Record<string, SkillFile> = Object.create(null);
    const inventory: string[] = [];
    let bytes = 0;
    async function walk(directoryPath: string) {
      let names: string[];
      try {
        names = (await readdir(directoryPath)).sort();
      } catch (error) {
        if (!supplied && hasCode(error, 'ENOENT') && directoryPath === root) return;
        throw error;
      }
      for (const name of names) {
        const path = resolve(directoryPath, name);
        const key = relative(root, path).replaceAll(sep, '/');
        inventory.push(key);
        if (inventory.length > MAX_FILES) throw new Error('Skill directory has too many entries.');
        const stat = await lstat(path);
        if (stat.isSymbolicLink()) throw new Error('Skill files must not be symlinks.');
        if (stat.isDirectory()) {
          await walk(path);
          continue;
        }
        if (!stat.isFile() || stat.size > MAX_FILE_BYTES)
          throw new Error('Skill files must be bounded regular text files.');
        if (supplied) skillFilePathSchema.parse(key);
        const data = await readFile(path);
        bytes += data.length;
        if (bytes > MAX_PACKAGE_BYTES) throw new Error('Skill directory exceeds its size limit.');
        const content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(data);
        files[key] = { sha256: sha256(data), content };
      }
    }
    if (supplied) {
      const stat = await lstat(root);
      if (!stat.isDirectory() || stat.isSymbolicLink())
        throw new Error('Skill package root must be a regular directory.');
    }
    await walk(root);
    return { files, inventory };
  }

  async function preview(request: SkillInstallationRequest): Promise<SkillInstallationPreview> {
    if (request.operation !== 'remove' && !request.packageRoot)
      throw new Error('An explicit skill package root is required.');
    const { destination } = await paths();
    const current = await snapshot(destination, false);
    const metadata = current.files[SKILL_MANIFEST];
    const installed = metadata
      ? managedSkillManifestSchema.parse(JSON.parse(metadata.content))
      : null;
    const supplied =
      request.operation === 'remove'
        ? undefined
        : await snapshot(resolve(request.packageRoot ?? ''), true);
    const plan = planSkillInstallation({
      operation: request.operation,
      installed,
      current: current.files,
      ...(supplied ? { supplied: supplied.files } : {}),
      ...(request.version === undefined ? {} : { version: request.version }),
    });
    // Capture unrelated entries as well: a concurrent new file must not be lost or overwritten.
    const fingerprint = sha256(JSON.stringify({ destination, current, supplied, plan }));
    return { ...plan, destination, fingerprint, request: { ...request } };
  }

  async function replaceFile(root: string, destination: string, content: string | null) {
    if (content === null) {
      await unlink(destination);
      return;
    }
    await managedDirectory(root, dirname(destination));
    const temporary = resolve(dirname(destination), `.tutorialx-${randomUUID()}.tmp`);
    const file = await open(temporary, 'wx', 0o600);
    try {
      await file.writeFile(content);
      await file.sync();
      await file.close();
      await rename(temporary, destination);
    } finally {
      await file.close();
      await unlink(temporary).catch((error) => {
        if (!hasCode(error, 'ENOENT')) throw error;
      });
    }
  }

  return {
    preview,
    async apply(proposed) {
      const { root } = await paths();
      const lockPath = resolve(root, '.tutorialx-skill-install.lock');
      const lock = await open(lockPath, 'wx', 0o600).catch((error) => {
        if (hasCode(error, 'EEXIST'))
          throw new Error('Another skill installation owns the lock; inspect it before recovery.');
        throw error;
      });
      try {
        await lock.writeFile(`${JSON.stringify({ pid: process.pid, host: options.host })}\n`);
        const accepted = await preview(proposed.request);
        if (accepted.fingerprint !== proposed.fingerprint)
          throw new Error('Skill installation changed since preview; request a fresh preview.');
        if (accepted.changes.length === 0) return accepted;
        await managedDirectory(root, accepted.destination);
        // Save before-images before touching files, so an interrupted update remains recoverable.
        const backup = resolve(root, '.tutorialx', 'skill-backups', randomUUID());
        await managedDirectory(root, backup);
        const recovery = await open(resolve(backup, 'changes.json'), 'wx', 0o600);
        try {
          await recovery.writeFile(`${JSON.stringify(accepted, null, 2)}\n`);
          await recovery.sync();
        } finally {
          await recovery.close();
        }
        for (const change of accepted.changes)
          await replaceFile(root, resolve(accepted.destination, change.path), change.after);
        return accepted;
      } finally {
        await lock.close();
        await unlink(lockPath);
      }
    },
  };
}
