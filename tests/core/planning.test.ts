import { createHash } from 'node:crypto';
import {
  canonicalJson,
  type EvidenceRecord,
  type JobRecord,
  type JsonObject,
  planRevisionSchema,
  productionScriptSchema,
  type ResearchReport,
  type SourceManifest,
  type WorkspaceConfig,
} from '@tutorialx/contracts';
import {
  compileProductionScript,
  type PlanValidationContext,
  recipeDefinition,
  renderStoryboardProjection,
  resolveProductionBrief,
  validatePlanSubmission,
  validateProductionPlan,
} from '@tutorialx/core';
import { describe, expect, it } from 'vitest';
import {
  digest,
  sampleBrief,
  samplePlan,
  sampleSettings,
  timestamp,
} from '../fixtures/contracts.js';

const fingerprint = (value: JsonObject) =>
  createHash('sha256').update(canonicalJson(value)).digest('hex');
const profileHash = (value: unknown) =>
  fingerprint(JSON.parse(JSON.stringify(value)) as JsonObject);
function fixture() {
  const brief = sampleBrief();
  brief.sourceIds = ['source_one'];
  const settings = sampleSettings();
  settings.voice = { mode: 'none' };
  const workspace: WorkspaceConfig = {
    schemaVersion: 1,
    id: brief.workspaceId,
    createdAt: timestamp,
    revision: 1,
    contentRoot: 'videos',
    sourceRoots: ['.'],
    exclusions: [],
    defaults: {},
    policyCeiling: settings.policy,
  };
  const source: SourceManifest = {
    schemaVersion: 1,
    id: 'source_one',
    createdAt: timestamp,
    jobId: brief.id,
    input: { kind: 'text', text: 'The workflow produces plans.' },
    contentHash: digest,
    sourceRevision: null,
    status: 'available',
    snapshotArtifactId: null,
    reason: null,
    attribution: { origin: 'fixture', license: null, requiredText: null, usage: 'permitted' },
  };
  const evidence: EvidenceRecord = {
    schemaVersion: 1,
    id: 'evidence_one',
    createdAt: timestamp,
    jobId: brief.id,
    sourceId: source.id,
    sourceHash: digest,
    locator: { kind: 'whole' },
    claim: 'The workflow produces plans.',
    extract: source.input.kind === 'text' ? source.input.text : '',
    status: 'supplied',
    artifactIds: [],
    limitations: [],
  };
  const report: ResearchReport = {
    schemaVersion: 1,
    id: 'research_example',
    createdAt: timestamp,
    jobId: brief.id,
    basedOnRevision: 1,
    sourceIds: [source.id],
    evidenceIds: [evidence.id],
    summary: 'Workflow evidence.',
    blockers: [],
  };
  const job: JobRecord = {
    brief,
    status: {
      jobId: brief.id,
      revision: 1,
      lifecycle: 'waiting',
      waitReason: 'input',
      delivery: null,
      completedStages: 0,
      totalStages: 0,
    },
  };
  const resolved = resolveProductionBrief(
    { defaults: settings, workspace, brief, sources: [source] },
    profileHash,
  );
  const plan = samplePlan();
  plan.effective = resolved.effective;
  plan.evidenceDigest = fingerprint({ evidence: [evidence] });
  plan.scenes[0]!.evidenceIds = [evidence.id];
  const context: PlanValidationContext = {
    job,
    report,
    reportAcceptedRevision: 1,
    evidence: [evidence],
    sources: [source],
    effective: resolved.effective,
    previousPlan: null,
    fingerprint,
  };
  return { brief, settings, workspace, source, evidence, report, job, resolved, plan, context };
}

describe('recipe and effective brief resolution', () => {
  it.each(['tutorial', 'explainer', 'asset-video', 'reel', 'mixed'] as const)(
    'keeps %s purpose independent of landscape or vertical variants',
    (recipe) => {
      const state = fixture();
      state.brief.overrides = {
        recipe,
        variants: [
          {
            ...state.settings.variants[0]!,
            id: 'portrait',
            aspectRatio: '9:16',
            width: 1080,
            height: 1920,
          },
        ],
      };
      const resolved = resolveProductionBrief(
        {
          defaults: state.settings,
          workspace: state.workspace,
          brief: state.brief,
          sources: [state.source],
        },
        profileHash,
      );
      expect(resolved.recipe.id).toBe(recipe);
      expect(resolved.effective.settings.variants[0]?.aspectRatio).toBe('9:16');
      expect(resolved.effective.origins.recipe).toBe('job');
      expect(recipeDefinition(recipe).purpose).not.toContain('9:16');
      expect(resolved.materials[0]?.digest).toBe(digest);
    },
  );

  it('rejects unknown settings, contradictory dimensions, missing materials and policy escalation', () => {
    const state = fixture();
    expect(() =>
      resolveProductionBrief(
        {
          defaults: state.settings,
          workspace: state.workspace,
          brief: { ...state.brief, overrides: { invented: true } } as unknown as typeof state.brief,
          sources: [state.source],
        },
        profileHash,
      ),
    ).toThrow();
    state.brief.overrides = {
      variants: [{ ...state.settings.variants[0]!, width: 1080, height: 1920 }],
    };
    expect(() =>
      resolveProductionBrief(
        {
          defaults: state.settings,
          workspace: state.workspace,
          brief: state.brief,
          sources: [state.source],
        },
        profileHash,
      ),
    ).toThrow(/aspect ratio/);
    state.brief.overrides = { policy: { budgetUsdMicros: 1 } };
    expect(() =>
      resolveProductionBrief(
        {
          defaults: state.settings,
          workspace: state.workspace,
          brief: state.brief,
          sources: [state.source],
        },
        profileHash,
      ),
    ).toThrow(/policy/);
    state.brief.overrides = {};
    expect(() =>
      resolveProductionBrief(
        { defaults: state.settings, workspace: state.workspace, brief: state.brief, sources: [] },
        profileHash,
      ),
    ).toThrow(/unregistered/);
  });
});

