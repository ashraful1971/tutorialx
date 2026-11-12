import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import type { SqlitePersistence } from '@tutorialx/adapters';
import {
  type ActionRequest,
  type ArtifactManifest,
  artifactListInputSchema,
  artifactReadInputSchema,
  eventsInputSchema,
  type JsonObject,
  type WorkspaceConfig,
} from '@tutorialx/contracts';
import { redactPublicValue } from '@tutorialx/core';
import { jobDirectory } from './files.js';

class InspectionFailure extends Error {
  constructor(
    readonly code: 'NOT_FOUND' | 'CAPABILITY_UNAVAILABLE' | 'INVALID_INPUT' | 'POLICY_DENIED',
    message: string,
  ) {
    super(message);
  }
}

export async function executeInspectionAction(
  request: ActionRequest,
  persistence: SqlitePersistence,
  options: {
    projectDirectory: string;
    workspace: WorkspaceConfig;
    knownSecrets: readonly string[];
    now(): string;
  },
): Promise<JsonObject> {
  if (request.action === 'events') {
    const input = eventsInputSchema.parse(request.params);
    const events = await persistence.repository.events(input.jobId, input.afterCursor, input.limit);
    const items = events.map((event) => {
      const { payload: _payload, ...summary } = event.data;
      const redacted = redactPublicValue(summary, options.knownSecrets) as JsonObject;
      const data: JsonObject =
        Buffer.byteLength(JSON.stringify(redacted)) <= 1024
          ? redacted
          : {
              truncated: true,
              keys: Object.keys(redacted).slice(0, 20),
            };
      if ('payload' in event.data) data.submissionId = event.id;
      return { ...event, data };
    });
    return redactPublicValue(
      {
        items,
        afterCursor: input.afterCursor,
        nextCursor: events.at(-1)?.cursor ?? input.afterCursor,
        mayHaveMore: events.length === input.limit,
      },
      options.knownSecrets,
    ) as JsonObject;
  }
  if (request.action === 'artifact.list') {
    const input = artifactListInputSchema.parse(request.params);
    const page = await persistence.repository.artifacts(input.jobId, input.cursor, input.limit);
    return redactPublicValue(
      {
        items: page.artifacts.map(({ storage: _storage, ...artifact }) => artifact),
        nextCursor: page.nextCursor,
      },
      options.knownSecrets,
    ) as JsonObject;
  }
  const input = artifactReadInputSchema.parse(request.params);
  let cursor: string | null = null;
  let manifest: ArtifactManifest | undefined;
  const seen = new Set<string>();
  do {
    const page = await persistence.repository.artifacts(input.jobId, cursor, 100);
    manifest = page.artifacts.find((item) => item.id === input.artifactId);
    if (manifest) break;
    cursor = page.nextCursor;
    if (cursor !== null) {
      if (seen.has(cursor) || seen.size >= 1000)
        throw new InspectionFailure('INVALID_INPUT', 'Artifact lookup exceeded its bounded scan.');
      seen.add(cursor);
    }
  } while (cursor !== null);
  if (!manifest || manifest.workspaceId !== options.workspace.id || manifest.jobId !== input.jobId)
    throw new InspectionFailure('NOT_FOUND', 'Accepted artifact not found in this job.');
  if (manifest.storage.kind !== 'local')
    throw new InspectionFailure(
      'CAPABILITY_UNAVAILABLE',
      'Select an object-storage reader for this artifact.',
    );
  const root = await realpath(
    await jobDirectory(options.projectDirectory, options.workspace, input.jobId),
  );
  const filename = resolve(root, manifest.storage.path);
  const path = relative(root, filename);
  if (path === '..' || path.startsWith(`..${sep}`) || path.startsWith(sep))
    throw new InspectionFailure('POLICY_DENIED', 'Artifact escaped its owning job.');
  let current = root;
  for (const component of path.split(sep)) {
    current = resolve(current, component);
    if ((await lstat(current)).isSymbolicLink())
      throw new InspectionFailure('POLICY_DENIED', 'Artifact path is redirected.');
  }
  if ((await realpath(filename)) !== filename)
    throw new InspectionFailure('POLICY_DENIED', 'Artifact is redirected.');
  const file = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await file.stat();
    if (!before.isFile() || before.size !== manifest.sizeBytes)
      throw new InspectionFailure('INVALID_INPUT', 'Accepted artifact size changed.');
    // Verify all bytes before exposing a requested range. A bounded elapsed time prevents an unbounded tool call.
    const hash = createHash('sha256');
    const chunk = Buffer.alloc(1024 * 1024);
    const deadline = Date.parse(options.now()) + 10_000;
    let offset = 0;
    while (offset < before.size) {
      if (Date.parse(options.now()) >= deadline)
        throw new InspectionFailure(
          'CAPABILITY_UNAVAILABLE',
          'Artifact verification exceeded the read deadline.',
        );
      const { bytesRead } = await file.read(
        chunk,
        0,
        Math.min(chunk.length, before.size - offset),
        offset,
      );
      if (bytesRead === 0)
        throw new InspectionFailure('INVALID_INPUT', 'Accepted artifact was truncated.');
      hash.update(chunk.subarray(0, bytesRead));
      offset += bytesRead;
    }
    if (hash.digest('hex') !== manifest.digest)
      throw new InspectionFailure('INVALID_INPUT', 'Accepted artifact checksum changed.');
    const after = await file.stat();
    if (
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs
    )
      throw new InspectionFailure('INVALID_INPUT', 'Artifact changed during verification.');
    // Inspect overlap around byte ranges so split requests cannot reconstruct a known secret.
    const secrets = options.knownSecrets
      .filter((secret) => secret.length > 0)
      .map((secret) => Buffer.from(secret));
    const overlap = Math.max(0, ...secrets.map((secret) => secret.length - 1));
    if (overlap > 65_536)
      throw new InspectionFailure(
        'POLICY_DENIED',
        'Configured redaction values exceed the artifact reader limit.',
      );
    const start = Math.max(0, input.offset - overlap);
    const end = Math.min(before.size, input.offset + input.length + overlap);
    const window = Buffer.alloc(Math.max(0, end - start));
    const read = await file.read(window, 0, window.length, start);
    for (const secret of secrets) {
      let index = 0;
      while ((index = window.indexOf(secret, index)) !== -1) {
        window.fill(42, index, index + secret.length);
        index += secret.length;
      }
    }
    const from = Math.min(window.length, Math.max(0, input.offset - start));
    const data = window.subarray(from, Math.min(read.bytesRead, from + input.length));
    const bytesRead = data.length;
    const textKind = ['text', 'json', 'html', 'subtitles'].includes(manifest.kind);
    return {
      artifactId: manifest.id,
      digest: manifest.digest,
      sizeBytes: manifest.sizeBytes,
      offset: input.offset,
      bytesRead,
      nextOffset: input.offset + bytesRead < before.size ? input.offset + bytesRead : null,
      encoding: textKind ? 'utf8' : 'base64',
      content: textKind
        ? (redactPublicValue(
            data.subarray(0, bytesRead).toString('utf8'),
            options.knownSecrets,
          ) as string)
        : data.subarray(0, bytesRead).toString('base64'),
    };
  } finally {
    await file.close();
  }
}
