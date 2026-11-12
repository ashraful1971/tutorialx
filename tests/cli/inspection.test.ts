import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createSqlitePersistence } from '@tutorialx/adapters';
import type { ActionResponse, ArtifactManifest, JsonObject } from '@tutorialx/contracts';
import { redactPublicValue } from '@tutorialx/core';
import { afterEach, describe, expect, it } from 'vitest';
import { createActionService } from '../../packages/cli/src/actions.js';
import { digest, timestamp } from '../fixtures/contracts.js';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
const data = (response: ActionResponse) => {
  if (response.status !== 'ok') throw new Error(JSON.stringify(response));
  return response.data;
};
async function fixture() {
  const directory = await mkdtemp(resolve(tmpdir(), 'tutorialx-inspection-'));
  roots.push(directory);
  const secret = 'private-fixture-value';
  const service = createActionService({
    projectDirectory: directory,
    knownSecrets: [secret],
    authority: {
      actorId: 'operator_fixture',
      actions: ['*'],
      roles: ['researcher', 'writer-director', 'reviewer', 'repair'],
    },
  });
  let request = 0;
  const call = (action: string, params: JsonObject = {}, key: string | null = null) =>
    service.execute({
      apiVersion: 1,
      requestId: `request_${request++}`,
      action,
      params,
      expectedRevision: null,
      idempotencyKey: key,
    });
  data(await call('workspace.init'));
  const created = data(
    await call(
      'job.create',
      { title: 'Read fixture', topic: 'Inspect accepted work', audience: 'Contributors' },
      digest,
    ),
  );
  const jobId = String(created.jobId);
  const jobRoot = resolve(directory, 'tutorialx-videos', String(created.directory));
  const workspace = JSON.parse(
    await readFile(resolve(directory, '.tutorialx/workspace.json'), 'utf8'),
  );
  const store = await createSqlitePersistence({
    filename: resolve(directory, '.tutorialx/metadata.sqlite'),
    workspaceId: workspace.id,
    now: () => timestamp,
  });
  await store.repository.initialize();
  try {
    const record = (await store.repository.read(jobId))!;
    const artifacts: ArtifactManifest[] = [];
    for (const name of ['artifact_a', 'artifact_b']) {
      const content = `Fixture ${name}: ${secret}.`;
      await writeFile(resolve(jobRoot, 'input', `${name}.txt`), content);
      artifacts.push({
        schemaVersion: 1,
        id: name,
        createdAt: timestamp,
        workspaceId: workspace.id,
        jobId,
        kind: 'text',
        mimeType: 'text/plain',
        storage: { kind: 'local', path: `input/${name}.txt` },
        digest: createHash('sha256').update(content).digest('hex'),
        sizeBytes: Buffer.byteLength(content),
        media: null,
        provenance: {
          stageId: 'fixture',
          attemptId: 'attempt_fixture',
          inputDigests: [],
          provider: null,
          settingsDigest: digest,
          templateDigest: null,
        },
      });
    }
    await store.repository.commit({
      jobId,
      expectedRevision: record.status.revision,
      job: { ...record, status: { ...record.status, revision: 2 } },
      fence: null,
      attempts: [],
      artifacts,
      plans: [],
      approvals: [],
      operations: [],
      dispatch: [],
      events: [1, 2].map((value) => ({
        schemaVersion: 1,
        id: `event_${value}`,
        createdAt: timestamp,
        workspaceId: workspace.id,
        jobId,
        attemptId: 'attempt_fixture',
        cursor: 1,
        requestId: `request_origin_${value}`,
        traceId: 'trace_fixture',
        kind: 'fixture',
        level: 'info',
        data: {
          message: `Diagnostic ${secret}`,
          token: secret,
          url: 'https://example.com?token=private',
        },
      })),
    });
  } finally {
    await store.repository.close();
  }
  return { directory, call, jobId, jobRoot, secret };
}

