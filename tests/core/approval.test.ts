import { fingerprintJson } from '@tutorialx/adapters';
import { comparePlanRevisions, createPlanApproval, evaluatePlanApproval } from '@tutorialx/core';
import { describe, expect, it } from 'vitest';
import { samplePlan, timestamp } from '../fixtures/contracts.js';

const principal = { id: 'operator_local', role: 'operator' as const, origin: 'local-cli' };
function issuance() {
  const plan = samplePlan();
  return {
    id: 'approval_local',
    plan,
    expectedPlanRevision: plan.revision,
    evidenceDigest: plan.evidenceDigest,
    fingerprint: fingerprintJson,
    now: timestamp,
    principal,
    trustedOrigins: ['local-cli'],
    decision: 'approve' as const,
    scopes: ['production' as const],
    expiresAt: null,
  };
}
function evaluation() {
  const input = issuance();
  return {
    plan: input.plan,
    evidenceDigest: input.evidenceDigest,
    fingerprint: fingerprintJson,
    approvals: [createPlanApproval(input)],
    now: timestamp,
    isTrustedApproval: (approval: { id: string }) => approval.id === 'approval_local',
  };
}

describe('revision-bound operator approval', () => {
  it('requires explicit authenticated operator approval and current evidence', () => {
    for (const role of ['creative', 'worker'] as const)
      expect(() =>
        createPlanApproval({ ...issuance(), principal: { ...principal, role } }),
      ).toThrow('operator');
    expect(() => createPlanApproval({ ...issuance(), trustedOrigins: [] })).toThrow('operator');
    expect(() => createPlanApproval({ ...issuance(), expectedPlanRevision: 2 })).toThrow('stale');
    expect(() => createPlanApproval({ ...issuance(), evidenceDigest: 'b'.repeat(64) })).toThrow(
      'evidence',
    );
    // An untyped transport must still validate an explicit decision.
    expect(() => createPlanApproval({ ...issuance(), decision: undefined as never })).toThrow(
      'explicit',
    );
  });

  it('does not infer approval from mode, silence, timeout, or an unverified issuer', () => {
    expect(evaluatePlanApproval(evaluation()).authorized).toBe(true);
    expect(evaluatePlanApproval({ ...evaluation(), approvals: [] }).authorized).toBe(false);
    expect(
      evaluatePlanApproval({ ...evaluation(), isTrustedApproval: () => false }).authorized,
    ).toBe(false);
    expect(evaluatePlanApproval({ ...evaluation(), scope: 'uncertain-retry' }).authorized).toBe(
      false,
    );
    const input = issuance();
    input.plan.effective.settings.policy.mode = 'autonomous';
    expect(evaluatePlanApproval({ ...evaluation(), plan: input.plan }).authorized).toBe(false);
    const approval = createPlanApproval({ ...issuance(), expiresAt: '2026-11-11T10:01:00Z' });
    expect(
      evaluatePlanApproval({ ...evaluation(), approvals: [approval], now: '2026-11-11T10:01:00Z' })
        .authorized,
    ).toBe(false);
  });

  it.each(['narration', 'actions', 'voice', 'provider', 'evidence', 'settings', 'revision'])(
    'rejects approval reuse after a changed %s',
    (kind) => {
      const input = evaluation();
      if (kind === 'narration') input.plan.scenes[0]!.narration += ' Another sentence.';
      if (kind === 'actions')
        input.plan.scenes[0]!.visual = { kind: 'text', headline: 'Another step', body: '' };
      if (kind === 'voice')
        input.plan.effective.settings.voice = { mode: 'supplied', assetId: 'another_voice' };
      if (kind === 'provider') input.plan.effective.settings.providers.renderer.version = '2';
      if (kind === 'evidence') {
        input.plan.evidenceDigest = 'b'.repeat(64);
        input.evidenceDigest = input.plan.evidenceDigest;
      }
      if (kind === 'settings') input.plan.effective.settings.variants[0]!.height = 720;
      if (kind === 'revision') input.plan.revision++;
      expect(evaluatePlanApproval(input).authorized).toBe(false);
    },
  );

  it('reports material speech and action changes while recognizing a metadata-only revision', () => {
    const original = samplePlan();
    const next = structuredClone(original);
    next.revision++;
    expect(comparePlanRevisions(original, next)).toEqual({ material: false, changes: [] });
    next.scenes[0]!.narration += ' Changed speech.';
    next.scenes[0]!.visual = { kind: 'text', headline: 'Changed', body: '' };
    expect(comparePlanRevisions(original, next)).toMatchObject({
      material: true,
      changes: ['narration', 'visuals-and-actions'],
    });
    next.effective.settings.voice = { mode: 'supplied', assetId: 'new_voice' };
    expect(comparePlanRevisions(original, next).changes).toContain('voice');
    next.jobId = 'another_job';
    expect(() => comparePlanRevisions(original, next)).toThrow('different jobs');
  });
});
