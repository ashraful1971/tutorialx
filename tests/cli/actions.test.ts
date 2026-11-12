import { createHash } from 'node:crypto';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import {
  type ActionResponse,
  actionResponseSchema,
  canonicalJson,
  type JsonObject,
} from '@tutorialx/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createActionService,
  MAX_RESPONSE_BYTES,
  runCommand,
} from '../../packages/cli/src/index.js';

const roots: string[] = [];
const key = (name: string) => createHash('sha256').update(name).digest('hex');
const asData = (response: ActionResponse): JsonObject => {
  expect(response.status).toBe('ok');
  if (response.status !== 'ok') throw new Error(JSON.stringify(response));
  return response.data;
};
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function setup(contentRoot?: string) {
  const directory = await mkdtemp(resolve(tmpdir(), 'tutorialx-cli-'));
  roots.push(directory);
  const service = () =>
    createActionService({
      projectDirectory: directory,
      authority: {
        actorId: 'test_operator',
        actions: ['*'],
        roles: ['researcher', 'writer-director', 'reviewer', 'repair'],
        principalRole: 'operator',
      },
    });
  let request = 0;
  const call = (
    action: string,
    params: JsonObject = {},
    revision: number | null = null,
    identity: string | null = null,
  ) =>
    service().execute({
      apiVersion: 1,
      requestId: `request_${request++}`,
      action,
      params,
      expectedRevision: revision,
      idempotencyKey: identity ? key(identity) : null,
    });
  asData(await call('workspace.init', contentRoot ? { contentRoot } : {}));
  const created = asData(
    await call(
      'job.create',
      { title: 'Example', topic: 'A test topic', audience: 'Beginners' },
      null,
      'create',
    ),
  );
  return { directory, call, jobId: String(created.jobId), service };
}

