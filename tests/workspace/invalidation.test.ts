import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createLocalArtifactStaging,
  createLocalDeliveryPointerStore,
  createLocalProjectionFiles,
  createSqlitePersistence,
  fingerprintJson,
} from '@tutorialx/adapters';
import {
  type ArtifactManifest,
  currentDeliveryPointerSchema,
  type OperationContext,
  type WorkflowRepository,
} from '@tutorialx/contracts';
import {
  acceptStageArtifacts,
  bindWorkflowLineage,
  computeStageLineage,
  importWorkspaceProjection,
  invalidateWorkflowInputs,
  publishWorkspaceProjections,
  verifyAcceptedArtifacts,
  workspaceProjectionDocuments,
} from '@tutorialx/core';
import { expect, it } from 'vitest';
import { fixtureAttempt, fixtureJob, fixtureMutation } from '../conformance/repository-suite.js';
import { timestamp } from '../fixtures/contracts.js';
import {
  lineageGraph,
  lineageInputs,
  lineageModel,
  lineageSource,
  verticalVariant,
} from '../fixtures/lineage.js';

async function prepare() {
  const root = await mkdtemp(join(tmpdir(), 'tutorialx-invalidation-'));
  const directory = join(root, 'job');
  await mkdir(directory);
  const model = lineageModel();
  const lineage = computeStageLineage(lineageInputs(model), fingerprintJson);
  const graph = bindWorkflowLineage(lineageGraph(), lineage, fingerprintJson);
  const store = await createSqlitePersistence({
    filename: join(root, 'state.sqlite'),
    workspaceId: 'workspace_example',
    now: () => timestamp,
  });
  await store.repository.initialize();
  const original = fixtureJob();
  original.brief.sourceIds = [model.sourceId];
  original.status.totalStages = graph.stages.length;
  await store.repository.create(original);
  const first = fixtureMutation(original);
  first.job.status.lifecycle = 'running';
  await store.workflow.commitWorkflow(
    first,
    { schemaVersion: 1, jobId: original.brief.id, jobRevision: 2, graph, lineage },
    { sources: [lineageSource(model)], evidence: [] },
  );
  const staging = await createLocalArtifactStaging({
    jobDirectory: directory,
    workspaceId: original.brief.workspaceId,
    jobId: original.brief.id,
    now: () => timestamp,
  });
  const artifactIds: string[] = [];
  const executionCount: Record<string, number> = {};
  let current = (await store.repository.read(original.brief.id))!;
  for (const definition of graph.stages) {
    const record = lineage.find((value) => value.stageId === definition.id)!;
    const attempt = {
      ...fixtureAttempt(`attempt_${definition.id}`),
      stageId: definition.id,
      stageKind: definition.kind,
      inputDigest: record.inputDigest,
      jobRevision: 2,
      lease: { workerId: 'worker', token: 1, expiresAt: '2030-01-01T00:00:00Z' },
    };
    const start = fixtureMutation(current);
    start.attempts = [attempt];
    await store.repository.commit(start);
    current = (await store.repository.read(original.brief.id))!;
    const context: OperationContext = {
      operationId: `op_${definition.id}`,
      attemptId: attempt.id,
      jobId: original.brief.id,
      outputDirectory: directory,
      deadlineAt: '2099-01-01T00:00:00Z',
      reservationId: null,
      signal: new AbortController().signal,
    };
    const data = Buffer.from(
      JSON.stringify({ stage: definition.id, inputDigest: record.inputDigest }),
    );
    const expected = {
      inputDigest: record.inputDigest,
      inputDigests: [
        ...Object.values(record.sourceDigests).filter((value): value is string => value !== null),
        ...Object.values(record.dependencies),
      ],
      settingsDigest: fingerprintJson(model.settings),
      templateDigest: Object.keys(record.templateDigests).length
        ? fingerprintJson(record.templateDigests)
        : null,
      provider:
        record.provider === null
          ? null
          : { id: record.provider.id, version: record.provider.version },
    };
    const artifact: ArtifactManifest = {
      schemaVersion: 1,
      id: `artifact_${definition.id}`,
      createdAt: timestamp,
      workspaceId: original.brief.workspaceId,
      jobId: original.brief.id,
      kind: 'json',
      mimeType: 'application/json',
      storage: { kind: 'local', path: 'fixture.json' },
      digest: createHash('sha256').update(data).digest('hex'),
      sizeBytes: data.length,
      media: null,
      provenance: {
        stageId: definition.id,
        attemptId: attempt.id,
        inputDigests: expected.inputDigests,
        settingsDigest: expected.settingsDigest,
        templateDigest: expected.templateDigest,
        provider: expected.provider,
      },
    };
    async function* bytes() {
      yield data;
    }
    executionCount[definition.id] = (executionCount[definition.id] ?? 0) + 1;
    const staged = await staging.stage(artifact, bytes(), context);
    const accepted = await acceptStageArtifacts({
      repository: store.repository,
      staging,
      graph,
      expectedRevision: current.status.revision,
      receiptIds: [staged.id],
      lineage: expected,
      availableArtifactIds: artifactIds,
      fence: { workerId: 'worker', token: 1 },
      context,
      now: () => timestamp,
    });
    artifactIds.push(artifact.id);
    current = accepted.job;
  }
  // A fixture models an already accepted delivery; it does not produce or claim a real video.
  const finish = fixtureMutation(current);
  finish.job.status.lifecycle = 'finished';
  finish.job.status.delivery = 'ready';
  await store.repository.commit(finish);
  current = (await store.repository.read(original.brief.id))!;
  await mkdir(join(directory, 'output'), { recursive: true });
  await writeFile(
    join(directory, 'output/current.json'),
    JSON.stringify({
      schemaVersion: 1,
      jobId: original.brief.id,
      jobRevision: current.status.revision,
      status: 'ready',
      manifestIds: ['fixture_delivery'],
    }),
  );
  const pointer = createLocalDeliveryPointerStore(directory, original.brief.id);
  const workspace = {
    schemaVersion: 1 as const,
    id: original.brief.workspaceId,
    createdAt: timestamp,
    revision: 1,
    contentRoot: 'videos',
    sourceRoots: [],
    exclusions: [],
    defaults: {},
    policyCeiling: model.settings.policy,
  };
  const revise = (
    next = (() => {
      const value = structuredClone(model);
      value.settings.captions.style.color = '#ff0000';
      return value;
    })(),
    workflow: WorkflowRepository = store.workflow,
  ) =>
    invalidateWorkflowInputs({
      repository: store.repository,
      workflows: workflow,
      pointer,
      workspace,
      expectedRevision: current.status.revision,
      nextBrief: {
        ...current.brief,
        revision: current.status.revision + 1,
        overrides: { captions: { style: { color: next.settings.captions.style.color } } },
      },
      graph: lineageGraph(),
      inputs: lineageInputs(next),
      fingerprint: fingerprintJson,
      availableArtifactIds: artifactIds,
      now: () => timestamp,
    });
  const context: OperationContext = {
    operationId: 'inspect',
    attemptId: 'inspect',
    jobId: original.brief.id,
    outputDirectory: directory,
    deadlineAt: '2099-01-01T00:00:00Z',
    reservationId: null,
    signal: new AbortController().signal,
  };
  return {
    root,
    directory,
    current,
    model,
    store,
    staging,
    pointer,
    workspace,
    artifactIds,
    executionCount,
    revise,
    context,
    close: async () => {
      await store.repository.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}
async function fixture(run: (value: Awaited<ReturnType<typeof prepare>>) => Promise<void>) {
  const value = await prepare();
  try {
    await run(value);
  } finally {
    await value.close();
  }
}

it('persists selective invalidation, preserves unaffected bytes, and clears the current delivery first', async () => {
  await fixture(async ({ revise, current, directory, store, executionCount, staging, context }) => {
    const originalCalls = { ...executionCount };
    const originalArtifacts = (await store.repository.artifacts(context.jobId, null, 100))
      .artifacts;
    const result = await revise();
    expect(result.changes.changed).toEqual(['composition', 'delivery', 'quality', 'render']);
    expect(result.job.status).toMatchObject({
      lifecycle: 'waiting',
      waitReason: 'input',
      delivery: null,
      completedStages: 7,
      totalStages: 11,
    });
    const attempts = await store.repository.attempts(context.jobId);
    expect(attempts.find((attempt) => attempt.stageId === 'voice')?.status).toBe('succeeded');
    expect(attempts.find((attempt) => attempt.stageId === 'capture')?.status).toBe('succeeded');
    expect(
      attempts
        .filter((attempt) => attempt.status === 'invalidated')
        .map((attempt) => attempt.stageId)
        .sort(),
    ).toEqual(result.changes.changed);
    expect(
      await verifyAcceptedArtifacts(
        store.repository,
        staging,
        originalArtifacts.map((artifact) => artifact.id),
        context,
      ),
    ).toEqual(originalArtifacts);
    expect(executionCount).toEqual(originalCalls);
    const pointer = currentDeliveryPointerSchema.parse(
      JSON.parse(await readFile(join(directory, 'output/current.json'), 'utf8')),
    );
    expect(pointer).toMatchObject({
      status: 'invalidated',
      jobRevision: current.status.revision + 1,
      previousRevision: current.status.revision,
    });
    expect((await store.workflow.readWorkflow(context.jobId))?.lineage).toEqual(
      result.snapshot.lineage,
    );
    expect((await store.workflow.readWorkflow(context.jobId, 2))?.jobRevision).toBe(2);
    expect((await store.repository.artifacts(context.jobId, null, 100)).artifacts).toEqual(
      originalArtifacts,
    );
  });
});

it('retains a conservative invalidated pointer if metadata fails and can retry without producing bytes again', async () => {
  await fixture(async ({ revise, current, directory, store, context, executionCount }) => {
    const originalCalls = { ...executionCount };
    const failed: WorkflowRepository = {
      ...store.workflow,
      commitWorkflow: async () => {
        throw new Error('interrupted before metadata');
      },
    };
    await expect(revise(undefined, failed)).rejects.toThrow('before metadata');
    expect((await store.repository.read(context.jobId))?.status.revision).toBe(
      current.status.revision,
    );
    expect(JSON.parse(await readFile(join(directory, 'output/current.json'), 'utf8')).status).toBe(
      'invalidated',
    );
    expect((await readdir(join(directory, 'output'))).some((name) => name.includes('lock'))).toBe(
      false,
    );
    const result = await revise();
    expect(result.job.status.revision).toBe(current.status.revision + 1);
    expect(executionCount).toEqual(originalCalls);
  });
});

it.each(['narration', 'aspect ratio'] as const)(
  'retains compatible attempts and clears ready delivery after a %s edit',
  async (edit) => {
    await fixture(async ({ model, revise, directory, store, context, executionCount }) => {
      const next = structuredClone(model);
      if (edit === 'narration') next.narration = 'A revised narration.';
      else verticalVariant(next.settings);
      const calls = { ...executionCount };
      const result = await revise(next);
      const changed =
        edit === 'narration'
          ? ['alignment', 'composition', 'delivery', 'quality', 'render', 'timeline', 'voice']
          : ['composition', 'delivery', 'framing', 'quality', 'render'];
      expect(result.changes.changed).toEqual(changed);
      expect(result.job.status.completedStages).toBe(11 - changed.length);
      for (const attempt of await store.repository.attempts(context.jobId))
        expect(attempt.status).toBe(
          changed.includes(attempt.stageId) ? 'invalidated' : 'succeeded',
        );
      expect(
        JSON.parse(await readFile(join(directory, 'output/current.json'), 'utf8')).status,
      ).toBe('invalidated');
      expect(executionCount).toEqual(calls);
    });
  },
);

it('rolls back missing source/artifact bindings and hides snapshots after a raw brief revision', async () => {
  await fixture(async ({ model, store, current, context }) => {
    for (const field of ['sourceDigests', 'artifactDigests'] as const) {
      const inputs = lineageInputs(model);
      inputs[0]![field] = { unregistered: 'f'.repeat(64) };
      const lineage = computeStageLineage(inputs, fingerprintJson);
      await expect(
        store.workflow.commitWorkflow(fixtureMutation(current), {
          schemaVersion: 1,
          jobId: context.jobId,
          jobRevision: current.status.revision + 1,
          graph: bindWorkflowLineage(lineageGraph(), lineage, fingerprintJson),
          lineage,
        }),
      ).rejects.toThrow('fingerprint');
      expect((await store.repository.read(context.jobId))?.status.revision).toBe(
        current.status.revision,
      );
    }
    const mutation = fixtureMutation(current);
    mutation.job.brief.revision = mutation.job.status.revision;
    mutation.job.brief.audience = 'New audience';
    await store.repository.commit(mutation);
    expect(await store.workflow.readWorkflow(context.jobId)).toBeNull();
    expect((await store.workflow.readWorkflow(context.jobId, 2))?.jobRevision).toBe(2);
  });
});

it('preserves committed invalidation when a response is lost after its SQLite transaction', async () => {
  await fixture(async ({ revise, current, directory, store, context }) => {
    const failed: WorkflowRepository = {
      ...store.workflow,
      commitWorkflow: async (...args) => {
        await store.workflow.commitWorkflow(...args);
        throw new Error('response lost after metadata');
      },
    };
    await expect(revise(undefined, failed)).rejects.toThrow('after metadata');
    expect((await store.repository.read(context.jobId))?.status).toMatchObject({
      revision: current.status.revision + 1,
      delivery: null,
    });
    expect((await store.workflow.readWorkflow(context.jobId))?.jobRevision).toBe(
      current.status.revision + 1,
    );
    expect(JSON.parse(await readFile(join(directory, 'output/current.json'), 'utf8')).status).toBe(
      'invalidated',
    );
  });
});

it('serializes delivery pointer writers and does not clobber a newer ready pointer', async () => {
  await fixture(async ({ pointer, revise, directory, current, store, context }) => {
    const guard = await pointer.lock();
    await expect(revise()).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    await guard.release();
    const newer = {
      schemaVersion: 1,
      jobId: context.jobId,
      jobRevision: current.status.revision + 1,
      status: 'ready',
      manifestIds: ['newer_fixture'],
    };
    await writeFile(join(directory, 'output/current.json'), JSON.stringify(newer));
    await expect(revise()).rejects.toThrow('newer revision');
    expect(JSON.parse(await readFile(join(directory, 'output/current.json'), 'utf8'))).toEqual(
      newer,
    );
    expect((await store.repository.read(context.jobId))?.status.revision).toBe(
      current.status.revision,
    );
  });
});

it('commits a refreshed immutable source version with its affected input lineage atomically', async () => {
  await fixture(
    async ({ current, model, store, pointer, workspace, artifactIds, context, directory }) => {
      const next = structuredClone(model);
      next.sourceId = 'narration_source_v2';
      next.sourceDigest = fingerprintJson({ content: 'Updated fixture source' });
      const source = lineageSource(next);
      source.input = { kind: 'text', text: JSON.stringify({ content: 'Updated fixture source' }) };
      const result = await invalidateWorkflowInputs({
        repository: store.repository,
        workflows: store.workflow,
        pointer,
        workspace,
        expectedRevision: current.status.revision,
        nextBrief: {
          ...current.brief,
          revision: current.status.revision + 1,
          sourceIds: [next.sourceId],
        },
        graph: lineageGraph(),
        inputs: lineageInputs(next),
        fingerprint: fingerprintJson,
        availableArtifactIds: artifactIds,
        research: { sources: [source], evidence: [] },
        now: () => timestamp,
      });
      expect(result.changes.preserved).toEqual(['capture', 'framing']);
      expect(await store.research.sources(context.jobId)).toHaveLength(2);
      expect((await store.repository.read(context.jobId))?.brief.sourceIds).toEqual([
        next.sourceId,
      ]);
      expect(
        JSON.parse(await readFile(join(directory, 'output/current.json'), 'utf8')).status,
      ).toBe('invalidated');
    },
  );
});

it('requires the delivery guard for a raw projection import and invalidates its older current pointer', async () => {
  await fixture(async ({ current, store, pointer, workspace, context, directory }) => {
    const files = createLocalProjectionFiles(directory);
    const documents = workspaceProjectionDocuments(current, null);
    await publishWorkspaceProjections(
      files,
      current,
      null,
      Object.fromEntries(Object.keys(documents).map((path) => [path, null])),
    );
    const brief = (await files.read('brief.md'))!.content;
    await files.write('brief.md', brief, brief.replace('> Beginners', '> New readers'));
    const input = {
      repository: store.repository,
      files,
      workspace,
      jobId: context.jobId,
      expectedRevision: current.status.revision,
      path: 'brief.md',
      now: () => timestamp,
    };
    await expect(importWorkspaceProjection(input)).rejects.toThrow('shared guard');
    expect((await store.repository.read(context.jobId))?.status.revision).toBe(
      current.status.revision,
    );
    await importWorkspaceProjection({ ...input, pointer });
    expect(JSON.parse(await readFile(join(directory, 'output/current.json'), 'utf8')).status).toBe(
      'invalidated',
    );
    expect(await store.workflow.readWorkflow(context.jobId)).toBeNull();
  });
});

it('revokes affected running leases while retaining compatible ownership and paused state', async () => {
  await fixture(async ({ current, model, store, pointer, workspace, artifactIds, context }) => {
    const previous = (await store.workflow.readWorkflow(context.jobId))!;
    const mutation = fixtureMutation(current);
    mutation.job.status.lifecycle = 'paused';
    mutation.job.status.delivery = null;
    mutation.attempts = ['render', 'voice'].map((stageId) => ({
      ...fixtureAttempt(`retry_${stageId}`, 2),
      stageId,
      stageKind: stageId,
      jobRevision: 2,
      inputDigest: previous.lineage.find((record) => record.stageId === stageId)!.inputDigest,
      lease: { workerId: 'worker', token: 2, expiresAt: '2030-01-01T00:00:00Z' },
    }));
    await store.repository.commit(mutation);
    const next = structuredClone(model);
    next.settings.captions.style.color = '#ff0000';
    const result = await invalidateWorkflowInputs({
      repository: store.repository,
      workflows: store.workflow,
      pointer,
      workspace,
      expectedRevision: mutation.job.status.revision,
      nextBrief: { ...current.brief, revision: mutation.job.status.revision + 1 },
      graph: lineageGraph(),
      inputs: lineageInputs(next),
      fingerprint: fingerprintJson,
      availableArtifactIds: artifactIds,
      now: () => timestamp,
    });
    expect(result.job.status.lifecycle).toBe('paused');
    const attempts = await store.repository.attempts(context.jobId);
    expect(attempts.find((attempt) => attempt.id === 'retry_render')).toMatchObject({
      status: 'invalidated',
      lease: null,
    });
    expect(attempts.find((attempt) => attempt.id === 'retry_voice')).toMatchObject({
      status: 'running',
      lease: mutation.attempts[1]!.lease,
    });
  });
});
