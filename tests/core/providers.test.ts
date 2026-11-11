import {
  type OperationContext,
  type ProviderCandidate,
  type ProviderDescriptor,
  type ProviderFallbackPolicy,
  type ProviderRequirements,
  providerFallbackPolicySchema,
  providerRequirementsSchema,
  type RendererProvider,
  type VoiceProvider,
} from '@tutorialx/contracts';
import { requirementsForPlan, selectProvider, wireProviders } from '@tutorialx/core';
import { describe, expect, it, vi } from 'vitest';
import { digest, samplePlan } from '../fixtures/contracts.js';

const empty = (): ProviderRequirements => ({
  languages: [],
  features: [],
  formats: [],
  modalities: [],
  customScenes: [],
});
const choice = (id = 'primary', voiceId: string | null = 'amy'): ProviderCandidate => ({
  selection: { id, version: '1', config: { enabled: true }, credentialRef: null },
  voiceId,
  visualIdentity: null,
});
const fallback = (candidates: ProviderCandidate[] = []): ProviderFallbackPolicy => ({
  schemaVersion: 1,
  candidates,
  maxCostUsdMicros: 10,
});
const context = (): OperationContext => ({
  operationId: 'op',
  jobId: 'job',
  attemptId: 'attempt',
  outputDirectory: '/unused',
  deadlineAt: '2099-01-01T00:00:00Z',
  reservationId: null,
  signal: new AbortController().signal,
});

function descriptor(id = 'primary'): ProviderDescriptor & { kind: 'voice' } {
  return {
    id,
    version: '1',
    contractVersion: 1,
    kind: 'voice',
    configurationSchema: {
      type: 'object',
      properties: { enabled: { type: 'boolean' } },
      required: ['enabled'],
      additionalProperties: false,
    },
    capabilities: {
      languages: ['en-US'],
      features: [],
      formats: ['audio/wav'],
      modalities: ['audio'],
    },
    runtime: { platforms: ['linux'], dependencies: [], memoryMiB: 1, gpu: false },
    execution: {
      location: 'local',
      maxDurationMs: 1000,
      cancellation: 'cooperative',
      sideEffect: 'pure',
      idempotency: 'supported',
      permissions: [],
    },
    pricing: 'free',
  };
}

function voice(id = 'primary'): VoiceProvider {
  return {
    descriptor: descriptor(id),
    validateConfiguration: vi.fn((config) => ({
      ready: config.enabled === true && Object.keys(config).length === 1,
      diagnostics: [],
    })),
    readiness: vi.fn(async () => ({ ready: true, diagnostics: [] })),
    estimate: vi.fn(async () => ({
      expectedUsdMicros: 0,
      upperBoundUsdMicros: 0,
      validUntil: null,
      uncertainty: [],
    })),
    voices: vi.fn(async () => [
      { id: 'amy', name: 'Amy', language: 'en-US', controls: [] },
      { id: 'ben', name: 'Ben', language: 'en-US', controls: [] },
    ]),
    synthesize: vi.fn(async () => {
      throw new Error('Production must not run in negotiation.');
    }),
  };
}

function setup(...providers: VoiceProvider[]) {
  const factories = providers.map((provider) => vi.fn(() => provider));
  const wiring = wireProviders(
    providers.map((provider, index) => ({
      descriptor: provider.descriptor,
      create: factories[index]!,
    })),
  );
  return { wiring, factories };
}

function request() {
  return {
    kind: 'voice' as const,
    selected: choice(),
    requirements: { ...empty(), languages: ['en-US'] },
    fallback: fallback(),
    planDigest: digest,
    authorization: null,
    platform: 'linux' as const,
    localOnly: true,
    remainingBudgetUsdMicros: 10,
    operation: 'synthesize',
    estimateInput: {},
    context: context(),
    now: () => Date.parse('2026-11-11T12:00:00Z'),
  };
}

