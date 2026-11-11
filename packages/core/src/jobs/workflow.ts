import {
  type Diagnostic,
  type JobStatus,
  jobStatusSchema,
  type StageAttempt,
  type StageDefinition,
  stageAttemptSchema,
  timestampSchema,
  type WaitReason,
  type WorkflowGraph,
  workflowGraphSchema,
} from '@tutorialx/contracts';

export class WorkflowTransitionError extends Error {
  readonly code = 'POLICY_DENIED';
}

/** Iterative topological validation avoids stack exhaustion on a long valid workflow. */
export function validateWorkflowGraph(input: WorkflowGraph): WorkflowGraph {
  const graph = workflowGraphSchema.parse(input);
  const nodes = new Map(graph.stages.map((stage) => [stage.id, stage]));
  const remaining = new Map(graph.stages.map((stage) => [stage.id, stage.dependencies.length]));
  const dependents = new Map<string, string[]>();
  for (const stage of graph.stages)
    for (const dependency of stage.dependencies) {
      if (!nodes.has(dependency))
        throw new WorkflowTransitionError(
          `Stage ${stage.id} references missing dependency ${dependency}.`,
        );
      const values = dependents.get(dependency) ?? [];
      values.push(stage.id);
      dependents.set(dependency, values);
    }
  const ready = graph.stages
    .filter((stage) => stage.dependencies.length === 0)
    .map((stage) => stage.id);
  for (let index = 0; index < ready.length; index++)
    for (const child of dependents.get(ready[index]!) ?? []) {
      const count = remaining.get(child)! - 1;
      remaining.set(child, count);
      if (count === 0) ready.push(child);
    }
  if (ready.length !== graph.stages.length)
    throw new WorkflowTransitionError('Workflow contains a dependency cycle.');
  return graph;
}

export interface WorkflowContext {
  graph: WorkflowGraph;
  job: JobStatus;
  attempts: readonly StageAttempt[];
  /** Verified/accepted artifacts for this job, supplied by the artifact acceptance service. */
  acceptedArtifactIds: readonly string[];
  /** Result of trusted revision-bound authorization, not a flag read from a submitted plan. */
  productionAuthorized: boolean;
  prerequisites: Readonly<
    Record<string, readonly { satisfied: boolean; reason: WaitReason; detail: string }[]>
  >;
  now: string;
}
export type StageEligibility =
  | { eligible: true }
  | {
      eligible: false;
      code: string;
      reason: WaitReason | null;
      nextAction: string;
      detail: string;
    };

function latest(context: WorkflowContext, stage: StageDefinition) {
  return context.attempts
    .filter(
      (attempt) =>
        attempt.jobId === context.job.jobId &&
        attempt.stageId === stage.id &&
        attempt.stageKind === stage.kind &&
        attempt.inputDigest === stage.inputDigest,
    )
    .sort((a, b) => b.attempt - a.attempt)[0];
}
function requiredStage(context: WorkflowContext, stageId: string) {
  const stage = context.graph.stages.find((value) => value.id === stageId);
  if (!stage) throw new WorkflowTransitionError('Stage is not in the current workflow.');
  return stage;
}

function completedStage(context: WorkflowContext, stage: StageDefinition): boolean {
  const result = latest(context, stage);
  return (
    result?.status === 'succeeded' &&
    result.diagnostic === null &&
    result.outputArtifactIds.every((id) => context.acceptedArtifactIds.includes(id))
  );
}

