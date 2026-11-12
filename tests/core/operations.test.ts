import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSqlitePersistence, type SqlitePersistence } from '@tutorialx/adapters';
import {
  type BeginOperation,
  type OperationContext,
  type OperationOutcome,
  operationReceiptSchema,
} from '@tutorialx/contracts';
import { createOperationExecutor, OperationFailure, operationRetryDecision } from '@tutorialx/core';
import { describe, expect, it } from 'vitest';
import { fixtureAttempt, fixtureJob, fixtureMutation } from '../conformance/repository-suite.js';
import { digest, timestamp } from '../fixtures/contracts.js';

const policy = {
  maxAttempts: 3,
  baseDelayMs: 100,
  maxDelayMs: 500,
  deadlineAt: '2026-11-11T10:10:00Z',
};
const transient = {
  code: 'RATE_LIMIT',
  message: 'Provider rate limit.',
  classification: 'transient' as const,
  retryable: true,
};
const success: OperationOutcome = {
  state: 'succeeded',
  actualUsdMicros: 50,
  diagnostic: null,
  providerRequestId: null,
  nextAttemptAt: null,
};
function begin(id = 'operation_one', key = digest, sequence = 1): BeginOperation {
  return {
    receipt: {
      schemaVersion: 1,
      id,
      createdAt: timestamp,
      jobId: 'job_example',
      jobRevision: 2,
      attemptId: 'attempt_one',
      leaseToken: 1,
      operationKey: key,
      providerId: 'voice',
      sideEffect: 'reconcilable',
      state: 'reserved',
      sequence,
      version: 1,
      reservationId: `reservation_${id}`,
      reservedUsdMicros: 80,
      actualUsdMicros: null,
      providerRequestId: null,
      diagnostic: null,
      retryPolicy: policy,
      nextAttemptAt: null,
      cancelRequestedAt: null,
      submittedAt: null,
      updatedAt: timestamp,
    },
    scopes: [
      { id: 'job_example', kind: 'job', limitUsdMicros: 200 },
      { id: 'batch_example', kind: 'batch', limitUsdMicros: 100 },
    ],
    uncertainRetryAuthorized: false,
  };
}
function context(input: BeginOperation): OperationContext {
  return {
    operationId: input.receipt.id,
    jobId: input.receipt.jobId,
    attemptId: input.receipt.attemptId,
    reservationId: input.receipt.reservationId,
    outputDirectory: '/tmp/unused-output',
    deadlineAt: policy.deadlineAt,
    signal: new AbortController().signal,
  };
}
async function fixture(
  run: (f: {
    store: SqlitePersistence;
    other: SqlitePersistence;
    setNow(value: string): void;
  }) => Promise<void>,
) {
  const root = await mkdtemp(join(tmpdir(), 'tutorialx-operations-'));
  let now = timestamp;
  const options = {
    filename: join(root, 'state.sqlite'),
    workspaceId: 'workspace_example',
    now: () => now,
  };
  const store = await createSqlitePersistence(options);
  const other = await createSqlitePersistence(options);
  try {
    await store.repository.initialize();
    await other.repository.initialize();
    const job = fixtureJob();
    await store.repository.create(job);
    const mutation = fixtureMutation(job);
    mutation.job.status.lifecycle = 'running';
    mutation.attempts = [fixtureAttempt()];
    await store.repository.commit(mutation);
    await run({
      store,
      other,
      setNow: (value) => {
        now = value;
      },
    });
  } finally {
    await store.repository.close();
    await other.repository.close();
    await rm(root, { recursive: true, force: true });
  }
}

