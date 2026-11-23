import { createHash } from 'node:crypto';
import { createSuppliedAssetProvider } from '@tutorialx/adapters';
import {
  type ArtifactManifest,
  type AssetProvider,
  canonicalJson,
  type GeneratedAssetRequest,
  generatedAssetRequestSchema,
  inspectProviderConformance,
  type JsonObject,
  type OperationContext,
} from '@tutorialx/contracts';
import { generateAuthorizedAsset, requirementsForPlan } from '@tutorialx/core';
import { expect, it } from 'vitest';
import { digest, samplePlan, timestamp } from '../fixtures/contracts.js';

const config = { maxAssetsPerScene: 10 };
const context: OperationContext = {
  operationId: 'operation_assets',
  jobId: 'job_example',
  attemptId: 'attempt_assets',
  reservationId: null,
  outputDirectory: '/unused',
  deadlineAt: '2099-01-01T00:00:00Z',
  signal: new AbortController().signal,
};

function imageArtifact(overrides: Partial<ArtifactManifest> = {}): ArtifactManifest {
  return {
    schemaVersion: 1,
    id: 'hero_image',
    createdAt: timestamp,
    workspaceId: 'workspace_example',
    jobId: 'job_example',
    kind: 'image',
    mimeType: 'image/png',
    storage: { kind: 'local', path: 'input/hero.png' },
    digest,
    sizeBytes: 1024,
    media: {
      durationUs: null,
      width: 1600,
      height: 900,
      frameRate: null,
      videoCodec: null,
      audioCodec: null,
      sampleRate: null,
      channels: null,
    },
    provenance: {
      stageId: 'source_materialization',
      attemptId: 'attempt_source',
      inputDigests: [digest],
      provider: null,
      settingsDigest: digest,
      templateDigest: null,
    },
    ...overrides,
  };
}

function assetPlan() {
  const plan = samplePlan();
  plan.effective.settings.voice = { mode: 'none' };
  plan.effective.settings.providers.assets = {
    id: 'supplied-assets',
    version: '1.0.0',
    config,
    credentialRef: null,
  };
  plan.scenes[0]!.visual = { kind: 'image', assetId: 'hero_image', fit: 'contain' };
  return plan;
}

it('passes conformance and resolves a supplied scene asset with retained provenance', async () => {
  const provider = createSuppliedAssetProvider(config, {
    workspaceId: 'workspace_example',
    attribution: { hero_image: ['Photo: TutorialX fixture (CC BY 4.0).'] },
  });
  expect(
    await inspectProviderConformance(provider, {
      kind: 'assets',
      validConfiguration: config,
      invalidConfiguration: { ...config, unknown: true },
      estimateOperation: 'assets.prepare',
      estimateInput: {},
      context,
    }),
  ).toEqual([]);
  const plan = assetPlan();
  const artifact = imageArtifact();
  await expect(
    provider.prepare(
      { scene: plan.scenes[0]!, supplied: [artifact], settings: plan.effective.settings },
      context,
    ),
  ).resolves.toEqual({
    artifacts: [artifact],
    attribution: ['Photo: TutorialX fixture (CC BY 4.0).'],
    providerRequestId: null,
    actualUsdMicros: 0,
  });
});

it('fails explicitly for missing, wrong-kind, and generated assets', async () => {
  const provider = createSuppliedAssetProvider(config, {
    workspaceId: 'workspace_example',
  });
  const plan = assetPlan();
  const request = { scene: plan.scenes[0]!, supplied: [], settings: plan.effective.settings };
  await expect(provider.prepare(request, context)).rejects.toThrow(
    'SUPPLIED_ASSET_REQUIRED_MISSING',
  );
  await expect(
    provider.prepare({ ...request, supplied: [imageArtifact({ kind: 'audio' })] }, context),
  ).rejects.toThrow();
  const generated = generatedAssetRequestSchema.parse({
    sceneId: 'intro',
    kind: 'image',
    prompt: 'A clean blue abstract background',
    referenceArtifactIds: [],
    requirements: { mimeTypes: ['image/png'], width: 1600, height: 900, durationUs: null },
    authorization: { reservationId: 'reservation_assets', maxUsdMicros: 1000 },
  });
  await expect(
    generateAuthorizedAsset({
      provider,
      request: generated,
      context: { ...context, reservationId: 'reservation_assets' },
      fingerprint,
    }),
  ).rejects.toThrow('GENERATED_ASSET_CAPABILITY_UNAVAILABLE');
});

