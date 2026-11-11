import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  createLocalArtifactStaging,
  createSqlitePersistence,
  type LocalArtifactStagingOptions,
} from '@tutorialx/adapters';
import type {
  ArtifactManifest,
  JobRepository,
  MediaMetadata,
  OperationContext,
  WorkflowGraph,
} from '@tutorialx/contracts';
import {
  acceptStageArtifacts,
  inspectRetainedArtifacts,
  verifyAcceptedArtifacts,
} from '@tutorialx/core';
import { expect, it } from 'vitest';
import { fixtureAttempt, fixtureJob, fixtureMutation } from '../conformance/repository-suite.js';
import { digest, timestamp } from '../fixtures/contracts.js';

async function* bytes(value: Uint8Array) {
  yield value;
}
const hash = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');

async function prepare(inspectMedia?: LocalArtifactStagingOptions['inspectMedia']) {
  const root = await mkdtemp(join(tmpdir(), 'tutorialx-artifacts-'));
  const jobDirectory = join(root, 'job');
  await mkdir(jobDirectory);
  let now = timestamp;
  const store = await createSqlitePersistence({
    filename: join(root, 'state.sqlite'),
    workspaceId: 'workspace_example',
    now: () => now,
  });
  await store.repository.initialize();
  const job = fixtureJob();
  await store.repository.create(job);
  const attempt = {
    ...fixtureAttempt(),
    stageId: 'produce',
    stageKind: 'produce',
    lease: { workerId: 'worker', token: 1, expiresAt: '2030-01-01T00:00:00Z' },
  };
  const mutation = fixtureMutation(job);
  mutation.job.status.lifecycle = 'running';
  mutation.job.status.totalStages = 1;
  mutation.attempts = [attempt];
  await store.repository.commit(mutation);
  const context: OperationContext = {
    operationId: 'operation',
    attemptId: attempt.id,
    jobId: job.brief.id,
    outputDirectory: jobDirectory,
    deadlineAt: '2099-01-01T00:00:00Z',
    reservationId: null,
    signal: new AbortController().signal,
  };
  const staging = await createLocalArtifactStaging({
    jobDirectory,
    workspaceId: job.brief.workspaceId,
    jobId: job.brief.id,
    now: () => now,
    ...(inspectMedia ? { inspectMedia } : {}),
  });
  const graph: WorkflowGraph = {
    schemaVersion: 1,
    stages: [
      {
        id: 'produce',
        kind: 'produce',
        phase: 'production',
        inputDigest: digest,
        dependencies: [],
        requiredArtifactIds: [],
        required: true,
      },
    ],
  };
  const lineage = {
    inputDigest: digest,
    inputDigests: [digest],
    settingsDigest: digest,
    templateDigest: null,
    provider: { id: 'fixture-media', version: '1' },
  };
  function manifest(value: Uint8Array, id = 'artifact'): ArtifactManifest {
    return {
      schemaVersion: 1,
      id,
      createdAt: timestamp,
      workspaceId: job.brief.workspaceId,
      jobId: job.brief.id,
      kind: 'json',
      mimeType: 'application/json',
      storage: { kind: 'local', path: 'provider/result.json' },
      digest: hash(value),
      sizeBytes: value.byteLength,
      media: null,
      provenance: {
        stageId: 'produce',
        attemptId: attempt.id,
        inputDigests: [digest],
        provider: lineage.provider,
        settingsDigest: digest,
        templateDigest: null,
      },
    };
  }
  const accept = (
    receiptIds: string[],
    repository: JobRepository = store.repository,
    expectedRevision = 2,
  ) =>
    acceptStageArtifacts({
      repository,
      staging,
      graph,
      expectedRevision,
      receiptIds,
      lineage,
      availableArtifactIds: [],
      fence: { workerId: 'worker', token: 1 },
      context,
      now: () => now,
    });
  return {
    root,
    jobDirectory,
    store,
    staging,
    context,
    graph,
    lineage,
    manifest,
    accept,
    setNow: (value: string) => {
      now = value;
    },
    close: async () => {
      await store.repository.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}
async function fixture(
  run: (value: Awaited<ReturnType<typeof prepare>>) => Promise<void>,
  inspectMedia?: LocalArtifactStagingOptions['inspectMedia'],
) {
  const value = await prepare(inspectMedia);
  try {
    await run(value);
  } finally {
    await value.close();
  }
}

it('stages and publishes complete bytes, then atomically accepts them with a fenced SQLite transition', async () => {
  await fixture(async ({ staging, context, manifest, accept, store, jobDirectory }) => {
    const content = Buffer.from('{"ready":true}');
    const staged = await staging.stage(manifest(content), bytes(content), context);
    expect(await store.repository.artifacts(context.jobId, null, 100)).toEqual({
      artifacts: [],
      nextCursor: null,
    });
    await expect(
      verifyAcceptedArtifacts(store.repository, staging, ['artifact'], context),
    ).rejects.toThrow('no accepted metadata');
    const result = await accept([staged.id]);
    expect(result.job.status).toMatchObject({
      revision: 3,
      lifecycle: 'running',
      completedStages: 1,
      totalStages: 1,
      delivery: null,
    });
    expect((await store.repository.attempts(context.jobId))[0]).toMatchObject({
      status: 'succeeded',
      outputArtifactIds: ['artifact'],
      lease: null,
    });
    const accepted = (
      await verifyAcceptedArtifacts(store.repository, staging, ['artifact'], context)
    )[0]!;
    expect(accepted.digest).toBe(hash(content));
    expect(accepted.storage.kind).toBe('local');
    if (accepted.storage.kind === 'local')
      expect(await readFile(resolve(jobDirectory, accepted.storage.path))).toEqual(content);
    expect(
      (
        await inspectRetainedArtifacts(
          store.repository,
          staging,
          { cursor: null, limit: 100 },
          context,
        )
      ).items[0],
    ).toMatchObject({ phase: 'published', metadataReferenced: true, activeAttempt: false });
  });
});

it('retains partial writes without a completion marker and omits private producer errors', async () => {
  await fixture(async ({ staging, context, manifest, store, jobDirectory }) => {
    const content = Buffer.from('{"ready":true}');
    async function* interrupted() {
      yield content.subarray(0, 5);
      throw new Error('private-provider-secret');
    }
    let failure: unknown;
    try {
      await staging.stage(manifest(content), interrupted(), context);
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({ code: 'PROVIDER_FAILED' });
    expect(String(failure)).not.toContain('private-provider-secret');
    const retained = await staging.retained({ cursor: null, limit: 100 }, context);
    expect(retained.items[0]?.phase).toBe('partial');
    const id = retained.items[0]!.receiptId;
    expect(
      (await readFile(join(jobDirectory, 'work/artifacts/staging', id, 'bytes.partial'))).length,
    ).toBe(5);
    await expect(staging.publish(id, context)).rejects.toThrow();
    expect((await store.repository.artifacts(context.jobId, null, 100)).artifacts).toEqual([]);
    expect((await store.repository.attempts(context.jobId))[0]?.status).toBe('running');
  });
});

it('rejects wrong checksums, truncated streams, and overlong streams before publication', async () => {
  await fixture(async ({ staging, context, manifest, store }) => {
    const content = Buffer.from('{"ready":true}');
    for (const candidate of [
      { ...manifest(content), digest: '0'.repeat(64) },
      { ...manifest(content), sizeBytes: content.length + 1 },
      { ...manifest(content), sizeBytes: content.length - 1 },
    ])
      await expect(staging.stage(candidate, bytes(content), context)).rejects.toMatchObject({
        code: 'PROVIDER_FAILED',
      });
    expect(
      (await staging.retained({ cursor: null, limit: 100 }, context)).items.every(
        (item) => item.phase === 'partial',
      ),
    ).toBe(true);
    expect((await store.repository.artifacts(context.jobId, null, 100)).artifacts).toEqual([]);
  });
});

it('retains fully published orphans when metadata commit fails and can reconcile the same bytes', async () => {
  await fixture(async ({ staging, context, manifest, accept, store }) => {
    const content = Buffer.from('{"ready":true}');
    const staged = await staging.stage(manifest(content), bytes(content), context);
    const interrupted: JobRepository = {
      ...store.repository,
      commit: async () => {
        throw new Error('crash before metadata commit');
      },
    };
    await expect(accept([staged.id], interrupted)).rejects.toThrow('crash before metadata');
    expect((await store.repository.read(context.jobId))?.status.revision).toBe(2);
    expect((await store.repository.artifacts(context.jobId, null, 100)).artifacts).toEqual([]);
    expect(
      (
        await inspectRetainedArtifacts(
          store.repository,
          staging,
          { cursor: null, limit: 100 },
          context,
        )
      ).items[0],
    ).toMatchObject({ phase: 'published', metadataReferenced: false, activeAttempt: true });
    expect((await accept([staged.id])).artifacts).toHaveLength(1);
  });
});

it('never removes accepted bytes after an uncertain response following the actual metadata commit', async () => {
  await fixture(async ({ staging, context, manifest, accept, store }) => {
    const content = Buffer.from('{"ready":true}');
    const staged = await staging.stage(manifest(content), bytes(content), context);
    const interrupted: JobRepository = {
      ...store.repository,
      commit: async (mutation) => {
        await store.repository.commit(mutation);
        throw new Error('connection interrupted after commit');
      },
    };
    await expect(accept([staged.id], interrupted)).rejects.toThrow('after commit');
    expect((await store.repository.read(context.jobId))?.status.revision).toBe(3);
    expect(
      await verifyAcceptedArtifacts(store.repository, staging, ['artifact'], context),
    ).toHaveLength(1);
  });
});

it('accepts a multi-output stage only when every output passes verification', async () => {
  await fixture(async ({ staging, context, manifest, accept, store }) => {
    const good = Buffer.from('{"ready":true}');
    const invalid = Buffer.from('private text that is not JSON');
    const first = await staging.stage(manifest(good, 'first'), bytes(good), context);
    const second = await staging.stage(manifest(invalid, 'second'), bytes(invalid), context);
    await expect(accept([first.id, second.id])).rejects.toThrow('not valid JSON');
    expect((await store.repository.artifacts(context.jobId, null, 100)).artifacts).toEqual([]);
    expect((await store.repository.attempts(context.jobId))[0]?.status).toBe('running');
    const retained = await inspectRetainedArtifacts(
      store.repository,
      staging,
      { cursor: null, limit: 100 },
      context,
    );
    expect(retained.items.every((item) => !item.metadataReferenced)).toBe(true);
    expect(retained.items.some((item) => item.phase === 'published')).toBe(true);
  });
});

it('rejects altered provenance, stale worker fences, expired leases, and cancellation', async () => {
  await fixture(async ({ staging, context, manifest, accept, store, setNow, graph, lineage }) => {
    const content = Buffer.from('{"ready":true}');
    const forged = manifest(content);
    forged.provenance.settingsDigest = 'b'.repeat(64);
    const bad = await staging.stage(forged, bytes(content), context);
    await expect(accept([bad.id])).rejects.toThrow('provenance');
    const staged = await staging.stage(manifest(content), bytes(content), context);
    const current = (await store.repository.read(context.jobId))!;
    const attempt = (await store.repository.attempts(context.jobId))[0]!;
    const takeover = fixtureMutation(current);
    takeover.attempts = [
      { ...attempt, lease: { ...attempt.lease!, workerId: 'replacement', token: 2 } },
    ];
    await store.repository.commit(takeover);
    await expect(accept([staged.id], store.repository, 3)).rejects.toThrow('execution lease');
    setNow('2031-01-01T00:00:00Z');
    await expect(
      acceptStageArtifacts({
        repository: store.repository,
        staging,
        graph,
        expectedRevision: 3,
        receiptIds: [staged.id],
        lineage,
        availableArtifactIds: [],
        fence: { workerId: 'replacement', token: 2 },
        context,
        now: () => '2031-01-01T00:00:00Z',
      }),
    ).rejects.toThrow('execution lease');
    const abort = new AbortController();
    abort.abort();
    await expect(
      staging.publish(staged.id, { ...context, signal: abort.signal }),
    ).rejects.toThrow();
    expect((await store.repository.artifacts(context.jobId, null, 100)).artifacts).toEqual([]);
  });
});

it('rejects symlink/object-scope escapes and another job binding', async () => {
  await fixture(async ({ root, jobDirectory, staging, context, manifest, accept, store }) => {
    const content = Buffer.from('{"ready":true}');
    const staged = await staging.stage(manifest(content), bytes(content), context);
    const outside = join(root, 'outside');
    await mkdir(outside);
    await rm(join(jobDirectory, 'work/artifacts/objects'), { recursive: true });
    await symlink(outside, join(jobDirectory, 'work/artifacts/objects'), 'junction');
    await expect(accept([staged.id])).rejects.toThrow('symlink');
    expect(await readdir(outside)).toEqual([]);
    await expect(
      createLocalArtifactStaging({
        jobDirectory,
        jobId: 'foreign_job',
        workspaceId: 'workspace_example',
        now: () => timestamp,
      }),
    ).rejects.toThrow();
    await expect(
      staging.verify(
        { ...staged.manifest, storage: { kind: 'local', path: 'provider/result.json' } },
        context,
      ),
    ).rejects.toThrow('object scope');
    expect((await store.repository.artifacts(context.jobId, null, 100)).artifacts).toEqual([]);
  });
});

function wav() {
  const value = Buffer.alloc(32044);
  value.write('RIFF');
  value.writeUInt32LE(value.length - 8, 4);
  value.write('WAVEfmt ', 8);
  value.writeUInt32LE(16, 16);
  value.writeUInt16LE(1, 20);
  value.writeUInt16LE(1, 22);
  value.writeUInt32LE(16000, 24);
  value.writeUInt32LE(32000, 28);
  value.writeUInt16LE(2, 32);
  value.writeUInt16LE(16, 34);
  value.write('data', 36);
  value.writeUInt32LE(32000, 40);
  return value;
}
async function inspectWav(path: string): Promise<MediaMetadata> {
  const value = await readFile(path);
  if (value.toString('ascii', 0, 4) !== 'RIFF' || value.readUInt16LE(20) !== 1)
    throw new Error('Unsupported fixture WAV');
  return {
    durationUs: Math.round((value.readUInt32LE(40) / value.readUInt32LE(28)) * 1_000_000),
    width: null,
    height: null,
    frameRate: null,
    videoCodec: null,
    audioCodec: 'pcm_s16le',
    sampleRate: value.readUInt32LE(24),
    channels: value.readUInt16LE(22),
  };
}

it('requires real media inspection, checks measured metadata, and accepts valid inspected WAV bytes', async () => {
  const value = wav();
  const measured: MediaMetadata = {
    durationUs: 1_000_000,
    width: null,
    height: null,
    frameRate: null,
    videoCodec: null,
    audioCodec: 'pcm_s16le',
    sampleRate: 16000,
    channels: 1,
  };
  await fixture(async ({ staging, context, manifest, accept }) => {
    const media = {
      ...manifest(value),
      kind: 'audio' as const,
      mimeType: 'audio/wav',
      media: measured,
    };
    const staged = await staging.stage(media, bytes(value), context);
    await expect(accept([staged.id])).rejects.toThrow('media inspector is required');
  });
  await fixture(async ({ staging, context, manifest, accept, store }) => {
    const media = {
      ...manifest(value),
      kind: 'audio' as const,
      mimeType: 'audio/wav',
      media: measured,
    };
    const wrong = await staging.stage(
      { ...media, id: 'wrong', media: { ...measured, sampleRate: 48000 } },
      bytes(value),
      context,
    );
    await expect(accept([wrong.id])).rejects.toThrow('Measured media metadata');
    const staged = await staging.stage(media, bytes(value), context);
    expect((await accept([staged.id])).artifacts[0]!.media).toEqual(measured);
    expect(
      await verifyAcceptedArtifacts(store.repository, staging, ['artifact'], context),
    ).toHaveLength(1);
  }, inspectWav);
});

it('lists retained receipts with bounded cursor pages without implying acceptance', async () => {
  await fixture(async ({ staging, context, manifest, store }) => {
    const value = Buffer.from('{}');
    for (const id of ['first', 'second', 'third'])
      await staging.stage(manifest(value, id), bytes(value), context);
    const first = await inspectRetainedArtifacts(
      store.repository,
      staging,
      { cursor: null, limit: 2 },
      context,
    );
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const last = await inspectRetainedArtifacts(
      store.repository,
      staging,
      { cursor: first.nextCursor, limit: 2 },
      context,
    );
    expect(last.items).toHaveLength(1);
    expect(last.nextCursor).toBeNull();
    expect(
      [...first.items, ...last.items].every(
        (item) => item.phase === 'staged' && !item.metadataReferenced,
      ),
    ).toBe(true);
  });
});

it('rejects corruption of accepted bytes and ownership replacement without a newer fence', async () => {
  await fixture(async ({ staging, context, manifest, accept, store, jobDirectory }) => {
    const current = (await store.repository.read(context.jobId))!;
    const attempt = (await store.repository.attempts(context.jobId))[0]!;
    const takeover = fixtureMutation(current);
    takeover.attempts = [{ ...attempt, lease: { ...attempt.lease!, workerId: 'replacement' } }];
    await expect(store.repository.commit(takeover)).rejects.toThrow('newer fencing token');
    const content = Buffer.from('{"ready":true}');
    const staged = await staging.stage(manifest(content), bytes(content), context);
    const result = await accept([staged.id]);
    const accepted = result.artifacts[0]!;
    if (accepted.storage.kind !== 'local') throw new Error('Expected local object.');
    const path = resolve(jobDirectory, accepted.storage.path);
    await chmod(path, 0o600);
    const corrupt = Buffer.from(content);
    corrupt[2] = corrupt[2]! ^ 1;
    await writeFile(path, corrupt);
    await expect(
      verifyAcceptedArtifacts(store.repository, staging, ['artifact'], context),
    ).rejects.toThrow('checksum');
    expect((await store.repository.artifacts(context.jobId, null, 100)).artifacts).toHaveLength(1);
  });
});

it('retains an actual killed worker partial write and never promotes it to a successful artifact', async () => {
  await fixture(async ({ root, jobDirectory, context, manifest, staging, store }) => {
    const data = Buffer.from('{"ready":true}');
    const script = join(root, 'interrupted-worker.mjs');
    const entrypoint = pathToFileURL(resolve('packages/adapters/dist/index.js')).href;
    await writeFile(
      script,
      `import {createLocalArtifactStaging} from ${JSON.stringify(entrypoint)};\nconst options=${JSON.stringify({ jobDirectory, workspaceId: 'workspace_example', jobId: context.jobId })};options.now=()=>${JSON.stringify(timestamp)};\nconst store=await createLocalArtifactStaging(options);\nconst context=${JSON.stringify({ ...context, signal: undefined })};context.signal=new AbortController().signal;\nsetInterval(()=>{},1000);\nasync function* source(){yield Buffer.from(${JSON.stringify([...data.subarray(0, 5)])});process.stdout.write('PARTIAL\\n');await new Promise(()=>{});}\nawait store.stage(${JSON.stringify(manifest(data))},source(),context);\n`,
    );
    const child = spawn(process.execPath, [script], { stdio: ['ignore', 'pipe', 'pipe'] });
    const exited = new Promise<void>((resolveExit) => {
      child.once('exit', () => resolveExit());
      child.once('error', () => resolveExit());
    });
    try {
      await new Promise<void>((resolveReady, reject) => {
        const timeout = setTimeout(
          () => reject(new Error('Worker did not reach its partial write.')),
          5000,
        );
        let output = '';
        let errors = '';
        child.stdout.on('data', (chunk) => {
          output += chunk.toString();
          if (output.includes('PARTIAL')) {
            clearTimeout(timeout);
            resolveReady();
          }
        });
        child.stderr.on('data', (chunk) => {
          errors += chunk.toString();
        });
        child.once('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
        child.once('exit', () => {
          clearTimeout(timeout);
          reject(new Error(`Worker exited early: ${errors}`));
        });
      });
      child.kill('SIGKILL');
      await exited;
    } finally {
      if (child.pid && child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
        await exited;
      }
    }
    const retained = await staging.retained({ cursor: null, limit: 100 }, context);
    expect(retained.items[0]?.phase).toBe('partial');
    const receiptId = retained.items[0]!.receiptId;
    expect(
      (await readFile(join(jobDirectory, 'work/artifacts/staging', receiptId, 'bytes.partial')))
        .length,
    ).toBe(5);
    await expect(staging.publish(receiptId, context)).rejects.toThrow();
    expect((await store.repository.artifacts(context.jobId, null, 100)).artifacts).toEqual([]);
    expect((await store.repository.attempts(context.jobId))[0]?.status).toBe('running');
  });
});
