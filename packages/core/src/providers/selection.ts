import {
  type CostEstimate,
  costEstimateSchema,
  digestSchema,
  type OperationContext,
  type ProviderCandidate,
  type ProviderDescriptor,
  type ProviderFallbackPolicy,
  type ProviderKind,
  type ProviderRequirements,
  providerCandidateSchema,
  providerFallbackPolicySchema,
  providerReadinessSchema,
  providerRequirementsSchema,
  timestampSchema,
  usdMicrosSchema,
  type VoiceProvider,
} from '@tutorialx/contracts';
import { type ProviderPorts, type ProviderWiring, sameJson } from './wiring.js';

export interface CompatibilityIssue {
  providerId: string;
  code: string;
  requirement: string;
  remedy: string;
}

export function inspectProviderCompatibility(
  descriptor: ProviderDescriptor,
  requirements: ProviderRequirements,
  environment: { platform: 'linux' | 'darwin' | 'win32'; localOnly: boolean },
): CompatibilityIssue[] {
  const issues: CompatibilityIssue[] = [];
  const add = (code: string, requirement: string, remedy: string) =>
    issues.push({ providerId: descriptor.id, code, requirement, remedy });
  if (!descriptor.runtime.platforms.includes(environment.platform))
    add(
      'UNSUPPORTED_PLATFORM',
      environment.platform,
      'Select a provider supported on this worker.',
    );
  if (environment.localOnly && descriptor.execution.location !== 'local')
    add('LOCAL_ONLY_POLICY', 'local', 'Select a local provider; content cannot be sent remotely.');
  for (const category of ['languages', 'features', 'formats', 'modalities'] as const) {
    const advertised = descriptor.capabilities[category].map((value) =>
      category === 'languages' ? value.toLowerCase() : value,
    );
    for (const required of requirements[category]) {
      if (!advertised.includes(category === 'languages' ? required.toLowerCase() : required))
        add(
          `UNSUPPORTED_${category.toUpperCase()}`,
          required,
          `Select a provider declaring ${required} or revise the requested settings.`,
        );
    }
  }
  for (const scene of requirements.customScenes) {
    if (descriptor.kind !== 'renderer' || scene.providerId !== descriptor.id)
      add(
        'CUSTOM_SCENE_PROVIDER',
        scene.sceneId,
        `Use ${scene.providerId} with template ${scene.templateId}, or adapt and reapprove scene ${scene.sceneId}.`,
      );
    else if (!descriptor.capabilities.features.includes(`template:${scene.templateId}`))
      add(
        'CUSTOM_SCENE_TEMPLATE',
        scene.sceneId,
        `Install template ${scene.templateId} or adapt and reapprove scene ${scene.sceneId}.`,
      );
  }
  return issues;
}

export interface AuthorizedProviderChoice {
  candidate: ProviderCandidate;
  location: 'local' | 'remote';
}

/** Supplied only by the trusted approval/policy service, never by creative submissions. */
export interface ProviderAuthorization {
  planDigest: string;
  choices: readonly AuthorizedProviderChoice[];
}

interface SelectionRequest<K extends ProviderKind> {
  kind: K;
  selected: ProviderCandidate;
  requirements: ProviderRequirements;
  fallback: ProviderFallbackPolicy;
  planDigest: string;
  authorization: ProviderAuthorization | null;
  platform: 'linux' | 'darwin' | 'win32';
  localOnly: boolean;
  remainingBudgetUsdMicros: number;
  operation: string;
  estimateInput: Parameters<VoiceProvider['estimate']>[1];
  context: OperationContext;
  now(): number;
}

export type ProviderNegotiation<K extends ProviderKind> =
  | {
      status: 'selected';
      candidate: ProviderCandidate;
      provider: ProviderPorts[K];
      estimate: CostEstimate;
      rejected: readonly CompatibilityIssue[];
    }
  | {
      status: 'needs-approval';
      candidate: ProviderCandidate;
      changes: readonly string[];
      rejected: readonly CompatibilityIssue[];
    }
  | { status: 'blocked'; rejected: readonly CompatibilityIssue[] };

