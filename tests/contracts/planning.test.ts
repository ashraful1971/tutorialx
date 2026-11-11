import {
  approvalRecordSchema,
  batchManifestSchema,
  evidenceRecordSchema,
  inputReferenceSchema,
  jobBriefSchema,
  planRevisionSchema,
  profileSchema,
  researchReportSchema,
  settingsSchema,
  sourceManifestSchema,
  workspaceConfigSchema,
} from '@tutorialx/contracts';
import { describe, expect, it } from 'vitest';
import {
  digest,
  sampleApproval,
  sampleBrief,
  samplePlan,
  sampleSettings,
  timestamp,
} from '../fixtures/contracts.js';

describe('portable planning contracts', () => {
  it('round-trips a complete brief, plan, settings, and approval', () => {
    for (const [schema, value] of [
      [jobBriefSchema, sampleBrief()],
      [planRevisionSchema, samplePlan()],
      [settingsSchema, sampleSettings()],
      [approvalRecordSchema, sampleApproval()],
    ] as const) {
      expect(schema.parse(JSON.parse(JSON.stringify(value)))).toEqual(value);
    }
  });

  it('rejects unknown fields at both record and nested boundaries', () => {
    expect(
      jobBriefSchema.safeParse({ ...sampleBrief(), command: 'execute-anything' }).success,
    ).toBe(false);
    const settings = sampleSettings();
    expect(
      settingsSchema.safeParse({ ...settings, brand: { ...settings.brand, unknown: true } })
        .success,
    ).toBe(false);
  });

  it('rejects future schemas, invalid identities, and incomplete briefs', () => {
    expect(jobBriefSchema.safeParse({ ...sampleBrief(), schemaVersion: 2 }).success).toBe(false);
    expect(jobBriefSchema.safeParse({ ...sampleBrief(), id: '../escape' }).success).toBe(false);
    expect(jobBriefSchema.safeParse({ title: 'Only a title' }).success).toBe(false);
  });

  it('validates workspace and profile revisions without accepting arbitrary settings', () => {
    expect(
      workspaceConfigSchema.safeParse({
        schemaVersion: 1,
        id: 'workspace_example',
        createdAt: timestamp,
        revision: 1,
        contentRoot: 'tutorialx-videos',
        sourceRoots: ['.'],
        exclusions: ['.env*'],
        defaults: {},
        policyCeiling: sampleSettings().policy,
      }).success,
    ).toBe(true);
    expect(
      profileSchema.safeParse({
        schemaVersion: 1,
        id: 'product',
        createdAt: timestamp,
        revision: 1,
        kind: 'product',
        name: 'Example',
        settings: { invented: true },
        sourceIds: [],
        notes: '',
      }).success,
    ).toBe(false);
  });

  it('accepts supplied material types and rejects executable URL protocols', () => {
    expect(
      inputReferenceSchema.parse({ kind: 'codebase', path: '../plugin', copy: false }).kind,
    ).toBe('codebase');
    expect(inputReferenceSchema.safeParse({ kind: 'url', url: 'file:///etc/passwd' }).success).toBe(
      false,
    );
    expect(
      inputReferenceSchema.safeParse({ kind: 'url', url: 'javascript:alert(1)' }).success,
    ).toBe(false);
    expect(
      sourceManifestSchema.safeParse({
        schemaVersion: 1,
        id: 'source_example',
        createdAt: timestamp,
        jobId: 'job_example',
        input: { kind: 'text', text: 'Reference text' },
        contentHash: digest,
        sourceRevision: null,
        status: 'available',
        snapshotArtifactId: null,
        reason: null,
        attribution: { origin: 'user', license: null, requiredText: null, usage: 'permitted' },
      }).success,
    ).toBe(true);
  });

  it('requires ordered evidence ranges and revision-linked research', () => {
    expect(
      evidenceRecordSchema.safeParse({
        schemaVersion: 1,
        id: 'evidence',
        createdAt: timestamp,
        jobId: 'job_example',
        sourceId: 'source_example',
        sourceHash: digest,
        locator: { kind: 'lines', start: 20, end: 10 },
        claim: 'A setting exists.',
        extract: '',
        status: 'observed',
        artifactIds: [],
        limitations: [],
      }).success,
    ).toBe(false);
    expect(
      researchReportSchema.safeParse({
        schemaVersion: 1,
        id: 'research',
        createdAt: timestamp,
        jobId: 'job_example',
        basedOnRevision: 1,
        sourceIds: [],
        evidenceIds: [],
        summary: 'Research is incomplete.',
        blockers: ['Missing app access'],
      }).success,
    ).toBe(true);
  });

  it('rejects inconsistent caption modes and missing synthesis providers', () => {
    const settings = sampleSettings();
    expect(
      settingsSchema.safeParse({ ...settings, captions: { ...settings.captions, mode: 'none' } })
        .success,
    ).toBe(false);
    expect(
      settingsSchema.safeParse({
        ...settings,
        voice: { mode: 'synthesize', voiceId: 'voice', pace: 1, tone: '', pronunciations: {} },
      }).success,
    ).toBe(false);
  });

  it('rejects duplicate scene, variant, and batch item identities', () => {
    const plan = samplePlan();
    expect(
      planRevisionSchema.safeParse({ ...plan, scenes: [plan.scenes[0], plan.scenes[0]] }).success,
    ).toBe(false);
    const settings = sampleSettings();
    expect(
      settingsSchema.safeParse({
        ...settings,
        variants: [settings.variants[0], settings.variants[0]],
      }).success,
    ).toBe(false);
    const item = {
      id: 'topic',
      title: 'Topic',
      topic: 'A tutorial',
      instructions: '',
      sourceIds: [],
      overrides: {},
    };
    expect(
      batchManifestSchema.safeParse({
        schemaVersion: 1,
        id: 'batch',
        createdAt: timestamp,
        workspaceId: 'workspace_example',
        profiles: [],
        defaults: {},
        items: [item, item],
        budgetUsdMicros: 0,
        deadlineAt: null,
        concurrency: 1,
        failurePolicy: 'continue',
        duplicates: 'reject',
      }).success,
    ).toBe(false);
  });

  it('does not treat unscoped policy records as approval', () => {
    const approval = sampleApproval();
    expect(
      approvalRecordSchema.safeParse({ ...approval, actor: { ...approval.actor, kind: 'policy' } })
        .success,
    ).toBe(false);
    expect(approvalRecordSchema.safeParse({ ...approval, expiresAt: timestamp }).success).toBe(
      false,
    );
    expect(
      approvalRecordSchema.safeParse({ ...approval, expiresAt: '2026-11-11T10:00:00.100Z' })
        .success,
    ).toBe(true);
  });
});
