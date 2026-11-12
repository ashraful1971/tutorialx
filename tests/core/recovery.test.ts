import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSqlitePersistence } from '@tutorialx/adapters';
import type { JobRecord, OperationReceipt, StageAttempt } from '@tutorialx/contracts';
import { inspectJobRecovery, releaseInterruptedAttempt } from '@tutorialx/core';
import { afterEach, describe, expect, it } from 'vitest';
import { digest, sampleBrief, timestamp } from '../fixtures/contracts.js';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});
const expiry = '2026-11-11T10:01:00Z';
const afterExpiry = '2026-11-11T10:02:00Z';
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'tutorialx-recovery-'));
  let now = timestamp;
  const options = {
    filename: join(directory, 'state.sqlite'),
    workspaceId: 'workspace_example',
    now: () => now,
  };
  let store = await createSqlitePersistence(options);
  cleanup.push(async () => {
    await store.repository.close();
    await rm(directory, { recursive: true, force: true });
  });
  await store.repository.initialize();
  const job: JobRecord = {
    brief: sampleBrief(),
    status: {
      jobId: 'job_example',
      revision: 1,
      lifecycle: 'running',
      waitReason: null,
      delivery: null,
      completedStages: 0,
      totalStages: 1,
    },
  };
  await store.repository.create(job);
  const attempt: StageAttempt = {
    schemaVersion: 1,
    id: 'attempt_interrupted',
    createdAt: timestamp,
    jobId: job.brief.id,
    jobRevision: 1,
    stageId: 'voice',
    stageKind: 'voice',
    attempt: 1,
    inputDigest: digest,
    status: 'running',
    lease: { workerId: 'worker_original', token: 1, expiresAt: expiry },
    waitReason: null,
    startedAt: timestamp,
    finishedAt: null,
    outputArtifactIds: [],
    diagnostic: null,
  };
  await store.repository.commit({
    jobId: job.brief.id,
    expectedRevision: 1,
    job: { ...job, status: { ...job.status, revision: 2 } },
    fence: null,
    attempts: [attempt],
    artifacts: [],
    plans: [],
    approvals: [],
    operations: [],
    events: [],
    dispatch: [],
  });
  return {
    get store() {
      return store;
    },
    attempt,
    now: () => now,
    advance() {
      now = afterExpiry;
    },
    async reopen() {
      await store.repository.close();
      store = await createSqlitePersistence(options);
      await store.repository.initialize();
    },
    input() {
      return {
        repository: store.repository,
        operations: store.operations,
        jobId: job.brief.id,
        attemptId: attempt.id,
        expectedRevision: 2,
        now: () => now,
      };
    },
  };
}

function receipt(attempt: StageAttempt): OperationReceipt {
  return {
    schemaVersion: 1,
    id: 'operation_speech',
    createdAt: timestamp,
    jobId: attempt.jobId,
    jobRevision: 2,
    attemptId: attempt.id,
    leaseToken: 1,
    operationKey: digest,
    providerId: 'speech_fixture',
    sideEffect: 'uncertain',
    state: 'reserved',
    sequence: 1,
    version: 1,
    reservationId: 'reservation_speech',
    reservedUsdMicros: 10,
    actualUsdMicros: null,
    providerRequestId: null,
    submittedAt: null,
    diagnostic: null,
    retryPolicy: {
      maxAttempts: 2,
      baseDelayMs: 10,
      maxDelayMs: 100,
      deadlineAt: '2026-11-11T11:00:00Z',
    },
    nextAttemptAt: null,
    cancelRequestedAt: null,
    updatedAt: timestamp,
  };
}

describe('public local recovery', () => {
  it('inspects a reopened interrupted job and releases it without dispatch or accepting outputs', async () => {
    const f = await fixture();
    f.advance();
    await f.reopen();
    const report = await inspectJobRecovery({
      ...f.input(),
      attempts: { cursor: null, limit: 1 },
      receipts: { cursor: null, limit: 1 },
    });
    expect(report.attempts.items[0]).toMatchObject({ state: 'interrupted', id: f.attempt.id });
    expect(report.revision).toBe(2);
    const job = await releaseInterruptedAttempt(f.input());
    expect(job.status).toMatchObject({
      revision: 3,
      lifecycle: 'waiting',
      waitReason: 'input',
      delivery: null,
    });
    expect((await f.store.repository.attempts(f.attempt.jobId))[0]).toMatchObject({
      status: 'failed',
      lease: null,
      outputArtifactIds: [],
    });
    expect(await f.store.repository.pendingDispatch(10)).toEqual([]);
    expect((await f.store.repository.artifacts(f.attempt.jobId, null, 10)).artifacts).toEqual([]);
    await expect(releaseInterruptedAttempt(f.input())).rejects.toThrow('revision');
  });

  it('preserves a reservation until an uncertain external outcome is observed', async () => {
    const f = await fixture();
    const begun = await f.store.operations.begin({
      receipt: receipt(f.attempt),
      scopes: [{ id: f.attempt.jobId, kind: 'job', limitUsdMicros: 10 }],
      uncertainRetryAuthorized: false,
    });
    await f.store.operations.submitted(
      begun.receipt.id,
      begun.receipt.version,
      'external_reference',
    );
    f.advance();
    await f.reopen();
    await expect(releaseInterruptedAttempt(f.input())).rejects.toThrow('Reconcile');
    expect(await f.store.coordinator.usage(f.attempt.jobId)).toEqual({
      reservedUsdMicros: 10,
      actualUsdMicros: 0,
    });
    const operation = (await f.store.operations.read(begun.receipt.id))!;
    await f.store.operations.reconcile(operation.id, operation.version, {
      state: 'failed',
      actualUsdMicros: 7,
      providerRequestId: 'external_reference',
      diagnostic: {
        code: 'RECONCILED_FAILURE',
        message: 'Observed failure.',
        classification: 'permanent',
        retryable: false,
      },
      nextAttemptAt: null,
    });
    await releaseInterruptedAttempt(f.input());
    expect(await f.store.coordinator.usage(f.attempt.jobId)).toEqual({
      reservedUsdMicros: 0,
      actualUsdMicros: 7,
    });
  });

  it('refuses to steal a live lease or recover a changed revision', async () => {
    const f = await fixture();
    await expect(releaseInterruptedAttempt(f.input())).rejects.toThrow('expired');
    f.advance();
    await expect(releaseInterruptedAttempt({ ...f.input(), expectedRevision: 1 })).rejects.toThrow(
      'revision',
    );
  });

  it('retains paused state and does not authorize a retry', async () => {
    const f = await fixture();
    f.advance();
    const job = (await f.store.repository.read(f.attempt.jobId))!;
    await f.store.repository.commit({
      jobId: job.brief.id,
      expectedRevision: 2,
      job: { ...job, status: { ...job.status, revision: 3, lifecycle: 'paused' } },
      fence: null,
      attempts: [],
      artifacts: [],
      plans: [],
      approvals: [],
      operations: [],
      events: [],
      dispatch: [],
    });
    expect(
      (await releaseInterruptedAttempt({ ...f.input(), expectedRevision: 3 })).status,
    ).toMatchObject({ lifecycle: 'paused', waitReason: null });
  });
});
