import type { StageAttempt, StageDefinition, WorkflowGraph } from '@tutorialx/contracts';
import {
  evaluateStageEligibility,
  transitionJob,
  transitionStage,
  validateWorkflowGraph,
  type WorkflowContext,
} from '@tutorialx/core';
import { describe, expect, it } from 'vitest';
import { digest, timestamp } from '../fixtures/contracts.js';

function graph(): WorkflowGraph {
  const phases: StageDefinition['phase'][] = [
    'planning',
    'planning',
    'production',
    'quality',
    'delivery',
  ];
  const ids = ['research', 'plan', 'voice', 'quality', 'delivery'];
  return validateWorkflowGraph({
    schemaVersion: 1,
    stages: ids.map((id, index) => ({
      id,
      kind: id,
      phase: phases[index]!,
      inputDigest: digest,
      dependencies: index ? [ids[index - 1]!] : [],
      requiredArtifactIds: [],
      required: true,
    })),
  });
}
function attempt(
  stage: string,
  status: StageAttempt['status'] = 'pending',
  ordinal = 1,
): StageAttempt {
  return {
    schemaVersion: 1,
    id: `${stage}_${ordinal}`,
    createdAt: timestamp,
    jobId: 'job',
    jobRevision: 1,
    stageId: stage,
    stageKind: stage,
    attempt: ordinal,
    inputDigest: digest,
    status,
    lease:
      status === 'running'
        ? { workerId: 'worker', token: ordinal, expiresAt: '2030-01-01T00:00:00Z' }
        : null,
    waitReason: status === 'waiting' ? 'input' : null,
    startedAt: ['running', 'succeeded', 'failed'].includes(status) ? timestamp : null,
    finishedAt: ['succeeded', 'failed', 'cancelled', 'invalidated'].includes(status)
      ? timestamp
      : null,
    outputArtifactIds: [],
    diagnostic: null,
  };
}
function context(): WorkflowContext {
  const workflow = graph();
  return {
    graph: workflow,
    job: {
      jobId: 'job',
      revision: 1,
      lifecycle: 'queued',
      waitReason: null,
      delivery: null,
      completedStages: 0,
      totalStages: workflow.stages.length,
    },
    attempts: workflow.stages.map((stage) => attempt(stage.id)),
    acceptedArtifactIds: [],
    productionAuthorized: false,
    prerequisites: {},
    now: timestamp,
  };
}
function planningDone(ctx: WorkflowContext) {
  ctx.attempts = [
    attempt('research', 'succeeded'),
    attempt('plan', 'succeeded'),
    attempt('voice'),
    attempt('quality'),
    attempt('delivery'),
  ];
}

describe('workflow graph and eligibility', () => {
  it('rejects missing/duplicate/cyclic dependencies and preserves a valid graph', () => {
    const value = graph();
    const before = structuredClone(value);
    expect(validateWorkflowGraph(value)).toEqual(before);
    expect(value).toEqual(before);
    value.stages[0]!.dependencies = ['delivery'];
    expect(() => validateWorkflowGraph(value)).toThrow('cycle');
    value.stages[0]!.dependencies = ['absent'];
    expect(() => validateWorkflowGraph(value)).toThrow('missing');
    value.stages[0]!.dependencies = ['plan', 'plan'];
    expect(() => validateWorkflowGraph(value)).toThrow('Duplicate');
  });

  it('allows planning but gates production on compatible dependencies and explicit authorization', () => {
    const ctx = context();
    expect(evaluateStageEligibility(ctx, 'research')).toEqual({ eligible: true });
    expect(evaluateStageEligibility(ctx, 'voice')).toMatchObject({
      eligible: false,
      code: 'DEPENDENCY_INCOMPLETE',
    });
    planningDone(ctx);
    expect(evaluateStageEligibility(ctx, 'voice')).toMatchObject({
      eligible: false,
      reason: 'approval',
      nextAction: 'plan.approve',
    });
    ctx.productionAuthorized = true;
    expect(evaluateStageEligibility(ctx, 'voice')).toEqual({ eligible: true });
    ctx.graph.stages[1]!.inputDigest = 'b'.repeat(64);
    expect(evaluateStageEligibility(ctx, 'voice')).toMatchObject({
      eligible: false,
      code: 'DEPENDENCY_INCOMPLETE',
    });
  });

  it('requires accepted artifacts and reports missing provider/budget/access prerequisites', () => {
    const ctx = context();
    planningDone(ctx);
    ctx.productionAuthorized = true;
    ctx.graph.stages[2]!.requiredArtifactIds = ['narration'];
    expect(evaluateStageEligibility(ctx, 'voice')).toMatchObject({ code: 'ARTIFACT_MISSING' });
    ctx.acceptedArtifactIds = ['narration'];
    ctx.prerequisites = {
      voice: [{ satisfied: false, reason: 'budget', detail: 'Reserve authorized cost first.' }],
    };
    expect(evaluateStageEligibility(ctx, 'voice')).toMatchObject({
      reason: 'budget',
      detail: 'Reserve authorized cost first.',
    });
  });

  it('does not reuse a success whose accepted artifact is now missing', () => {
    const ctx = context();
    ctx.attempts = [
      { ...attempt('research', 'succeeded'), outputArtifactIds: ['research_report'] },
    ];
    expect(evaluateStageEligibility(ctx, 'research')).toMatchObject({
      code: 'ACCEPTED_OUTPUT_UNAVAILABLE',
    });
    expect(evaluateStageEligibility(ctx, 'plan')).toMatchObject({ code: 'DEPENDENCY_INCOMPLETE' });
    ctx.acceptedArtifactIds = ['research_report'];
    expect(evaluateStageEligibility(ctx, 'research')).toMatchObject({ code: 'STAGE_COMPLETE' });
    expect(evaluateStageEligibility(ctx, 'plan')).toEqual({ eligible: true });
  });

  it('blocks paused/cancelled/failed/finished jobs and completed stages', () => {
    for (const lifecycle of ['paused', 'cancelled', 'failed', 'finished'] as const) {
      const ctx = context();
      ctx.job.lifecycle = lifecycle;
      expect(evaluateStageEligibility(ctx, 'research').eligible).toBe(false);
    }
    const ctx = context();
    ctx.attempts = [attempt('research', 'succeeded')];
    expect(evaluateStageEligibility(ctx, 'research')).toMatchObject({ code: 'STAGE_COMPLETE' });
  });

  it('never replays uncertain or already executed failed/invalidated attempts', () => {
    const ctx = context();
    const waiting = {
      ...attempt('research', 'waiting'),
      waitReason: 'uncertain-outcome' as const,
      startedAt: timestamp,
    };
    ctx.attempts = [waiting];
    expect(evaluateStageEligibility(ctx, 'research')).toMatchObject({
      code: 'RECONCILIATION_REQUIRED',
      reason: 'uncertain-outcome',
    });
    for (const status of ['failed', 'cancelled', 'invalidated'] as const) {
      ctx.attempts = [{ ...attempt('research', status), startedAt: timestamp }];
      expect(evaluateStageEligibility(ctx, 'research')).toMatchObject({
        code: 'NEW_ATTEMPT_REQUIRED',
      });
    }
  });
});

