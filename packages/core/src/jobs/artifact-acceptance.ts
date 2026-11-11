import {
  type ArtifactLineage,
  type ArtifactManifest,
  type ArtifactStaging,
  artifactLineageSchema,
  artifactManifestSchema,
  idSchema,
  type JobRecord,
  type JobRepository,
  type OperationContext,
  type Pagination,
  positiveIntegerSchema,
  stageAttemptSchema,
  timestampSchema,
  type WorkflowGraph,
} from '@tutorialx/contracts';
import { transitionStage, validateWorkflowGraph, workflowProgress } from './workflow.js';

export class ArtifactAcceptanceConflict extends Error {
  readonly code = 'REVISION_CONFLICT';
}

async function manifests(repository: JobRepository, jobId: string): Promise<ArtifactManifest[]> {
  const result: ArtifactManifest[] = [];
  let cursor: string | null = null;
  const seen = new Set<string>();
  do {
    const page = await repository.artifacts(jobId, cursor, 100);
    for (const input of page.artifacts) {
      const artifact = artifactManifestSchema.parse(input);
      if (artifact.jobId !== jobId)
        throw new Error('Repository returned an artifact from another job.');
      result.push(artifact);
    }
    cursor = page.nextCursor;
    if (cursor !== null) {
      if (seen.has(cursor)) throw new Error('Artifact pagination did not advance.');
      seen.add(cursor);
    }
  } while (cursor !== null);
  return result;
}

function assertLineage(
  manifest: ArtifactManifest,
  expected: ArtifactLineage,
  scope: { jobId: string; workspaceId: string; stageId: string; attemptId: string },
) {
  const provenance = manifest.provenance;
  if (
    manifest.jobId !== scope.jobId ||
    manifest.workspaceId !== scope.workspaceId ||
    provenance.stageId !== scope.stageId ||
    provenance.attemptId !== scope.attemptId ||
    provenance.settingsDigest !== expected.settingsDigest ||
    provenance.templateDigest !== expected.templateDigest ||
    provenance.provider?.id !== expected.provider?.id ||
    provenance.provider?.version !== expected.provider?.version ||
    JSON.stringify(provenance.inputDigests) !== JSON.stringify(expected.inputDigests)
  )
    throw new Error('Artifact provenance differs from its authorized attempt inputs.');
}

