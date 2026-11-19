import type { OperationContext, ProviderDescriptor, RendererProvider } from '@tutorialx/contracts';
import {
  evaluatePlanPolicy,
  preflightPlanProviders,
  requirementsForPlan,
  wireProviders,
} from '@tutorialx/core';
import { describe, expect, it, vi } from 'vitest';
import { digest, samplePlan } from '../fixtures/contracts.js';

function renderer(plan = samplePlan(), upperBoundUsdMicros = 5): RendererProvider {
  const requirements = requirementsForPlan(plan).renderer!;
  const descriptor: ProviderDescriptor & { kind: 'renderer' } = {
    id: 'hyperframes',
    version: '1',
    contractVersion: 1,
    kind: 'renderer',
    configurationSchema: { type: 'object', additionalProperties: false },
    capabilities: {
      languages: [],
      features: requirements.features,
      formats: requirements.formats,
      modalities: [],
    },
    runtime: { platforms: ['linux'], dependencies: [], memoryMiB: 64, gpu: false },
    execution: {
      location: 'local',
      maxDurationMs: 60_000,
      cancellation: 'cooperative',
      sideEffect: 'pure',
      idempotency: 'supported',
      permissions: ['read-assets', 'write-work'],
    },
    pricing: 'metered',
  };
  return {
    descriptor,
    validateConfiguration: () => ({ ready: true, diagnostics: [] }),
    readiness: vi.fn(async () => ({ ready: true, diagnostics: [] })),
    estimate: vi.fn(async () => ({
      expectedUsdMicros: upperBoundUsdMicros,
      upperBoundUsdMicros,
      validUntil: null,
      uncertainty: [],
    })),
    preflight: vi.fn(async () => ({ ready: true, diagnostics: [] })),
    render: vi.fn(async () => {
      throw new Error('Production rendering must not run during plan preflight.');
    }),
  };
}

function context(): OperationContext {
  return {
    operationId: 'operation_preflight',
    jobId: 'job_example',
    attemptId: 'attempt_preflight',
    reservationId: null,
    outputDirectory: '/unused',
    deadlineAt: '2099-01-01T00:00:00Z',
    signal: new AbortController().signal,
  };
}