describe('pure stage transitions', () => {
  it('requires eligibility then a live lease, and accepts only verified output IDs', () => {
    const ctx = context();
    const original = attempt('research');
    const before = structuredClone(original);
    const eligible = transitionStage(original, { type: 'eligible' }, ctx);
    expect(original).toEqual(before);
    expect(() =>
      transitionStage(
        original,
        {
          type: 'start',
          lease: { workerId: 'worker', token: 1, expiresAt: '2030-01-01T00:00:00Z' },
        },
        ctx,
      ),
    ).toThrow();
    ctx.attempts = [eligible];
    const running = transitionStage(
      eligible,
      { type: 'start', lease: { workerId: 'worker', token: 1, expiresAt: '2030-01-01T00:00:00Z' } },
      ctx,
    );
    ctx.attempts = [running];
    expect(() =>
      transitionStage(running, { type: 'succeed', token: 1, outputArtifactIds: ['missing'] }, ctx),
    ).toThrow('accepted');
    ctx.acceptedArtifactIds = ['evidence'];
    const done = transitionStage(
      running,
      { type: 'succeed', token: 1, outputArtifactIds: ['evidence'] },
      ctx,
    );
    expect(done).toMatchObject({
      status: 'succeeded',
      lease: null,
      finishedAt: timestamp,
      outputArtifactIds: ['evidence'],
    });
    expect(() => transitionStage(done, { type: 'cancel' }, ctx)).toThrow();
    expect(transitionStage(done, { type: 'invalidate' }, ctx)).toMatchObject({
      status: 'invalidated',
      outputArtifactIds: ['evidence'],
    });
  });

  it('rejects stale inputs, superseded attempts, expired fences, and completion after cancellation', () => {
    const ctx = context();
    const running = attempt('research', 'running');
    ctx.attempts = [running];
    expect(() =>
      transitionStage(running, { type: 'succeed', token: 2, outputArtifactIds: [] }, ctx),
    ).toThrow('fence');
    ctx.now = '2031-01-01T00:00:00Z';
    expect(() =>
      transitionStage(running, { type: 'succeed', token: 1, outputArtifactIds: [] }, ctx),
    ).toThrow('fence');
    ctx.now = timestamp;
    ctx.job.lifecycle = 'cancelled';
    expect(() =>
      transitionStage(running, { type: 'succeed', token: 1, outputArtifactIds: [] }, ctx),
    ).toThrow('fence');
    ctx.job.lifecycle = 'queued';
    const old = attempt('research');
    ctx.attempts = [old, attempt('research', 'pending', 2)];
    expect(() => transitionStage(old, { type: 'eligible' }, ctx)).toThrow('supersedes');
    ctx.attempts = [old];
    ctx.graph.stages[0]!.inputDigest = 'b'.repeat(64);
    expect(() => transitionStage(old, { type: 'eligible' }, ctx)).toThrow('stale');
  });

  it('records waits/failures, revokes cancelled ownership, and rejects skipped states', () => {
    const ctx = context();
    const running = attempt('research', 'running');
    ctx.attempts = [running];
    const wait = transitionStage(
      running,
      { type: 'wait', reason: 'authentication', token: 1 },
      ctx,
    );
    expect(wait).toMatchObject({ status: 'waiting', waitReason: 'authentication', lease: null });
    const failed = transitionStage(
      running,
      {
        type: 'fail',
        token: 1,
        diagnostic: {
          code: 'TIMEOUT',
          message: 'Request timed out',
          classification: 'uncertain',
          retryable: false,
        },
      },
      ctx,
    );
    expect(failed.status).toBe('failed');
    expect(() => transitionStage(failed, { type: 'eligible' }, ctx)).toThrow();
    const cancelled = transitionStage(running, { type: 'cancel' }, ctx);
    expect(cancelled).toMatchObject({ status: 'cancelled', lease: null });
    expect(() =>
      transitionStage(cancelled, { type: 'succeed', token: 1, outputArtifactIds: [] }, ctx),
    ).toThrow();
  });
});

