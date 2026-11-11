import type {
  JobMutation,
  JobRecord,
  JobRepository,
  JobRevisionRepository,
  ResearchRepository,
  ResourceCoordinator,
  StageAttempt,
  UsageReservation,
} from '@tutorialx/contracts';
import { describe, expect, it } from 'vitest';
import {
  digest,
  sampleApproval,
  sampleBrief,
  samplePlan,
  timestamp,
} from '../fixtures/contracts.js';

export interface RepositoryTestPorts {
  repository: JobRepository;
  research: ResearchRepository;
  revisions: JobRevisionRepository;
  coordinator: ResourceCoordinator;
}
export interface RepositoryConformanceFixture {
  primary: RepositoryTestPorts;
  connect(): Promise<RepositoryTestPorts>;
  setNow(value: string): void;
  close(): Promise<void>;
}

export function fixtureJob(id = 'job_example'): JobRecord {
  return {
    brief: { ...sampleBrief(), id },
    status: {
      jobId: id,
      revision: 1,
      lifecycle: 'queued',
      waitReason: null,
      delivery: null,
      completedStages: 0,
      totalStages: 3,
    },
  };
}
export function fixtureMutation(job: JobRecord): JobMutation {
  return {
    jobId: job.brief.id,
    expectedRevision: job.status.revision,
    job: { brief: job.brief, status: { ...job.status, revision: job.status.revision + 1 } },
    fence: null,
    attempts: [],
    artifacts: [],
    plans: [],
    approvals: [],
    operations: [],
    events: [],
    dispatch: [],
  };
}
export function fixtureAttempt(id = 'attempt_one', ordinal = 1): StageAttempt {
  return {
    schemaVersion: 1,
    id,
    createdAt: timestamp,
    jobId: 'job_example',
    jobRevision: 1,
    stageId: 'voice',
    stageKind: 'voice',
    attempt: ordinal,
    inputDigest: digest,
    status: 'running',
    lease: { workerId: 'worker', token: ordinal, expiresAt: '2026-11-11T11:00:00Z' },
    waitReason: null,
    startedAt: timestamp,
    finishedAt: null,
    outputArtifactIds: [],
    diagnostic: null,
  };
}

