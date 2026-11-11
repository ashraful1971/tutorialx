import { createHash } from 'node:crypto';
import { lstat, mkdir, readdir, realpath, rm } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import {
  artifactManifestSchema,
  digestSchema,
  idSchema,
  type RegisteredSource,
  relativeArtifactPathSchema,
  type SourceRegistrar,
  sourceManifestSchema,
  type WorkspaceConfig,
  workspaceConfigSchema,
} from '@tutorialx/contracts';
import { hasCode, isWithin, managedDirectory, writeNewFile } from './files.js';
import {
  createSourceScope,
  excludedPath,
  readScopedFile,
  SourceScopeError,
} from './source-scope.js';

interface InventoryEntry {
  path: string;
  kind: 'file' | 'directory';
  digest: string | null;
  sizeBytes: number;
}
const hash = (content: string | Uint8Array) => createHash('sha256').update(content).digest('hex');

export function createLocalSourceRegistrar(options: {
  projectDirectory: string;
  jobDirectory: string;
  jobId: string;
  workspace: WorkspaceConfig;
  settingsDigest: string;
  limits?: { maxFileBytes: number; maxTotalBytes: number; maxEntries: number; maxDepth: number };
}): SourceRegistrar {
  const workspace = workspaceConfigSchema.parse(options.workspace);
  const settingsDigest = digestSchema.parse(options.settingsDigest);
  const jobId = idSchema.parse(options.jobId);
  const project = resolve(options.projectDirectory);
  const directory = resolve(options.jobDirectory);
  const privateRoots = [resolve(project, '.tutorialx'), resolve(project, workspace.contentRoot)];
  const scope = createSourceScope(
    project,
    workspace.sourceRoots,
    workspace.exclusions,
    privateRoots,
  );
  const limits = options.limits ?? {
    maxFileBytes: 16 * 1024 * 1024,
    maxTotalBytes: 64 * 1024 * 1024,
    maxEntries: 10_000,
    maxDepth: 32,
  };
  for (const value of Object.values(limits))
    if (!Number.isSafeInteger(value) || value < 1)
      throw new Error('Source limits must be positive safe integers.');

  return {
    async register(input): Promise<RegisteredSource> {
      const source = sourceManifestSchema.parse(input);
      if (
        source.jobId !== jobId ||
        source.status !== 'pending' ||
        source.contentHash !== null ||
        source.snapshotArtifactId !== null
      )
        throw new Error('Expected a fresh source for this job.');
      if ((await lstat(directory)).isSymbolicLink())
        throw new SourceScopeError('Job directory must not be redirected.');
      const jobDirectory = await realpath(directory);
      const canonicalPrivateRoots = await Promise.all(
        privateRoots.map(async (path) => {
          try {
            return await realpath(path);
          } catch (error) {
            if (hasCode(error, 'ENOENT')) return path;
            throw error;
          }
        }),
      );
      const entries: InventoryEntry[] = [];
      const contents = new Map<string, Buffer>();
      let totalBytes = 0;
      const { input: reference } = source;
      let rootPath: string | null = null;
      let copy = false;
      if (reference.kind === 'text') {
        source.contentHash = hash(reference.text);
        source.status = 'available';
      } else if (reference.kind === 'url') {
        source.reason =
          'URL registered; content access and fingerprinting require a configured reader.';
      } else {
        copy = reference.copy;
        try {
          rootPath = await scope.authorize(reference.path);
          const stat = await lstat(rootPath);
          if (
            (reference.kind === 'directory' || reference.kind === 'codebase') !== stat.isDirectory()
          )
            throw new Error('Source kind does not match the referenced file/directory.');
          const visit = async (path: string, name: string, depth: number): Promise<void> => {
            if (depth > limits.maxDepth)
              throw new Error('Source exceeds the configured directory-depth limit.');
            const actual = await scope.authorize(path);
            const metadata = await lstat(actual);
            const portable = name.replaceAll('\\', '/');
            relativeArtifactPathSchema.parse(portable);
            if (entries.length >= limits.maxEntries)
              throw new Error('Source exceeds the configured entry limit.');
            if (metadata.isDirectory()) {
              entries.push({ path: portable, kind: 'directory', digest: null, sizeBytes: 0 });
              const children = await readdir(actual);
              for (const child of children.sort()) {
                const next = resolve(actual, child);
                // Exclusions are relative to both the selected source and each configured root.
                if (
                  excludedPath(relative(rootPath!, next), workspace.exclusions) ||
                  canonicalPrivateRoots.some((root) => isWithin(root, next))
                )
                  continue;
                await visit(next, `${portable}/${child}`, depth + 1);
              }
            } else {
              const bytes = await readScopedFile(
                actual,
                Math.min(limits.maxFileBytes, limits.maxTotalBytes - totalBytes),
                scope.authorize,
              );
              totalBytes += bytes.length;
              entries.push({
                path: portable,
                kind: 'file',
                digest: hash(bytes),
                sizeBytes: bytes.length,
              });
              if (copy) contents.set(portable, bytes);
            }
          };
          await visit(rootPath, 'original', 0);
          source.contentHash = stat.isDirectory()
            ? hash(JSON.stringify(entries))
            : entries[0]!.digest;
          source.status = 'available';
        } catch (error) {
          if (error instanceof SourceScopeError) throw error;
          if (hasCode(error, 'ENOENT')) {
            source.status = 'missing';
            source.reason = 'Referenced source is missing.';
          } else if (hasCode(error, 'EACCES') || hasCode(error, 'EPERM')) {
            source.status = 'inaccessible';
            source.reason = 'Referenced source cannot be read with the configured access.';
          } else throw error;
        }
      }
      const inputDirectory = await managedDirectory(
        jobDirectory,
        resolve(jobDirectory, 'input/sources'),
      );
      const target = resolve(inputDirectory, source.id);
      await mkdir(target, { mode: 0o700 });
      try {
        let snapshot: RegisteredSource['snapshot'] = null;
        if (copy && source.status === 'available') {
          const files = await managedDirectory(target, resolve(target, 'files'));
          for (const entry of entries) {
            const path = resolve(files, entry.path);
            if (entry.kind === 'directory') await managedDirectory(files, path);
            else {
              await managedDirectory(files, resolve(path, '..'));
              await writeNewFile(path, contents.get(entry.path)!);
            }
          }
          const manifest = `${JSON.stringify({ schemaVersion: 1, entries, contentHash: source.contentHash }, null, 2)}\n`;
          await writeNewFile(resolve(target, 'snapshot.json'), manifest);
          source.snapshotArtifactId = source.id;
          snapshot = artifactManifestSchema.parse({
            schemaVersion: 1,
            id: source.id,
            createdAt: source.createdAt,
            workspaceId: workspace.id,
            jobId,
            kind: 'json',
            mimeType: 'application/json',
            storage: { kind: 'local', path: `input/sources/${source.id}/snapshot.json` },
            digest: hash(manifest),
            sizeBytes: Buffer.byteLength(manifest),
            media: null,
            provenance: {
              stageId: 'source',
              attemptId: source.id,
              inputDigests: [source.contentHash],
              provider: null,
              settingsDigest,
              templateDigest: null,
            },
          });
        }
        await writeNewFile(resolve(target, 'source.json'), `${JSON.stringify(source, null, 2)}\n`);
        return { source: sourceManifestSchema.parse(source), snapshot };
      } catch (error) {
        await rm(target, { recursive: true, force: true });
        throw error;
      }
    },
  };
}