describe('job lifecycle and honest outcomes', () => {
  it('handles run, approval wait, pause/resume, cancel, and explicit cancelled resume', () => {
    const ctx = context();
    ctx.job = transitionJob({ type: 'run' }, ctx);
    expect(ctx.job.lifecycle).toBe('running');
    ctx.job = transitionJob({ type: 'wait', reason: 'approval' }, ctx);
    expect(ctx.job.waitReason).toBe('approval');
    ctx.job = transitionJob({ type: 'pause' }, ctx);
    expect(ctx.job.lifecycle).toBe('paused');
    ctx.job = transitionJob({ type: 'resume' }, ctx);
    expect(ctx.job.lifecycle).toBe('queued');
    ctx.job = transitionJob({ type: 'cancel' }, ctx);
    expect(ctx.job.delivery).toBe('cancelled');
    expect(evaluateStageEligibility(ctx, 'research').eligible).toBe(false);
    ctx.job = transitionJob({ type: 'resume' }, ctx);
    expect(ctx.job.delivery).toBeNull();
  });

  it('requires all delivery evidence for ready and clears readiness on invalidation', () => {
    const ctx = context();
    ctx.job.lifecycle = 'running';
    ctx.productionAuthorized = true;
    const finish = {
      type: 'finish',
      delivery: 'ready',
      qualityPassed: true,
      packageAccepted: true,
    } as const;
    expect(() => transitionJob(finish, ctx)).toThrow('Ready');
    ctx.attempts = ctx.graph.stages.map((stage) => attempt(stage.id, 'succeeded'));
    for (const change of [{ qualityPassed: false }, { packageAccepted: false }])
      expect(() => transitionJob({ ...finish, ...change }, ctx)).toThrow('Ready');
    ctx.productionAuthorized = false;
    expect(() => transitionJob(finish, ctx)).toThrow('Ready');
    ctx.productionAuthorized = true;
    ctx.job = transitionJob(finish, ctx);
    expect(ctx.job).toMatchObject({
      lifecycle: 'finished',
      delivery: 'ready',
      completedStages: 5,
      totalStages: 5,
    });
    expect(() => transitionJob({ type: 'run' }, ctx)).toThrow();
    ctx.job = transitionJob({ type: 'invalidate' }, ctx);
    expect(ctx.job).toMatchObject({ lifecycle: 'waiting', waitReason: 'input', delivery: null });
  });

  it('keeps needs-attention distinct from ready and rejects invalid lifecycle transitions', () => {
    const ctx = context();
    expect(() => transitionJob({ type: 'resume' }, ctx)).toThrow();
    ctx.job.lifecycle = 'running';
    const attention = transitionJob(
      { type: 'finish', delivery: 'needs-attention', qualityPassed: false, packageAccepted: false },
      ctx,
    );
    expect(attention.delivery).toBe('needs-attention');
    ctx.job = transitionJob({ type: 'fail' }, ctx);
    expect(ctx.job).toMatchObject({ lifecycle: 'failed', delivery: 'failed' });
    expect(() => transitionJob({ type: 'run' }, ctx)).toThrow();
  });

  it('keeps revisions paused and can finalize accepted in-flight work after explicit resume', () => {
    const ctx = context();
    ctx.job.lifecycle = 'paused';
    expect(transitionJob({ type: 'invalidate' }, ctx)).toMatchObject({
      lifecycle: 'paused',
      waitReason: null,
      delivery: null,
    });
    ctx.attempts = ctx.graph.stages.map((stage) => attempt(stage.id, 'succeeded'));
    ctx.productionAuthorized = true;
    ctx.job = transitionJob({ type: 'resume' }, ctx);
    expect(
      transitionJob(
        { type: 'finish', delivery: 'ready', qualityPassed: true, packageAccepted: true },
        ctx,
      ).delivery,
    ).toBe('ready');
  });
});
