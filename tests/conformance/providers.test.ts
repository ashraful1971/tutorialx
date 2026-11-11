import {
  type BaseProvider,
  inspectProviderConformance,
  type ProviderDescriptor,
  type ProviderFixture,
  type ProviderKind,
  providerKindSchema,
  type VoiceProvider,
  voiceResultSchema,
} from '@tutorialx/contracts';
import { describe, expect, it } from 'vitest';

function descriptor(kind: ProviderKind): ProviderDescriptor {
  return {
    id: 'fixture',
    kind,
    version: '1.0.0',
    contractVersion: 1,
    configurationSchema: {
      type: 'object',
      properties: { enabled: { type: 'boolean' } },
      required: ['enabled'],
      additionalProperties: false,
    },
    capabilities: { features: [], languages: ['en-US'], formats: [], modalities: ['text'] },
    runtime: {
      platforms: ['linux', 'darwin', 'win32'],
      dependencies: [],
      memoryMiB: 64,
      gpu: false,
    },
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

function provider(kind: ProviderKind): BaseProvider<ProviderKind> {
  return {
    descriptor: descriptor(kind),
    validateConfiguration: (config) => ({
      ready: config.enabled === true && Object.keys(config).length === 1,
      diagnostics: [],
    }),
    readiness: async () => ({ ready: true, diagnostics: [] }),
    estimate: async () => ({
      expectedUsdMicros: 0,
      upperBoundUsdMicros: 0,
      validUntil: null,
      uncertainty: [],
    }),
  };
}

function fixture(kind: ProviderKind): ProviderFixture {
  return {
    kind,
    validConfiguration: { enabled: true },
    invalidConfiguration: { secret: 'not-a-real-secret' },
    estimateOperation: 'fixture',
    estimateInput: {},
    context: {
      operationId: 'operation',
      jobId: 'job',
      attemptId: 'attempt',
      outputDirectory: '/unused',
      deadlineAt: '2099-01-01T00:00:00Z',
      reservationId: null,
      signal: new AbortController().signal,
    },
  };
}

describe('provider conformance harness', () => {
  it.each(providerKindSchema.options)(
    'accepts a compatible %s descriptor and common methods',
    async (kind) => {
      expect(await inspectProviderConformance(provider(kind), fixture(kind))).toEqual([]);
    },
  );

  it('rejects incompatible contract versions before invoking provider methods', async () => {
    const candidate = provider('voice');
    Object.defineProperty(candidate.descriptor, 'contractVersion', { value: 2 });
    expect(await inspectProviderConformance(candidate, fixture('voice'))).toEqual([
      'INVALID_DESCRIPTOR',
    ]);
  });

  it('rejects a different provider responsibility', async () => {
    expect(await inspectProviderConformance(provider('voice'), fixture('capture'))).toContain(
      'WRONG_PROVIDER_KIND',
    );
  });

  it('detects providers that accept unknown configuration', async () => {
    const candidate = {
      ...provider('voice'),
      validateConfiguration: () => ({ ready: true, diagnostics: [] }),
    };
    expect(await inspectProviderConformance(candidate, fixture('voice'))).toContain(
      'INVALID_CONFIGURATION_ACCEPTED',
    );
  });

  it('rejects contradictory free-provider pricing and invalid upper bounds', async () => {
    const candidate = {
      ...provider('voice'),
      estimate: async () => ({
        expectedUsdMicros: 1,
        upperBoundUsdMicros: 1,
        validUntil: null,
        uncertainty: [],
      }),
    };
    expect(await inspectProviderConformance(candidate, fixture('voice'))).toContain(
      'FREE_PROVIDER_ESTIMATE_NOT_ZERO',
    );
    candidate.estimate = async () => ({
      expectedUsdMicros: 2,
      upperBoundUsdMicros: 1,
      validUntil: null,
      uncertainty: [],
    });
    expect(await inspectProviderConformance(candidate, fixture('voice'))).toContain(
      'INVALID_ESTIMATE',
    );
  });

  it('reports a broken provider without exposing its thrown content', async () => {
    const candidate = {
      ...provider('voice'),
      validateConfiguration: () => {
        throw new Error('private diagnostic');
      },
    };
    expect(await inspectProviderConformance(candidate, fixture('voice'))).toEqual([
      'CONFIGURATION_CHECK_THREW',
    ]);
  });

  it('expresses voice cancellation through the shared operation context', async () => {
    const base = provider('voice');
    const voice: VoiceProvider = {
      ...base,
      descriptor: { ...base.descriptor, kind: 'voice' },
      voices: async () => [
        { id: 'fixture', name: 'Fixture voice', language: 'en-US', controls: [] },
      ],
      synthesize: async (_request, context) => {
        context.signal.throwIfAborted();
        throw new Error('Fixture has no production audio');
      },
    };
    const abort = new AbortController();
    abort.abort(new Error('Cancelled fixture'));
    await expect(
      voice.synthesize(
        {
          sceneId: 'intro',
          text: 'Hello',
          language: 'en-US',
          voiceId: 'fixture',
          pace: 1,
          tone: '',
          pronunciations: {},
        },
        { ...fixture('voice').context, signal: abort.signal },
      ),
    ).rejects.toThrow('Cancelled fixture');
    expect(
      voiceResultSchema.safeParse({
        audio: {},
        words: null,
        providerRequestId: null,
        actualUsdMicros: null,
      }).success,
    ).toBe(false);
  });
});
