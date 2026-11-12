import {
  type JobBrief,
  jobBriefSchema,
  type RecipeDefinition,
  type ResolvedProductionBrief,
  recipeDefinitionSchema,
  resolvedProductionBriefSchema,
  type SourceManifest,
  sourceManifestSchema,
} from '@tutorialx/contracts';
import { resolveSettings, type SettingsResolutionInput } from '../workspace/settings.js';

/** Purpose is independent of aspect ratio: every recipe can use every validated output variant. */
export const RECIPE_DEFINITIONS: Readonly<Record<RecipeDefinition['id'], RecipeDefinition>> = {
  tutorial: {
    id: 'tutorial',
    purpose: 'Teach an evidenced sequence of actions with visible results.',
    supportedVisuals: ['text', 'image', 'video', 'browser', 'diagram', 'custom'],
    requiredMaterials: 'demonstration',
    suggestedDurationUs: null,
  },
  explainer: {
    id: 'explainer',
    purpose: 'Explain an evidenced concept through narration and supporting visuals.',
    supportedVisuals: ['text', 'image', 'video', 'diagram', 'custom'],
    requiredMaterials: 'evidence',
    suggestedDurationUs: null,
  },
  'asset-video': {
    id: 'asset-video',
    purpose: 'Arrange supplied or explicitly requested media into an evidenced video.',
    supportedVisuals: ['text', 'image', 'video', 'diagram', 'custom'],
    requiredMaterials: 'assets',
    suggestedDurationUs: null,
  },
  reel: {
    id: 'reel',
    purpose:
      'Deliver a concise hook, supporting idea, and conclusion in any requested aspect ratio.',
    supportedVisuals: ['text', 'image', 'video', 'browser', 'diagram', 'custom'],
    requiredMaterials: 'evidence',
    suggestedDurationUs: 60_000_000,
  },
  mixed: {
    id: 'mixed',
    purpose: 'Combine demonstrations, supplied media, and explanations in one reviewable story.',
    supportedVisuals: ['text', 'image', 'video', 'browser', 'diagram', 'custom'],
    requiredMaterials: 'evidence',
    suggestedDurationUs: null,
  },
};

export function recipeDefinition(name: RecipeDefinition['id']): RecipeDefinition {
  return recipeDefinitionSchema.parse(RECIPE_DEFINITIONS[name]);
}

export function validateVariantDimensions(
  settings: ResolvedProductionBrief['effective']['settings'],
) {
  for (const variant of settings.variants) {
    if (variant.aspectRatio === 'custom') continue;
    const [width, height] = variant.aspectRatio.split(':').map(Number) as [number, number];
    if (Math.abs(variant.width / variant.height - width / height) > 0.01)
      throw new Error(`Variant ${variant.id} dimensions contradict its declared aspect ratio.`);
  }
}

/** Resolve explicit layers once; detached profile snapshots and visible origins enter the plan. */
export function resolveProductionBrief(
  input: Omit<SettingsResolutionInput, 'overrides'> & {
    brief: JobBrief;
    sources: readonly SourceManifest[];
  },
  fingerprint: Parameters<typeof resolveSettings>[1],
): ResolvedProductionBrief {
  const brief = jobBriefSchema.parse(input.brief);
  if (brief.workspaceId !== input.workspace.id)
    throw new Error('Brief belongs to another workspace.');
  const resolved = resolveSettings({ ...input, overrides: brief.overrides }, fingerprint);
  if (
    resolved.profiles.length !== brief.profiles.length ||
    resolved.profiles.some((snapshot, index) => {
      const selected = brief.profiles[index];
      return (
        !selected ||
        selected.id !== snapshot.profile.id ||
        selected.revision !== snapshot.profile.revision ||
        selected.digest !== snapshot.digest
      );
    })
  )
    throw new Error('Selected profile snapshots do not match the brief references and precedence.');
  const sources = input.sources.map((source) => sourceManifestSchema.parse(source));
  if (
    sources.some((source) => source.jobId !== brief.id) ||
    new Set(sources.map((source) => source.id)).size !== sources.length
  )
    throw new Error('Materials must have unique identities and belong to this job.');
  if (brief.sourceIds.some((sourceId) => !sources.some((source) => source.id === sourceId)))
    throw new Error('Brief references an unregistered source.');
  const result = resolvedProductionBriefSchema.parse({
    schemaVersion: 1,
    brief,
    ...resolved,
    recipe: recipeDefinition(resolved.effective.settings.recipe),
    materials: sources
      .filter((source) => brief.sourceIds.includes(source.id))
      .map((source) => ({
        sourceId: source.id,
        kind: source.input.kind,
        digest: source.contentHash,
        status: source.status,
      })),
  });
  validateVariantDimensions(result.effective.settings);
  return result;
}