describe('bounded failure policy', () => {
  it('bounds exponential backoff, rate-limit minima, attempts, failure classes and deadlines', () => {
    expect(
      operationRetryDecision({ policy, sequence: 1, diagnostic: transient, now: timestamp }),
    ).toEqual({ retry: true, availableAt: '2026-11-11T10:00:00.100Z' });
    expect(
      operationRetryDecision({
        policy,
        sequence: 2,
        diagnostic: transient,
        now: timestamp,
        retryAfterMs: 5000,
      }),
    ).toEqual({ retry: true, availableAt: '2026-11-11T10:00:05.000Z' });
    expect(
      operationRetryDecision({ policy, sequence: 3, diagnostic: transient, now: timestamp }),
    ).toEqual({ retry: false, reason: 'attempt-limit' });
    expect(
      operationRetryDecision({
        policy,
        sequence: 1,
        diagnostic: transient,
        now: timestamp,
        retryAfterMs: 600000,
      }),
    ).toEqual({ retry: false, reason: 'deadline' });
    for (const classification of ['permanent', 'policy', 'uncertain'] as const)
      expect(
        operationRetryDecision({
          policy,
          sequence: 1,
          diagnostic: { ...transient, classification },
          now: timestamp,
        }).retry,
      ).toBe(false);
  });
  it('rejects future schemas and unknown fields without changing the v1 operation record', () => {
    expect(() => operationReceiptSchema.parse({ ...begin().receipt, schemaVersion: 2 })).toThrow();
    expect(() => operationReceiptSchema.parse({ ...begin().receipt, secret: 'no' })).toThrow();
  });
});

it('reserves concurrent job and batch usage atomically with receipts, not beyond authorization', async () => {
  await fixture(async ({ store, other }) => {
    const results = await Promise.allSettled([
      store.operations.begin(begin()),
      other.operations.begin(begin('operation_two', 'b'.repeat(64))),
    ]);
    expect(results.filter((value) => value.status === 'fulfilled')).toHaveLength(1);
    expect(await store.coordinator.usage('batch_example')).toEqual({
      reservedUsdMicros: 80,
      actualUsdMicros: 0,
    });
    const receipts = (await other.operations.list('job_example', null, 100)).receipts;
    expect(receipts).toHaveLength(1);
    expect(
      (await store.operations.begin(begin(receipts[0]!.id, receipts[0]!.operationKey))).created,
    ).toBe(false);
    expect(await store.coordinator.usage('job_example')).toEqual({
      reservedUsdMicros: 80,
      actualUsdMicros: 0,
    });
  });
});

it('fences before dispatch and keeps actual overspend visible to block future requests', async () => {
  await fixture(async ({ store, setNow }) => {
    await expect(
      store.operations.begin({ ...begin(), receipt: { ...begin().receipt, leaseToken: 99 } }),
    ).rejects.toThrow('fence');
    expect((await store.operations.list('job_example', null, 100)).receipts).toHaveLength(0);
    const first = (await store.operations.begin(begin())).receipt;
    setNow('2026-11-11T11:01:00Z');
    await expect(store.operations.submitted(first.id, first.version, null)).rejects.toThrow(
      'fence',
    );
    setNow(timestamp);
    const submitted = await store.operations.submitted(first.id, first.version, 'external-1');
    await store.operations.complete(first.id, submitted.version, {
      ...success,
      actualUsdMicros: 150,
    });
    expect(await store.coordinator.usage('batch_example')).toEqual({
      reservedUsdMicros: 0,
      actualUsdMicros: 150,
    });
    await expect(store.operations.begin(begin('operation_next', 'c'.repeat(64)))).rejects.toThrow(
      'budget',
    );
  });
});