describe('explicit provider assembly', () => {
  it('rejects incompatible descriptors, duplicate identities, and missing versions', () => {
    const provider = voice();
    expect(() =>
      wireProviders([
        { descriptor: { ...provider.descriptor, contractVersion: 2 as 1 }, create: () => provider },
      ]),
    ).toThrow();
    expect(() => setup(provider, provider)).toThrow('Duplicate');
    const { wiring } = setup(provider);
    expect(() => wiring.instantiate('voice', { ...choice().selection, version: '2' })).toThrow(
      'not explicitly registered',
    );
  });

  it('passes exact configuration and credential references to the selected factory', async () => {
    const provider = voice();
    const { wiring, factories } = setup(provider);
    const selected = choice();
    selected.selection.credentialRef = 'speech_key';
    const result = await selectProvider(wiring, { ...request(), selected });
    expect(result.status).toBe('selected');
    expect(factories[0]).toHaveBeenCalledWith(selected.selection);
    expect(provider.validateConfiguration).toHaveBeenCalledWith({ enabled: true });
    expect(provider.synthesize).not.toHaveBeenCalled();
  });

  it('rejects an instance whose descriptor differs from its registration', () => {
    const provider = voice();
    const wiring = wireProviders([
      {
        descriptor: descriptor(),
        create: () => ({ ...provider, descriptor: descriptor('wrong') }),
      },
    ]);
    expect(() => wiring.instantiate('voice', choice().selection)).toThrow('does not match');
    const discovered = wiring.descriptors();
    discovered[0]!.id = 'mutated';
    expect(wiring.descriptors()[0]!.id).toBe('primary');
  });
});