describe('foundation action service', () => {
  it('persists jobs and safe sources across new service instances and replays stable keys', async () => {
    const { call, jobId } = await setup();
    const input = {
      jobId,
      source: {
        input: { kind: 'text', text: 'TutorialX creates video plans.' },
        attribution: { origin: 'operator', license: null, requiredText: null, usage: 'permitted' },
      },
    };
    const registered = asData(await call('source.create', input, 1, 'source'));
    expect(registered.revision).toBe(2);
    const replay = asData(await call('source.create', input, 1, 'source'));
    expect(replay.replayed).toBe(true);
    expect(asData(await call('source.list', { jobId })).items).toHaveLength(1);
    const inspected = asData(await call('job.inspect', { jobId }));
    expect((inspected.status as JsonObject).revision).toBe(2);
    expect(
      asData(
        await call(
          'job.create',
          { title: 'Example', topic: 'A test topic', audience: 'Beginners' },
          null,
          'create',
        ),
      ).replayed,
    ).toBe(true);
    expect(
      (
        await call(
          'job.create',
          { title: 'Different', topic: 'A test topic', audience: 'Beginners' },
          null,
          'create',
        )
      ).status,
    ).toBe('error');
  });

  it('validates, persists, reloads and rejects stale or self-authorizing planning submissions', async () => {
    const { call, jobId, directory } = await setup();
    const source = asData(
      await call(
        'source.create',
        {
          jobId,
          source: {
            input: { kind: 'text', text: 'This is a supplied claim.' },
            attribution: {
              origin: 'fixture',
              license: null,
              requiredText: null,
              usage: 'permitted',
            },
          },
        },
        1,
        'source',
      ),
    ).source as JsonObject;
    const evidence = {
      schemaVersion: 1,
      id: 'evidence_one',
      createdAt: new Date().toISOString(),
      jobId,
      sourceId: source.id!,
      sourceHash: source.contentHash!,
      locator: { kind: 'whole' },
      claim: 'A supplied claim',
      extract: 'This is a supplied claim.',
      status: 'supplied',
      artifactIds: [],
      limitations: [],
    };
    const report = {
      schemaVersion: 1,
      id: 'report_one',
      createdAt: new Date().toISOString(),
      jobId,
      basedOnRevision: 2,
      sourceIds: [source.id!],
      evidenceIds: ['evidence_one'],
      summary: 'A supplied claim.',
      blockers: [],
    };
    const research = { jobId, kind: 'research', report, evidence: [evidence] };
    const accepted = asData(await call('job.submit', research, 2, 'research'));
    expect(accepted.revision).toBe(3);
    expect(asData(await call('job.submit', research, 2, 'research')).replayed).toBe(true);
    const saved = asData(
      await call('job.submission', { jobId, submissionId: accepted.submissionId! }),
    );
    expect(saved.payload).toEqual(research);
    const context = asData(await call('job.context', { jobId, role: 'writer-director' }));
    const plan = {
      schemaVersion: 1,
      id: 'plan_one',
      createdAt: new Date().toISOString(),
      jobId,
      revision: 1,
      basedOnJobRevision: 3,
      researchReportId: 'report_one',
      evidenceDigest: createHash('sha256')
        .update(canonicalJson({ evidence: [evidence] }))
        .digest('hex'),
      effective: context.effective!,
      scenes: [
        {
          id: 'scene_one',
          title: 'Intro',
          narration: 'A supplied claim.',
          intent: 'Explain the supplied claim',
          evidenceIds: ['evidence_one'],
          visual: { kind: 'text', headline: 'Claim', body: 'A supplied claim.' },
          estimatedDurationUs: 5_000_000,
          transition: 'cut',
          variantFraming: {},
        },
      ],
      costEstimate: { expectedUsdMicros: 0, upperBoundUsdMicros: 0, uncertainty: [] },
      limitations: [],
    };
    const stale = await call('job.submit', { jobId, kind: 'plan', plan }, 2, 'stale');
    expect(stale.status === 'error' && stale.error.code).toBe('REVISION_CONFLICT');
    const submitted = asData(await call('job.submit', { jobId, kind: 'plan', plan }, 3, 'plan'));
    expect(submitted.authorizesProduction).toBe(false);
    const inspected = asData(await call('job.inspect', { jobId }));
    expect((inspected.status as JsonObject).waitReason).toBe('approval');
    const selfAuthorized = await call(
      'job.submit',
      { jobId, kind: 'plan', plan, actor: { kind: 'human', id: 'operator' }, approved: true },
      4,
      'unsafe',
    );
    expect(selfAuthorized.status === 'error' && selfAuthorized.error.code).toBe('INVALID_INPUT');
    const external = createActionService({
      projectDirectory: directory,
      authority: {
        actorId: 'writer',
        actions: ['job.submit'],
        roles: ['writer-director'],
        jobIds: [jobId],
      },
    });
    const denied = await external.execute({
      apiVersion: 1,
      requestId: 'restricted',
      action: 'job.submit',
      params: research,
      expectedRevision: 4,
      idempotencyKey: key('external'),
    });
    expect(denied.status === 'error' && denied.error.code).toBe('POLICY_DENIED');
    const staleApproval = await call(
      'plan.approve',
      { jobId, planRevision: 2, decision: 'approve' },
      4,
      'stale-approval',
    );
    expect(staleApproval.status === 'error' && staleApproval.error.code).toBe('REVISION_CONFLICT');
    const creative = createActionService({
      projectDirectory: directory,
      authority: {
        actorId: 'writer',
        actions: ['*'],
        roles: ['writer-director'],
        principalRole: 'creative',
      },
    });
    const unauthorized = await creative.execute({
      apiVersion: 1,
      requestId: 'creative_approval',
      action: 'plan.approve',
      params: { jobId, planRevision: 1, decision: 'approve' },
      expectedRevision: 4,
      idempotencyKey: key('creative-approval'),
    });
    expect(unauthorized.status === 'error' && unauthorized.error.code).toBe('POLICY_DENIED');
    expect(
      asData(
        await call('plan.approve', { jobId, planRevision: 1, decision: 'approve' }, 4, 'approval'),
      ).revision,
    ).toBe(5);
    const run = await call('job.run', { jobId }, 5, 'run');
    expect(run.status).toBe('accepted');
    expect(run.status === 'accepted' && run.data.completed).toBe(false);
    expect(asData(await call('job.pause', { jobId }, 6, 'pause')).lifecycle).toBe('paused');
    expect((await call('job.resume', { jobId }, 7, 'resume')).status).toBe('accepted');
    expect(asData(await call('job.cancel', { jobId }, 8, 'cancel')).lifecycle).toBe('cancelled');
    expect((await call('job.resume', { jobId }, 9, 'resume-cancelled')).status).toBe('accepted');
    expect((await call('job.check', { jobId }, 10, 'check')).status).toBe('accepted');
    expect((await call('job.export', { jobId }, 11, 'export')).status).toBe('accepted');
    expect(asData(await call('plan.show', { jobId })).plan).toMatchObject({ revision: 1 });
    const revision = {
      ...plan,
      id: 'plan_two',
      revision: 2,
      basedOnJobRevision: 12,
      scenes: [{ ...plan.scenes[0]!, narration: 'Revised supplied claim.' }],
    };
    expect(
      asData(await call('plan.revise', { jobId, plan: revision }, 12, 'revise')).revision,
    ).toBe(13);
    expect(
      asData(await call('plan.diff', { jobId, beforeRevision: 1, afterRevision: 2 })).material,
    ).toBe(true);
    const needsApproval = await call('job.run', { jobId }, 13, 'stale-run');
    expect(needsApproval.status === 'waiting' && needsApproval.code).toBe('NEEDS_APPROVAL');
  });

  it('supports an external content root and rejects redirected or excluded source access', async () => {
    const externalRoot = await mkdtemp(resolve(tmpdir(), 'tutorialx-content-'));
    roots.push(externalRoot);
    const { call, directory, jobId } = await setup(externalRoot);
    await writeFile(resolve(directory, '.env'), 'SECRET_TEST_VALUE');
    await symlink(resolve(directory, '.env'), resolve(directory, 'alias.txt'));
    for (const path of ['.env', 'alias.txt']) {
      const response = await call(
        'source.create',
        {
          jobId,
          source: {
            input: { kind: 'file', path, copy: false },
            attribution: { origin: 'fixture', license: null, requiredText: null, usage: 'unknown' },
          },
        },
        1,
        path,
      );
      expect(response.status === 'error' && response.error.code).toBe('POLICY_DENIED');
      expect(JSON.stringify(response)).not.toContain('SECRET_TEST_VALUE');
    }
    expect((asData(await call('job.list')).items as unknown[]).length).toBe(1);
  });

  it('returns bounded discovery and actionable missing-input results without prompting', async () => {
    const { call } = await setup();
    const response = await call('job.create');
    expect(response.status === 'waiting' && response.code).toBe('NEEDS_INPUT');
    expect(response.nextActions[0]?.action).toBe('schema');
    for (const action of ['capabilities', 'schema']) {
      const response = await call(action, action === 'schema' ? { name: 'job.submit' } : {});
      expect(actionResponseSchema.safeParse(response).success).toBe(true);
      expect(Buffer.byteLength(JSON.stringify(response))).toBeLessThan(MAX_RESPONSE_BYTES);
    }
  });

  it('keeps JSON stdout parseable for success, invalid JSON and human mode', async () => {
    const { directory } = await setup();
    const run = async (argv: string[], input = '') => {
      let stdout = '';
      let stderr = '';
      const exitCode = await runCommand(
        argv,
        {
          stdout: (text) => {
            stdout += text;
          },
          stderr: (text) => {
            stderr += text;
          },
          stdin: (async function* () {
            yield input;
          })(),
        },
        directory,
      );
      return { stdout, stderr, exitCode };
    };
    const good = await run(['job', 'list', '--json']);
    expect(good.exitCode).toBe(0);
    expect(actionResponseSchema.safeParse(JSON.parse(good.stdout)).success).toBe(true);
    expect(good.stderr).toBe('');
    const invalid = await run(['action', '--input', '-', '--json'], '{invalid');
    expect(invalid.exitCode).toBe(2);
    expect(JSON.parse(invalid.stdout).error.code).toBe('INVALID_INPUT');
    expect((await run(['capabilities'])).stdout).toContain('OK');
  });
});
