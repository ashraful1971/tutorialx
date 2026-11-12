import type { SqlitePersistence } from '@tutorialx/adapters';
import {
  type ActionRequest,
  type ActionResponse,
  type JobRecord,
  planApproveInputSchema,
} from '@tutorialx/contracts';
import { createPlanApproval, transitionJob, type WorkflowContext } from '@tutorialx/core';
import {
  type ActionDependencies,
  ActionFailure,
  digest,
  id,
  json,
  next,
} from './action-support.js';

export function createLifecycleHandler(dependencies: ActionDependencies) {
  const {
    options,
    now,
    events,
    nextActions,
    mutation,
    checkRevision,
    authorization,
    acceptedEvidence,
  } = dependencies;
  async function control(
    request: ActionRequest,
    record: JobRecord,
    persistence: SqlitePersistence,
  ): Promise<ActionResponse> {
    if (options.authority.principalRole !== 'operator')
      throw new ActionFailure(
        'POLICY_DENIED',
        'Lifecycle and approval actions require authenticated operator authority.',
      );
    const requestDigest = digest({ action: request.action, params: request.params });
    const history = await events(persistence, record.brief.id);
    const replay = history.find((event) => event.data.idempotencyKey === request.idempotencyKey);
    if (replay) {
      if (
        replay.data.requestDigest !== requestDigest ||
        replay.data.actorId !== options.authority.actorId
      )
        throw new ActionFailure(
          'REVISION_CONFLICT',
          'Idempotency key was used for another request or actor.',
        );
      return {
        apiVersion: 1,
        requestId: request.requestId,
        status: 'ok',
        data: {
          revision: replay.data.acceptedRevision!,
          replayed: true,
          ...(replay.data.operationId ? { operationId: replay.data.operationId } : {}),
        },
        nextActions: await nextActions(persistence, record),
      };
    }
    checkRevision(request, record);
    const plans = await persistence.repository.plans(record.brief.id);
    const plan = plans.at(-1);
    const transaction = mutation(request, record, {
      kind: request.action,
      actorId: options.authority.actorId,
      requestDigest,
      idempotencyKey: request.idempotencyKey,
      acceptedRevision: record.status.revision + 1,
    });
    if (request.action === 'plan.approve') {
      const input = planApproveInputSchema.parse(request.params);
      if (
        !plan ||
        plan.revision !== input.planRevision ||
        plan.basedOnJobRevision < record.brief.revision
      )
        throw new ActionFailure(
          'REVISION_CONFLICT',
          'Approve the current plan revision after refreshing context.',
        );
      const currentEvidence = await acceptedEvidence(persistence, record);
      if (currentEvidence.report?.id !== plan.researchReportId)
        throw new ActionFailure(
          'REVISION_CONFLICT',
          'The accepted research report changed. Revise the plan first.',
        );
      const approval = createPlanApproval({
        id: id('approval'),
        plan,
        expectedPlanRevision: input.planRevision,
        evidenceDigest: currentEvidence.digest,
        fingerprint: (value) => digest(json(value)),
        now: now(),
        principal: { id: options.authority.actorId, role: 'operator', origin: 'local-cli' },
        trustedOrigins: ['local-cli'],
        decision: input.decision,
        scopes: ['production'],
        expiresAt: input.expiresAt,
      });
      transaction.approvals = [approval];
      transaction.events[0]!.data = {
        ...transaction.events[0]!.data,
        kind: 'operator-approval',
        approvalId: approval.id,
        origin: 'local-cli',
      };
      transaction.job.status = { ...transaction.job.status, lifecycle: 'queued', waitReason: null };
      await persistence.repository.commit(transaction);
      return {
        apiVersion: 1,
        requestId: request.requestId,
        status: 'ok',
        data: {
          approvalId: approval.id,
          planRevision: plan.revision,
          revision: transaction.job.status.revision,
        },
        nextActions: [
          next('job.run', 'Request approved production.', { jobId: record.brief.id }, true),
        ],
      };
    }
    const simple = request.action.slice(4);
    const requestWork = ['run', 'resume', 'retry', 'check', 'export'].includes(simple);
    if (requestWork) {
      if (!plan)
        throw new ActionFailure(
          'MISSING_PREREQUISITE',
          'Submit a validated plan before requesting work.',
          {},
          [
            next('job.context', 'Prepare a plan handoff.', {
              jobId: record.brief.id,
              role: 'writer-director',
            }),
          ],
        );
      const approval = await authorization(persistence, record, plan);
      if (!approval.authorized)
        return {
          apiVersion: 1,
          requestId: request.requestId,
          status: 'waiting',
          reason: 'approval',
          code: 'NEEDS_APPROVAL',
          jobId: record.brief.id,
          data: { reason: approval.reason },
          nextActions: [
            next(
              'plan.approve',
              'Approve the exact current plan.',
              { jobId: record.brief.id, planRevision: plan.revision, decision: 'approve' },
              true,
            ),
          ],
        };
      const policy = plan.effective.settings.policy;
      if (policy.deadlineAt !== null && Date.parse(policy.deadlineAt) <= Date.parse(now()))
        throw new ActionFailure('POLICY_DENIED', 'The execution deadline has elapsed.');
      const receipts = await persistence.operations.list(record.brief.id, null, 100);
      if (receipts.nextCursor || receipts.receipts.some((receipt) => receipt.state === 'uncertain'))
        return {
          apiVersion: 1,
          requestId: request.requestId,
          status: 'waiting',
          reason: 'uncertain-outcome',
          code: 'UNCERTAIN_OUTCOME',
          jobId: record.brief.id,
          data: { reason: 'Reconcile outstanding provider outcomes before requesting more work.' },
          nextActions: [
            next(
              'job.inspect',
              'Inspect and reconcile the pending operations.',
              { jobId: record.brief.id },
              true,
            ),
          ],
        };
      if (simple === 'retry') {
        if (record.status.lifecycle !== 'failed')
          throw new ActionFailure('POLICY_DENIED', 'Retry requires a failed job.');
        if (
          receipts.receipts.some(
            (receipt) =>
              receipt.state === 'failed' &&
              (receipt.diagnostic?.classification !== 'transient' ||
                !receipt.diagnostic.retryable ||
                receipt.sequence >= policy.maxAttempts),
          )
        )
          throw new ActionFailure(
            'POLICY_DENIED',
            'A failed operation is permanent, nonretryable, or exhausted its attempt limit.',
          );
      }
    }
    const snapshot = await persistence.workflow.readWorkflow(record.brief.id);
    const graph = snapshot?.graph ?? {
      schemaVersion: 1 as const,
      stages: [
        {
          id: 'production_request',
          kind: 'production_request',
          phase: 'production' as const,
          inputDigest: digest({ jobId: record.brief.id, planRevision: plan?.revision ?? null }),
          dependencies: [],
          requiredArtifactIds: [],
          required: true,
        },
      ],
    };
    const context: WorkflowContext = {
      graph,
      job: record.status,
      attempts: await persistence.repository.attempts(record.brief.id),
      acceptedArtifactIds: [],
      productionAuthorized: requestWork,
      prerequisites: {},
      now: now(),
    };
    if (simple === 'pause' || simple === 'cancel' || simple === 'resume' || simple === 'run') {
      const status = transitionJob({ type: simple }, context);
      if (status.revision === record.status.revision)
        return {
          apiVersion: 1,
          requestId: request.requestId,
          status: 'ok',
          data: { revision: status.revision, unchanged: true },
          nextActions: await nextActions(persistence, record),
        };
      transaction.job.status = {
        ...status,
        completedStages: record.status.completedStages,
        totalStages: record.status.totalStages,
      };
    } else if (simple === 'retry') {
      transaction.job.status = {
        ...transaction.job.status,
        lifecycle: 'queued',
        waitReason: null,
        delivery: null,
      };
    } else if (!['check', 'export'].includes(simple))
      throw new ActionFailure('NOT_FOUND', 'Unknown lifecycle action.');
    const operationId = id('request');
    if (requestWork) {
      transaction.dispatch = [
        {
          id: operationId,
          jobId: record.brief.id,
          stageId: `${simple}_request`,
          expectedRevision: transaction.job.status.revision,
          capabilityRequirements: [`request:${simple}`, 'worker:trusted'],
          availableAt: now(),
        },
      ];
      transaction.events[0]!.data = {
        ...transaction.events[0]!.data,
        operationId,
        state: 'queued',
        planRevision: plan!.revision,
      };
      if (['run', 'resume', 'retry'].includes(simple)) transaction.job.status.lifecycle = 'queued';
    }
    await persistence.repository.commit(transaction);
    if (simple === 'cancel') await persistence.operations.cancelJob(record.brief.id);
    if (requestWork)
      return {
        apiVersion: 1,
        requestId: request.requestId,
        status: 'accepted',
        operationId,
        data: {
          revision: transaction.job.status.revision,
          request: simple,
          completed: false,
          requiresWorkerCapabilities: [...transaction.dispatch[0]!.capabilityRequirements],
        },
        nextActions: [
          next('events', 'Follow the persisted request through worker events.', {
            jobId: record.brief.id,
            afterCursor: 0,
          }),
        ],
      };
    return {
      apiVersion: 1,
      requestId: request.requestId,
      status: 'ok',
      data: {
        revision: transaction.job.status.revision,
        lifecycle: transaction.job.status.lifecycle,
      },
      nextActions: await nextActions(persistence, transaction.job),
    };
  }

  return control;
}
