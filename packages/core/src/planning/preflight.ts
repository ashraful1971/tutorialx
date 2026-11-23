import {
  type CostEstimate,
  digestSchema,
  type OperationContext,
  type PlanRevision,
  type ProviderCandidate,
  type ProviderFallbackPolicy,
  type ProviderKind,
  type ProviderSelection,
  planRevisionSchema,
  usdMicrosSchema,
} from '@tutorialx/contracts';
import { requirementsForPlan } from '../providers/requirements.js';
import {
  type ProviderAuthorization,
  type ProviderNegotiation,
  selectProvider,
} from '../providers/selection.js';
import type { ProviderWiring } from '../providers/wiring.js';

export interface ProviderPreflightSummary {
  kind: ProviderKind;
  providerId: string | null;
  status: 'ready' | 'blocked' | 'needs-approval';
  estimate: CostEstimate | null;
  reasons: string[];
}

export interface PlanProviderPreflight {
  ready: boolean;
  expectedUsdMicros: number;
  upperBoundUsdMicros: number | null;
  providers: ProviderPreflightSummary[];
}

function selectedProvider(plan: PlanRevision, kind: ProviderKind): ProviderSelection | null {
  const selected = plan.effective.settings.providers;
  if (kind === 'renderer') return selected.renderer;
  if (kind === 'voice') return selected.voice;
  if (kind === 'capture') return selected.capture;
  if (kind === 'alignment') return selected.alignment;
  if (kind === 'agent') return selected.agent;
  if (kind === 'assets') return selected.assets;
  return null;
}

/** Run capability, configuration, readiness, voice and bounded-cost checks without production calls. */
export async function preflightPlanProviders(input: {
  wiring: ProviderWiring;
  plan: PlanRevision;
  planDigest: string;
  authorization: ProviderAuthorization | null;
  fallbacks?: Partial<Record<ProviderKind, ProviderFallbackPolicy>>;
  platform: 'linux' | 'darwin' | 'win32';
  remainingProductionAllowanceUsdMicros: number;
  context: OperationContext;
  now(): number;
}): Promise<PlanProviderPreflight> {
  const plan = planRevisionSchema.parse(input.plan);
  const planDigest = digestSchema.parse(input.planDigest);
  let remaining = usdMicrosSchema.parse(input.remainingProductionAllowanceUsdMicros);
  let expected = 0;
  let upper = 0;
  const providers: ProviderPreflightSummary[] = [];
  const requirements = requirementsForPlan(plan);

  for (const kind of ['renderer', 'capture', 'voice', 'alignment', 'assets'] as const) {
    const required = requirements[kind];
    if (!required) continue;
    const selection = selectedProvider(plan, kind);
    if (!selection) {
      providers.push({
        kind,
        providerId: null,
        status: 'blocked',
        estimate: null,
        reasons: ['REQUIRED_PROVIDER_NOT_SELECTED'],
      });
      continue;
    }
    const candidate: ProviderCandidate = {
      selection,
      voiceId:
        kind === 'voice' && plan.effective.settings.voice.mode === 'synthesize'
          ? plan.effective.settings.voice.voiceId
          : null,
      visualIdentity: kind === 'renderer' ? selection.id : null,
    };
    const fallback = input.fallbacks?.[kind] ?? {
      schemaVersion: 1,
      candidates: [],
      maxCostUsdMicros: remaining,
    };
    const negotiation: ProviderNegotiation<typeof kind> = await selectProvider(input.wiring, {
      kind,
      selected: candidate,
      requirements: required,
      fallback,
      planDigest,
      authorization: input.authorization,
      platform: input.platform,
      localOnly: plan.effective.settings.policy.localOnly,
      remainingBudgetUsdMicros: remaining,
      operation: `${kind}.preflight`,
      estimateInput: { planId: plan.id, planRevision: plan.revision },
      context: input.context,
      now: input.now,
    });
    if (negotiation.status !== 'selected') {
      providers.push({
        kind,
        providerId:
          negotiation.status === 'needs-approval'
            ? negotiation.candidate.selection.id
            : selection.id,
        status: negotiation.status,
        estimate: null,
        reasons: negotiation.rejected.map((issue) => issue.code),
      });
      continue;
    }
    expected += negotiation.estimate.expectedUsdMicros;
    if (negotiation.estimate.upperBoundUsdMicros === null) upper = Number.NaN;
    else if (!Number.isNaN(upper)) {
      upper += negotiation.estimate.upperBoundUsdMicros;
      remaining -= negotiation.estimate.upperBoundUsdMicros;
    }
    providers.push({
      kind,
      providerId: negotiation.candidate.selection.id,
      status: 'ready',
      estimate: negotiation.estimate,
      reasons: negotiation.rejected.map((issue) => issue.code),
    });
  }

  return {
    ready: providers.length > 0 && providers.every((provider) => provider.status === 'ready'),
    expectedUsdMicros: expected,
    upperBoundUsdMicros: Number.isNaN(upper) ? null : upper,
    providers,
  };
}