it('never repeats uncertain paid work; reconciliation records observations and releases only proven remainder', async () => {
  await fixture(async ({ store }) => {
    let receipt = (await store.operations.begin(begin())).receipt;
    receipt = await store.operations.submitted(receipt.id, receipt.version, null);
    receipt = await store.operations.complete(receipt.id, receipt.version, {
      ...success,
      state: 'uncertain',
      actualUsdMicros: null,
    });
    await expect(store.operations.begin(begin('operation_retry', digest, 2))).rejects.toThrow(
      'reconcile',
    );
    expect(await store.coordinator.usage('batch_example')).toEqual({
      reservedUsdMicros: 80,
      actualUsdMicros: 0,
    });
    await expect(store.coordinator.releaseUsage(receipt.reservationId)).rejects.toThrow();
    receipt = await store.operations.reconcile(receipt.id, receipt.version, {
      ...success,
      state: 'failed',
      actualUsdMicros: 0,
      diagnostic: transient,
      nextAttemptAt: '2026-11-11T10:00:00.100Z',
    });
    await expect(store.operations.begin(begin('operation_retry', digest, 2))).rejects.toThrow(
      'backoff',
    );
    expect(await store.coordinator.usage('batch_example')).toEqual({
      reservedUsdMicros: 0,
      actualUsdMicros: 0,
    });
  });
});

it('records transient retry scheduling and prevents retry policy changes or permanent replays', async () => {
  await fixture(async ({ store, setNow }) => {
    const executor = createOperationExecutor(store.operations, {
      now: () => timestamp,
      schedule: () => null,
      clear: () => undefined,
    });
    const value = begin();
    const result = await executor.execute({
      begin: value,
      context: context(value),
      execute: async () => {
        throw new OperationFailure({
          diagnostic: transient,
          actualUsdMicros: 0,
          retryAfterMs: 2000,
        });
      },
    });
    // Use injected clock for deterministic scheduling in provider-independent policy checks.
    expect(result.receipt.state).toBe('failed');
    const observed = await store.operations.read(result.receipt.id);
    expect(observed?.diagnostic?.classification).toBe('transient');
    setNow('2026-11-11T10:00:03Z');
    const next = begin('operation_retry', digest, 2);
    await expect(
      store.operations.begin({
        ...next,
        receipt: { ...next.receipt, retryPolicy: { ...policy, maxAttempts: 10 } },
      }),
    ).rejects.toThrow('policy changed');
  });
});

it('pause blocks new dispatch while accepted in-flight usage can finish; cancellation retains outcomes', async () => {
  await fixture(async ({ store, other }) => {
    let first = (await store.operations.begin(begin())).receipt;
    first = await store.operations.submitted(first.id, first.version, 'paid-request');
    const current = (await store.repository.read('job_example'))!;
    const pause = fixtureMutation(current);
    pause.job.status.lifecycle = 'paused';
    await store.repository.commit(pause);
    await expect(
      other.operations.begin({
        ...begin('operation_two', 'e'.repeat(64)),
        receipt: { ...begin('operation_two', 'e'.repeat(64)).receipt, jobRevision: 3 },
      }),
    ).rejects.toThrow('fence');
    expect((await other.operations.complete(first.id, first.version, success)).state).toBe(
      'succeeded',
    );
    const resume = fixtureMutation((await store.repository.read('job_example'))!);
    resume.job.status.lifecycle = 'running';
    await store.repository.commit(resume);
    const second = begin('operation_two', 'e'.repeat(64));
    second.receipt.jobRevision = 4;
    second.receipt.reservedUsdMicros = 40;
    let receipt = (await store.operations.begin(second)).receipt;
    receipt = await store.operations.submitted(receipt.id, receipt.version, 'paid-request-2');
    const cancel = fixtureMutation((await store.repository.read('job_example'))!);
    cancel.job.status.lifecycle = 'cancelled';
    cancel.job.status.delivery = 'cancelled';
    await store.repository.commit(cancel);
    expect((await store.operations.cancelJob('job_example'))[0]?.state).toBe('uncertain');
    receipt = (await other.operations.read(receipt.id))!;
    expect(
      (
        await other.operations.reconcile(receipt.id, receipt.version, {
          ...success,
          actualUsdMicros: 30,
        })
      ).state,
    ).toBe('cancelled');
    expect(await store.coordinator.usage('batch_example')).toEqual({
      reservedUsdMicros: 0,
      actualUsdMicros: 80,
    });
    expect((await store.operations.read(first.id))?.state).toBe('succeeded');
    expect((await store.repository.read('job_example'))?.status.delivery).toBe('cancelled');
  });
});

