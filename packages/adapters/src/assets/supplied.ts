import {
  type AssetProvider,
  artifactManifestSchema,
  assetPreparationRequestSchema,
  assetResultSchema,
  idSchema,
  type JsonObject,
  type OperationContext,
  type ProviderDescriptor,
  type ProviderReadiness,
  timestampSchema,
} from '@tutorialx/contracts';

export interface SuppliedAssetProviderOptions {
  workspaceId: string;
  attribution?: Readonly<Record<string, readonly string[]>>;
}

interface SuppliedAssetConfiguration {
  maxAssetsPerScene: number;
}

const version = '1.0.0';

function configuration(value: JsonObject): SuppliedAssetConfiguration | null {
  if (
    Object.keys(value).some((key) => key !== 'maxAssetsPerScene') ||
    !Number.isSafeInteger(value.maxAssetsPerScene) ||
    Number(value.maxAssetsPerScene) < 1 ||
    Number(value.maxAssetsPerScene) > 2000
  )
    return null;
  return { maxAssetsPerScene: Number(value.maxAssetsPerScene) };
}

function descriptor(): ProviderDescriptor & { kind: 'assets' } {
  return {
    id: 'supplied-assets',
    kind: 'assets',
    version,
    contractVersion: 1,
    configurationSchema: {
      type: 'object',
      properties: { maxAssetsPerScene: { type: 'integer', minimum: 1, maximum: 2000 } },
      required: ['maxAssetsPerScene'],
      additionalProperties: false,
    },
    capabilities: {
      features: ['assets:supplied'],
      languages: [],
      formats: ['image/*', 'video/*', 'audio/*'],
      modalities: ['image', 'video', 'audio'],
    },
    runtime: {
      platforms: ['darwin', 'linux', 'win32'],
      dependencies: [],
      memoryMiB: 32,
      gpu: false,
    },
    execution: {
      location: 'local',
      maxDurationMs: 10_000,
      cancellation: 'cooperative',
      sideEffect: 'pure',
      idempotency: 'supported',
      permissions: [],
    },
    pricing: 'free',
  };
}

function checkContext(context: OperationContext) {
  context.signal.throwIfAborted();
  timestampSchema.parse(context.deadlineAt);
  if (Date.parse(context.deadlineAt) <= Date.now())
    throw new Error('SUPPLIED_ASSET_DEADLINE_EXCEEDED');
  idSchema.parse(context.operationId);
  idSchema.parse(context.jobId);
  idSchema.parse(context.attemptId);
}

function requiredAsset(scene: ReturnType<typeof assetPreparationRequestSchema.parse>['scene']) {
  if (scene.visual.kind === 'image') return { id: scene.visual.assetId, kind: 'image' as const };
  if (scene.visual.kind === 'video') return { id: scene.visual.assetId, kind: 'video' as const };
  return null;
}

export function createSuppliedAssetProvider(
  configValue: JsonObject,
  options: SuppliedAssetProviderOptions,
): AssetProvider {
  const config = configuration(configValue);
  if (!config) throw new Error('Invalid supplied-assets configuration.');
  idSchema.parse(options.workspaceId);
  const providerDescriptor = descriptor();
  const validateConfiguration = (candidate: JsonObject): ProviderReadiness => ({
    ready: configuration(candidate) !== null,
    diagnostics:
      configuration(candidate) === null
        ? [
            {
              code: 'SUPPLIED_ASSET_CONFIG_INVALID',
              message: 'Supplied-asset configuration is malformed or contains unknown fields.',
              classification: 'permanent',
              retryable: false,
            },
          ]
        : [],
  });
  return {
    descriptor: providerDescriptor,
    validateConfiguration,
    readiness: async () => ({ ready: true, diagnostics: [] }),
    estimate: async (_operation, _input, context) => {
      checkContext(context);
      return { expectedUsdMicros: 0, upperBoundUsdMicros: 0, validUntil: null, uncertainty: [] };
    },
    prepare: async (requestValue, context) => {
      checkContext(context);
      const request = assetPreparationRequestSchema.parse(requestValue);
      if (request.supplied.length > config.maxAssetsPerScene)
        throw new Error('SUPPLIED_ASSET_LIMIT_EXCEEDED');
      const needed = requiredAsset(request.scene);
      if (!needed)
        return assetResultSchema.parse({
          artifacts: [],
          attribution: [],
          providerRequestId: null,
          actualUsdMicros: 0,
        });
      const matches = request.supplied.filter((artifact) => artifact.id === needed.id);
      if (matches.length !== 1) throw new Error('SUPPLIED_ASSET_REQUIRED_MISSING');
      const artifact = artifactManifestSchema.parse(matches[0]);
      if (
        artifact.kind !== needed.kind ||
        artifact.workspaceId !== options.workspaceId ||
        artifact.jobId !== context.jobId
      )
        throw new Error('SUPPLIED_ASSET_SCOPE_MISMATCH');
      return assetResultSchema.parse({
        artifacts: [artifact],
        attribution: [...new Set(options.attribution?.[artifact.id] ?? [])],
        providerRequestId: null,
        actualUsdMicros: 0,
      });
    },
  };
}
