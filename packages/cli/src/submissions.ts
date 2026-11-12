import type { SqlitePersistence } from '@tutorialx/adapters';
import {
  type ActionRequest,
  type ActionResponse,
  type JobRecord,
  type JobSubmission,
  type JsonObject,
  type ResearchReport,
  type WorkspaceConfig,
} from '@tutorialx/contracts';
import { PlanningValidationError, validatePlanSubmission } from '@tutorialx/core';
import { type ActionDependencies, ActionFailure, digest, json } from './action-support.js';

export function createSubmissionHandler(dependencies: ActionDependencies) {
  const { options, events, nextActions, mutation, checkRevision, job, effective } = dependencies;
  async function submit(
    request: ActionRequest,
    input: JobSubmission,
    record: JobRecord,
    workspace: WorkspaceConfig,
    persistence: SqlitePersistence,
  ): Promise<ActionResponse> {
    const requiredRole = {
      research: 'researcher',
      plan: 'writer-director',
      review: 'reviewer',
      feedback: 'repair',
    } as const;
    if (!options.authority.roles.includes(requiredRole[input.kind]))
      throw new ActionFailure('POLICY_DENIED', 'This transport lacks the submission role.');
    const history = await events(persistence, input.jobId);
    const requestDigest = digest({ action: request.action, params: request.params });
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
        data: { submissionId: replay.id, revision: replay.data.acceptedRevision!, replayed: true },
        nextActions: await nextActions(persistence, record),
      };
    }
    checkRevision(request, record);
    const sources = await persistence.research.sources(input.jobId);
    const evidence = await persistence.research.evidence(input.jobId);
    const plans = await persistence.repository.plans(input.jobId);
    const currentPlan = plans.at(-1);
    const assert = (condition: unknown, message: string) => {
      if (!condition) throw new ActionFailure('INVALID_INPUT', message);
    };
    const owner = (value: { jobId: string }) =>
      assert(value.jobId === input.jobId, 'Submission contains data for another job.');
    const assertEvidence = (ids: readonly string[]) => {
      assert(new Set(ids).size === ids.length, 'Duplicate evidence identities.');
      for (const evidenceId of ids) {
        const item = evidence.find((entry) => entry.id === evidenceId);
        assert(
          item && !['contradicted', 'unverified'].includes(item.status),
          'Evidence is missing, contradicted, or unverified.',
        );
        assert(
          sources.some(
            (source) => source.id === item!.sourceId && source.contentHash === item!.sourceHash,
          ),
          'Evidence has a stale source fingerprint.',
        );
      }
    };
    const transaction = mutation(request, record, {
      actorId: options.authority.actorId,
      idempotencyKey: request.idempotencyKey,
      requestDigest,
      kind: input.kind,
      acceptedRevision: record.status.revision + 1,
      payload: json(input),
    });
    if (input.kind === 'research') {
      owner(input.report);
      assert(
        input.report.basedOnRevision === record.status.revision,
        'Research is based on another job revision.',
      );
      assert(
        new Set(input.evidence.map((entry) => entry.id)).size === input.evidence.length,
        'Duplicate evidence identity.',
      );
      for (const item of input.evidence) {
        owner(item);
        assert(
          sources.some(
            (source) =>
              source.id === item.sourceId &&
              source.contentHash === item.sourceHash &&
              source.status === 'available',
          ),
          'Research evidence references an unavailable or stale source.',
        );
        assert(
          item.artifactIds.length === 0,
          'Evidence artifact references require accepted artifact retrieval.',
        );
      }
      const all = [...evidence, ...input.evidence];
      assert(
        input.report.sourceIds.every((sourceId) =>
          sources.some((source) => source.id === sourceId),
        ),
        'Research report references an unregistered source.',
      );
      assert(
        input.report.evidenceIds.every((evidenceId) =>
          all.some(
            (item) => item.id === evidenceId && input.report.sourceIds.includes(item.sourceId),
          ),
        ),
        'Research report references missing evidence or an undeclared source.',
      );
      assert(
        input.report.evidenceIds.length > 0 || input.report.blockers.length > 0,
        'Research requires evidence or an explicit blocker.',
      );
      transaction.job.status.lifecycle = 'waiting';
      transaction.job.status.waitReason = 'input';
      await persistence.research.commitResearch(transaction, {
        sources: [],
        evidence: input.evidence,
      });
    } else if (input.kind === 'plan') {
      const reportEvent = history.findLast(
        (event) =>
          event.data.kind === 'research' &&
          (event.data.payload as JsonObject | undefined)?.kind === 'research',
      );
      const report = (reportEvent?.data.payload as JsonObject | undefined)?.report;
      if (!report || typeof reportEvent?.data.acceptedRevision !== 'number')
        throw new ActionFailure('MISSING_PREREQUISITE', 'Plan requires accepted research first.');
      try {
        validatePlanSubmission(input.plan, {
          job: record,
          report: report as unknown as ResearchReport,
          reportAcceptedRevision: reportEvent.data.acceptedRevision,
          evidence,
          sources,
          effective: effective(workspace, record),
          previousPlan: currentPlan ?? null,
          fingerprint: digest,
        });
      } catch (error) {
        if (error instanceof PlanningValidationError)
          throw new ActionFailure(error.code, error.message);
        throw error;
      }
      transaction.plans = [input.plan];
      transaction.job.status.lifecycle = 'waiting';
      transaction.job.status.waitReason = 'approval';
      await persistence.repository.commit(transaction);
    } else {
      const result = input.kind === 'review' ? input.review : input.feedback;
      owner(result);
      assert(
        currentPlan && result.planRevision === currentPlan.revision,
        'Submission references a stale or missing plan.',
      );
      if (input.kind === 'feedback') {
        assert(
          input.feedback.basedOnRevision === record.status.revision,
          'Feedback is based on another job revision.',
        );
        assert(
          input.feedback.sceneIds.every((sceneId) =>
            currentPlan!.scenes.some((scene) => scene.id === sceneId),
          ),
          'Feedback references another scene.',
        );
        assertEvidence(input.feedback.evidenceIds);
      } else {
        assert(
          input.review.reviewerId === options.authority.actorId,
          'Reviewer identity comes from transport authority.',
        );
        assert(
          input.review.profileId === currentPlan!.effective.settings.qualityProfileId,
          'Review uses another quality profile.',
        );
        assert(
          currentPlan!.effective.settings.variants.some(
            (variant) => variant.id === input.review.variantId,
          ),
          'Review references another output variant.',
        );
        const artifacts = await persistence.repository.artifacts(input.jobId, null, 100);
        for (const finding of input.findings) {
          owner(finding);
          assert(
            finding.variantId === input.review.variantId &&
              (finding.sceneId === null ||
                currentPlan!.scenes.some((scene) => scene.id === finding.sceneId)),
            'Finding belongs to another variant or scene.',
          );
          assert(
            finding.evidenceArtifactIds.every((artifactId) =>
              artifacts.artifacts.some((artifact) => artifact.id === artifactId),
            ),
            'Finding references an unaccepted artifact.',
          );
        }
        assert(
          input.review.findingIds.every((findingId) =>
            input.findings.some((finding) => finding.id === findingId),
          ),
          'Review references a missing finding.',
        );
        assert(
          input.review.coverage.every((coverage) =>
            currentPlan!.scenes.some((scene) => scene.id === coverage.sceneId),
          ),
          'Review covers an unknown scene.',
        );
        // Observations remain input. A runner claim cannot grant an approval or publish delivery.
      }
      await persistence.repository.commit(transaction);
    }
    const updated = await job(persistence, input.jobId);
    return {
      apiVersion: 1,
      requestId: request.requestId,
      status: 'ok',
      data: {
        submissionId: transaction.events[0]!.id,
        revision: updated.status.revision,
        kind: input.kind,
        authorizesProduction: false,
        marksDeliveryReady: false,
      },
      nextActions: await nextActions(persistence, updated),
    };
  }

  return submit;
}
