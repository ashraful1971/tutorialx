import {
  type JobBrief,
  type JobCreation,
  jobBriefSchema,
  jobCreationSchema,
  type WorkspaceLayout,
  workspaceConfigSchema,
} from '@tutorialx/contracts';

export interface WorkspaceIdentity {
  newId(prefix: 'workspace' | 'job'): string;
  now(): string;
}

export async function initializeWorkspace(
  layout: WorkspaceLayout,
  identity: WorkspaceIdentity,
  options: { contentRoot?: string; sourceRoots?: string[] } = {},
) {
  const existing = await layout.readConfiguration();
  if (existing && options.contentRoot !== undefined && options.contentRoot !== existing.contentRoot)
    throw new Error(
      'Workspace already uses another content root; an explicit migration is required.',
    );
  if (
    existing &&
    options.sourceRoots !== undefined &&
    JSON.stringify(options.sourceRoots) !== JSON.stringify(existing.sourceRoots)
  )
    throw new Error('Workspace source roots must be changed through an explicit revision.');
  const configuration =
    existing ??
    workspaceConfigSchema.parse({
      schemaVersion: 1,
      id: identity.newId('workspace'),
      createdAt: identity.now(),
      revision: 1,
      contentRoot: options.contentRoot ?? 'tutorialx-videos',
      sourceRoots: options.sourceRoots ?? ['.'],
      exclusions: ['.git', 'node_modules', '.env', '.env.*', '.tutorialx', 'tutorialx-videos'],
      defaults: {},
      policyCeiling: {
        mode: 'review',
        localOnly: true,
        budgetUsdMicros: 0,
        researchBudgetUsdMicros: 0,
        maxAttempts: 3,
        maxRepairs: 2,
        deadlineAt: null,
        allowedOrigins: [],
        mutationTargets: [],
        requiredReviewModalities: ['text', 'image', 'audio'],
      },
    });
  const result = await layout.initialize(configuration);
  if (result.configuration.contentRoot !== configuration.contentRoot)
    throw new Error(
      'Concurrent initialization selected another content root; inspect the existing workspace.',
    );
  return result;
}

/** Produce a new brief and its files; job scheduling/persistence is a separate repository operation. */
export async function createWorkspaceJob(
  layout: WorkspaceLayout,
  identity: WorkspaceIdentity,
  request: JobCreation,
): Promise<{ brief: JobBrief; directory: string }> {
  const workspace = await layout.readConfiguration();
  if (!workspace) throw new Error('Initialize the workspace before creating a job.');
  const brief = jobBriefSchema.parse({
    schemaVersion: 1,
    id: identity.newId('job'),
    createdAt: identity.now(),
    workspaceId: workspace.id,
    revision: 1,
    instructions: '',
    overrides: {},
    sourceIds: [],
    profiles: [],
    ...jobCreationSchema.parse(request),
  });
  const slug =
    brief.title
      .normalize('NFKD')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 64)
      .replace(/-$/, '') || 'video';
  const directory = await layout.createJobDirectory(brief, `${brief.id}-${slug}`);
  return { brief, directory };
}