describe('pre-dispatch negotiation', () => {
  it.each([
    ['language', { ...empty(), languages: ['bn-BD'] }],
    ['timing', { ...empty(), features: ['timing:word'] }],
    ['format', { ...empty(), formats: ['audio/mp3'] }],
    ['review modality', { ...empty(), modalities: ['video'] }],
  ] as const)(
    'rejects an unsupported %s before factory or provider calls',
    async (_label, requirements) => {
      const provider = voice();
      const { wiring, factories } = setup(provider);
      const result = await selectProvider(wiring, {
        ...request(),
        requirements: providerRequirementsSchema.parse(requirements),
      });
      expect(result.status).toBe('blocked');
      expect(factories[0]).not.toHaveBeenCalled();
      expect(provider.estimate).not.toHaveBeenCalled();
    },
  );

  it('rejects a custom scene assigned to another renderer before any dispatch', async () => {
    const base = voice();
    const plan = samplePlan();
    plan.scenes[0]!.visual = {
      kind: 'custom',
      providerId: 'hyperframes',
      templateId: 'special',
      data: {},
      requiredCapabilities: ['shader'],
    };
    const requirements = requirementsForPlan(plan).renderer!;
    const renderer: RendererProvider = {
      ...base,
      descriptor: {
        ...base.descriptor,
        id: 'remotion',
        kind: 'renderer',
        capabilities: {
          ...base.descriptor.capabilities,
          features: requirements.features,
          formats: requirements.formats,
        },
      },
      preflight: vi.fn(async () => ({ ready: true, diagnostics: [] })),
      render: vi.fn(async () => {
        throw new Error('Must not render');
      }),
    };
    const create = vi.fn(() => renderer);
    const wiring = wireProviders([{ descriptor: renderer.descriptor, create }]);
    const result = await selectProvider(wiring, {
      ...request(),
      kind: 'renderer',
      selected: choice('remotion', null),
      requirements,
    });
    expect(result.status).toBe('blocked');
    expect(result.rejected).toContainEqual(
      expect.objectContaining({ code: 'CUSTOM_SCENE_PROVIDER', requirement: 'intro' }),
    );
    expect(create).not.toHaveBeenCalled();
    expect(renderer.render).not.toHaveBeenCalled();
  });

  it('checks voice-specific language and controls, not only broad descriptors', async () => {
    const provider = voice();
    provider.descriptor.capabilities.features = ['voice:pace'];
    const { wiring } = setup(provider);
    const result = await selectProvider(wiring, {
      ...request(),
      requirements: { ...empty(), languages: ['en-US'], features: ['voice:pace'] },
    });
    expect(result.status).toBe('blocked');
    expect(result.rejected[0]?.code).toBe('UNSUPPORTED_VOICE');
    expect(provider.estimate).not.toHaveBeenCalled();
  });

  it('rejects invalid config without a readiness or production call', async () => {
    const provider = voice();
    const { wiring } = setup(provider);
    const selected = choice();
    selected.selection.config = { unknown: true };
    const result = await selectProvider(wiring, { ...request(), selected });
    expect(result.status).toBe('blocked');
    expect(provider.readiness).not.toHaveBeenCalled();
    expect(provider.synthesize).not.toHaveBeenCalled();
  });

  it.each(['remote', 'platform'] as const)(
    'rejects %s restrictions without provider access',
    async (restriction) => {
      const provider = voice();
      if (restriction === 'remote') provider.descriptor.execution.location = 'remote';
      else provider.descriptor.runtime.platforms = ['win32'];
      const { wiring, factories } = setup(provider);
      expect((await selectProvider(wiring, request())).status).toBe('blocked');
      expect(factories[0]).not.toHaveBeenCalled();
    },
  );

  it.each([null, 11])(
    'blocks unknown or over-budget cost bound %s',
    async (upperBoundUsdMicros) => {
      const provider = voice();
      provider.descriptor.pricing = 'metered';
      provider.estimate = vi.fn(async () => ({
        expectedUsdMicros: 1,
        upperBoundUsdMicros,
        validUntil: null,
        uncertainty: [],
      }));
      const { wiring } = setup(provider);
      const result = await selectProvider(wiring, request());
      expect(result.status).toBe('blocked');
      expect(result.rejected[0]?.code).toBe('COST_LIMIT');
      expect(provider.synthesize).not.toHaveBeenCalled();
    },
  );

  it('enforces the lower remaining budget and rejects expired estimates', async () => {
    const provider = voice();
    provider.descriptor.pricing = 'metered';
    provider.estimate = async () => ({
      expectedUsdMicros: 2,
      upperBoundUsdMicros: 3,
      validUntil: null,
      uncertainty: [],
    });
    const { wiring } = setup(provider);
    expect(
      (await selectProvider(wiring, { ...request(), remainingBudgetUsdMicros: 2 })).status,
    ).toBe('blocked');
    provider.estimate = async () => ({
      expectedUsdMicros: 0,
      upperBoundUsdMicros: 0,
      validUntil: '2026-11-11T11:00:00Z',
      uncertainty: [],
    });
    expect((await selectProvider(wiring, request())).rejected[0]?.code).toBe('STALE_ESTIMATE');
  });

  it('does not expose provider exception text or probe undeclared alternatives', async () => {
    const primary = voice();
    primary.readiness = async () => {
      throw new Error('secret value');
    };
    const spare = voice('spare');
    const { wiring, factories } = setup(primary, spare);
    const result = await selectProvider(wiring, request());
    expect(result.status).toBe('blocked');
    expect(JSON.stringify(result)).not.toContain('secret value');
    expect(factories[1]).not.toHaveBeenCalled();
  });

  it('stops cancelled and expired operations before probing', async () => {
    const provider = voice();
    const { wiring, factories } = setup(provider);
    const abort = new AbortController();
    abort.abort();
    const cancelled = await selectProvider(wiring, {
      ...request(),
      context: { ...context(), signal: abort.signal },
    });
    expect(cancelled.status).toBe('blocked');
    const expired = await selectProvider(wiring, {
      ...request(),
      context: { ...context(), deadlineAt: '2020-01-01T00:00:00Z' },
    });
    expect(expired.status).toBe('blocked');
    expect(factories[0]).not.toHaveBeenCalled();
  });
});

