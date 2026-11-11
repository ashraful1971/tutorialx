import { createHash, randomUUID } from 'node:crypto';
import { chmod, link, lstat, mkdir, open, readdir, realpath, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  type ArtifactManifest,
  type ArtifactStaging,
  artifactManifestSchema,
  idSchema,
  type MediaMetadata,
  mediaMetadataSchema,
  type OperationContext,
  paginationSchema,
  type RetainedArtifact,
  type StagedArtifact,
  stagedArtifactSchema,
  timestampSchema,
} from '@tutorialx/contracts';
import { hasCode, managedDirectory, readRegularFile, writeNewFile } from '../../workspace/files.js';
import { artifactPath, syncDirectory, verifyArtifactBytes } from './bytes.js';

export class ArtifactStagingFailure extends Error {
  readonly code = 'PROVIDER_FAILED';
  constructor(readonly receiptId: string) {
    super(`Artifact staging failed; retained receipt ${receiptId} is not accepted output.`);
  }
}
export interface LocalArtifactStagingOptions {
  jobDirectory: string;
  jobId: string;
  workspaceId: string;
  now(): string;
  maxArtifactBytes?: number;
  maxStructuredBytes?: number;
  /** Explicit local inspector. It must measure this file without modifying it or reading ambient inputs. */
  inspectMedia?(
    path: string,
    manifest: ArtifactManifest,
    context: OperationContext,
  ): Promise<MediaMetadata>;
}

