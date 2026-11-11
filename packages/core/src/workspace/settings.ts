import {
  digestSchema,
  type EffectiveSettings,
  type ExecutionPolicy,
  effectiveSettingsSchema,
  type Profile,
  type ProfileSnapshot,
  profileSchema,
  type SettingsOverrides,
  settingsOverridesSchema,
  settingsSchema,
  type VideoSettings,
  type WorkspaceConfig,
  workspaceConfigSchema,
} from '@tutorialx/contracts';

export class SettingsPolicyError extends Error {
  readonly code = 'POLICY_DENIED';
  constructor(readonly fields: readonly string[]) {
    super(`Settings exceed workspace policy: ${fields.join(', ')}.`);
  }
}

function urlIdentity(value: string): string {
  return new URL(value).href;
}

export function assertSettingsPolicy(policy: ExecutionPolicy, ceiling: ExecutionPolicy): void {
  const fields: string[] = [];
  for (const key of [
    'budgetUsdMicros',
    'researchBudgetUsdMicros',
    'maxAttempts',
    'maxRepairs',
  ] as const)
    if (policy[key] > ceiling[key]) fields.push(key);
  if (ceiling.localOnly && !policy.localOnly) fields.push('localOnly');
  if (ceiling.mode === 'review' && policy.mode !== 'review') fields.push('mode');
  if (
    ceiling.deadlineAt !== null &&
    (policy.deadlineAt === null || Date.parse(policy.deadlineAt) > Date.parse(ceiling.deadlineAt))
  )
    fields.push('deadlineAt');
  for (const key of ['allowedOrigins', 'mutationTargets'] as const) {
    const allowed = new Set(ceiling[key].map(urlIdentity));
    if (policy[key].some((value) => !allowed.has(urlIdentity(value)))) fields.push(key);
  }
  if (
    ceiling.requiredReviewModalities.some(
      (modality) => !policy.requiredReviewModalities.includes(modality),
    )
  )
    fields.push('requiredReviewModalities');
  if (fields.length) throw new SettingsPolicyError(fields);
}

type ObjectValue = Record<string, unknown>;
const isObject = (value: unknown): value is ObjectValue =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const atomic = (path: string) =>
  path === 'voice' || path === 'audio.music' || path.startsWith('providers.');

function recordOrigins(
  value: unknown,
  path: string,
  origin: string,
  origins: Record<string, string>,
) {
  if (isObject(value) && Object.keys(value).length > 0) {
    for (const [key, child] of Object.entries(value))
      recordOrigins(child, path ? `${path}.${key}` : key, origin, origins);
  } else origins[path] = origin;
}

function overlay(
  base: ObjectValue,
  changes: ObjectValue,
  origin: string,
  origins: Record<string, string>,
  prefix = '',
): ObjectValue {
  const result = structuredClone(base);
  for (const [key, value] of Object.entries(changes)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (!atomic(path) && isObject(value) && isObject(result[key]))
      result[key] = overlay(result[key], value, origin, origins, path);
    else {
      result[key] = structuredClone(value);
      for (const previous of Object.keys(origins))
        if (previous === path || previous.startsWith(`${path}.`)) delete origins[previous];
      recordOrigins(value, path, origin, origins);
    }
  }
  return result;
}

/** Restrict built-in policy defaults before applying any explicit configuration layer. */
function inheritedPolicy(defaults: ExecutionPolicy, ceiling: ExecutionPolicy): ExecutionPolicy {
  const result = structuredClone(defaults);
  for (const key of [
    'budgetUsdMicros',
    'researchBudgetUsdMicros',
    'maxAttempts',
    'maxRepairs',
  ] as const)
    result[key] = Math.min(result[key], ceiling[key]);
  if (ceiling.localOnly) result.localOnly = true;
  if (ceiling.mode === 'review') result.mode = 'review';
  if (
    ceiling.deadlineAt !== null &&
    (result.deadlineAt === null || Date.parse(result.deadlineAt) > Date.parse(ceiling.deadlineAt))
  )
    result.deadlineAt = ceiling.deadlineAt;
  for (const key of ['allowedOrigins', 'mutationTargets'] as const) {
    const allowed = new Set(ceiling[key].map(urlIdentity));
    result[key] = result[key].filter((value) => allowed.has(urlIdentity(value)));
  }
  result.requiredReviewModalities = [
    ...new Set([...result.requiredReviewModalities, ...ceiling.requiredReviewModalities]),
  ];
  return result;
}

export interface SettingsResolution {
  workspace: { id: string; revision: number };
  profiles: ProfileSnapshot[];
  effective: EffectiveSettings;
}

export interface SettingsResolutionInput {
  defaults: VideoSettings;
  workspace: WorkspaceConfig;
  product?: Profile;
  brand?: Profile;
  presets?: readonly Profile[];
  overrides?: SettingsOverrides;
}

/** Always builds a new detached snapshot. Existing jobs never follow mutable profile objects. */
export function resolveSettings(
  input: SettingsResolutionInput,
  fingerprint: (profile: Profile) => string,
): SettingsResolution {
  const workspace = workspaceConfigSchema.parse(input.workspace);
  const defaults = settingsSchema.parse(input.defaults);
  const origins: Record<string, string> = {};
  recordOrigins(defaults, '', 'built-in', origins);
  const policy = inheritedPolicy(defaults.policy, workspace.policyCeiling);
  for (const key of Object.keys(policy) as (keyof ExecutionPolicy)[])
    if (JSON.stringify(policy[key]) !== JSON.stringify(defaults.policy[key]))
      origins[`policy.${key}`] = `workspace:${workspace.id}@${workspace.revision}:policy-ceiling`;
  let current: ObjectValue = { ...defaults, policy };
  const profiles: ProfileSnapshot[] = [];
  const selected: { profile: Profile; kind: Profile['kind'] }[] = [];
  if (input.product) selected.push({ profile: input.product, kind: 'product' });
  if (input.brand) selected.push({ profile: input.brand, kind: 'brand' });
  for (const profile of input.presets ?? []) selected.push({ profile, kind: 'preset' });
  if (selected.length > 100) throw new Error('Too many selected profiles.');
  const seen = new Set<string>();

  const apply = (changes: SettingsOverrides, origin: string) => {
    current = overlay(current, settingsOverridesSchema.parse(changes), origin, origins);
    assertSettingsPolicy(current.policy as ExecutionPolicy, workspace.policyCeiling);
  };
  apply(workspace.defaults, `workspace:${workspace.id}@${workspace.revision}`);
  for (const { profile: supplied, kind } of selected) {
    const profile = profileSchema.parse(supplied);
    if (profile.kind !== kind) throw new Error(`Expected a ${kind} profile.`);
    if (seen.has(profile.id)) throw new Error('A profile cannot be selected more than once.');
    seen.add(profile.id);
    const digest = digestSchema.parse(fingerprint(structuredClone(profile)));
    profiles.push({ profile, digest });
    apply(profile.settings, `${kind}:${profile.id}@${profile.revision}`);
  }
  apply(input.overrides ?? {}, 'job');
  const settings = settingsSchema.parse(current);
  return {
    workspace: { id: workspace.id, revision: workspace.revision },
    profiles,
    effective: effectiveSettingsSchema.parse({ settings, origins }),
  };
}