describe('bounded public inspection', () => {
  it('reconnects after an event cursor with correlations and redacted diagnostics', async () => {
    const f = await fixture();
    const first = data(await f.call('events', { jobId: f.jobId, limit: 1 }));
    const items = first.items as JsonObject[];
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      jobId: f.jobId,
      attemptId: 'attempt_fixture',
      requestId: 'request_origin_1',
      traceId: 'trace_fixture',
    });
    expect(JSON.stringify(first)).not.toContain(f.secret);
    expect(JSON.stringify(first)).not.toContain('token=private');
    const later = data(
      await f.call('events', { jobId: f.jobId, afterCursor: first.nextCursor!, limit: 1 }),
    );
    expect((later.items as JsonObject[])[0]!.id).toBe('event_2');
    const empty = data(
      await f.call('events', { jobId: f.jobId, afterCursor: later.nextCursor!, limit: 1 }),
    );
    expect(empty.items).toEqual([]);
    expect(empty.nextCursor).toBe(later.nextCursor);
  });

  it('paginates accepted manifests, verifies bytes, redacts text and rejects corruption', async () => {
    const f = await fixture();
    const first = data(await f.call('artifact.list', { jobId: f.jobId, limit: 1 }));
    expect((first.items as JsonObject[])[0]!.id).toBe('artifact_a');
    expect((first.items as JsonObject[])[0]!.storage).toBeUndefined();
    const second = data(
      await f.call('artifact.list', { jobId: f.jobId, limit: 1, cursor: first.nextCursor! }),
    );
    expect((second.items as JsonObject[])[0]!.id).toBe('artifact_b');
    const read = data(
      await f.call('artifact.read', { jobId: f.jobId, artifactId: 'artifact_b', length: 100 }),
    );
    expect(read.encoding).toBe('utf8');
    expect(read.content).toContain('***');
    const split = data(
      await f.call('artifact.read', {
        jobId: f.jobId,
        artifactId: 'artifact_b',
        offset: 22,
        length: 5,
      }),
    );
    expect(split.content).toBe('*****');
    expect(JSON.stringify(read)).not.toContain(f.secret);
    const range = data(
      await f.call('artifact.read', {
        jobId: f.jobId,
        artifactId: 'artifact_a',
        offset: 0,
        length: 7,
      }),
    );
    expect(range.content).toBe('Fixture');
    expect(range.nextOffset).toBe(7);
    await writeFile(resolve(f.jobRoot, 'input/artifact_b.txt'), 'Corrupted fixture');
    const invalid = await f.call('artifact.read', { jobId: f.jobId, artifactId: 'artifact_b' });
    expect(invalid.status === 'error' && invalid.error.code).toBe('INVALID_INPUT');
  });

  it('enforces job scope before artifact or event lookup and rejects oversized requests', async () => {
    const f = await fixture();
    const restricted = createActionService({
      projectDirectory: f.directory,
      authority: {
        actorId: 'restricted',
        actions: ['events', 'artifact.read'],
        roles: [],
        jobIds: ['other_job'],
      },
    });
    for (const action of ['events', 'artifact.read']) {
      const response = await restricted.execute({
        apiVersion: 1,
        requestId: 'restricted_request',
        action,
        params: {
          jobId: f.jobId,
          ...(action === 'artifact.read' ? { artifactId: 'artifact_a' } : {}),
        },
        expectedRevision: null,
        idempotencyKey: null,
      });
      expect(response.status === 'error' && response.error.code).toBe('POLICY_DENIED');
    }
    const response = await f.call('artifact.read', {
      jobId: f.jobId,
      artifactId: 'artifact_a',
      length: 65_537,
    });
    expect(response.status === 'error' && response.error.code).toBe('INVALID_INPUT');
  });

  it('redacts known values, secret fields, credentials in URLs and bearer tokens recursively', () => {
    const redacted = redactPublicValue(
      {
        nested: [
          {
            apiKey: 'hidden',
            note: 'known-value',
            auth: 'Bearer abc.def',
            url: 'https://user:password@example.com?a=1&token=abc',
          },
        ],
      },
      ['known-value'],
    );
    expect(JSON.stringify(redacted)).not.toMatch(
      /hidden|known-value|abc\.def|user:password|token=abc/,
    );
  });
});
