import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import {
  type ActionResponse,
  evidenceRecordSchema,
  FOUNDATION_ACTION_SCHEMAS,
  type JsonObject,
  planRevisionSchema,
} from '@tutorialx/contracts';
import { describe, expect, it } from 'vitest';
import { bundledSkillPackage } from '../../packages/cli/dist/bundled-skill.js';
import { type ActionAuthority, createActionService } from '../../packages/cli/src/index.js';
import { SKILL_FILES } from '../../scripts/skill-files.mjs';
import {
  bundleSkill,
  checkSkillReference,
  generatedSkillReference,
} from '../../scripts/skill-reference.mjs';
import { samplePlan } from '../fixtures/contracts.js';

function data(response: ActionResponse): JsonObject {
  if (response.status !== 'ok') throw new Error(JSON.stringify(response));
  return response.data;
}
const json = (value: unknown): JsonObject => JSON.parse(JSON.stringify(value)) as JsonObject;
const key = (value: string) => createHash('sha256').update(value).digest('hex');

describe('bundled progressive skill', () => {
  it('ships a schema-generated action reference and the complete installable role bundle', async () => {
    await checkSkillReference();
    expect(await readFile(resolve('skills/tutorialx/references/actions.md'), 'utf8')).toBe(
      generatedSkillReference(),
    );
    await bundleSkill();
    const bundled = bundledSkillPackage();
    for (const name of SKILL_FILES)
      expect(await readFile(resolve(bundled.directory, name), 'utf8')).toBe(
        await readFile(resolve('skills/tutorialx', name), 'utf8'),
      );
    const packageJson = JSON.parse(await readFile(resolve('packages/cli/package.json'), 'utf8'));
    expect(bundled.version).toBe(packageJson.version);
  });

  it('hands off research to writing to independent review through persisted public actions and stops at operator approval', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'tutorialx-agent-handoff-'));
    const trace: string[] = [];
    let sequence = 0;
    const operator: ActionAuthority = {
      actorId: 'operator',
      principalRole: 'operator',
      actions: ['*'],
      roles: ['researcher', 'writer-director', 'reviewer', 'repair'],
    };
    const call = async (
      authority: ActionAuthority,
      action: string,
      params: JsonObject = {},
      revision: number | null = null,
      mutation?: string,
    ) => {
      expect(action in FOUNDATION_ACTION_SCHEMAS).toBe(true);
      trace.push(action);
      // Fresh composition for each request demonstrates that accepted handoffs outlive a chat/session.
      return createActionService({ projectDirectory: root, authority }).execute({
        apiVersion: 1,
        requestId: `request_${sequence++}`,
        action,
        params,
        expectedRevision: revision,
        idempotencyKey: mutation ? key(mutation) : null,
      });
    };
    try {
      data(await call(operator, 'workspace.init'));
      const created = data(
        await call(
          operator,
          'job.create',
          {
            title: 'Explain source registration',
            topic: 'Describe the supplied product fact',
            audience: 'New users',
          },
          null,
          'create',
        ),
      );
      const jobId = String(created.jobId);
      const source = data(
        await call(
          operator,
          'source.create',
          {
            jobId,
            source: {
              input: {
                kind: 'text',
                text: 'TutorialX retains accepted research across agent handoffs.',
              },
              attribution: {
                origin: 'fixture',
                license: 'CC0-1.0',
                requiredText: null,
                usage: 'permitted',
              },
            },
          },
          1,
          'source',
        ),
      ).source as JsonObject;
      const researcher: ActionAuthority = {
        actorId: 'researcher',
        principalRole: 'creative',
        jobIds: [jobId],
        actions: ['schema', 'job.context', 'source.inspect', 'job.submit'],
        roles: ['researcher'],
      };
      const researchContext = data(
        await call(researcher, 'job.context', { jobId, role: 'researcher' }),
      );
      expect(researchContext.sourceContentAuthority).toBe('data-only');
      expect(researchContext.jobRevision).toBe(2);
      data(await call(researcher, 'schema', { name: 'job.submit' }));
      const evidence = evidenceRecordSchema.parse({
        schemaVersion: 1,
        id: 'evidence_handoff',
        createdAt: '2026-11-12T00:00:00Z',
        jobId,
        sourceId: source.id,
        sourceHash: source.contentHash,
        locator: { kind: 'whole' },
        claim: 'Accepted research survives handoffs.',
        extract: 'TutorialX retains accepted research across agent handoffs.',
        status: 'supplied',
        artifactIds: [],
        limitations: ['Supplied documentation claim, not a live capture.'],
      });
      const research = data(
        await call(
          researcher,
          'job.submit',
          json({
            jobId,
            kind: 'research',
            evidence: [evidence],
            report: {
              schemaVersion: 1,
              id: 'research_handoff',
              createdAt: '2026-11-12T00:00:00Z',
              jobId,
              basedOnRevision: 2,
              sourceIds: [source.id],
              evidenceIds: [evidence.id],
              summary: 'Research survives agent handoffs.',
              blockers: [],
            },
          }),
          2,
          'research',
        ),
      );
      const writer: ActionAuthority = {
        actorId: 'writer',
        principalRole: 'creative',
        jobIds: [jobId],
        actions: [
          'schema',
          'job.context',
          'job.submission',
          'job.submit',
          'plan.show',
          'plan.approve',
        ],
        roles: ['writer-director'],
      };
      const context = data(await call(writer, 'job.context', { jobId, role: 'writer-director' }));
      const saved = data(
        await call(writer, 'job.submission', { jobId, submissionId: research.submissionId! }),
      );
      expect((saved.payload as JsonObject).kind).toBe('research');
      const plan = planRevisionSchema.parse({
        ...samplePlan(),
        id: 'plan_handoff',
        jobId,
        basedOnJobRevision: 3,
        researchReportId: 'research_handoff',
        evidenceDigest: context.evidenceDigest,
        effective: context.effective,
        scenes: [
          {
            id: 'scene_handoff',
            title: 'Durable handoff',
            narration: evidence.claim,
            intent: 'Explain the supplied product fact',
            evidenceIds: [evidence.id],
            visual: { kind: 'text', headline: 'Durable research', body: evidence.claim },
            estimatedDurationUs: 5_000_000,
            transition: 'cut',
            variantFraming: {},
          },
        ],
      });
      const submitted = data(
        await call(writer, 'job.submit', json({ jobId, kind: 'plan', plan }), 3, 'plan'),
      );
      expect(submitted.authorizesProduction).toBe(false);
      const shown = data(await call(writer, 'plan.show', { jobId }));
      expect(shown.plan).toBeDefined();
      // Granting an action name does not grant an operator principal's approval authority.
      const forged = await call(
        writer,
        'plan.approve',
        { jobId, planRevision: 1, decision: 'approve' },
        4,
        'self-approval',
      );
      expect(forged.status === 'error' && forged.error.code).toBe('POLICY_DENIED');
      const reviewer: ActionAuthority = {
        actorId: 'independent_reviewer',
        principalRole: 'creative',
        jobIds: [jobId],
        actions: ['job.context', 'job.inspect', 'artifact.list', 'job.submission'],
        roles: ['reviewer'],
      };
      const review = data(await call(reviewer, 'job.context', { jobId, role: 'reviewer' }));
      expect(review.outputSchemaId).toContain('ReviewResult');
      expect(review.approvedRevision).toBeNull();
      const inspected = data(await call(reviewer, 'job.inspect', { jobId }));
      expect((inspected.status as JsonObject).waitReason).toBe('approval');
      expect((inspected.status as JsonObject).delivery).toBeNull();
      const artifacts = data(await call(reviewer, 'artifact.list', { jobId }));
      expect(artifacts.items).toEqual([]);
      const production = await call(operator, 'job.run', { jobId }, 4, 'run');
      expect(production.status === 'waiting' && production.code).toBe('NEEDS_APPROVAL');
      expect(
        production.nextActions.some(
          (action) => action.action === 'plan.approve' && action.needsOperator,
        ),
      ).toBe(true);
      expect(trace).toContain('job.submission');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
