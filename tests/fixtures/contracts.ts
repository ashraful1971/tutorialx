import type { ApprovalRecord, JobBrief, PlanRevision, VideoSettings } from '@tutorialx/contracts';

export const timestamp = '2026-11-11T10:00:00Z';
export const digest = 'a'.repeat(64);

export function sampleSettings(): VideoSettings {
  return {
    recipe: 'explainer',
    language: 'en-US',
    targetDurationUs: 60_000_000,
    variants: [
      {
        id: 'landscape',
        aspectRatio: '16:9',
        width: 1920,
        height: 1080,
        frameRate: { numerator: 30, denominator: 1 },
        codec: 'h264',
        container: 'mp4',
        thumbnail: true,
      },
    ],
    captions: {
      mode: 'sidecar',
      formats: ['srt'],
      language: 'en-US',
      style: {
        fontFamily: 'Inter',
        fontSize: 48,
        color: '#ffffff',
        backgroundColor: '#000000cc',
        maxLines: 2,
        position: 'bottom',
      },
    },
    voice: { mode: 'supplied', assetId: 'narration' },
    audio: { music: { enabled: false }, effects: false, ducking: false },
    brand: {
      name: 'Demo',
      logoAssetId: null,
      fontFamily: 'Inter',
      primaryColor: '#176bff',
      introTemplate: null,
      outroTemplate: null,
    },
    providers: {
      renderer: { id: 'hyperframes', version: '1', config: {}, credentialRef: null },
      voice: null,
      capture: null,
      alignment: null,
      agent: null,
      assets: null,
    },
    qualityProfileId: 'standard',
    policy: {
      mode: 'review',
      localOnly: true,
      budgetUsdMicros: 0,
      researchBudgetUsdMicros: 0,
      maxAttempts: 3,
      maxRepairs: 2,
      deadlineAt: null,
      allowedOrigins: [],
      mutationTargets: [],
      requiredReviewModalities: ['text', 'image', 'audio'],
    },
  };
}

export function sampleBrief(): JobBrief {
  return {
    schemaVersion: 1,
    id: 'job_example',
    createdAt: timestamp,
    workspaceId: 'workspace_example',
    revision: 1,
    title: 'Create your first tutorial',
    topic: 'Explain the workflow',
    audience: 'Beginners',
    instructions: 'Keep the explanation concise.',
    sourceIds: [],
    profiles: [],
    overrides: {},
  };
}

export function samplePlan(): PlanRevision {
  return {
    schemaVersion: 1,
    id: 'plan_example',
    createdAt: timestamp,
    jobId: 'job_example',
    revision: 1,
    basedOnJobRevision: 1,
    researchReportId: 'research_example',
    evidenceDigest: digest,
    effective: { settings: sampleSettings(), origins: { recipe: 'defaults' } },
    scenes: [
      {
        id: 'intro',
        title: 'Introduction',
        narration: 'Welcome to the tutorial.',
        intent: 'Introduce the topic.',
        evidenceIds: [],
        visual: { kind: 'text', headline: 'Welcome', body: 'Create a useful tutorial.' },
        estimatedDurationUs: 5_000_000,
        transition: 'fade',
        variantFraming: {},
      },
    ],
    costEstimate: { expectedUsdMicros: 0, upperBoundUsdMicros: 0, uncertainty: [] },
    limitations: [],
  };
}

export function sampleApproval(): ApprovalRecord {
  return {
    schemaVersion: 1,
    id: 'approval_example',
    createdAt: timestamp,
    jobId: 'job_example',
    planId: 'plan_example',
    planRevision: 1,
    planDigest: digest,
    settingsDigest: digest,
    evidenceDigest: digest,
    providersDigest: digest,
    actor: { id: 'operator', kind: 'human', origin: 'local-cli' },
    scopes: ['production'],
    expiresAt: null,
    policyId: null,
  };
}
