import {
  type ActionErrorCode,
  type ArtifactManifest,
  canonicalJson,
  type EffectiveSettings,
  type EvidenceRecord,
  type JobRecord,
  type JsonObject,
  type PlanRevision,
  planRevisionSchema,
  type ResearchClaimUse,
  type ResearchConflict,
  type ResearchEvidenceObservation,
  type ResearchReport,
  researchReportSchema,
  type SourceManifest,
} from '@tutorialx/contracts';
import { assessResearchEvidence } from '../research/evidence.js';
import { recipeDefinition, validateVariantDimensions } from './brief.js';

export class PlanningValidationError extends Error {
  constructor(
    readonly code: ActionErrorCode,
    message: string,
  ) {
    super(message);
  }
}
const requireInput = (condition: unknown, message: string) => {
  if (!condition) throw new PlanningValidationError('INVALID_INPUT', message);
};
const json = (value: unknown): JsonObject => JSON.parse(JSON.stringify(value)) as JsonObject;

export interface PlanValidationContext {
  job: JobRecord;
  report: ResearchReport;
  reportAcceptedRevision: number;
  evidence: readonly EvidenceRecord[];
  sources: readonly SourceManifest[];
  effective: EffectiveSettings;
  previousPlan: PlanRevision | null;
  observations?: readonly ResearchEvidenceObservation[];
  conflicts?: readonly ResearchConflict[];
  fingerprint(value: JsonObject): string;
}

/** Shared acceptance checks for CLI, external agents and future MCP transports. */
export function validatePlanSubmission(raw: unknown, context: PlanValidationContext): PlanRevision {
  const parsed = planRevisionSchema.safeParse(raw);
  if (!parsed.success)
    throw new PlanningValidationError(
      'INVALID_INPUT',
      'Plan failed the versioned PlanRevision schema.',
    );
  const plan = parsed.data;
  const report = researchReportSchema.parse(context.report);
  const { job, evidence, sources } = context;
  requireInput(
    plan.jobId === job.brief.id && report.jobId === job.brief.id,
    'Plan or research belongs to another job.',
  );
  if (plan.basedOnJobRevision !== job.status.revision)
    throw new PlanningValidationError(
      'REVISION_CONFLICT',
      'Plan is based on a stale job revision.',
    );
  if (context.reportAcceptedRevision < job.brief.revision || report.id !== plan.researchReportId)
    throw new PlanningValidationError(
      'REVISION_CONFLICT',
      'Plan requires the current accepted research report.',
    );
  requireInput(report.blockers.length === 0, 'Resolve research blockers before submitting a plan.');
  const assessment = assessResearchEvidence({
    jobId: job.brief.id,
    report,
    sources,
    evidence,
    ...(context.observations === undefined ? {} : { observations: context.observations }),
    ...(context.conflicts === undefined ? {} : { conflicts: context.conflicts }),
  });
  requireInput(
    assessment.ready,
    assessment.issues[0]?.message ?? 'Research evidence is incomplete.',
  );
  requireInput(
    plan.revision === (context.previousPlan?.revision ?? 0) + 1,
    'Plan revision must advance by one.',
  );
  const reportIds = new Set(report.evidenceIds);
  requireInput(
    reportIds.size === report.evidenceIds.length,
    'Research report repeats evidence identities.',
  );
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  const checkEvidence = (ids: readonly string[]) => {
    requireInput(new Set(ids).size === ids.length, 'Duplicate evidence identities.');
    for (const evidenceId of ids) {
      const item = evidenceById.get(evidenceId);
      requireInput(
        item && item.jobId === job.brief.id && reportIds.has(evidenceId),
        'Evidence is missing or outside the accepted report.',
      );
      requireInput(
        item && !['contradicted', 'unverified'].includes(item.status),
        'Evidence is contradicted or unverified.',
      );
      requireInput(
        item &&
          sources.some(
            (source) =>
              source.jobId === job.brief.id &&
              source.id === item.sourceId &&
              source.contentHash === item.sourceHash &&
              source.status === 'available',
          ),
        'Evidence references a stale or unavailable source.',
      );
    }
  };
  checkEvidence(report.evidenceIds);
  const selectedEvidence = evidence
    .filter((item) => reportIds.has(item.id))
    .sort((a, b) => a.id.localeCompare(b.id));
  requireInput(
    plan.evidenceDigest === context.fingerprint({ evidence: selectedEvidence }),
    'Plan evidence digest differs from accepted research.',
  );
  requireInput(
    canonicalJson(json(plan.effective)) === canonicalJson(json(context.effective)),
    'Plan cannot replace resolved settings or execution policy.',
  );
  const policy = plan.effective.settings.policy;
  const originAllowed = (target: string) =>
    policy.allowedOrigins.some((origin) => new URL(origin).origin === new URL(target).origin);
  for (const scene of plan.scenes) {
    checkEvidence(scene.evidenceIds);
    if (scene.visual.kind !== 'browser') continue;
    requireInput(
      originAllowed(scene.visual.target),
      'Browser target is outside allowed network scope.',
    );
    for (const step of scene.visual.steps) {
      checkEvidence(step.evidenceIds);
      if (step.action === 'navigate')
        requireInput(
          originAllowed(step.url),
          'Capture navigation is outside allowed network scope.',
        );
    }
  }
  return plan;
}

export interface ProductionPlanRequirements {
  /** Already accepted media, not untrusted caller-authored artifact manifests. */
  artifacts: readonly ArtifactManifest[];
  /** Explicit model-independent requirements assigned by the operator/brief resolver. */
  conclusionSceneId?: string;
  callToActionSceneId?: string;
  minTextHeightRatio?: number;
  claims?: readonly ResearchClaimUse[];
}