it('cooperatively cancels in flight, retains uncertain reservations, and reconciles a late charge without ready output', async () => {
  await fixture(async ({ store }) => {
    let resolveProvider!: (value: {
      result: string;
      actualUsdMicros: number;
      providerRequestId: string | null;
    }) => void;
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    let signal: AbortSignal | undefined;
    const executor = createOperationExecutor(store.operations, {
      now: () => timestamp,
      schedule: () => null,
      clear: () => undefined,
    });
    const value = begin();
    const work = executor.execute({
      begin: value,
      context: context(value),
      execute: async (ctx) => {
        signal = ctx.signal;
        started();
        return new Promise<{
          result: string;
          actualUsdMicros: number;
          providerRequestId: string | null;
        }>((resolve) => {
          resolveProvider = resolve;
        });
      },
    });
    await ready;
    const cancel = fixtureMutation((await store.repository.read('job_example'))!);
    cancel.job.status.lifecycle = 'cancelled';
    cancel.job.status.delivery = 'cancelled';
    await store.repository.commit(cancel);
    await executor.cancelJob('job_example');
    const stopped = await work;
    expect(stopped.result).toBeNull();
    expect(signal?.aborted).toBe(true);
    expect(stopped.receipt.state).toBe('uncertain');
    expect(await store.coordinator.usage('batch_example')).toEqual({
      reservedUsdMicros: 80,
      actualUsdMicros: 0,
    });
    resolveProvider({
      result: 'late-video',
      actualUsdMicros: 60,
      providerRequestId: 'late-charge',
    });
    for (let index = 0; index < 20; index++) {
      await Promise.resolve();
    }
    const receipt = (await store.operations.read(value.receipt.id))!;
    expect(receipt.state).toBe('cancelled');
    expect(receipt.actualUsdMicros).toBe(60);
    expect((await store.repository.artifacts('job_example', null, 100)).artifacts).toHaveLength(0);
  });
});

it('bounds non-cooperative timeouts, marks unknown exceptions uncertain, and deduplicates execution', async () => {
  await fixture(async ({ store }) => {
    let timeout!: () => void;
    const executor = createOperationExecutor(store.operations, {
      now: () => timestamp,
      schedule: (callback) => {
        timeout = callback;
        return null;
      },
      clear: () => undefined,
    });
    const value = begin();
    let calls = 0;
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const work = executor.execute({
      begin: value,
      context: context(value),
      execute: async () => {
        calls++;
        started();
        return new Promise<never>(() => undefined);
      },
    });
    await ready;
    timeout();
    expect((await work).receipt.state).toBe('uncertain');
    const replay = await executor.execute({
      begin: value,
      context: context(value),
      execute: async () => {
        calls++;
        throw new Error('should never happen');
      },
    });
    expect(replay.receipt.state).toBe('uncertain');
    expect(calls).toBe(1);
    const page = await store.operations.list('job_example', null, 1);
    expect(page.receipts[0]?.id).toBe(value.receipt.id);
  });
});

it('permits explicit uncertain retry while retaining the original upper bound and attempt ceiling', async () => {
  await fixture(async ({ store, setNow }) => {
    const value = begin();
    value.scopes = value.scopes.map((scope) => ({ ...scope, limitUsdMicros: 200 }));
    let receipt = (await store.operations.begin(value)).receipt;
    receipt = await store.operations.submitted(receipt.id, receipt.version, 'unknown-charge');
    receipt = await store.operations.complete(receipt.id, receipt.version, {
      ...success,
      state: 'uncertain',
      actualUsdMicros: null,
    });
    const retry = begin('operation_retry', digest, 2);
    retry.scopes = value.scopes;
    retry.uncertainRetryAuthorized = true;
    await expect(store.operations.begin(retry)).rejects.toThrow('backoff');
    setNow('2026-11-11T10:00:00.100Z');
    expect((await store.operations.begin(retry)).created).toBe(true);
    expect(await store.coordinator.usage('batch_example')).toEqual({
      reservedUsdMicros: 160,
      actualUsdMicros: 0,
    });
    const overLimit = begin('operation_over_limit', digest, 4);
    overLimit.scopes = value.scopes;
    overLimit.uncertainRetryAuthorized = true;
    await expect(store.operations.begin(overLimit)).rejects.toThrow('attempt limit');
    expect((await store.operations.read(receipt.id))?.state).toBe('uncertain');
  });
});

