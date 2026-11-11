import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalProjectionFiles } from '@tutorialx/adapters';
import {
  type JobMutation,
  type JobRecord,
  type JobRepository,
  type PlanRevision,
  type StageAttempt,
  type WorkspaceConfig,
} from '@tutorialx/contracts';
import {
  importWorkspaceProjection,
  inspectWorkspaceProjections,
  publishWorkspaceProjections,
  workspaceProjectionDocuments,
} from '@tutorialx/core';
import { expect, it } from 'vitest';
import { sampleBrief, samplePlan, sampleSettings, timestamp } from '../fixtures/contracts.js';

async function prepare() {
  const root = await mkdtemp(join(tmpdir(), 'tutorialx-projections-'));
  const initial: JobRecord = {
    brief: sampleBrief(),
    status: {
      jobId: sampleBrief().id,
      revision: 1,
      lifecycle: 'waiting',
      waitReason: 'approval',
      delivery: null,
      completedStages: 0,
      totalStages: 3,
    },
  };
  const state = {
    job: structuredClone(initial),
    plans: [samplePlan()] as PlanRevision[],
    attempts: [] as StageAttempt[],
    commits: [] as JobMutation[],
    race: false,
    afterCommit: async () => {},
  };
  const repository: JobRepository = {
    descriptor: {
      id: 'fixture',
      version: '1',
      kind: 'persistence',
      contractVersion: 1,
      configurationSchema: { type: 'object' },
      capabilities: { features: [], languages: [], formats: [], modalities: [] },
      runtime: { platforms: ['linux'], dependencies: [], memoryMiB: 1, gpu: false },
      execution: {
        location: 'local',
        maxDurationMs: 1000,
        cancellation: 'unsupported',
        sideEffect: 'idempotent',
        idempotency: 'supported',
        permissions: [],
      },
      pricing: 'free',
    },
    validateConfiguration: () => ({ ready: true, diagnostics: [] }),
    readiness: async () => ({ ready: true, diagnostics: [] }),
    estimate: async () => ({
      expectedUsdMicros: 0,
      upperBoundUsdMicros: 0,
      validUntil: null,
      uncertainty: [],
    }),
    initialize: async () => {},
    create: async () => {},
    close: async () => {},
    read: async () => structuredClone(state.job),
    list: async () => ({ jobs: [structuredClone(state.job)], nextCursor: null }),
    commit: async (mutation) => {
      if (state.race || mutation.expectedRevision !== state.job.status.revision)
        throw new Error('transactional revision conflict');
      state.commits.push(structuredClone(mutation));
      state.job = structuredClone(mutation.job);
      state.plans.push(...structuredClone(mutation.plans));
      state.attempts = [...structuredClone(mutation.attempts)];
      await state.afterCommit();
    },
    plans: async () => structuredClone(state.plans),
    attempts: async () => structuredClone(state.attempts),
    approvals: async () => [],
    operations: async () => [],
    events: async () => [],
    pendingDispatch: async () => [],
    markDispatched: async () => {},
    artifacts: async () => ({ artifacts: [], nextCursor: null }),
  };
  const files = createLocalProjectionFiles(root);
  const documents = workspaceProjectionDocuments(initial, state.plans[0]!);
  await publishWorkspaceProjections(
    files,
    initial,
    state.plans[0]!,
    Object.fromEntries(Object.keys(documents).map((path) => [path, null])),
  );
  const workspace: WorkspaceConfig = {
    schemaVersion: 1,
    id: initial.brief.workspaceId,
    createdAt: timestamp,
    revision: 1,
    contentRoot: 'tutorialx-videos',
    sourceRoots: [],
    exclusions: [],
    defaults: {},
    policyCeiling: sampleSettings().policy,
  };
  const importFile = (path = 'job.json', expectedRevision = 1) =>
    importWorkspaceProjection({
      repository,
      files,
      workspace,
      jobId: initial.brief.id,
      expectedRevision,
      path,
      now: () => timestamp,
    });
  const editJob = async (change: (record: Record<string, unknown>) => void) => {
    const content = (await files.read('job.json'))!.content;
    const parsed = JSON.parse(content);
    change(parsed);
    await writeFile(join(root, 'job.json'), `${JSON.stringify(parsed, null, 2)}\n`);
  };
  return { root, state, files, workspace, initial, importFile, editJob };
}
async function fixture(run: (value: Awaited<ReturnType<typeof prepare>>) => Promise<void>) {
  const value = await prepare();
  try {
    await run(value);
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
}

it('publishes readable brief/job/plan projections and detects exact edited bytes by digest', async () => {
  await fixture(async ({ files, initial }) => {
    expect(
      (await inspectWorkspaceProjections(files, initial, samplePlan())).every(
        (entry) => entry.state === 'current',
      ),
    ).toBe(true);
    const brief = (await files.read('brief.md'))!;
    expect(brief.content).toContain('> Explain the workflow');
    expect(brief.digest).toMatch(/^[a-f0-9]{64}$/);
    expect((await files.read('plan/revisions/1/storyboard.md'))!.content).toContain(
      'Welcome to the tutorial.',
    );
    await files.write('brief.md', brief.content, brief.content.replace('Beginners', 'Experts'));
    expect(
      (await inspectWorkspaceProjections(files, initial, samplePlan())).find(
        (entry) => entry.path === 'brief.md',
      )?.state,
    ).toBe('edited');
  });
});

it('deliberately imports Markdown brief edits as a new revision with no approval', async () => {
  await fixture(async ({ files, importFile, state }) => {
    const brief = (await files.read('brief.md'))!.content;
    await files.write('brief.md', brief, brief.replace('> Beginners', '> Advanced readers'));
    const result = await importFile('brief.md');
    expect(result.job.brief.audience).toBe('Advanced readers');
    expect(result.job.brief.revision).toBe(2);
    expect(result.job.status).toMatchObject({
      revision: 2,
      lifecycle: 'waiting',
      waitReason: 'input',
      delivery: null,
    });
    expect(result.projectionConflicts).toEqual([]);
    expect(state.commits[0]!.approvals).toEqual([]);
    expect(state.plans).toHaveLength(1); // Original plan history is retained.
    const next = (await files.read('brief.md'))!.content;
    await files.write('brief.md', next, next.replace('> Advanced readers', '> Other readers'));
    expect((await importFile('brief.md', 2)).job.brief.revision).toBe(3);
  });
});

it('imports plan edits as a new approval-waiting revision and retains original history', async () => {
  await fixture(async ({ root, importFile, state }) => {
    const path = 'plan/revisions/1/plan.json';
    const original = await readFile(join(root, path), 'utf8');
    const edited = JSON.parse(original);
    edited.document.scenes[0].narration = 'A revised introduction.';
    await writeFile(join(root, path), JSON.stringify(edited));
    const result = await importFile(path);
    expect(result.plan?.revision).toBe(2);
    expect(result.plan?.basedOnJobRevision).toBe(2);
    expect(result.job.status.waitReason).toBe('approval');
    expect(result.job.status.delivery).toBeNull();
    expect(state.plans[0]!.scenes[0]!.narration).toBe('Welcome to the tutorial.');
    expect(state.commits[0]!.approvals).toEqual([]);
    expect(state.commits[0]!.dispatch).toEqual([]);
    expect(await readFile(join(root, path), 'utf8')).toBe(original);
    expect(await readFile(join(root, 'plan/revisions/2/plan.json'), 'utf8')).toContain(
      'A revised introduction.',
    );
  });
});

it('rejects stale projection bases and concurrent repository revisions without changing files', async () => {
  await fixture(async ({ root, state, editJob, importFile }) => {
    await editJob((record) => {
      (record.document as { audience: string }).audience = 'Changed';
      record.baseJobRevision = 2;
    });
    await expect(importFile()).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    expect(state.commits).toEqual([]);
    await editJob((record) => {
      record.baseJobRevision = 1;
    });
    const edited = await readFile(join(root, 'job.json'), 'utf8');
    state.race = true;
    await expect(importFile()).rejects.toThrow('transactional revision');
    expect(await readFile(join(root, 'job.json'), 'utf8')).toBe(edited);
    expect(state.commits).toEqual([]);
  });
});

it('rejects conflicting independent edits and never silently overwrites them', async () => {
  await fixture(async ({ root, state, files, importFile, editJob }) => {
    await editJob((record) => {
      (record.document as { audience: string }).audience = 'JSON audience';
    });
    const brief = (await files.read('brief.md'))!.content;
    await writeFile(join(root, 'brief.md'), brief.replace('> Beginners', '> Markdown audience'));
    await expect(importFile()).rejects.toThrow('unimported edits');
    expect(state.commits).toEqual([]);
    await expect(files.write('brief.md', brief, 'replacement')).rejects.toMatchObject({
      code: 'REVISION_CONFLICT',
    });
    expect(await readFile(join(root, 'brief.md'), 'utf8')).toContain('Markdown audience');
  });
});

it('rejects forged approval/status, unknown fields, identity changes, and policy relaxation', async () => {
  await fixture(async ({ root, state, editJob, importFile, files }) => {
    const original = (await files.read('job.json'))!.content;
    for (const change of [
      (record: Record<string, unknown>) => {
        (record.status as { delivery: string }).delivery = 'ready';
      },
      (record: Record<string, unknown>) => {
        record.approval = true;
      },
      (record: Record<string, unknown>) => {
        (record.document as { id: string }).id = 'different';
      },
      (record: Record<string, unknown>) => {
        (record.document as { overrides: unknown }).overrides = { policy: { budgetUsdMicros: 1 } };
      },
    ]) {
      await writeFile(join(root, 'job.json'), original);
      await editJob(change);
      await expect(importFile()).rejects.toThrow();
    }
    expect(state.commits).toEqual([]);
  });
});

it('reports a post-commit file conflict as an accepted revision needing projection refresh', async () => {
  await fixture(async ({ root, state, editJob, importFile }) => {
    await editJob((record) => {
      (record.document as { audience: string }).audience = 'Imported';
    });
    state.afterCommit = async () => {
      await writeFile(join(root, 'job.json'), 'A newer external edit');
    };
    const result = await importFile();
    expect(result.job.status.revision).toBe(2);
    expect(state.job.brief.audience).toBe('Imported');
    expect(result.projectionConflicts).toEqual(['job.json']);
    expect(await readFile(join(root, 'job.json'), 'utf8')).toBe('A newer external edit');
  });
});

it('rejects path escapes and redirected projection files', async () => {
  await fixture(async ({ root, files }) => {
    await expect(files.read('../outside')).rejects.toThrow();
    await symlink(root, join(root, 'redirect'), 'junction');
    await expect(files.write('redirect/other.json', null, '{}')).rejects.toThrow('symlink');
    await expect(files.read('redirect/job.json')).rejects.toThrow('redirected');
  });
});

it('preserves a paused job and requires explicit resume before importing into a cancelled job', async () => {
  await fixture(async ({ state, files, importFile }) => {
    state.job.status.lifecycle = 'paused';
    state.job.status.waitReason = null;
    const paths = workspaceProjectionDocuments(state.job, state.plans[0]!);
    const expected: Record<string, string | null> = {};
    for (const path of Object.keys(paths))
      expected[path] = (await files.read(path))?.content ?? null;
    await publishWorkspaceProjections(files, state.job, state.plans[0]!, expected);
    const brief = (await files.read('brief.md'))!.content;
    await files.write('brief.md', brief, brief.replace('> Beginners', '> Paused readers'));
    expect((await importFile('brief.md')).job.status.lifecycle).toBe('paused');
    state.job.status.lifecycle = 'cancelled';
    state.job.status.delivery = 'cancelled';
    await expect(importFile('brief.md', 2)).rejects.toThrow('Resume the cancelled');
  });
});