export interface AutonomousPlanScope {
  id: string;
  jobId: string;
  planRevision: number;
  recipe: PlanRevision['effective']['settings']['recipe'];
  sourceIds: readonly string[];
  providerIds: readonly string[];
  mutationTargets: readonly string[];
  maxResearchUsdMicros: number;
  maxProductionUsdMicros: number;
}

export interface PlanPolicyAssessment {
  ready: boolean;
  issues: Array<{ code: string; message: string }>;
}

/** Evaluate explicit allowances and review/autonomous authority after provider preflight. */
export function evaluatePlanPolicy(input: {
  plan: PlanRevision;
  sourceIds: readonly string[];
  preflight: PlanProviderPreflight;
  research: { authorizedUsdMicros: number; observedUsdMicros: number; reservedUsdMicros: number };
  production: { authorizedUsdMicros: number; observedUsdMicros: number; reservedUsdMicros: number };
  evidenceReady: boolean;
  approvalValid: boolean;
  autonomousScope: AutonomousPlanScope | null;
}): PlanPolicyAssessment {
  const plan = planRevisionSchema.parse(input.plan);
  const policy = plan.effective.settings.policy;
  const issues: PlanPolicyAssessment['issues'] = [];
  const add = (code: string, message: string) => issues.push({ code, message });
  for (const allowance of [input.research, input.production]) {
    usdMicrosSchema.parse(allowance.authorizedUsdMicros);
    usdMicrosSchema.parse(allowance.observedUsdMicros);
    usdMicrosSchema.parse(allowance.reservedUsdMicros);
  }
  if (
    input.research.authorizedUsdMicros > policy.researchBudgetUsdMicros ||
    input.research.observedUsdMicros + input.research.reservedUsdMicros >
      input.research.authorizedUsdMicros
  )
    add('RESEARCH_ALLOWANCE_EXCEEDED', 'Research usage exceeds its explicit policy allowance.');
  if (!input.evidenceReady)
    add('EVIDENCE_REQUIRED', 'Accepted evidence must pass the same gate in every policy mode.');
  if (input.production.authorizedUsdMicros > policy.budgetUsdMicros)
    add('PRODUCTION_ALLOWANCE_EXCEEDED', 'Production allowance exceeds the job policy ceiling.');
  if (!input.preflight.ready)
    add('PROVIDER_PREFLIGHT_FAILED', 'Every required provider must pass preflight.');
  if (input.preflight.upperBoundUsdMicros === null)
    add('UNBOUNDED_PRODUCTION_COST', 'Production requires a conservative upper cost bound.');
  else if (
    input.production.observedUsdMicros +
      input.production.reservedUsdMicros +
      input.preflight.upperBoundUsdMicros >
    input.production.authorizedUsdMicros
  )
    add(
      'PRODUCTION_ALLOWANCE_REQUIRED',
      'Paid production cannot start without sufficient explicit allowance.',
    );

  if (policy.mode === 'review') {
    if (!input.approvalValid)
      add('APPROVAL_REQUIRED', 'Review mode requires current revision-bound approval.');
  } else {
    const scope = input.autonomousScope;
    const providerIds = input.preflight.providers
      .map((provider) => provider.providerId)
      .filter((id): id is string => id !== null);
    const valid =
      scope !== null &&
      scope.jobId === plan.jobId &&
      scope.planRevision === plan.revision &&
      scope.recipe === plan.effective.settings.recipe &&
      input.sourceIds.every((id) => scope.sourceIds.includes(id)) &&
      providerIds.every((id) => scope.providerIds.includes(id)) &&
      policy.mutationTargets.every((target) => scope.mutationTargets.includes(target)) &&
      input.research.authorizedUsdMicros <= scope.maxResearchUsdMicros &&
      input.production.authorizedUsdMicros <= scope.maxProductionUsdMicros;
    if (!valid)
      add(
        'AUTONOMOUS_SCOPE_MISMATCH',
        'Autonomous execution requires an exact revision-bound source/provider/mutation/spending scope.',
      );
  }
  return { ready: issues.length === 0, issues };
}
