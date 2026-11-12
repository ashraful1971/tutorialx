import {
  type ApprovalRecord,
  approvalRecordSchema,
  digestSchema,
  type PlanRevision,
  planRevisionSchema,
  timestampSchema,
} from '@tutorialx/contracts';

export class ApprovalPolicyError extends Error {
  readonly code = 'POLICY_DENIED';
}

export function approvalDigests(
  supplied: PlanRevision,
  evidenceDigest: string,
  fingerprint: (value: unknown) => string,
) {
  const plan = planRevisionSchema.parse(supplied);
  const evidence = digestSchema.parse(evidenceDigest);
  if (plan.evidenceDigest !== evidence)
    throw new ApprovalPolicyError('Plan evidence differs from the current accepted evidence.');
  return {
    planDigest: digestSchema.parse(fingerprint(plan)),
    settingsDigest: digestSchema.parse(fingerprint(plan.effective.settings)),
    evidenceDigest: evidence,
    providersDigest: digestSchema.parse(fingerprint(plan.effective.settings.providers)),
  };
}

/** The composition root supplies authenticated authority; source/agent payloads cannot grant it. */
export function createPlanApproval(input: {
  id: string;
  plan: PlanRevision;
  expectedPlanRevision: number;
  evidenceDigest: string;
  fingerprint(value: unknown): string;
  now: string;
  principal: { id: string; role: 'operator' | 'worker' | 'creative'; origin: string };
  trustedOrigins: readonly string[];
  decision: 'approve';
  scopes: ApprovalRecord['scopes'];
  expiresAt: string | null;
}): ApprovalRecord {
  const plan = planRevisionSchema.parse(input.plan);
  if (input.principal.role !== 'operator' || !input.trustedOrigins.includes(input.principal.origin))
    throw new ApprovalPolicyError(
      'An authenticated operator from a trusted origin must approve production.',
    );
  if (input.decision !== 'approve')
    throw new ApprovalPolicyError('Production requires an explicit approval decision.');
  if (input.expectedPlanRevision !== plan.revision)
    throw new ApprovalPolicyError('Approval refers to a stale plan revision.');
  const now = timestampSchema.parse(input.now);
  if (Date.parse(plan.createdAt) > Date.parse(now))
    throw new ApprovalPolicyError('A future plan cannot be approved.');
  return approvalRecordSchema.parse({
    schemaVersion: 1,
    id: input.id,
    createdAt: now,
    jobId: plan.jobId,
    planId: plan.id,
    planRevision: plan.revision,
    ...approvalDigests(plan, input.evidenceDigest, input.fingerprint),
    actor: { id: input.principal.id, kind: 'human', origin: input.principal.origin },
    scopes: input.scopes,
    expiresAt: input.expiresAt,
    policyId: null,
  });
}

/** A digest checks content, not issuer identity. Trust must be established separately. */
export function evaluatePlanApproval(input: {
  plan: PlanRevision;
  evidenceDigest: string;
  fingerprint(value: unknown): string;
  approvals: readonly ApprovalRecord[];
  now: string;
  isTrustedApproval(approval: ApprovalRecord): boolean;
  scope?: ApprovalRecord['scopes'][number];
}): { authorized: boolean; approvalId: string | null; reason: string } {
  const now = timestampSchema.parse(input.now);
  let digests: ReturnType<typeof approvalDigests>;
  try {
    digests = approvalDigests(input.plan, input.evidenceDigest, input.fingerprint);
  } catch {
    return {
      authorized: false,
      approvalId: null,
      reason: 'The plan does not match current evidence.',
    };
  }
  const plan = input.plan;
  for (const candidate of input.approvals) {
    const parsed = approvalRecordSchema.safeParse(candidate);
    if (!parsed.success) continue;
    const approval = parsed.data;
    if (
      approval.jobId !== plan.jobId ||
      approval.planId !== plan.id ||
      approval.planRevision !== plan.revision ||
      approval.planDigest !== digests.planDigest ||
      approval.settingsDigest !== digests.settingsDigest ||
      approval.evidenceDigest !== digests.evidenceDigest ||
      approval.providersDigest !== digests.providersDigest ||
      !approval.scopes.includes(input.scope ?? 'production') ||
      Date.parse(approval.createdAt) > Date.parse(now) ||
      (approval.expiresAt !== null && Date.parse(approval.expiresAt) <= Date.parse(now)) ||
      !input.isTrustedApproval(approval)
    )
      continue;
    return {
      authorized: true,
      approvalId: approval.id,
      reason: 'A trusted approval covers this exact plan and scope.',
    };
  }
  return {
    authorized: false,
    approvalId: null,
    reason: 'A fresh trusted approval is required for this plan.',
  };
}

export function comparePlanRevisions(before: PlanRevision, after: PlanRevision) {
  const previous = planRevisionSchema.parse(before);
  const next = planRevisionSchema.parse(after);
  if (previous.jobId !== next.jobId)
    throw new ApprovalPolicyError('Plans belong to different jobs.');
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const changes: string[] = [];
  if (
    !same(
      previous.scenes.map((scene) => ({ id: scene.id, narration: scene.narration })),
      next.scenes.map((scene) => ({ id: scene.id, narration: scene.narration })),
    )
  )
    changes.push('narration');
  if (
    !same(
      previous.scenes.map((scene) => scene.visual),
      next.scenes.map((scene) => scene.visual),
    )
  )
    changes.push('visuals-and-actions');
  if (!same(previous.effective.settings.providers, next.effective.settings.providers))
    changes.push('providers');
  if (!same(previous.effective.settings.voice, next.effective.settings.voice))
    changes.push('voice');
  if (!same(previous.effective.settings, next.effective.settings)) changes.push('settings');
  if (
    previous.evidenceDigest !== next.evidenceDigest ||
    previous.researchReportId !== next.researchReportId ||
    !same(
      previous.scenes.map((scene) => scene.evidenceIds),
      next.scenes.map((scene) => scene.evidenceIds),
    )
  )
    changes.push('evidence');
  if (!same(previous.costEstimate, next.costEstimate)) changes.push('cost-estimate');
  if (!same(previous.limitations, next.limitations)) changes.push('limitations');
  if (
    !same(previous.scenes, next.scenes) &&
    !changes.includes('narration') &&
    !changes.includes('visuals-and-actions')
  )
    changes.push('scene-layout-or-timing');
  return { material: changes.length > 0, changes };
}