/** Shared semantic suite. Fixtures supply independent connections, not simulated persistence. */
export function repositoryConformance(
  name: string,
  create: () => Promise<RepositoryConformanceFixture>,
) {
  const withFixture = async (run: (fixture: RepositoryConformanceFixture) => Promise<void>) => {
    const fixture = await create();
    try {
      await run(fixture);
    } finally {
      await fixture.close();
    }
  };
  describe(`${name} repository conformance`, () => {
    it('persists jobs/revisions and returns bounded deterministic cursor pages across connections', async () => {
      await withFixture(async ({ primary, connect }) => {
        await primary.repository.create(fixtureJob('job_a'));
        await primary.repository.create(fixtureJob('job_b'));
        const first = await primary.repository.list(null, 1);
        expect(first.jobs.map((job) => job.brief.id)).toEqual(['job_a']);
        expect(first.nextCursor).not.toBeNull();
        const second = await connect();
        const page = await second.repository.list(first.nextCursor, 1);
        expect(page.jobs.map((job) => job.brief.id)).toEqual(['job_b']);
        expect(page.nextCursor).toBeNull();
        await primary.repository.commit(fixtureMutation(first.jobs[0]!));
        expect((await second.repository.read('job_a'))?.status.revision).toBe(2);
        expect(
          (await second.revisions.revisions('job_a')).map((job) => job.status.revision),
        ).toEqual([1, 2]);
        await expect(primary.repository.list('invalid_cursor', 101)).rejects.toThrow();
      });
    });

    it('allows exactly one competing expected-revision transaction', async () => {
      await withFixture(async ({ primary, connect }) => {
        await primary.repository.create(fixtureJob());
        const other = await connect();
        const mutation = fixtureMutation(fixtureJob());
        const results = await Promise.allSettled([
          primary.repository.commit(mutation),
          other.repository.commit(mutation),
        ]);
        expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
        const failed = results.find((result) => result.status === 'rejected');
        if (failed?.status === 'rejected')
          expect(failed.reason).toMatchObject({ code: 'REVISION_CONFLICT' });
        expect((await other.repository.read('job_example'))?.status.revision).toBe(2);
        expect(await other.revisions.revisions('job_example')).toHaveLength(2);
      });
    });

    it('commits plans, approvals, research, operation receipts, events, and dispatch atomically', async () => {
      await withFixture(async ({ primary, connect }) => {
        const job = fixtureJob();
        await primary.repository.create(job);
        const mutation = fixtureMutation(job);
        mutation.plans = [samplePlan()];
        mutation.approvals = [sampleApproval()];
        mutation.attempts = [
          { ...fixtureAttempt(), status: 'pending', lease: null, startedAt: null },
        ];
        mutation.operations = [
          {
            schemaVersion: 1,
            id: 'operation',
            createdAt: timestamp,
            jobId: job.brief.id,
            attemptId: 'attempt_one',
            idempotencyKey: digest,
            providerId: 'voice',
            providerRequestId: null,
            sideEffect: 'uncertain',
            status: 'reserved',
            reservedUsdMicros: 5,
            actualUsdMicros: null,
            diagnostic: null,
          },
        ];
        mutation.events = [
          {
            schemaVersion: 1,
            id: 'event_one',
            createdAt: timestamp,
            workspaceId: job.brief.workspaceId,
            jobId: job.brief.id,
            attemptId: null,
            cursor: 1,
            requestId: 'request',
            traceId: 'trace',
            kind: 'planned',
            level: 'info',
            data: {},
          },
        ];
        mutation.dispatch = [
          {
            id: 'dispatch',
            jobId: job.brief.id,
            stageId: 'voice',
            expectedRevision: 2,
            capabilityRequirements: ['voice'],
            availableAt: timestamp,
          },
        ];
        const source = {
          schemaVersion: 1 as const,
          id: 'source',
          createdAt: timestamp,
          jobId: job.brief.id,
          input: { kind: 'text' as const, text: 'Fixture claim' },
          contentHash: digest,
          sourceRevision: null,
          status: 'available' as const,
          snapshotArtifactId: null,
          reason: null,
          attribution: {
            origin: 'Authored fixture',
            license: null,
            requiredText: null,
            usage: 'permitted' as const,
          },
        };
        const evidence = {
          schemaVersion: 1 as const,
          id: 'evidence',
          createdAt: timestamp,
          jobId: job.brief.id,
          sourceId: source.id,
          sourceHash: digest,
          locator: { kind: 'whole' as const },
          claim: 'Fixture claim',
          extract: 'Fixture claim',
          status: 'supplied' as const,
          artifactIds: [],
          limitations: [],
        };
        await primary.research.commitResearch(mutation, {
          sources: [source],
          evidence: [evidence],
        });
        const other = await connect();
        expect(await other.repository.plans(job.brief.id)).toHaveLength(1);
        expect(await other.repository.approvals(job.brief.id)).toHaveLength(1);
        expect(await other.repository.operations(job.brief.id)).toHaveLength(1);
        expect(await other.research.sources(job.brief.id)).toEqual([source]);
        expect(await other.research.evidence(job.brief.id)).toEqual([evidence]);
        const events = await other.repository.events(job.brief.id, 0, 1);
        expect(events).toHaveLength(1);
        const next = fixtureMutation((await other.repository.read(job.brief.id))!);
        next.events = [{ ...mutation.events[0]!, id: 'event_two' }];
        await other.repository.commit(next);
        expect(
          (await primary.repository.events(job.brief.id, events[0]!.cursor, 10)).map(
            (event) => event.id,
          ),
        ).toEqual(['event_two']);
        expect(await other.repository.pendingDispatch(10)).toEqual(mutation.dispatch);
        await other.repository.markDispatched('dispatch');
        expect(await primary.repository.pendingDispatch(10)).toEqual([]);
      });
    });

    it('rolls back all writes when a later metadata record conflicts', async () => {
      await withFixture(async ({ primary }) => {
        const job = fixtureJob();
        await primary.repository.create(job);
        const first = fixtureMutation(job);
        first.plans = [samplePlan()];
        await primary.repository.commit(first);
        const next = fixtureMutation((await primary.repository.read(job.brief.id))!);
        next.attempts = [fixtureAttempt()];
        next.plans = [{ ...samplePlan(), limitations: ['Conflicting immutable revision'] }];
        await expect(primary.repository.commit(next)).rejects.toMatchObject({
          code: 'REVISION_CONFLICT',
        });
        expect(await primary.repository.attempts(job.brief.id)).toEqual([]);
        expect((await primary.repository.read(job.brief.id))?.status.revision).toBe(2);
        expect(await primary.revisions.revisions(job.brief.id)).toHaveLength(2);
      });
    });

    it('rejects missing, expired, and superseded attempt fences', async () => {
      await withFixture(async ({ primary, setNow }) => {
        const job = fixtureJob();
        await primary.repository.create(job);
        const first = fixtureMutation(job);
        first.attempts = [fixtureAttempt()];
        await primary.repository.commit(first);
        const completion = fixtureMutation((await primary.repository.read(job.brief.id))!);
        completion.attempts = [
          { ...fixtureAttempt(), status: 'succeeded', lease: null, finishedAt: timestamp },
        ];
        await expect(primary.repository.commit(completion)).rejects.toMatchObject({
          code: 'REVISION_CONFLICT',
        });
        completion.fence = { attemptId: 'attempt_one', token: 1 };
        setNow('2026-11-11T12:00:00Z');
        await expect(primary.repository.commit(completion)).rejects.toMatchObject({
          code: 'REVISION_CONFLICT',
        });
        setNow(timestamp);
        const supersede = fixtureMutation((await primary.repository.read(job.brief.id))!);
        supersede.attempts = [fixtureAttempt('attempt_two', 2)];
        await primary.repository.commit(supersede);
        completion.expectedRevision = 3;
        completion.job.status.revision = 4;
        await expect(primary.repository.commit(completion)).rejects.toMatchObject({
          code: 'REVISION_CONFLICT',
        });
      });
    });

    it('accepts active fenced completion and stores immutable artifact metadata with cursor access', async () => {
      await withFixture(async ({ primary, connect }) => {
        const job = fixtureJob();
        await primary.repository.create(job);
        const first = fixtureMutation(job);
        first.attempts = [fixtureAttempt()];
        await primary.repository.commit(first);
        const complete = fixtureMutation((await primary.repository.read(job.brief.id))!);
        complete.fence = { attemptId: 'attempt_one', token: 1 };
        complete.attempts = [
          {
            ...fixtureAttempt(),
            status: 'succeeded',
            lease: null,
            finishedAt: timestamp,
            outputArtifactIds: ['artifact_a', 'artifact_b'],
          },
        ];
        complete.artifacts = ['artifact_a', 'artifact_b'].map((id) => ({
          schemaVersion: 1,
          id,
          createdAt: timestamp,
          workspaceId: job.brief.workspaceId,
          jobId: job.brief.id,
          kind: 'json',
          mimeType: 'application/json',
          storage: { kind: 'local', path: `${id}.json` },
          digest,
          sizeBytes: 2,
          media: null,
          provenance: {
            stageId: 'voice',
            attemptId: 'attempt_one',
            inputDigests: [digest],
            provider: null,
            settingsDigest: digest,
            templateDigest: null,
          },
        }));
        await primary.repository.commit(complete);
        const other = await connect();
        const page = await other.repository.artifacts(job.brief.id, null, 1);
        expect(page.artifacts[0]?.id).toBe('artifact_a');
        expect(
          (await other.repository.artifacts(job.brief.id, page.nextCursor, 1)).artifacts[0]?.id,
        ).toBe('artifact_b');
        expect((await other.repository.attempts(job.brief.id))[0]?.status).toBe('succeeded');
      });
    });

    it('reserves shared job/batch budgets atomically and retains uncertain usage', async () => {
      await withFixture(async ({ primary, connect }) => {
        const other = await connect();
        const value: UsageReservation = {
          id: 'reserve_one',
          operationId: 'op_one',
          scopes: [
            { id: 'job_budget', kind: 'job', limitUsdMicros: 10 },
            { id: 'batch_budget', kind: 'batch', limitUsdMicros: 10 },
          ],
          reservedUsdMicros: 6,
          actualUsdMicros: null,
          state: 'reserved',
        };
        const competing = { ...value, id: 'reserve_two', operationId: 'op_two' };
        const results = await Promise.allSettled([
          primary.coordinator.reserveUsage(value),
          other.coordinator.reserveUsage(competing),
        ]);
        expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
        expect(await other.coordinator.usage('batch_budget')).toEqual({
          reservedUsdMicros: 6,
          actualUsdMicros: 0,
        });
        const winner = results[0]!.status === 'fulfilled' ? value : competing;
        const loser = results[0]!.status === 'fulfilled' ? competing : value;
        await primary.coordinator.markUsageUncertain(winner.id);
        await expect(other.coordinator.releaseUsage(winner.id)).rejects.toThrow();
        await other.coordinator.settleUsage(winner.id, 4);
        await primary.coordinator.reserveUsage(winner); // Replay must not allocate a second charge.
        expect(await primary.coordinator.usage('job_budget')).toEqual({
          reservedUsdMicros: 0,
          actualUsdMicros: 4,
        });
        await other.coordinator.reserveUsage(loser);
        expect(await primary.coordinator.usage('batch_budget')).toEqual({
          reservedUsdMicros: 6,
          actualUsdMicros: 4,
        });
        await primary.coordinator.releaseUsage(loser.id);
        expect(await other.coordinator.usage('job_budget')).toEqual({
          reservedUsdMicros: 0,
          actualUsdMicros: 4,
        });
      });
    });

    it('records actual overrun truthfully and blocks new spending', async () => {
      await withFixture(async ({ primary }) => {
        const value: UsageReservation = {
          id: 'reserve',
          operationId: 'operation',
          scopes: [{ id: 'budget', kind: 'job', limitUsdMicros: 10 }],
          reservedUsdMicros: 6,
          actualUsdMicros: null,
          state: 'reserved',
        };
        await primary.coordinator.reserveUsage(value);
        await primary.coordinator.settleUsage(value.id, 12);
        expect(await primary.coordinator.usage('budget')).toEqual({
          reservedUsdMicros: 0,
          actualUsdMicros: 12,
        });
        await expect(
          primary.coordinator.reserveUsage({
            ...value,
            id: 'extra',
            operationId: 'extra_op',
            reservedUsdMicros: 1,
          }),
        ).rejects.toThrow();
        await expect(primary.coordinator.releaseUsage(value.id)).rejects.toThrow();
      });
    });

    it('shares renewable resource leases and never reuses a released/expired fence token', async () => {
      await withFixture(async ({ primary, connect, setNow }) => {
        const other = await connect();
        const lease = (await primary.coordinator.acquireResource(
          'fixture',
          'worker_one',
          '2026-11-11T11:00:00Z',
        ))!;
        expect(
          await other.coordinator.acquireResource('fixture', 'worker_two', '2026-11-11T11:00:00Z'),
        ).toBeNull();
        expect(
          await primary.coordinator.acquireResource(
            'fixture',
            'worker_one',
            '2026-11-11T11:00:00Z',
          ),
        ).toEqual(lease);
        const renewed = await other.coordinator.renewResource(lease, '2026-11-11T12:00:00Z');
        await expect(primary.coordinator.releaseResource(lease)).rejects.toMatchObject({
          code: 'REVISION_CONFLICT',
        });
        await other.coordinator.releaseResource(renewed);
        await other.coordinator.releaseResource(renewed);
        const next = (await primary.coordinator.acquireResource(
          'fixture',
          'worker_two',
          '2026-11-11T11:00:00Z',
        ))!;
        expect(next.token).toBeGreaterThan(lease.token);
        setNow('2026-11-11T12:00:00Z');
        const takeover = (await other.coordinator.acquireResource(
          'fixture',
          'worker_three',
          '2026-11-11T13:00:00Z',
        ))!;
        expect(takeover.token).toBeGreaterThan(next.token);
        await expect(
          primary.coordinator.renewResource(next, '2026-11-11T14:00:00Z'),
        ).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
      });
    });
  });
}