it('requires an exact reservation and bounded cost before generated dispatch', async () => {
  const request: GeneratedAssetRequest = generatedAssetRequestSchema.parse({
    sceneId: 'intro',
    kind: 'image',
    prompt: 'A clean blue abstract background',
    referenceArtifactIds: [],
    requirements: { mimeTypes: ['image/png'], width: 1600, height: 900, durationUs: null },
    authorization: { reservationId: 'reservation_assets', maxUsdMicros: 1000 },
  });
  let calls = 0;
  const provider = createGeneratedFixtureProvider(request, () => calls++);
  await expect(
    generateAuthorizedAsset({ provider, request, context, fingerprint }),
  ).rejects.toThrow('GENERATED_ASSET_AUTHORIZATION_MISMATCH');
  expect(calls).toBe(0);

  const authorizedContext = { ...context, reservationId: 'reservation_assets' };
  await expect(
    generateAuthorizedAsset({ provider, request, context: authorizedContext, fingerprint }),
  ).resolves.toMatchObject({ actualUsdMicros: 900, artifacts: [{ id: 'generated_image' }] });
  expect(calls).toBe(1);
});

it('keeps an asset-only plan independent of browser and generative capabilities', () => {
  const requirements = requirementsForPlan(assetPlan());
  expect(requirements.capture).toBeUndefined();
  expect(requirements.assets).toMatchObject({
    features: ['assets:supplied'],
    modalities: ['image'],
  });
  expect(requirements.assets?.features).not.toContain('assets:generated:image');
});

function createGeneratedFixtureProvider(
  request: GeneratedAssetRequest,
  called: () => void,
): AssetProvider {
  const descriptor: AssetProvider['descriptor'] = {
    id: 'fixture-generator',
    kind: 'assets',
    version: '1.0.0',
    contractVersion: 1,
    configurationSchema: { type: 'object' },
    capabilities: {
      features: ['assets:generated:image'],
      languages: [],
      formats: ['image/png'],
      modalities: ['image'],
    },
    runtime: { platforms: ['linux'], dependencies: [], memoryMiB: 64, gpu: false },
    execution: {
      location: 'remote',
      maxDurationMs: 30_000,
      cancellation: 'cooperative',
      sideEffect: 'reconcilable',
      idempotency: 'supported',
      permissions: ['network', 'credentials', 'write-work'],
    },
    pricing: 'metered',
  };
  return {
    descriptor,
    validateConfiguration: () => ({ ready: true, diagnostics: [] }),
    readiness: async () => ({ ready: true, diagnostics: [] }),
    estimate: async () => ({
      expectedUsdMicros: 900,
      upperBoundUsdMicros: 1000,
      validUntil: null,
      uncertainty: [],
    }),
    prepare: async () => ({
      artifacts: [],
      attribution: [],
      providerRequestId: null,
      actualUsdMicros: 0,
    }),
    generate: async (_request, operation) => {
      called();
      const requestObject = JSON.parse(JSON.stringify(request)) as JsonObject;
      const requestDigest = createHash('sha256').update(canonicalJson(requestObject)).digest('hex');
      return {
        artifacts: [
          imageArtifact({
            id: 'generated_image',
            provenance: {
              stageId: 'assets_intro',
              attemptId: operation.attemptId,
              inputDigests: [requestDigest],
              provider: { id: descriptor.id, version: descriptor.version },
              settingsDigest: digest,
              templateDigest: null,
            },
          }),
        ],
        attribution: [],
        providerRequestId: 'provider-request-1',
        actualUsdMicros: 900,
      };
    },
  };
}

function fingerprint(value: JsonObject): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}