export async function createLocalArtifactStaging(
  options: LocalArtifactStagingOptions,
): Promise<ArtifactStaging> {
  const jobId = idSchema.parse(options.jobId);
  const workspaceId = idSchema.parse(options.workspaceId);
  if ((await lstat(options.jobDirectory)).isSymbolicLink())
    throw new Error('Artifact job root must not be redirected.');
  const root = await realpath(options.jobDirectory);
  const maximum = options.maxArtifactBytes ?? 10 * 1024 ** 3;
  const structuredMaximum = options.maxStructuredBytes ?? 16 * 1024 ** 2;
  for (const limit of [maximum, structuredMaximum])
    if (!Number.isSafeInteger(limit) || limit < 1)
      throw new Error('Artifact limits must be positive safe integers.');
  const base = await managedDirectory(root, resolve(root, 'work/artifacts'));
  const staging = await managedDirectory(root, resolve(base, 'staging'));
  await managedDirectory(root, resolve(base, 'objects'));
  const binding = { schemaVersion: 1, jobId, workspaceId };
  await writeNewFile(resolve(base, 'store.json'), `${JSON.stringify(binding)}\n`);
  if (
    JSON.stringify(JSON.parse(await readRegularFile(resolve(base, 'store.json')))) !==
    JSON.stringify(binding)
  )
    throw new Error('Artifact store belongs to another job/workspace or schema version.');
  await syncDirectory(base);

  function check(context: OperationContext) {
    idSchema.parse(context.operationId);
    idSchema.parse(context.attemptId);
    if (context.jobId !== jobId) throw new Error('Artifact operation belongs to another job.');
    context.signal.throwIfAborted();
    if (
      Date.parse(timestampSchema.parse(context.deadlineAt)) <=
      Date.parse(timestampSchema.parse(options.now()))
    )
      throw new Error('Artifact operation deadline exceeded.');
  }
  const objectKey = (manifest: ArtifactManifest) =>
    `work/artifacts/objects/${manifest.provenance.attemptId}/${manifest.id}/${manifest.digest}`;
  function scoped(manifest: ArtifactManifest) {
    if (
      manifest.jobId !== jobId ||
      manifest.workspaceId !== workspaceId ||
      manifest.storage.kind !== 'local' ||
      manifest.storage.path !== objectKey(manifest)
    )
      throw new Error('Artifact manifest is outside its immutable job object scope.');
  }
  async function receipt(
    id: string,
    context: OperationContext,
    ready: boolean,
  ): Promise<StagedArtifact> {
    check(context);
    idSchema.parse(id);
    const prefix = `work/artifacts/staging/${id}`;
    const result = stagedArtifactSchema.parse(
      JSON.parse(await readRegularFile(await artifactPath(root, `${prefix}/intent.json`))),
    );
    if (result.id !== id) throw new Error('Staging receipt identity differs from its directory.');
    scoped(result.manifest);
    if (ready) {
      const marker = await readRegularFile(await artifactPath(root, `${prefix}/ready.json`));
      if (JSON.stringify(stagedArtifactSchema.parse(JSON.parse(marker))) !== JSON.stringify(result))
        throw new Error('Staging completion marker does not match its intent.');
    }
    return result;
  }
  return {
    async stage(proposed, bytes, context) {
      check(context);
      const original = artifactManifestSchema.parse(proposed);
      if (
        original.jobId !== jobId ||
        original.workspaceId !== workspaceId ||
        original.provenance.attemptId !== context.attemptId
      )
        throw new Error('Artifact provenance does not match this job/attempt.');
      if (original.sizeBytes > maximum)
        throw new Error('Artifact exceeds the configured byte limit.');
      const manifest = artifactManifestSchema.parse({
        ...original,
        storage: { kind: 'local', path: objectKey(original) },
      });
      const result = stagedArtifactSchema.parse({
        schemaVersion: 1,
        id: `staged_${randomUUID()}`,
        createdAt: options.now(),
        manifest,
      });
      const directory = resolve(staging, result.id);
      await mkdir(directory, { mode: 0o700 });
      await writeNewFile(resolve(directory, 'intent.json'), `${JSON.stringify(result, null, 2)}\n`);
      await syncDirectory(directory);
      await syncDirectory(staging);
      const file = await open(resolve(directory, 'bytes.partial'), 'wx', 0o600);
      try {
        let count = 0;
        const digest = createHash('sha256');
        for await (const chunk of bytes) {
          check(context);
          if (!(chunk instanceof Uint8Array)) throw new Error('Expected byte chunks.');
          count += chunk.byteLength;
          if (count > manifest.sizeBytes || count > maximum)
            throw new Error('Artifact stream exceeds its declared size.');
          digest.update(chunk);
          await file.writeFile(chunk);
        }
        check(context);
        if (count !== manifest.sizeBytes || digest.digest('hex') !== manifest.digest)
          throw new Error('Artifact stream does not match its manifest.');
        await file.sync();
        await file.chmod(0o400);
        await file.sync();
        await file.close();
        await rename(resolve(directory, 'bytes.partial'), resolve(directory, 'bytes'));
        await syncDirectory(directory);
        await writeNewFile(
          resolve(directory, 'ready.json'),
          `${JSON.stringify(result, null, 2)}\n`,
        );
        await syncDirectory(directory);
        check(context);
        return result;
      } catch {
        throw new ArtifactStagingFailure(result.id);
      } finally {
        await file.close();
      }
    },
    async describe(id, context) {
      return receipt(id, context, true);
    },
    async publish(id, context) {
      const staged = await receipt(id, context, true);
      const { manifest } = staged;
      if (manifest.provenance.attemptId !== context.attemptId)
        throw new Error('Only the owning attempt can publish staged output.');
      const source = `work/artifacts/staging/${id}/bytes`;
      const structured = ['json', 'text', 'html', 'subtitles'].includes(manifest.kind);
      if (structured && manifest.sizeBytes > structuredMaximum)
        throw new Error('Structured artifact exceeds its inspection byte limit.');
      const content = await verifyArtifactBytes(
        root,
        source,
        manifest,
        () => check(context),
        structured,
      );
      if (content !== null) {
        let text: string;
        try {
          text = new TextDecoder('utf-8', { fatal: true }).decode(content);
        } catch {
          throw new Error('Structured artifact is not valid UTF-8.');
        }
        if (manifest.kind === 'json') {
          try {
            JSON.parse(text);
          } catch {
            throw new Error('Structured artifact is not valid JSON.');
          }
        }
      }
      if (['audio', 'video', 'image'].includes(manifest.kind)) {
        if (!options.inspectMedia)
          throw new Error(
            'A selected media inspector is required before accepting media artifacts.',
          );
        let actual: MediaMetadata;
        try {
          actual = mediaMetadataSchema.parse(
            await options.inspectMedia(
              await artifactPath(root, source),
              structuredClone(manifest),
              context,
            ),
          );
        } catch {
          throw new Error('Selected media inspector could not verify the staged artifact.');
        }
        const expected = manifest.media!;
        for (const key of Object.keys(expected) as (keyof MediaMetadata)[]) {
          if (key === 'frameRate' && actual.frameRate && expected.frameRate) {
            if (
              BigInt(actual.frameRate.numerator) * BigInt(expected.frameRate.denominator) !==
              BigInt(expected.frameRate.numerator) * BigInt(actual.frameRate.denominator)
            )
              throw new Error('Measured frame rate differs from the declared artifact.');
          } else if (JSON.stringify(actual[key]) !== JSON.stringify(expected[key]))
            throw new Error('Measured media metadata differs from the declared artifact.');
        }
        await verifyArtifactBytes(root, source, manifest, () => check(context));
      }
      check(context);
      const destination = await artifactPath(root, objectKey(manifest), true);
      try {
        await link(await artifactPath(root, source), destination);
      } catch (error) {
        if (!hasCode(error, 'EEXIST')) throw error;
      }
      await verifyArtifactBytes(root, objectKey(manifest), manifest, () => check(context));
      await chmod(destination, 0o400);
      await syncDirectory(dirname(destination));
      return manifest;
    },
    async verify(input, context) {
      check(context);
      const manifest = artifactManifestSchema.parse(input);
      scoped(manifest);
      await verifyArtifactBytes(root, objectKey(manifest), manifest, () => check(context));
    },
    async retained(input, context) {
      check(context);
      const page = paginationSchema.parse(input);
      let after = '';
      if (page.cursor !== null) {
        after = idSchema.parse(Buffer.from(page.cursor, 'base64url').toString('utf8'));
        if (Buffer.from(after).toString('base64url') !== page.cursor)
          throw new Error('Invalid artifact staging cursor.');
      }
      const ids = (await readdir(staging, { withFileTypes: true }))
        .filter(
          (entry) =>
            entry.isDirectory() && idSchema.safeParse(entry.name).success && entry.name > after,
        )
        .map((entry) => entry.name)
        .sort()
        .slice(0, page.limit + 1);
      const items: RetainedArtifact[] = [];
      for (const id of ids.slice(0, page.limit)) {
        check(context);
        try {
          const value = await receipt(id, context, false);
          let phase: RetainedArtifact['phase'] = 'partial';
          try {
            await receipt(id, context, true);
            phase = 'staged';
          } catch (error) {
            if (!hasCode(error, 'ENOENT')) throw error;
          }
          if (phase === 'staged') {
            try {
              const metadata = await lstat(await artifactPath(root, objectKey(value.manifest)));
              if (
                !metadata.isFile() ||
                metadata.isSymbolicLink() ||
                metadata.size !== value.manifest.sizeBytes
              )
                throw new Error('Published object is not a complete regular file.');
              phase = 'published';
            } catch (error) {
              if (!hasCode(error, 'ENOENT')) throw error;
            }
          }
          items.push({
            receiptId: id,
            phase,
            createdAt: value.createdAt,
            manifest: value.manifest,
          });
        } catch {
          check(context);
          items.push({ receiptId: id, phase: 'unreadable', createdAt: null, manifest: null });
        }
      }
      return {
        items,
        nextCursor:
          ids.length > page.limit ? Buffer.from(ids[page.limit - 1]!).toString('base64url') : null,
      };
    },
  };
}