describe('authorized fallbacks', () => {
  it('requires approval for a changed voice even in the same provider', async () => {
    const provider = voice();
    const { wiring } = setup(provider);
    const result = await selectProvider(wiring, {
      ...request(),
      selected: choice('primary', 'missing'),
      fallback: fallback([choice('primary', 'ben')]),
    });
    expect(result.status).toBe('needs-approval');
    if (result.status === 'needs-approval') expect(result.changes).toEqual(['voice']);
    expect(provider.synthesize).not.toHaveBeenCalled();
  });

  it.each([
    'missing',
    'stale',
    'different-config',
    'different-voice',
    'different-location',
  ] as const)('cannot bypass approval with %s authorization', async (scope) => {
    const primary = voice();
    primary.readiness = async () => ({ ready: false, diagnostics: [] });
    const spare = voice('spare');
    spare.descriptor.execution.location = 'remote';
    const { wiring, factories } = setup(primary, spare);
    const candidate = choice('spare', 'ben');
    const authorized = structuredClone(candidate);
    if (scope === 'different-config') authorized.selection.config = { enabled: false };
    if (scope === 'different-voice') authorized.voiceId = 'amy';
    const result = await selectProvider(wiring, {
      ...request(),
      localOnly: false,
      fallback: fallback([candidate]),
      authorization:
        scope === 'missing'
          ? null
          : {
              planDigest: scope === 'stale' ? 'b'.repeat(64) : digest,
              choices: [
                {
                  candidate: authorized,
                  location: scope === 'different-location' ? 'local' : 'remote',
                },
              ],
            },
    });
    expect(result.status).toBe('needs-approval');
    if (result.status === 'needs-approval')
      expect(result.changes).toEqual(['provider', 'voice', 'location']);
    expect(factories[1]).not.toHaveBeenCalled();
  });

  it('accepts an exact trusted revision-bound fallback and still enforces its budget', async () => {
    const primary = voice();
    primary.readiness = async () => ({ ready: false, diagnostics: [] });
    const spare = voice('spare');
    const { wiring } = setup(primary, spare);
    const candidate = choice('spare', 'ben');
    const input = {
      ...request(),
      fallback: fallback([candidate]),
      authorization: { planDigest: digest, choices: [{ candidate, location: 'local' as const }] },
    };
    const result = await selectProvider(wiring, input);
    expect(result.status).toBe('selected');
    if (result.status === 'selected') expect(result.candidate).toEqual(candidate);
    expect(spare.synthesize).not.toHaveBeenCalled();
    spare.estimate = async () => ({
      expectedUsdMicros: 20,
      upperBoundUsdMicros: 20,
      validUntil: null,
      uncertainty: [],
    });
    expect((await selectProvider(wiring, input)).status).toBe('blocked');
  });
});

it('derives codec, output, timing, and voice control requirements without inventing capabilities', () => {
  const plan = samplePlan();
  plan.effective.settings.voice = {
    mode: 'synthesize',
    voiceId: 'amy',
    pace: 1.2,
    tone: 'warm',
    pronunciations: { TutorialX: 'tutorial ex' },
  };
  plan.effective.settings.providers.voice = choice().selection;
  const requirements = requirementsForPlan(plan);
  expect(requirements.voice?.features).toEqual([
    'voice:pace',
    'voice:tone',
    'voice:pronunciations',
    'timing:word',
  ]);
  expect(requirements.renderer?.features).toEqual(
    expect.arrayContaining([
      'visual:text',
      'transition:fade',
      'resolution:1920x1080',
      'frame-rate:30/1',
      'aspect-ratio:16:9',
      'thumbnail',
    ]),
  );
  expect(requirements.renderer?.formats).toEqual(['codec:h264', 'container:mp4']);
  plan.effective.settings.providers.alignment = choice('aligner', null).selection;
  expect(requirementsForPlan(plan).voice?.features).not.toContain('timing:word');
  expect(requirementsForPlan(plan).alignment?.features).toContain('timing:word');
  expect(providerFallbackPolicySchema.safeParse({ ...fallback(), silent: true }).success).toBe(
    false,
  );
  expect(providerFallbackPolicySchema.safeParse({ ...fallback(), schemaVersion: 2 }).success).toBe(
    false,
  );
});