/** Metadata/configuration/readiness/estimate calls only. Never invokes a production method. */
export async function selectProvider<K extends ProviderKind>(
  wiring: ProviderWiring,
  request: SelectionRequest<K>,
): Promise<ProviderNegotiation<K>> {
  const selected = providerCandidateSchema.parse(request.selected);
  const requirements = providerRequirementsSchema.parse(request.requirements);
  const policy = providerFallbackPolicySchema.parse(request.fallback);
  const planDigest = digestSchema.parse(request.planDigest);
  timestampSchema.parse(request.context.deadlineAt);
  const maximum = Math.min(
    policy.maxCostUsdMicros,
    usdMicrosSchema.parse(request.remainingBudgetUsdMicros),
  );
  const original = wiring.describe(request.kind, selected.selection);
  const rejected: CompatibilityIssue[] = [];
  const interrupted = () =>
    request.context.signal.aborted || Date.parse(request.context.deadlineAt) <= request.now();

  for (const [index, candidate] of [selected, ...policy.candidates].entries()) {
    const reject = (code: string, requirement: string, remedy: string) =>
      rejected.push({ providerId: candidate.selection.id, code, requirement, remedy });
    if (interrupted()) {
      reject(
        'OPERATION_STOPPED',
        'deadline-or-cancellation',
        'Resume with a live authorized operation.',
      );
      break;
    }
    const descriptor = wiring.describe(request.kind, candidate.selection);
    if (!descriptor) {
      reject(
        'PROVIDER_NOT_REGISTERED',
        candidate.selection.version,
        'Explicitly wire this provider and exact version in the composition root.',
      );
      continue;
    }
    const incompatibilities = inspectProviderCompatibility(descriptor, requirements, request);
    if (incompatibilities.length) {
      rejected.push(...incompatibilities);
      continue;
    }

    if (index > 0) {
      const changes: string[] = [];
      if (!sameJson(candidate.selection, selected.selection)) changes.push('provider');
      // Voice identities are provider-scoped even if their labels happen to match.
      if (
        request.kind === 'voice' &&
        (!sameJson(candidate.selection, selected.selection) ||
          candidate.voiceId !== selected.voiceId)
      )
        changes.push('voice');
      if (
        candidate.visualIdentity !== selected.visualIdentity ||
        (request.kind === 'renderer' && !sameJson(candidate.selection, selected.selection))
      )
        changes.push('visuals');
      if (!original || original.execution.location !== descriptor.execution.location)
        changes.push('location');
      const authorized =
        request.authorization?.planDigest === planDigest &&
        request.authorization.choices.some(
          (choice) =>
            choice.location === descriptor.execution.location &&
            sameJson(choice.candidate, candidate),
        );
      if (changes.length && !authorized)
        return { status: 'needs-approval', candidate, changes, rejected };
    }

    let provider: ProviderPorts[K];
    try {
      provider = wiring.instantiate(request.kind, candidate.selection);
    } catch {
      reject(
        'INVALID_PROVIDER_CONFIGURATION',
        'configuration',
        'Check the selected configuration and registered factory; private error content is omitted.',
      );
      continue;
    }
    try {
      const readiness = providerReadinessSchema.parse(await provider.readiness());
      if (interrupted()) {
        reject(
          'OPERATION_STOPPED',
          'deadline-or-cancellation',
          'Resume with a live authorized operation.',
        );
        break;
      }
      if (!readiness.ready) {
        reject(
          'PROVIDER_UNAVAILABLE',
          'readiness',
          'Run provider-specific diagnostics and restore its dependencies or credentials.',
        );
        continue;
      }
      if (request.kind === 'voice') {
        const voices = await (provider as VoiceProvider).voices(request.context);
        const voice = voices.find(
          (entry) =>
            entry.id === candidate.voiceId &&
            requirements.languages.every(
              (language) => entry.language.toLowerCase() === language.toLowerCase(),
            ),
        );
        const controls = requirements.features
          .filter((feature) => feature.startsWith('voice:'))
          .map((feature) => feature.slice(6));
        if (!voice || controls.some((control) => !voice.controls.includes(control))) {
          reject(
            'UNSUPPORTED_VOICE',
            candidate.voiceId ?? 'missing-voice',
            'Select a discovered voice supporting the requested language and delivery controls.',
          );
          continue;
        }
      }
      if (interrupted()) {
        reject(
          'OPERATION_STOPPED',
          'deadline-or-cancellation',
          'Resume with a live authorized operation.',
        );
        break;
      }
      const estimate = costEstimateSchema.parse(
        await provider.estimate(request.operation, request.estimateInput, request.context),
      );
      if (interrupted()) {
        reject(
          'OPERATION_STOPPED',
          'deadline-or-cancellation',
          'Resume with a live authorized operation.',
        );
        break;
      }
      if (estimate.validUntil !== null && Date.parse(estimate.validUntil) <= request.now()) {
        reject('STALE_ESTIMATE', 'cost', 'Refresh the provider estimate before dispatch.');
        continue;
      }
      if (
        estimate.upperBoundUsdMicros === null ||
        estimate.upperBoundUsdMicros > maximum ||
        (descriptor.pricing === 'free' &&
          (estimate.expectedUsdMicros !== 0 || estimate.upperBoundUsdMicros !== 0))
      ) {
        reject(
          'COST_LIMIT',
          'cost',
          'Obtain a conservative cost bound within both policy and remaining budget.',
        );
        continue;
      }
      return { status: 'selected', candidate, provider, estimate, rejected };
    } catch {
      reject(
        'PROVIDER_PREFLIGHT_FAILED',
        'metadata',
        'Run provider-specific diagnostics; private exception content is omitted.',
      );
    }
  }
  return { status: 'blocked', rejected };
}