export function evaluateStageEligibility(
  context: WorkflowContext,
  stageId: string,
): StageEligibility {
  const stage = requiredStage(context, stageId);
  const blocked = (
    code: string,
    reason: WaitReason | null,
    nextAction: string,
    detail: string,
  ): StageEligibility => ({ eligible: false, code, reason, nextAction, detail });
  if (context.job.lifecycle === 'paused')
    return blocked('JOB_PAUSED', null, 'job.resume', 'Resume the job explicitly before dispatch.');
  if (context.job.lifecycle === 'cancelled')
    return blocked(
      'JOB_CANCELLED',
      null,
      'job.resume',
      'Cancelled work requires explicit resume and reauthorization.',
    );
  if (context.job.lifecycle === 'failed')
    return blocked(
      'JOB_FAILED',
      null,
      'job.retry',
      'Classify the failure and authorize an eligible retry.',
    );
  if (context.job.lifecycle === 'finished')
    return blocked(
      'JOB_FINISHED',
      null,
      'job.show',
      'Finished jobs require a revision before more work.',
    );
  const current = latest(context, stage);
  if (
    (current?.status === 'waiting' && current.waitReason === 'uncertain-outcome') ||
    current?.diagnostic?.classification === 'uncertain'
  )
    return blocked(
      'RECONCILIATION_REQUIRED',
      'uncertain-outcome',
      'job.context',
      'Reconcile the external operation before authorizing any repetition.',
    );
  if (
    context.attempts.some(
      (attempt) =>
        attempt.jobId === context.job.jobId &&
        attempt.stageId === stage.id &&
        attempt.status === 'running',
    )
  )
    return blocked('STAGE_RUNNING', null, 'events', 'An attempt already owns this stage.');
  if (current?.status === 'succeeded' && !completedStage(context, stage))
    return blocked(
      'ACCEPTED_OUTPUT_UNAVAILABLE',
      'input',
      'job.retry',
      'A recorded completion has missing accepted output or unresolved diagnostics.',
    );
  if (completedStage(context, stage))
    return blocked(
      'STAGE_COMPLETE',
      null,
      'job.context',
      'Reuse the accepted result rather than dispatching it again.',
    );
  if (
    current?.status === 'failed' ||
    current?.status === 'cancelled' ||
    ((current?.status === 'invalidated' || current?.status === 'waiting') &&
      current.startedAt !== null)
  )
    return blocked(
      'NEW_ATTEMPT_REQUIRED',
      null,
      'job.retry',
      'Retain the old attempt and create an authorized new attempt.',
    );
  for (const dependency of stage.dependencies) {
    const definition = requiredStage(context, dependency);
    if (!completedStage(context, definition))
      return blocked(
        'DEPENDENCY_INCOMPLETE',
        'input',
        'job.context',
        `Stage ${dependency} has no compatible accepted completion.`,
      );
  }
  const accepted = new Set(context.acceptedArtifactIds);
  if (stage.requiredArtifactIds.some((id) => !accepted.has(id)))
    return blocked(
      'ARTIFACT_MISSING',
      'input',
      'source.add',
      'A required accepted artifact is unavailable.',
    );
  if (stage.phase !== 'planning' && !context.productionAuthorized)
    return blocked(
      'APPROVAL_REQUIRED',
      'approval',
      'plan.approve',
      'Production requires trusted authorization for the current revision.',
    );
  for (const prerequisite of context.prerequisites[stageId] ?? [])
    if (!prerequisite.satisfied)
      return blocked(
        'PREREQUISITE_MISSING',
        prerequisite.reason,
        prerequisite.reason === 'approval' ? 'plan.approve' : 'job.context',
        prerequisite.detail,
      );
  return { eligible: true };
}

export type StageEvent =
  | { type: 'eligible' }
  | { type: 'start'; lease: NonNullable<StageAttempt['lease']> }
  | { type: 'wait'; reason: WaitReason; token?: number }
  | { type: 'succeed'; token: number; outputArtifactIds: string[] }
  | { type: 'fail'; token: number; diagnostic: Diagnostic }
  | { type: 'cancel' | 'invalidate' };

export function transitionStage(
  current: StageAttempt,
  event: StageEvent,
  context: WorkflowContext,
): StageAttempt {
  const stage = requiredStage(context, current.stageId);
  const now = timestampSchema.parse(context.now);
  stageAttemptSchema.parse(current);
  if (current.jobId !== context.job.jobId || current.stageKind !== stage.kind)
    throw new WorkflowTransitionError('Attempt belongs to another job or stage kind.');
  const next = structuredClone(current);
  const fail = () => {
    throw new WorkflowTransitionError(
      `Cannot ${event.type} an attempt in ${current.status} state.`,
    );
  };
  const owned = (token: number | undefined) => {
    if (
      ['cancelled', 'finished'].includes(context.job.lifecycle) ||
      current.status !== 'running' ||
      !current.lease ||
      current.lease.token !== token ||
      Date.parse(current.lease.expiresAt) <= Date.parse(now) ||
      latest(context, stage)?.id !== current.id
    )
      throw new WorkflowTransitionError('Attempt no longer has an active execution fence.');
  };
  if (event.type === 'eligible' || event.type === 'start') {
    if (current.inputDigest !== stage.inputDigest)
      throw new WorkflowTransitionError('Attempt inputs are stale.');
    if (latest(context, stage)?.id !== current.id)
      throw new WorkflowTransitionError('A newer attempt supersedes this attempt.');
    if (
      event.type === 'eligible' &&
      !['pending', 'waiting', 'invalidated'].includes(current.status)
    )
      fail();
    if (event.type === 'start' && current.status !== 'eligible') fail();
    const eligibility = evaluateStageEligibility(context, stage.id);
    if (!eligibility.eligible) throw new WorkflowTransitionError(eligibility.detail);
    next.status = event.type === 'eligible' ? 'eligible' : 'running';
    next.waitReason = null;
    next.diagnostic = null;
    next.finishedAt = null;
    next.outputArtifactIds = [];
    if (event.type === 'start') {
      if (Date.parse(event.lease.expiresAt) <= Date.parse(now))
        throw new WorkflowTransitionError('Cannot start with an expired lease.');
      next.lease = event.lease;
      next.startedAt = now;
    } else next.lease = null;
  } else if (event.type === 'wait') {
    if (!['pending', 'eligible', 'running', 'waiting'].includes(current.status)) fail();
    if (current.status === 'running') owned(event.token);
    next.status = 'waiting';
    next.waitReason = event.reason;
    next.lease = null;
    next.finishedAt = null;
  } else if (event.type === 'succeed' || event.type === 'fail') {
    owned(event.token);
    next.status = event.type === 'succeed' ? 'succeeded' : 'failed';
    next.lease = null;
    next.waitReason = null;
    next.finishedAt = now;
    if (event.type === 'succeed') {
      if (
        new Set(event.outputArtifactIds).size !== event.outputArtifactIds.length ||
        event.outputArtifactIds.some((id) => !context.acceptedArtifactIds.includes(id))
      )
        throw new WorkflowTransitionError(
          'Stage outputs must be accepted artifacts from this job.',
        );
      next.outputArtifactIds = event.outputArtifactIds;
      next.diagnostic = null;
    } else next.diagnostic = event.diagnostic;
  } else {
    if (
      (event.type === 'cancel' && current.status === 'cancelled') ||
      (event.type === 'invalidate' && current.status === 'invalidated')
    )
      return stageAttemptSchema.parse(current);
    if (event.type === 'cancel' && current.status === 'succeeded') fail();
    next.status = event.type === 'cancel' ? 'cancelled' : 'invalidated';
    next.lease = null;
    next.waitReason = null;
    next.finishedAt = now;
  }
  return stageAttemptSchema.parse(next);
}