/** A stronger, explicit production-readiness gate; legacy PlanRevision remains unchanged. */
export function validateProductionPlan(
  raw: unknown,
  context: PlanValidationContext,
  requirements: ProductionPlanRequirements,
): PlanRevision {
  const plan = validatePlanSubmission(raw, context);
  const settings = plan.effective.settings;
  validateVariantDimensions(settings);
  const recipe = recipeDefinition(settings.recipe);
  const evidence = new Map(context.evidence.map((item) => [item.id, item]));
  if (requirements.claims) {
    const assessment = assessResearchEvidence({
      jobId: plan.jobId,
      report: context.report,
      sources: context.sources,
      evidence: context.evidence,
      claims: requirements.claims,
      ...(context.observations === undefined ? {} : { observations: context.observations }),
      ...(context.conflicts === undefined ? {} : { conflicts: context.conflicts }),
    });
    requireInput(
      assessment.ready,
      assessment.issues[0]?.message ?? 'Production claims are unsupported.',
    );
  }
  const assets = new Map(
    requirements.artifacts
      .filter(
        (artifact) =>
          artifact.jobId === plan.jobId && artifact.workspaceId === context.job.brief.workspaceId,
      )
      .map((artifact) => [artifact.id, artifact]),
  );
  const minText = requirements.minTextHeightRatio ?? 0.015;
  requireInput(
    Number.isFinite(minText) && minText > 0 && minText <= 1,
    'Text readability threshold is invalid.',
  );
  const referencedMedia = new Set<string>();
  const media = (assetId: string, kind: 'audio' | 'image' | 'video') => {
    requireInput(
      assets.get(assetId)?.kind === kind,
      `Required ${kind} asset ${assetId} is not accepted in this job.`,
    );
    referencedMedia.add(assetId);
  };
  for (const scene of plan.scenes) {
    requireInput(
      recipe.supportedVisuals.includes(scene.visual.kind),
      'Visual kind is unsupported by the selected recipe.',
    );
    requireInput(
      scene.evidenceIds.length > 0,
      'Production scenes require explicit evidence references.',
    );
    if (settings.voice.mode !== 'none')
      requireInput(
        scene.narration.trim().length > 0,
        'Narrated production requires approved words for every scene.',
      );
    for (const variantId of Object.keys(scene.variantFraming))
      requireInput(
        settings.variants.some((variant) => variant.id === variantId),
        'Scene framing references an unknown output variant.',
      );
    for (const variant of settings.variants) {
      const framing = scene.variantFraming[variant.id];
      if (settings.variants.length > 1)
        requireInput(
          framing && framing.notes.trim().length > 0,
          'Each requested variant needs explicit framing and layout notes; an implicit center crop is insufficient.',
        );
      if (scene.visual.kind === 'text')
        requireInput(
          settings.captions.style.fontSize / variant.height >= minText,
          'Declared text size is too small for the output variant.',
        );
    }
    if (scene.visual.kind === 'image') media(scene.visual.assetId, 'image');
    if (scene.visual.kind === 'video') {
      media(scene.visual.assetId, 'video');
      const duration = assets.get(scene.visual.assetId)?.media?.durationUs;
      requireInput(
        duration !== null &&
          duration !== undefined &&
          scene.visual.startUs + scene.visual.durationUs <= duration,
        'Supplied video range exceeds the accepted asset duration.',
      );
    }
    if (scene.visual.kind === 'browser') {
      requireInput(
        settings.providers.capture !== null,
        'Browser scenes require an explicitly selected capture provider.',
      );
      const minimum = scene.visual.steps.reduce((sum, step) => sum + step.dwellUs, 0);
      requireInput(
        minimum <= scene.estimatedDurationUs,
        'Capture dwell time exceeds the scene estimate.',
      );
      for (const step of scene.visual.steps) {
        requireInput(
          step.evidenceIds.some((evidenceId) => evidence.get(evidenceId)?.status === 'observed'),
          'Capture steps require observed behavior evidence before production.',
        );
        if (step.action === 'click' || step.action === 'fill') {
          const target = new URL(scene.visual.target);
          requireInput(
            settings.policy.mutationTargets.some((allowed) => {
              const scope = new URL(allowed);
              return target.origin === scope.origin && target.pathname.startsWith(scope.pathname);
            }),
            'Capture interactions require an explicitly authorized mutation target.',
          );
        }
      }
    }
  }
  if (settings.voice.mode === 'supplied') media(settings.voice.assetId, 'audio');
  if (settings.audio.music.enabled) media(settings.audio.music.assetId, 'audio');
  if (settings.brand.logoAssetId) media(settings.brand.logoAssetId, 'image');
  if (recipe.requiredMaterials === 'assets')
    requireInput(referencedMedia.size > 0, 'Asset-based production requires accepted media.');
  if (recipe.requiredMaterials === 'demonstration')
    requireInput(
      plan.scenes.some((scene) => scene.visual.kind === 'browser' || scene.visual.kind === 'video'),
      'A tutorial requires a feasible live or supplied demonstration.',
    );
  for (const sceneId of [requirements.conclusionSceneId, requirements.callToActionSceneId]) {
    if (sceneId === undefined) continue;
    const scene = plan.scenes.find((scene) => scene.id === sceneId);
    requireInput(
      scene &&
        scene === plan.scenes.at(-1) &&
        (scene.narration.trim().length > 0 || scene.visual.kind === 'text'),
      'Requested conclusion or call to action must identify the final reviewable scene.',
    );
  }
  return plan;
}
