import {
  type DeliveryPointerStore,
  type EvidenceRecord,
  executionPolicySchema,
  type JobBrief,
  type JobRecord,
  type JobRepository,
  jobBriefSchema,
  positiveIntegerSchema,
  type SourceManifest,
  type StageInput,
  stageAttemptSchema,
  timestampSchema,
  type WorkflowGraph,
  type WorkflowRepository,
  type WorkflowSnapshot,
  type WorkspaceConfig,
  workflowSnapshotSchema,
  workspaceConfigSchema,
} from '@tutorialx/contracts';
import { assertSettingsPolicy } from '../workspace/settings.js';
import {
  bindWorkflowLineage,
  computeStageLineage,
  diffStageLineage,
  type InputFingerprinter,
  type LineageChanges,
  validateStageLineage,
} from './lineage.js';
import { transitionJob } from './workflow.js';

export class InvalidationConflict extends Error {
  readonly code = 'REVISION_CONFLICT';
}

/** Clear a current delivery view before committing a material revision; never discard old artifacts. */
export async function invalidateWorkflowInputs(input: {
  repository: JobRepository;
  workflows: WorkflowRepository;
  pointer: DeliveryPointerStore;
  workspace: WorkspaceConfig;
  expectedRevision: number;
  nextBrief: JobBrief;
  graph: WorkflowGraph;
  inputs: readonly StageInput[];
  fingerprint: InputFingerprinter;
  availableArtifactIds: readonly string[];
  now(): string;
  research?: { sources: readonly SourceManifest[]; evidence: readonly EvidenceRecord[] };
}): Promise<{
  job: JobRecord;
  snapshot: WorkflowSnapshot;
  changes: LineageChanges;
  invalidatedAttemptIds: string[];
}> {
  const workspace = workspaceConfigSchema.parse(input.workspace);
  positiveIntegerSchema.parse(input.expectedRevision);
  const nextBrief = jobBriefSchema.parse(input.nextBrief);
  const nextLineage = computeStageLineage(input.inputs, input.fingerprint);
  const graph = bindWorkflowLineage(input.graph, nextLineage, input.fingerprint);
  assertSettingsPolicy(
    executionPolicySchema.parse({ ...workspace.policyCeiling, ...nextBrief.overrides.policy }),
    workspace.policyCeiling,
  );
  const guard = await input.pointer.lock();
  try {
    const current = await input.repository.read(nextBrief.id);
    if (
      !current ||
      current.status.revision !== input.expectedRevision ||
      current.brief.workspaceId !== workspace.id
    )
      throw new InvalidationConflict('Job revision/workspace changed before input invalidation.');
    if (current.status.lifecycle === 'cancelled')
      throw new InvalidationConflict(
        'Resume the cancelled job explicitly before revising its inputs.',
      );
    if (
      nextBrief.workspaceId !== current.brief.workspaceId ||
      nextBrief.createdAt !== current.brief.createdAt ||
      nextBrief.revision !== current.status.revision + 1
    )
      throw new InvalidationConflict(
        'Input revision must preserve job identity and advance its brief revision.',
      );
    const previous = await input.workflows.readWorkflow(nextBrief.id);
    if (!previous)
      throw new InvalidationConflict(
        'A current workflow input snapshot is required before selective invalidation.',
      );
    validateStageLineage(previous.lineage, input.fingerprint);
    const changes = diffStageLineage(previous.lineage, nextLineage, input.fingerprint);
    const affected = new Set([...changes.changed, ...changes.removed]);
    const oldInputs = new Map(
      previous.lineage.map((record) => [record.stageId, record.inputDigest]),
    );
    const attempts = (await input.repository.attempts(nextBrief.id)).map((record) =>
      stageAttemptSchema.parse(record),
    );
    const now = timestampSchema.parse(input.now());
    const invalidated = attempts
      .filter(
        (attempt) =>
          affected.has(attempt.stageId) &&
          (attempt.inputDigest === oldInputs.get(attempt.stageId) ||
            attempt.status === 'running') &&
          attempt.status !== 'invalidated',
      )
      .map((attempt) =>
        stageAttemptSchema.parse({
          ...attempt,
          status: 'invalidated',
          lease: null,
          waitReason: null,
          finishedAt: attempt.finishedAt ?? now,
        }),
      );
    const replacements = new Map(invalidated.map((attempt) => [attempt.id, attempt]));
    const nextAttempts = attempts.map((attempt) => replacements.get(attempt.id) ?? attempt);
    const status = transitionJob(
      { type: 'invalidate' },
      {
        graph,
        job: current.status,
        attempts: nextAttempts,
        acceptedArtifactIds: input.availableArtifactIds,
        productionAuthorized: false,
        prerequisites: {},
        now,
      },
    );
    const job = { brief: nextBrief, status };
    const snapshot = workflowSnapshotSchema.parse({
      schemaVersion: 1,
      jobId: nextBrief.id,
      jobRevision: status.revision,
      graph,
      lineage: nextLineage,
    });
    // Shared guard serializes future publishers. A crash/failure here leaves no stale ready view.
    await guard.invalidate(current.status.revision, status.revision);
    await input.workflows.commitWorkflow(
      {
        jobId: nextBrief.id,
        expectedRevision: current.status.revision,
        job,
        fence: null,
        attempts: invalidated,
        artifacts: [],
        plans: [],
        approvals: [],
        operations: [],
        events: [],
        dispatch: [],
      },
      snapshot,
      input.research,
    );
    return {
      job,
      snapshot,
      changes,
      invalidatedAttemptIds: invalidated.map((attempt) => attempt.id),
    };
  } finally {
    await guard.release();
  }
}