type SimpleJobEvent = 'run' | 'pause' | 'resume' | 'cancel' | 'fail' | 'invalidate';
export type JobEvent =
  | { [Type in SimpleJobEvent]: { type: Type } }[SimpleJobEvent]
  | { type: 'wait'; reason: WaitReason }
  | {
      type: 'finish';
      delivery: 'ready' | 'needs-attention';
      qualityPassed: boolean;
      packageAccepted: boolean;
    };

export function transitionJob(event: JobEvent, context: WorkflowContext): JobStatus {
  const current = jobStatusSchema.parse(context.job);
  const completed = context.graph.stages.filter((stage) => completedStage(context, stage));
  const next: JobStatus = {
    ...current,
    revision: current.revision + 1,
    completedStages: completed.length,
    totalStages: context.graph.stages.length,
    waitReason: null,
    delivery: null,
  };
  const fail = () => {
    throw new WorkflowTransitionError(`Cannot ${event.type} a job in ${current.lifecycle} state.`);
  };
  if (event.type === 'pause') {
    if (current.lifecycle === 'paused') return current;
    if (!['queued', 'running', 'waiting'].includes(current.lifecycle)) fail();
    next.lifecycle = 'paused';
  } else if (event.type === 'resume') {
    if (!['paused', 'cancelled'].includes(current.lifecycle)) fail();
    next.lifecycle = 'queued';
  } else if (event.type === 'cancel') {
    if (current.lifecycle === 'cancelled') return current;
    if (current.lifecycle === 'finished') fail();
    next.lifecycle = 'cancelled';
    next.delivery = 'cancelled';
  } else if (event.type === 'run') {
    if (!['queued', 'waiting'].includes(current.lifecycle)) fail();
    if (!context.graph.stages.some((stage) => evaluateStageEligibility(context, stage.id).eligible))
      throw new WorkflowTransitionError('No stage is eligible for dispatch.');
    next.lifecycle = 'running';
  } else if (event.type === 'wait') {
    if (!['queued', 'running', 'waiting'].includes(current.lifecycle)) fail();
    next.lifecycle = 'waiting';
    next.waitReason = event.reason;
  } else if (event.type === 'fail') {
    if (!['queued', 'running', 'waiting'].includes(current.lifecycle)) fail();
    next.lifecycle = 'failed';
    next.delivery = 'failed';
  } else if (event.type === 'invalidate') {
    if (current.lifecycle === 'cancelled') fail();
    next.lifecycle = current.lifecycle === 'paused' ? 'paused' : 'waiting';
    next.waitReason = current.lifecycle === 'paused' ? null : 'input';
  } else {
    if (!['queued', 'running', 'waiting', 'failed'].includes(current.lifecycle)) fail();
    if (
      event.delivery === 'ready' &&
      (!context.productionAuthorized ||
        !event.qualityPassed ||
        !event.packageAccepted ||
        context.graph.stages.some((stage) => stage.required && !completedStage(context, stage)) ||
        context.attempts.some(
          (attempt) => attempt.jobId === current.jobId && attempt.status === 'running',
        ))
    )
      throw new WorkflowTransitionError(
        'Ready delivery requires authorized completed stages, final quality evidence, and an accepted package.',
      );
    next.lifecycle = 'finished';
    next.delivery = event.delivery;
  }
  return jobStatusSchema.parse(next);
}