it('recovers unsubmitted crash reservations and pagination without dispatching external requests', async () => {
  await fixture(async ({ store, other }) => {
    const first = begin('operation_a');
    first.receipt.reservedUsdMicros = 30;
    const second = begin('operation_b', 'f'.repeat(64));
    second.receipt.reservedUsdMicros = 30;
    const receipt = (await store.operations.begin(first)).receipt;
    await other.operations.begin(second);
    const page = await store.operations.list('job_example', null, 1);
    expect(page.nextCursor).toBe('operation_a');
    expect((await other.operations.list('job_example', page.nextCursor, 1)).receipts[0]?.id).toBe(
      'operation_b',
    );
    const stopped = await other.operations.reconcile(receipt.id, receipt.version, {
      ...success,
      state: 'cancelled',
      actualUsdMicros: 0,
    });
    expect(stopped.submittedAt).toBeNull();
    await expect(store.operations.submitted(receipt.id, receipt.version, null)).rejects.toThrow(
      'version',
    );
    expect(await store.coordinator.usage('batch_example')).toEqual({
      reservedUsdMicros: 30,
      actualUsdMicros: 0,
    });
  });
});

it('retains known actual charges even while application effects remain uncertain', async () => {
  await fixture(async ({ store }) => {
    let receipt = (await store.operations.begin(begin())).receipt;
    receipt = await store.operations.submitted(receipt.id, receipt.version, 'save-request');
    receipt = await store.operations.complete(receipt.id, receipt.version, {
      ...success,
      state: 'uncertain',
      actualUsdMicros: 50,
    });
    expect(await store.coordinator.usage('batch_example')).toEqual({
      reservedUsdMicros: 0,
      actualUsdMicros: 50,
    });
    await expect(store.operations.begin(begin('operation_retry', digest, 2))).rejects.toThrow(
      'reconcile',
    );
    const cancel = fixtureMutation((await store.repository.read('job_example'))!);
    cancel.job.status.lifecycle = 'cancelled';
    await store.repository.commit(cancel);
    await store.operations.cancelJob('job_example');
    receipt = (await store.operations.read(receipt.id))!;
    expect(receipt.actualUsdMicros).toBe(50);
    expect((await store.operations.reconcile(receipt.id, receipt.version, success)).state).toBe(
      'cancelled',
    );
    expect(await store.coordinator.usage('batch_example')).toEqual({
      reservedUsdMicros: 0,
      actualUsdMicros: 50,
    });
  });
});

it('requires durable submission before accepting a successful or charged result', async () => {
  await fixture(async ({ store }) => {
    const receipt = (await store.operations.begin(begin())).receipt;
    await expect(store.operations.complete(receipt.id, receipt.version, success)).rejects.toThrow(
      'Unsubmitted',
    );
    await expect(
      store.operations.complete(receipt.id, receipt.version, { ...success, state: 'cancelled' }),
    ).rejects.toThrow('Unsubmitted');
    expect(await store.coordinator.usage('job_example')).toEqual({
      reservedUsdMicros: 80,
      actualUsdMicros: 0,
    });
  });
});

