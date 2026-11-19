import {
  type ArtifactManifest,
  type AssetProvenanceDeclaration,
  artifactManifestSchema,
  assetProvenanceDeclarationSchema,
  canonicalJson,
  type PlanRevision,
  planRevisionSchema,
  type SourceManifest,
  sourceManifestSchema,
} from '@tutorialx/contracts';

export interface AssetProvenanceIssue {
  code:
    | 'MISSING_ASSET'
    | 'MISSING_PROVENANCE'
    | 'STALE_PROVENANCE'
    | 'UNKNOWN_USAGE'
    | 'RESTRICTED_USAGE';
  artifactId: string;
  message: string;
}

export interface AssetProvenanceAssessment {
  ready: boolean;
  attribution: string[];
  issues: AssetProvenanceIssue[];
}

function referencedAssets(plan: PlanRevision): string[] {
  const ids = new Set<string>();
  for (const scene of plan.scenes) {
    if (scene.visual.kind === 'image' || scene.visual.kind === 'video')
      ids.add(scene.visual.assetId);
  }
  if (plan.effective.settings.voice.mode === 'supplied')
    ids.add(plan.effective.settings.voice.assetId);
  if (plan.effective.settings.audio.music.enabled)
    ids.add(plan.effective.settings.audio.music.assetId);
  return [...ids].sort();
}

/** Resolve required delivery credits and block assets whose permitted use cannot be established. */
export function assessAssetProvenance(input: {
  plan: PlanRevision;
  artifacts: readonly ArtifactManifest[];
  declarations: readonly AssetProvenanceDeclaration[];
  sources: readonly SourceManifest[];
  allowUnknownUsage?: boolean;
}): AssetProvenanceAssessment {
  const plan = planRevisionSchema.parse(input.plan);
  const artifacts = input.artifacts.map((artifact) => artifactManifestSchema.parse(artifact));
  const declarations = input.declarations.map((declaration) =>
    assetProvenanceDeclarationSchema.parse(declaration),
  );
  const sources = input.sources.map((source) => sourceManifestSchema.parse(source));
  const issues: AssetProvenanceIssue[] = [];
  const attribution = new Set<string>();

  for (const artifactId of referencedAssets(plan)) {
    const artifact = artifacts.find(
      (candidate) => candidate.id === artifactId && candidate.jobId === plan.jobId,
    );
    if (!artifact) {
      issues.push({
        code: 'MISSING_ASSET',
        artifactId,
        message: 'Referenced media is not an accepted artifact for this job.',
      });
      continue;
    }
    const declaration = declarations.find(
      (candidate) => candidate.artifactId === artifactId && candidate.jobId === plan.jobId,
    );
    if (!declaration) {
      issues.push({
        code: 'MISSING_PROVENANCE',
        artifactId,
        message: 'Referenced media has no provenance and usage declaration.',
      });
      continue;
    }
    if (declaration.sourceId) {
      const source = sources.find(
        (candidate) => candidate.id === declaration.sourceId && candidate.jobId === plan.jobId,
      );
      const matches =
        source?.status === 'available' &&
        source.contentHash !== null &&
        artifact.provenance.inputDigests.includes(source.contentHash) &&
        canonicalJson(source.attribution) ===
          canonicalJson({
            origin: declaration.origin,
            license: declaration.license,
            requiredText: declaration.requiredText,
            usage: declaration.usage,
          });
      if (!matches) {
        issues.push({
          code: 'STALE_PROVENANCE',
          artifactId,
          message:
            'Asset declaration does not match its available source fingerprint and attribution.',
        });
        continue;
      }
    }
    if (declaration.usage === 'restricted')
      issues.push({
        code: 'RESTRICTED_USAGE',
        artifactId,
        message: 'Asset usage is restricted and cannot enter a delivery package.',
      });
    else if (declaration.usage === 'unknown' && !input.allowUnknownUsage)
      issues.push({
        code: 'UNKNOWN_USAGE',
        artifactId,
        message: 'Asset usage is unknown and requires an explicit operator policy decision.',
      });
    if (declaration.requiredText) attribution.add(declaration.requiredText);
    else if (declaration.license) attribution.add(`${declaration.origin} — ${declaration.license}`);
  }

  return { ready: issues.length === 0, attribution: [...attribution].sort(), issues };
}