/** Complete bytes first; one fenced repository transaction is the acceptance authority. */
export async function acceptStageArtifacts(input: {
  repository: JobRepository;
  staging: ArtifactStaging;
  graph: WorkflowGraph;
  expectedRevision: number;
  fence: { workerId: string; token: number };
  receiptIds: readonly string[];
  lineage: ArtifactLineage;
  /** Previously verified accepted artifacts, supplied by stage preflight. */
  availableArtifactIds: readonly string[];
  context: OperationContext;
  now(): string;
}): Promise<{ job: JobRecord; artifacts: readonly ArtifactManifest[] }> {
  const { repository, staging, context } = input;
  positiveIntegerSchema.parse(input.expectedRevision);
  if (
    !input.receiptIds.length ||
    input.receiptIds.length > 10_000 ||
    new Set(input.receiptIds).size !== input.receiptIds.length
  )
    throw new Error('Supply unique staged artifact receipts.');
  const check = () => {
    context.signal.throwIfAborted();
    if (
      Date.parse(timestampSchema.parse(context.deadlineAt)) <=
      Date.parse(timestampSchema.parse(input.now()))
    )
      throw new Error('Artifact acceptance deadline exceeded.');
  };
  check();
  const graph = validateWorkflowGraph(input.graph);
  const lineage = artifactLineageSchema.parse(input.lineage);
  const job = await repository.read(idSchema.parse(context.jobId));
  if (!job || job.status.revision !== input.expectedRevision)
    throw new ArtifactAcceptanceConflict('Job revision changed before artifact acceptance.');
  if (['cancelled', 'finished'].includes(job.status.lifecycle))
    throw new ArtifactAcceptanceConflict('This job cannot accept new stage output.');
  const attempts = (await repository.attempts(context.jobId)).map((value) =>
    stageAttemptSchema.parse(value),
  );
  const current = attempts.find((attempt) => attempt.id === context.attemptId);
  const definition = graph.stages.find((stage) => stage.id === current?.stageId);
  if (
    !current ||
    current.status !== 'running' ||
    !current.lease ||
    current.lease.workerId !== input.fence.workerId ||
    current.lease.token !== input.fence.token ||
    Date.parse(current.lease.expiresAt) <= Date.parse(input.now()) ||
    current.inputDigest !== lineage.inputDigest ||
    definition?.inputDigest !== lineage.inputDigest ||
    definition.kind !== current.stageKind
  )
    throw new ArtifactAcceptanceConflict(
      'Stage no longer owns the expected inputs and execution lease.',
    );
  const existing = await manifests(repository, context.jobId);
  const accepted = new Set(existing.map((artifact) => artifact.id));
  for (const id of input.availableArtifactIds)
    if (!accepted.has(id))
      throw new Error('Preflight reported an artifact that has no accepted metadata.');
  const scope = {
    jobId: context.jobId,
    workspaceId: job.brief.workspaceId,
    stageId: current.stageId,
    attemptId: current.id,
  };
  const described: ArtifactManifest[] = [];
  for (const receiptId of input.receiptIds) {
    check();
    const staged = await staging.describe(idSchema.parse(receiptId), context);
    const manifest = artifactManifestSchema.parse(staged.manifest);
    assertLineage(manifest, lineage, scope);
    described.push(manifest);
  }
  if (new Set(described.map((artifact) => artifact.id)).size !== described.length)
    throw new Error('Staged receipts duplicate an artifact identity.');
  const published: ArtifactManifest[] = [];
  for (let index = 0; index < input.receiptIds.length; index++) {
    check();
    const artifact = artifactManifestSchema.parse(
      await staging.publish(input.receiptIds[index]!, context),
    );
    assertLineage(artifact, lineage, scope);
    if (JSON.stringify(artifact) !== JSON.stringify(described[index]))
      throw new Error('Staged artifact changed during publication.');
    published.push(artifact);
  }
  check();
  const workflow = {
    graph,
    job: job.status,
    attempts,
    acceptedArtifactIds: [
      ...input.availableArtifactIds,
      ...published.map((artifact) => artifact.id),
    ],
    productionAuthorized: false,
    prerequisites: {},
    now: input.now(),
  };
  const completed = transitionStage(
    current,
    {
      type: 'succeed',
      token: input.fence.token,
      outputArtifactIds: published.map((artifact) => artifact.id),
    },
    workflow,
  );
  const updatedAttempts = attempts.map((attempt) =>
    attempt.id === completed.id ? completed : attempt,
  );
  const next: JobRecord = {
    brief: job.brief,
    status: {
      ...job.status,
      ...workflowProgress({ ...workflow, attempts: updatedAttempts }),
      revision: job.status.revision + 1,
    },
  };
  // Failure/unknown outcome intentionally retains published objects. Never unlink after commit errors.
  await repository.commit({
    jobId: context.jobId,
    expectedRevision: input.expectedRevision,
    job: next,
    fence: { attemptId: current.id, token: input.fence.token },
    attempts: [completed],
    artifacts: published,
    plans: [],
    approvals: [],
    operations: [],
    events: [],
    dispatch: [],
  });
  return { job: next, artifacts: published };
}

export async function verifyAcceptedArtifacts(
  repository: JobRepository,
  staging: ArtifactStaging,
  ids: readonly string[],
  context: OperationContext,
): Promise<readonly ArtifactManifest[]> {
  const accepted = await manifests(repository, context.jobId);
  const result: ArtifactManifest[] = [];
  for (const id of ids) {
    const manifest = accepted.find((artifact) => artifact.id === id);
    if (!manifest) throw new Error('Artifact has no accepted metadata in this job.');
    await staging.verify(manifest, context);
    result.push(manifest);
  }
  return result;
}

export async function inspectRetainedArtifacts(
  repository: JobRepository,
  staging: ArtifactStaging,
  page: Pagination,
  context: OperationContext,
) {
  const accepted = await manifests(repository, context.jobId);
  const attempts = await repository.attempts(context.jobId);
  const active = new Set(
    attempts.filter((attempt) => attempt.status === 'running').map((attempt) => attempt.id),
  );
  const retained = await staging.retained(page, context);
  return {
    nextCursor: retained.nextCursor,
    items: retained.items.map((item) => ({
      ...item,
      metadataReferenced:
        item.manifest !== null &&
        accepted.some(
          (manifest) =>
            manifest.id === item.manifest!.id &&
            manifest.digest === item.manifest!.digest &&
            JSON.stringify(manifest.storage) === JSON.stringify(item.manifest!.storage),
        ),
      activeAttempt: item.manifest === null ? null : active.has(item.manifest.provenance.attemptId),
    })),
  };
}
