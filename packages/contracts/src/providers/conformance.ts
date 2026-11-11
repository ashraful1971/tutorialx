import type { BaseProvider, JsonObject, OperationContext, ProviderKind } from './descriptor.js';
import {
  costEstimateSchema,
  providerDescriptorSchema,
  providerReadinessSchema,
} from './descriptor.js';

export interface ProviderFixture {
  kind: ProviderKind;
  validConfiguration: JsonObject;
  invalidConfiguration: JsonObject;
  estimateOperation: string;
  estimateInput: JsonObject;
  context: OperationContext;
}

/** Non-production checks. A service integration must separately verify its real side effects. */
export async function inspectProviderConformance(
  provider: BaseProvider<ProviderKind>,
  fixture: ProviderFixture,
): Promise<readonly string[]> {
  const findings: string[] = [];
  const descriptor = providerDescriptorSchema.safeParse(provider.descriptor);
  if (!descriptor.success) return ['INVALID_DESCRIPTOR'];
  if (descriptor.data.kind !== fixture.kind) findings.push('WRONG_PROVIDER_KIND');
  if (descriptor.data.configurationSchema.type !== 'object')
    findings.push('CONFIGURATION_SCHEMA_NOT_OBJECT');

  try {
    const valid = providerReadinessSchema.safeParse(
      provider.validateConfiguration(fixture.validConfiguration),
    );
    if (!valid.success || !valid.data.ready) findings.push('VALID_CONFIGURATION_REJECTED');
    const invalid = providerReadinessSchema.safeParse(
      provider.validateConfiguration(fixture.invalidConfiguration),
    );
    if (!invalid.success || invalid.data.ready) findings.push('INVALID_CONFIGURATION_ACCEPTED');
  } catch {
    findings.push('CONFIGURATION_CHECK_THREW');
  }

  try {
    if (!providerReadinessSchema.safeParse(await provider.readiness()).success)
      findings.push('INVALID_READINESS');
  } catch {
    findings.push('READINESS_THREW');
  }
  try {
    const estimate = costEstimateSchema.safeParse(
      await provider.estimate(fixture.estimateOperation, fixture.estimateInput, fixture.context),
    );
    if (!estimate.success) findings.push('INVALID_ESTIMATE');
    else if (
      descriptor.data.pricing === 'free' &&
      (estimate.data.expectedUsdMicros !== 0 || estimate.data.upperBoundUsdMicros !== 0)
    )
      findings.push('FREE_PROVIDER_ESTIMATE_NOT_ZERO');
  } catch {
    findings.push('ESTIMATE_THREW');
  }
  return findings;
}