it('does not replay a charged cancellation or erase its actual usage after explicit resume', async () => {
  await fixture(async ({ store, setNow }) => {
    let receipt = (await store.operations.begin(begin())).receipt;
    receipt = await store.operations.submitted(receipt.id, receipt.version, 'paid-request');
    const cancel = fixtureMutation((await store.repository.read('job_example'))!);
    cancel.job.status.lifecycle = 'cancelled';
    await store.repository.commit(cancel);
    await store.operations.cancelJob('job_example');
    receipt = (await store.operations.read(receipt.id))!;
    receipt = await store.operations.reconcile(receipt.id, receipt.version, success);
    const resume = fixtureMutation((await store.repository.read('job_example'))!);
    resume.job.status.lifecycle = 'running';
    await store.repository.commit(resume);
    setNow('2026-11-11T10:00:01Z');
    const retry = begin('operation_retry', digest, 2);
    retry.receipt.jobRevision = 4;
    await expect(store.operations.begin(retry)).rejects.toThrow('not safely retryable');
    expect(await store.coordinator.usage('batch_example')).toEqual({
      reservedUsdMicros: 0,
      actualUsdMicros: 50,
    });
    expect((await store.operations.read(receipt.id))?.state).toBe('cancelled');
  });
});

it('retains provider request identity through unknown outcomes and rejects identity reassignment', async () => {
  await fixture(async ({ store }) => {
    let receipt = (await store.operations.begin(begin())).receipt;
    receipt = await store.operations.submitted(receipt.id, receipt.version, 'external-stable');
    receipt = await store.operations.complete(receipt.id, receipt.version, {
      ...success,
      state: 'uncertain',
      actualUsdMicros: null,
      providerRequestId: null,
    });
    expect(receipt.providerRequestId).toBe('external-stable');
    await expect(
      store.operations.reconcile(receipt.id, receipt.version, {
        ...success,
        providerRequestId: 'external-different',
      }),
    ).rejects.toThrow('identity');
    expect(
      (
        await store.operations.reconcile(receipt.id, receipt.version, {
          ...success,
          providerRequestId: null,
        })
      ).providerRequestId,
    ).toBe('external-stable');
  });
});

it('classifies unknown provider exceptions as uncertain without exposing raw credential-bearing errors', async () => {
  await fixture(async ({ store }) => {
    const executor = createOperationExecutor(store.operations, {
      now: () => timestamp,
      schedule: () => null,
      clear: () => undefined,
    });
    const value = begin();
    const result = await executor.execute({
      begin: value,
      context: context(value),
      execute: async () => {
        throw new Error('Token: super-private-provider-secret');
      },
    });
    expect(result.receipt.state).toBe('uncertain');
    expect(result.receipt.diagnostic?.classification).toBe('uncertain');
    expect(JSON.stringify(result)).not.toContain('super-private');
    expect(await store.coordinator.usage('batch_example')).toEqual({
      reservedUsdMicros: 80,
      actualUsdMicros: 0,
    });
  });
});

it('records external submission identity before completion and retains it after a bounded timeout', async () => {
  await fixture(async ({ store, other }) => {
    let timeout!: () => void;
    let ready!: () => void;
    const submitted = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const executor = createOperationExecutor(store.operations, {
      now: () => timestamp,
      schedule: (callback) => {
        timeout = callback;
        return null;
      },
      clear: () => undefined,
    });
    const value = begin();
    const work = executor.execute({
      begin: value,
      context: context(value),
      execute: async (_ctx, reportRequestId) => {
        await reportRequestId('persistent-provider-request');
        ready();
        return new Promise<never>(() => undefined);
      },
    });
    await submitted;
    const receipt = (await other.operations.read(value.receipt.id))!;
    expect(receipt.providerRequestId).toBe('persistent-provider-request');
    expect(receipt.state).toBe('in-flight');
    await expect(
      other.operations.identify(receipt.id, receipt.version, 'other-request'),
    ).rejects.toThrow('identity');
    timeout();
    const result = await work;
    expect(result.receipt.state).toBe('uncertain');
    expect(result.receipt.providerRequestId).toBe('persistent-provider-request');
  });
});
