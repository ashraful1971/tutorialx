import {
  type AssetProvider,
  type AssetResult,
  assetResultSchema,
  digestSchema,
  type GeneratedAssetRequest,
  generatedAssetRequestSchema,
  type JsonObject,
  type OperationContext,
} from '@tutorialx/contracts';

function requestInput(request: GeneratedAssetRequest): JsonObject {
  return JSON.parse(JSON.stringify(request)) as JsonObject;
}

/** Dispatch generated media only after capability, reservation, estimate and provenance checks. */
export async function generateAuthorizedAsset(input: {
  provider: AssetProvider;
  request: GeneratedAssetRequest;
  context: OperationContext;
  fingerprint(value: JsonObject): string;
}): Promise<AssetResult> {
  const request = generatedAssetRequestSchema.parse(input.request);
  input.context.signal.throwIfAborted();
  if (
    !input.provider.generate ||
    !input.provider.descriptor.capabilities.features.includes(`assets:generated:${request.kind}`) ||
    !input.provider.descriptor.capabilities.modalities.includes(request.kind)
  )
    throw new Error('GENERATED_ASSET_CAPABILITY_UNAVAILABLE');
  if (input.context.reservationId !== request.authorization.reservationId)
    throw new Error('GENERATED_ASSET_AUTHORIZATION_MISMATCH');
  const estimate = await input.provider.estimate(
    'assets.generate',
    requestInput(request),
    input.context,
  );
  if (
    estimate.upperBoundUsdMicros === null ||
    estimate.upperBoundUsdMicros > request.authorization.maxUsdMicros
  )
    throw new Error('GENERATED_ASSET_COST_NOT_AUTHORIZED');
  const result = assetResultSchema.parse(await input.provider.generate(request, input.context));
  if (
    result.actualUsdMicros === null ||
    result.actualUsdMicros > request.authorization.maxUsdMicros
  )
    throw new Error('GENERATED_ASSET_COST_EXCEEDED');
  const requestDigest = digestSchema.parse(input.fingerprint(requestInput(request)));
  for (const artifact of result.artifacts) {
    if (
      artifact.jobId !== input.context.jobId ||
      artifact.provenance.attemptId !== input.context.attemptId ||
      artifact.provenance.provider?.id !== input.provider.descriptor.id ||
      artifact.provenance.provider.version !== input.provider.descriptor.version ||
      !artifact.provenance.inputDigests.includes(requestDigest)
    )
      throw new Error('GENERATED_ASSET_PROVENANCE_INVALID');
  }
  return result;
}
