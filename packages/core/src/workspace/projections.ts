import {
  executionPolicySchema,
  type JobBrief,
  type JobRecord,
  type JobRepository,
  jobBriefSchema,
  jobProjectionSchema,
  jobStatusSchema,
  type PlanRevision,
  planProjectionSchema,
  planRevisionSchema,
  type WorkspaceConfig,
  type WorkspaceProjectionFiles,
} from '@tutorialx/contracts';
import { assertSettingsPolicy } from './settings.js';

export class ProjectionRevisionConflict extends Error {
  readonly code = 'REVISION_CONFLICT';
}
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const quote = (value: string) =>
  value
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');

/** Blockquotes make headings within operator text unambiguous when importing the brief. */
export function renderBriefProjection(brief: JobBrief, baseJobRevision: number): string {
  const { title, topic, audience, instructions, ...metadata } = brief;
  return `<!-- tutorialx-brief-v1 -->\n\`\`\`json\n${json({ baseJobRevision, ...metadata })}\`\`\`\n\n# Title\n${quote(title)}\n\n## Topic\n${quote(topic)}\n\n## Audience\n${quote(audience)}\n\n## Instructions\n${quote(instructions)}\n`;
}

function parseBriefProjection(content: string): { baseJobRevision: number; document: JobBrief } {
  const match =
    /^<!-- tutorialx-brief-v1 -->\n```json\n([^]*?)\n```\n\n# Title\n([^]*?)\n\n## Topic\n([^]*?)\n\n## Audience\n([^]*?)\n\n## Instructions\n([^]*)\n$/.exec(
      content.replaceAll('\r\n', '\n'),
    );
  if (!match)
    throw new Error(
      'Brief projection format is invalid; retain its metadata and section headings.',
    );
  const metadata = JSON.parse(match[1]!) as Record<string, unknown>;
  const { baseJobRevision, ...record } = metadata;
  const unquote = (value: string) =>
    value
      .split('\n')
      .map((line) => {
        if (!line.startsWith('> '))
          throw new Error('Brief content lines must retain their blockquote marker.');
        return line.slice(2);
      })
      .join('\n');
  const document = jobBriefSchema.parse({
    ...record,
    title: unquote(match[2]!),
    topic: unquote(match[3]!),
    audience: unquote(match[4]!),
    instructions: unquote(match[5]!),
  });
  const checked = jobProjectionSchema.parse({
    schemaVersion: 1,
    baseJobRevision,
    document,
    status: {
      jobId: document.id,
      revision: baseJobRevision,
      lifecycle: 'waiting',
      waitReason: 'input',
      delivery: null,
      completedStages: 0,
      totalStages: 0,
    },
  });
  return { baseJobRevision: checked.baseJobRevision, document };
}

export function workspaceProjectionDocuments(
  job: JobRecord,
  plan: PlanRevision | null,
): Record<string, string> {
  const files: Record<string, string> = {
    'job.json': json({
      schemaVersion: 1,
      baseJobRevision: job.status.revision,
      document: job.brief,
      status: job.status,
    }),
    'brief.md': renderBriefProjection(job.brief, job.status.revision),
  };
  if (plan) {
    const prefix = `plan/revisions/${plan.revision}`;
    files[`${prefix}/plan.json`] = json({
      schemaVersion: 1,
      baseJobRevision: job.status.revision,
      document: plan,
    });
    files[`${prefix}/storyboard.md`] =
      `# Storyboard: revision ${plan.revision}\n\nReview projection. Submit edits through plan.json; this document cannot authorize production.\n\n${plan.scenes.map((scene) => `## ${scene.title}\n\nNarration:\n${quote(scene.narration)}\n\nIntent:\n${quote(scene.intent)}\n\nVisual:\n\`\`\`json\n${json(scene.visual)}\`\`\`\n`).join('\n')}`;
  }
  return files;
}

export async function inspectWorkspaceProjections(
  files: WorkspaceProjectionFiles,
  job: JobRecord,
  plan: PlanRevision | null,
) {
  const expected = workspaceProjectionDocuments(job, plan);
  return Promise.all(
    Object.entries(expected).map(async ([path, content]) => {
      const actual = await files.read(path);
      return {
        path,
        state:
          actual === null
            ? ('missing' as const)
            : actual.content === content
              ? ('current' as const)
              : ('edited' as const),
        digest: actual?.digest ?? null,
      };
    }),
  );
}

/** Publish only bytes verified by the caller; existing edits are never implicitly discarded. */
export async function publishWorkspaceProjections(
  files: WorkspaceProjectionFiles,
  job: JobRecord,
  plan: PlanRevision | null,
  expected: Readonly<Record<string, string | null>>,
) {
  for (const [path, content] of Object.entries(workspaceProjectionDocuments(job, plan))) {
    if (!(path in expected))
      throw new ProjectionRevisionConflict(`Inspect ${path} before publishing.`);
    await files.write(path, expected[path]!, content);
  }
}

