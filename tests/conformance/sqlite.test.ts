import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createLocalProjectionFiles,
  createSqlitePersistence,
  type SqlitePersistence,
} from '@tutorialx/adapters';
import { inspectProviderConformance } from '@tutorialx/contracts';
import {
  importWorkspaceProjection,
  publishWorkspaceProjections,
  workspaceProjectionDocuments,
} from '@tutorialx/core';
import { expect, it } from 'vitest';
import { sampleSettings, timestamp } from '../fixtures/contracts.js';
import { fixtureJob, fixtureMutation, repositoryConformance } from './repository-suite.js';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'tutorialx-sqlite-'));
  const filename = join(root, 'state.sqlite');
  let now = timestamp;
  const connections: SqlitePersistence[] = [];
  const connect = async () => {
    const store = await createSqlitePersistence({
      filename,
      workspaceId: 'workspace_example',
      now: () => now,
    });
    connections.push(store);
    await store.repository.initialize();
    return store;
  };
  const primary = await connect();
  return {
    root,
    filename,
    primary,
    connect,
    setNow: (value: string) => {
      now = value;
    },
    close: async () => {
      for (const store of connections) await store.repository.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

repositoryConformance('SQLite', fixture);

it('migrates once, persists across close/reopen, and passes common provider conformance', async () => {
  const value = await fixture();
  try {
    await value.primary.repository.initialize();
    await value.primary.repository.create(fixtureJob());
    await value.primary.repository.commit(fixtureMutation(fixtureJob()));
    expect(
      await inspectProviderConformance(value.primary.repository, {
        kind: 'persistence',
        validConfiguration: { filename: value.filename },
        invalidConfiguration: { filename: value.filename, secret: true },
        estimateOperation: 'commit',
        estimateInput: {},
        context: {
          operationId: 'op',
          jobId: 'job_example',
          attemptId: 'attempt',
          outputDirectory: value.root,
          deadlineAt: '2099-01-01T00:00:00Z',
          reservationId: null,
          signal: new AbortController().signal,
        },
      }),
    ).toEqual([]);
    await value.primary.repository.close();
    const reopened = await value.connect();
    expect((await reopened.repository.read('job_example'))?.status.revision).toBe(2);
    expect(await reopened.revisions.revisions('job_example')).toHaveLength(2);
  } finally {
    await value.close();
  }
});

it('rejects unsupported future schemas and another workspace without mutating their data', async () => {
  const value = await fixture();
  try {
    await value.primary.repository.create(fixtureJob());
    await value.primary.repository.close();
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(value.filename);
    db.exec('PRAGMA user_version=2');
    db.close();
    const future = await createSqlitePersistence({
      filename: value.filename,
      workspaceId: 'workspace_example',
      now: () => timestamp,
    });
    try {
      await expect(future.repository.initialize()).rejects.toThrow('Unsupported');
    } finally {
      await future.repository.close();
    }
    const inspect = new DatabaseSync(value.filename);
    expect(inspect.prepare('PRAGMA user_version').get()?.user_version).toBe(2);
    expect(inspect.prepare('SELECT COUNT(*) count FROM jobs').get()?.count).toBe(1);
    inspect.exec('PRAGMA user_version=1');
    inspect.close();
    const foreign = await createSqlitePersistence({
      filename: value.filename,
      workspaceId: 'other_workspace',
      now: () => timestamp,
    });
    try {
      await expect(foreign.repository.initialize()).rejects.toMatchObject({
        code: 'POLICY_DENIED',
      });
    } finally {
      await foreign.repository.close();
    }
  } finally {
    await value.close();
  }
});

it('imports an edited brief through the real SQLite transaction and reloads its revision', async () => {
  const value = await fixture();
  try {
    const job = fixtureJob();
    await value.primary.repository.create(job);
    const directory = join(value.root, 'job');
    await mkdir(directory);
    const files = createLocalProjectionFiles(directory);
    const documents = workspaceProjectionDocuments(job, null);
    await publishWorkspaceProjections(
      files,
      job,
      null,
      Object.fromEntries(Object.keys(documents).map((path) => [path, null])),
    );
    const brief = await readFile(join(directory, 'brief.md'), 'utf8');
    await writeFile(
      join(directory, 'brief.md'),
      brief.replace('> Beginners', '> Database contributors'),
    );
    const result = await importWorkspaceProjection({
      repository: value.primary.repository,
      files,
      workspace: {
        schemaVersion: 1,
        id: job.brief.workspaceId,
        createdAt: timestamp,
        revision: 1,
        contentRoot: 'videos',
        sourceRoots: [],
        exclusions: [],
        defaults: {},
        policyCeiling: sampleSettings().policy,
      },
      jobId: job.brief.id,
      expectedRevision: 1,
      path: 'brief.md',
      now: () => timestamp,
    });
    expect(result.projectionConflicts).toEqual([]);
    const reloaded = await value.connect();
    expect((await reloaded.repository.read(job.brief.id))?.brief.audience).toBe(
      'Database contributors',
    );
    expect(
      (await reloaded.revisions.revisions(job.brief.id)).map((record) => record.brief.audience),
    ).toEqual(['Beginners', 'Database contributors']);
    expect(await reloaded.repository.approvals(job.brief.id)).toEqual([]);
  } finally {
    await value.close();
  }
});