describe('plan provider and allowance preflight', () => {
  it('checks every required provider and aggregates bounded estimates without production calls', async () => {
    const plan = samplePlan();
    plan.effective.settings.voice = { mode: 'none' };
    plan.effective.settings.policy.budgetUsdMicros = 10;
    const provider = renderer(plan);
    const wiring = wireProviders([{ descriptor: provider.descriptor, create: () => provider }]);
    const result = await preflightPlanProviders({
      wiring,
      plan,
      planDigest: digest,
      authorization: null,
      platform: 'linux',
      remainingProductionAllowanceUsdMicros: 10,
      context: context(),
      now: () => Date.parse('2026-11-19T00:00:00Z'),
    });

    expect(result).toMatchObject({
      ready: true,
      expectedUsdMicros: 5,
      upperBoundUsdMicros: 5,
      providers: [{ kind: 'renderer', providerId: 'hyperframes', status: 'ready' }],
    });
    expect(provider.readiness).toHaveBeenCalledOnce();
    expect(provider.estimate).toHaveBeenCalledOnce();
    expect(provider.preflight).not.toHaveBeenCalled();
    expect(provider.render).not.toHaveBeenCalled();
  });

  it('requires separate paid-production allowance and current approval in review mode', () => {
    const plan = samplePlan();
    plan.effective.settings.policy.budgetUsdMicros = 10;
    const preflight = {
      ready: true,
      expectedUsdMicros: 5,
      upperBoundUsdMicros: 5,
      providers: [
        {
          kind: 'renderer' as const,
          providerId: 'hyperframes',
          status: 'ready' as const,
          estimate: {
            expectedUsdMicros: 5,
            upperBoundUsdMicros: 5,
            validUntil: null,
            uncertainty: [],
          },
          reasons: [],
        },
      ],
    };
    const denied = evaluatePlanPolicy({
      plan,
      sourceIds: ['source_one'],
      preflight,
      research: { authorizedUsdMicros: 0, observedUsdMicros: 0, reservedUsdMicros: 0 },
      production: { authorizedUsdMicros: 0, observedUsdMicros: 0, reservedUsdMicros: 0 },
      evidenceReady: true,
      approvalValid: false,
      autonomousScope: null,
    });
    expect(denied.ready).toBe(false);
    expect(denied.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['PRODUCTION_ALLOWANCE_REQUIRED', 'APPROVAL_REQUIRED']),
    );
    expect(
      evaluatePlanPolicy({
        plan,
        sourceIds: ['source_one'],
        preflight,
        research: { authorizedUsdMicros: 0, observedUsdMicros: 0, reservedUsdMicros: 0 },
        production: { authorizedUsdMicros: 10, observedUsdMicros: 0, reservedUsdMicros: 0 },
        evidenceReady: true,
        approvalValid: true,
        autonomousScope: null,
      }).ready,
    ).toBe(true);
  });

  it('requires exact revision-bound sources, providers, mutations, and spending in autonomous mode', () => {
    const plan = samplePlan();
    plan.effective.settings.policy.mode = 'autonomous';
    plan.effective.settings.policy.budgetUsdMicros = 10;
    plan.effective.settings.policy.researchBudgetUsdMicros = 4;
    const preflight = {
      ready: true,
      expectedUsdMicros: 0,
      upperBoundUsdMicros: 0,
      providers: [
        {
          kind: 'renderer' as const,
          providerId: 'hyperframes',
          status: 'ready' as const,
          estimate: {
            expectedUsdMicros: 0,
            upperBoundUsdMicros: 0,
            validUntil: null,
            uncertainty: [],
          },
          reasons: [],
        },
      ],
    };
    const base = {
      plan,
      sourceIds: ['source_one'],
      preflight,
      research: { authorizedUsdMicros: 4, observedUsdMicros: 0, reservedUsdMicros: 0 },
      production: { authorizedUsdMicros: 10, observedUsdMicros: 0, reservedUsdMicros: 0 },
      evidenceReady: true,
      approvalValid: false,
    };
    expect(evaluatePlanPolicy({ ...base, autonomousScope: null }).ready).toBe(false);
    expect(
      evaluatePlanPolicy({
        ...base,
        autonomousScope: {
          id: 'policy_autonomous',
          jobId: plan.jobId,
          planRevision: plan.revision,
          recipe: plan.effective.settings.recipe,
          sourceIds: ['source_one'],
          providerIds: ['hyperframes'],
          mutationTargets: [],
          maxResearchUsdMicros: 4,
          maxProductionUsdMicros: 10,
        },
      }).ready,
    ).toBe(true);
  });

  it('applies identical evidence, provider, and budget gates in review and autonomous modes', () => {
    const shared = {
      sourceIds: ['source_one'],
      preflight: {
        ready: false,
        expectedUsdMicros: 5,
        upperBoundUsdMicros: 5,
        providers: [],
      },
      research: { authorizedUsdMicros: 1, observedUsdMicros: 2, reservedUsdMicros: 0 },
      production: { authorizedUsdMicros: 0, observedUsdMicros: 0, reservedUsdMicros: 0 },
      evidenceReady: false,
      approvalValid: false,
      autonomousScope: null,
    };
    const common = [
      'RESEARCH_ALLOWANCE_EXCEEDED',
      'EVIDENCE_REQUIRED',
      'PROVIDER_PREFLIGHT_FAILED',
      'PRODUCTION_ALLOWANCE_REQUIRED',
    ];
    for (const mode of ['review', 'autonomous'] as const) {
      const plan = samplePlan();
      plan.effective.settings.policy.mode = mode;
      plan.effective.settings.policy.researchBudgetUsdMicros = 1;
      plan.effective.settings.policy.budgetUsdMicros = 5;
      const codes = evaluatePlanPolicy({ ...shared, plan }).issues.map((issue) => issue.code);
      expect(codes).toEqual(expect.arrayContaining(common));
    }
  });
});