export async function importWorkspaceProjection(input: {
  repository: JobRepository;
  files: WorkspaceProjectionFiles;
  workspace: WorkspaceConfig;
  jobId: string;
  expectedRevision: number;
  path: string;
  now(): string;
}): Promise<{ job: JobRecord; plan: PlanRevision | null; projectionConflicts: string[] }> {
  const { repository, files } = input;
  const current = await repository.read(input.jobId);
  if (!current || current.brief.workspaceId !== input.workspace.id)
    throw new Error('Job is not available in this workspace.');
  if (current.status.revision !== input.expectedRevision)
    throw new ProjectionRevisionConflict('Job revision changed before import.');
  if (current.status.lifecycle === 'cancelled')
    throw new ProjectionRevisionConflict(
      'Resume the cancelled job explicitly before importing an edit.',
    );
  const attempts = await repository.attempts(input.jobId);
  if (attempts.some((attempt) => attempt.status === 'running'))
    throw new ProjectionRevisionConflict('Pause active production before importing an edit.');
  const plans = await repository.plans(input.jobId);
  const latest =
    [...plans]
      .filter((plan) => plan.basedOnJobRevision >= current.brief.revision)
      .sort((a, b) => b.revision - a.revision)[0] ?? null;
  const before = workspaceProjectionDocuments(current, latest);
  if (!(input.path in before) || input.path.endsWith('storyboard.md'))
    throw new Error(
      'Import brief.md, job.json, or the current plan.json; storyboard Markdown is a review projection.',
    );
  const edited = await files.read(input.path);
  if (!edited) throw new Error('Projection file is missing.');
  const expected: Record<string, string | null> = {};
  for (const [path, content] of Object.entries(before)) {
    const actual = await files.read(path);
    expected[path] = actual?.content ?? null;
    if (path === input.path && actual?.content !== edited.content)
      throw new ProjectionRevisionConflict('Projection changed during import inspection.');
    if (path !== input.path && actual !== null && actual.content !== content)
      throw new ProjectionRevisionConflict(`Another projection has unimported edits: ${path}.`);
  }
  let brief = current.brief;
  let plan: PlanRevision | null = null;
  let baseJobRevision: number;
  if (input.path.endsWith('/plan.json')) {
    const parsed = planProjectionSchema.parse(JSON.parse(edited.content));
    baseJobRevision = parsed.baseJobRevision;
    if (
      !latest ||
      parsed.document.id !== latest.id ||
      parsed.document.jobId !== input.jobId ||
      parsed.document.revision !== latest.revision ||
      parsed.document.createdAt !== latest.createdAt ||
      parsed.document.basedOnJobRevision !== latest.basedOnJobRevision
    )
      throw new ProjectionRevisionConflict(
        'Plan identity or revision does not match its projection base.',
      );
    assertSettingsPolicy(parsed.document.effective.settings.policy, input.workspace.policyCeiling);
    plan = planRevisionSchema.parse({
      ...parsed.document,
      revision: latest.revision + 1,
      createdAt: input.now(),
      basedOnJobRevision: current.status.revision + 1,
    });
  } else {
    let parsed: { baseJobRevision: number; document: JobBrief };
    if (input.path === 'brief.md') parsed = parseBriefProjection(edited.content);
    else {
      const job = jobProjectionSchema.parse(JSON.parse(edited.content));
      if (JSON.stringify(job.status) !== JSON.stringify(jobStatusSchema.parse(current.status)))
        throw new Error(
          'Projected status is read-only and cannot grant approval or change execution state.',
        );
      parsed = job;
    }
    baseJobRevision = parsed.baseJobRevision;
    if (
      parsed.document.id !== current.brief.id ||
      parsed.document.workspaceId !== current.brief.workspaceId ||
      parsed.document.revision !== current.brief.revision ||
      parsed.document.createdAt !== current.brief.createdAt
    )
      throw new ProjectionRevisionConflict(
        'Brief identity or revision does not match its projection base.',
      );
    assertSettingsPolicy(
      executionPolicySchema.parse({
        ...input.workspace.policyCeiling,
        ...parsed.document.overrides.policy,
      }),
      input.workspace.policyCeiling,
    );
    brief = jobBriefSchema.parse({ ...parsed.document, revision: current.status.revision + 1 });
  }
  if (baseJobRevision !== current.status.revision)
    throw new ProjectionRevisionConflict('Projection was produced from a stale job revision.');
  if (edited.content === before[input.path]) throw new Error('Projection has no edits to import.');
  const revision = current.status.revision + 1;
  if (brief === current.brief) brief = { ...current.brief, revision };
  const job: JobRecord = {
    brief,
    status: {
      ...current.status,
      revision,
      lifecycle: current.status.lifecycle === 'paused' ? 'paused' : 'waiting',
      waitReason: current.status.lifecycle === 'paused' ? null : plan ? 'approval' : 'input',
      delivery: null,
      completedStages: 0,
    },
  };
  const after = workspaceProjectionDocuments(job, plan);
  // Retain canonical historical views after importing an edit into a new revision.
  for (const [path, content] of Object.entries(before)) if (!(path in after)) after[path] = content;
  for (const path of Object.keys(after))
    if (!(path in expected)) {
      const previous = await files.read(path);
      if (previous !== null)
        throw new ProjectionRevisionConflict(`New revision path already exists: ${path}.`);
      expected[path] = null;
    }
  await repository.commit({
    jobId: input.jobId,
    expectedRevision: current.status.revision,
    job,
    fence: null,
    attempts: attempts.map((attempt) => ({
      ...attempt,
      status: 'invalidated',
      lease: null,
      waitReason: null,
      finishedAt: input.now(),
    })),
    artifacts: [],
    plans: plan ? [plan] : [],
    approvals: [],
    operations: [],
    events: [],
    dispatch: [],
  });
  const projectionConflicts: string[] = [];
  for (const [path, content] of Object.entries(after)) {
    try {
      await files.write(path, expected[path]!, content);
    } catch {
      projectionConflicts.push(path);
    }
  }
  return { job, plan, projectionConflicts };
}