describe('schema-checked production script and storyboard', () => {
  it('shows approved words beside intentions, evidence, capture assertions, timing and variants', () => {
    const { plan } = fixture();
    const script = compileProductionScript(plan);
    expect(productionScriptSchema.safeParse(script).success).toBe(true);
    expect(script.scenes[0]).toMatchObject({ order: 1, startUs: 0, endUs: 5_000_000 });
    const text = renderStoryboardProjection(plan);
    for (const value of [
      'Welcome to the tutorial.',
      'Introduce the topic.',
      'evidence\\_one',
      '5.00 s',
      'landscape',
      'planning estimates',
    ])
      expect(text).toContain(value);
    plan.scenes[0]!.visual = {
      kind: 'browser',
      target: 'https://demo.example/',
      setupRecipeId: null,
      focus: null,
      maskRegions: [],
      steps: [
        {
          id: 'observe',
          action: 'observe',
          description: 'Show the visible result',
          evidenceIds: ['evidence_one'],
          expected: [{ kind: 'url', url: 'https://demo.example/' }],
          dwellUs: 1_000_000,
        },
      ],
    };
    const tutorial = renderStoryboardProjection(plan);
    expect(tutorial).toContain('Intended action beside narration');
    expect(tutorial).toContain('Show the visible result');
    expect(tutorial).toContain('Expected result');
    expect(tutorial).toContain('1.00 s');
  });

  it('rejects stale/evidence-incomplete or self-modified plans through the shared public validator', () => {
    const state = fixture();
    expect(validatePlanSubmission(state.plan, state.context)).toEqual(state.plan);
    expect(() =>
      validatePlanSubmission({ ...state.plan, basedOnJobRevision: 2 }, state.context),
    ).toThrow(/stale/);
    expect(() =>
      validatePlanSubmission({ ...state.plan, evidenceDigest: 'b'.repeat(64) }, state.context),
    ).toThrow(/digest/);
    expect(() => validatePlanSubmission({ ...state.plan, approved: true }, state.context)).toThrow(
      /schema/,
    );
    const changed = structuredClone(state.plan);
    changed.effective.settings.policy.budgetUsdMicros = 500;
    expect(() => validatePlanSubmission(changed, state.context)).toThrow(/resolved settings/);
  });

  it('requires explicit multiple-variant layouts and accepted asset identities before production', () => {
    const state = fixture();
    state.plan.effective.settings.variants.push({
      ...state.plan.effective.settings.variants[0]!,
      id: 'portrait',
      aspectRatio: '9:16',
      width: 1080,
      height: 1920,
    });
    state.context.effective = state.plan.effective;
    expect(() => validateProductionPlan(state.plan, state.context, { artifacts: [] })).toThrow(
      /framing/,
    );
    state.plan.scenes[0]!.variantFraming = {
      landscape: { focus: null, notes: 'Use full width with bottom captions.' },
      portrait: { focus: null, notes: 'Stack text with bottom caption clearance.' },
    };
    expect(
      validateProductionPlan(state.plan, state.context, { artifacts: [] }).scenes,
    ).toHaveLength(1);
    state.plan.scenes[0]!.visual = { kind: 'image', assetId: 'missing_image', fit: 'contain' };
    expect(() => validateProductionPlan(state.plan, state.context, { artifacts: [] })).toThrow(
      /not accepted/,
    );
  });

  it('keeps incomplete topic-only demonstrations blocked and does not change the original plan schema', () => {
    const state = fixture();
    state.plan.effective.settings.recipe = 'tutorial';
    state.context.effective = state.plan.effective;
    expect(() => validateProductionPlan(state.plan, state.context, { artifacts: [] })).toThrow(
      /demonstration/,
    );
    expect(planRevisionSchema.safeParse(state.plan).success).toBe(true);
    expect(planRevisionSchema.safeParse({ ...state.plan, assetNeeds: [] }).success).toBe(false);
  });
});
