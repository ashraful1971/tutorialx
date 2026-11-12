import { createHash } from 'node:crypto';
import {
  createLocalSourceRegistrar,
  createLocalWorkspaceLayout,
  createSqlitePersistence,
  type SqlitePersistence,
} from '@tutorialx/adapters';
import {
  type ActionDescriptor,
  type ActionErrorCode,
  type ActionRequest,
  type ActionResponse,
  actionDescriptorSchema,
  actionRequestSchema,
  actionResponseSchema,
  canonicalJson,
  doctorInputSchema,
  FOUNDATION_ACTION_SCHEMAS,
  foundationActionSchema,
  idSchema,
  type JobMutation,
  type JobRecord,
  type JsonObject,
  jobContextInputSchema,
  jobCreationSchema,
  jobIdentityInputSchema,
  jobInspectInputSchema,
  jobSubmitInputSchema,
  listInputSchema,
  type NextAction,
  PUBLIC_SCHEMAS,
  planDiffInputSchema,
  planReviseInputSchema,
  planShowInputSchema,
  publicSchema,
  schemaInputSchema,
  skillCommandInputSchema,
  sourceCreateInputSchema,
  sourceInspectInputSchema,
  sourceListInputSchema,
  submissionInspectInputSchema,
  type WorkspaceConfig,
  workspaceInitInputSchema,
} from '@tutorialx/contracts';
import {
  comparePlanRevisions,
  createWorkspaceJob,
  evaluatePlanApproval,
  initializeWorkspace,
  redactPublicValue,
  registerWorkspaceSource,
  resolveSettings,
} from '@tutorialx/core';
import {
  type ActionDependencies,
  ActionFailure,
  type ActionServiceOptions,
  digest,
  id,
  json,
  next,
} from './action-support.js';
import { builtInSettings } from './defaults.js';
import { diagnoseRecipe } from './doctor.js';
import { jobDirectory, workspaceDatabase } from './files.js';
import { executeInspectionAction } from './inspection.js';
import { createLifecycleHandler } from './lifecycle.js';
import { executeSkillCommand, SkillCommandFailure } from './skill.js';
import { createSubmissionHandler } from './submissions.js';

export const MAX_REQUEST_BYTES = 1024 * 1024;
export const MAX_RESPONSE_BYTES = 256 * 1024;

const descriptions: Record<keyof typeof FOUNDATION_ACTION_SCHEMAS, string> = {
  'skill.install': 'Preview or explicitly apply a managed skill installation.',
  'skill.update': 'Preview or explicitly apply a managed skill update.',
  'skill.remove': 'Preview or explicitly remove only managed skill files.',
  'workspace.init': 'Initialize a private workspace and its content directory.',
  'job.create': 'Create and persist a video brief.',
  'job.inspect': 'Inspect current job state and permitted next actions.',
  'job.list': 'List bounded summaries of persisted jobs.',
  'job.context': 'Read a bounded role-specific planning handoff.',
  'job.submit': 'Validate and persist research, plans, review observations, or revision feedback.',
  'job.submission': 'Retrieve an accepted submission independently of the original conversation.',
  'source.create': 'Register scoped source data without granting execution authority.',
  'source.inspect': 'Inspect one registered source.',
  'source.list': 'List bounded source summaries.',
  capabilities: 'Discover implemented actions, schemas, dependencies, and execution policy.',
  schema: 'Retrieve one versioned action input or public contract schema.',
  doctor: 'Diagnose only the selected recipe providers and dependencies.',
  events: 'Read redacted job events after a durable cursor.',
  'artifact.list': 'List accepted artifact metadata in bounded pages.',
  'artifact.read': 'Read a verified accepted artifact by bounded range.',
  'plan.show': 'Show an accepted plan revision.',
  'plan.diff': 'Compare two accepted plan revisions.',
  'plan.approve': 'Explicitly approve the exact plan revision as an authorized operator.',
  'plan.revise': 'Validate a new immutable plan revision.',
  'job.run': 'Persist an approved production request for a capable worker.',
  'job.pause': 'Pause dispatch while preserving in-flight operation accounting.',
  'job.resume': 'Resume a paused or cancelled job through current authorization gates.',
  'job.cancel': 'Cancel the job and request cancellation of active operations.',
  'job.retry': 'Request retry of a failed job after classifying prior operations.',
  'job.check': 'Request quality checks from a capable worker.',
  'job.export': 'Request gated export from a capable worker.',
};
const lifecycleActions = new Set([
  'job.run',
  'job.pause',
  'job.resume',
  'job.cancel',
  'job.retry',
  'job.check',
  'job.export',
]);
const mutations = new Set([
  'job.create',
  'source.create',
  'job.submit',
  'plan.approve',
  'plan.revise',
  ...lifecycleActions,
]);

export function foundationActionDescriptors(): ActionDescriptor[] {
  return Object.entries(descriptions).map(([name, description]) =>
    actionDescriptorSchema.parse({
      name,
      description,
      inputSchemaId: `urn:tutorialx:action:1:${name}:input`,
      outputSchemaId: 'urn:tutorialx:schema:1:ActionResponse',
      readOnly: name !== 'workspace.init' && !mutations.has(name) && !name.startsWith('skill.'),
      asynchronous: ['job.run', 'job.check', 'job.export', 'job.retry', 'job.resume'].includes(
        name,
      ),
      requiredCapabilities:
        name.startsWith('skill.') || ['plan.approve', ...lifecycleActions].includes(name)
          ? ['operator']
          : [],
      requiresRevision: mutations.has(name) && name !== 'job.create',
      requiresIdempotency: mutations.has(name),
    }),
  );
}

export type { ActionAuthority, ActionServiceOptions } from './action-support.js';

export function createActionService(options: ActionServiceOptions) {
  idSchema.parse(options.authority.actorId);
  const now = options.now ?? (() => new Date().toISOString());
  const layout = createLocalWorkspaceLayout(options.projectDirectory);
  function payloadRange(
    value: unknown,
    field: string,
    offset?: number,
    length?: number,
  ): JsonObject {
    const safe = redactPublicValue(value, options.knownSecrets ?? []);
    const bytes = Buffer.from(JSON.stringify(safe));
    if (offset === undefined && length === undefined && bytes.length <= 128 * 1024)
      return json({ [field]: safe });
    const start = offset ?? 0;
    if (start > bytes.length)
      throw new ActionFailure('INVALID_INPUT', 'Requested offset exceeds the payload size.');
    const end = Math.min(bytes.length, start + (length ?? 65_536));
    return {
      field,
      encoding: 'base64',
      content: bytes.subarray(start, end).toString('base64'),
      offset: start,
      length: end - start,
      totalBytes: bytes.length,
      digest: createHash('sha256').update(bytes).digest('hex'),
      nextOffset: end < bytes.length ? end : null,
    };
  }

  function boundedView(value: unknown, offset?: number, length?: number) {
    const bounded = payloadRange(value, 'data', offset, length);
    return 'encoding' in bounded ? bounded : (bounded.data as JsonObject);
  }

  async function open() {
    const workspace = await layout.readConfiguration();
    if (!workspace)
      throw new ActionFailure('MISSING_PREREQUISITE', 'Initialize the workspace first.', {}, [
        next('workspace.init', 'Initialize this workspace.'),
      ]);
    const persistence = await createSqlitePersistence({
      filename: await workspaceDatabase(options.projectDirectory),
      workspaceId: workspace.id,
      now,
    });
    await persistence.repository.initialize();
    return { workspace, persistence };
  }
  async function job(persistence: SqlitePersistence, jobId: string) {
    if (options.authority.jobIds && !options.authority.jobIds.includes(jobId))
      throw new ActionFailure(
        'POLICY_DENIED',
        'This transport is not authorized for the requested job.',
      );
    const record = await persistence.repository.read(jobId);
    if (!record) throw new ActionFailure('NOT_FOUND', 'Job not found.', { jobId });
    return record;
  }
  function effective(
    workspace: WorkspaceConfig,
    record: { brief: Pick<JobRecord['brief'], 'profiles' | 'overrides'> },
  ) {
    if (record.brief.profiles.length)
      throw new ActionFailure(
        'CAPABILITY_UNAVAILABLE',
        'Profile resolution requires a configured profile loader.',
      );
    return resolveSettings(
      { defaults: builtInSettings(), workspace, overrides: record.brief.overrides },
      (profile) => digest(json(profile)),
    ).effective;
  }
  async function events(persistence: SqlitePersistence, jobId: string) {
    const result = [];
    let cursor = 0;
    for (let count = 0; count < 100; count++) {
      const page = await persistence.repository.events(jobId, cursor, 100);
      result.push(...page);
      if (page.length < 100) return result;
      cursor = page.at(-1)!.cursor;
    }
    throw new ActionFailure(
      'CAPABILITY_UNAVAILABLE',
      'Submission history exceeds the foundation event limit.',
    );
  }
  function mutation(request: ActionRequest, record: JobRecord, data: JsonObject): JobMutation {
    return {
      jobId: record.brief.id,
      expectedRevision: record.status.revision,
      job: {
        brief: record.brief,
        status: { ...record.status, revision: record.status.revision + 1 },
      },
      fence: null,
      attempts: [],
      artifacts: [],
      plans: [],
      approvals: [],
      operations: [],
      dispatch: [],
      events: [
        {
          schemaVersion: 1,
          id: id('event'),
          createdAt: now(),
          workspaceId: record.brief.workspaceId,
          jobId: record.brief.id,
          attemptId: null,
          cursor: 1,
          requestId: request.requestId,
          traceId: request.requestId,
          kind: 'submission',
          level: 'info',
          data,
        },
      ],
    };
  }
  function checkRevision(request: ActionRequest, record: JobRecord) {
    if (request.expectedRevision !== record.status.revision)
      throw new ActionFailure(
        'REVISION_CONFLICT',
        'Refresh context before submitting a mutation.',
        { expectedRevision: request.expectedRevision, currentRevision: record.status.revision },
        [next('job.context', 'Refresh the current job context.', { jobId: record.brief.id })],
      );
  }
  async function nextActions(
    persistence: SqlitePersistence,
    record: JobRecord,
  ): Promise<NextAction[]> {
    const params = { jobId: record.brief.id };
    if (['finished', 'cancelled'].includes(record.status.lifecycle)) return [];
    const history = await events(persistence, record.brief.id);
    const research = history.findLast((event) => event.data.kind === 'research');
    const plans = await persistence.repository.plans(record.brief.id);
    const plan = plans.at(-1);
    if (record.status.lifecycle === 'paused')
      return [next('job.resume', 'Resume this paused job explicitly.', params, true)];
    if (plan && plan.basedOnJobRevision >= record.brief.revision) {
      const approval = await authorization(persistence, record, plan);
      if (!approval.authorized)
        return [
          next(
            'plan.approve',
            'An operator must approve this exact plan revision.',
            { ...params, planRevision: plan.revision, decision: 'approve' },
            true,
          ),
        ];
      if (record.status.lifecycle === 'queued' || record.status.lifecycle === 'running')
        return [
          next('events', 'Inspect worker progress after the current cursor.', {
            ...params,
            afterCursor: 0,
          }),
        ];
      return [next('job.run', 'Request production by a capable worker.', params, true)];
    }
    if (
      research &&
      typeof research.data.acceptedRevision === 'number' &&
      research.data.acceptedRevision >= record.brief.revision
    )
      return [
        next('job.context', 'Prepare a writer/director handoff for a schema-checked plan.', {
          ...params,
          role: 'writer-director',
        }),
      ];
    const sources = await persistence.research.sources(record.brief.id);
    if (!sources.length)
      return [
        next('source.create', 'Register relevant source material before research.', params, true),
      ];
    return [
      next('job.context', 'Prepare the researcher handoff and submit evidence-linked research.', {
        ...params,
        role: 'researcher',
      }),
    ];
  }

  async function acceptedEvidence(persistence: SqlitePersistence, record: JobRecord) {
    const history = await events(persistence, record.brief.id);
    const latest = history.findLast(
      (event) =>
        event.data.kind === 'research' &&
        typeof event.data.acceptedRevision === 'number' &&
        event.data.acceptedRevision >= record.brief.revision,
    );
    const report = (latest?.data.payload as JsonObject | undefined)?.report as
      | JsonObject
      | undefined;
    const ids = Array.isArray(report?.evidenceIds) ? (report.evidenceIds as string[]) : [];
    const evidence = (await persistence.research.evidence(record.brief.id))
      .filter((item) => ids.includes(item.id))
      .sort((a, b) => a.id.localeCompare(b.id));
    return { report, digest: digest({ evidence }) };
  }
  async function authorization(
    persistence: SqlitePersistence,
    record: JobRecord,
    plan: Awaited<ReturnType<SqlitePersistence['repository']['plans']>>[number],
  ) {
    const currentEvidence = await acceptedEvidence(persistence, record);
    if (
      plan.basedOnJobRevision < record.brief.revision ||
      currentEvidence.report?.id !== plan.researchReportId
    )
      return { authorized: false, approvalId: null, reason: 'Plan or research is stale.' };
    const history = await events(persistence, record.brief.id);
    return evaluatePlanApproval({
      plan,
      evidenceDigest: currentEvidence.digest,
      fingerprint: (value) => digest(json(value)),
      approvals: await persistence.repository.approvals(record.brief.id),
      now: now(),
      isTrustedApproval: (approval) =>
        history.some(
          (event) =>
            event.data.kind === 'operator-approval' &&
            event.data.approvalId === approval.id &&
            event.data.actorId === approval.actor.id &&
            event.data.origin === 'local-cli' &&
            approval.actor.origin === 'local-cli',
        ),
    });
  }

  const dependencies: ActionDependencies = {
    options,
    now,
    events,
    nextActions,
    mutation,
    checkRevision,
    job,
    effective,
    authorization,
    acceptedEvidence,
  };
  const control = createLifecycleHandler(dependencies);
  const submit = createSubmissionHandler(dependencies);

  async function dispatch(request: ActionRequest): Promise<ActionResponse> {
    if (
      !options.authority.actions.includes(request.action) &&
      !options.authority.actions.includes('*')
    )
      throw new ActionFailure(
        'POLICY_DENIED',
        'This transport is not authorized for the requested action.',
      );
    const validator =
      FOUNDATION_ACTION_SCHEMAS[request.action as keyof typeof FOUNDATION_ACTION_SCHEMAS];
    if (!validator)
      throw new ActionFailure('NOT_FOUND', 'Unknown action.', {}, [
        next('capabilities', 'Discover implemented actions.'),
      ]);
    const parsed = validator.safeParse(request.params);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .slice(0, 20)
        .map((issue) => ({ path: issue.path.join('.'), message: issue.message.slice(0, 300) }));
      const actions = [
        next('schema', 'Inspect the action input schema.', { name: request.action }),
      ];
      if (Object.keys(request.params).length === 0)
        return {
          apiVersion: 1,
          requestId: request.requestId,
          status: 'waiting',
          reason: 'input',
          code: 'NEEDS_INPUT',
          jobId: null,
          data: { issues },
          nextActions: actions,
        };
      throw new ActionFailure(
        'INVALID_INPUT',
        'Action parameters failed schema validation.',
        { issues },
        actions,
      );
    }
    if (mutations.has(request.action) && request.idempotencyKey === null)
      throw new ActionFailure('INVALID_INPUT', 'Supply a stable idempotencyKey for this mutation.');
    if (
      mutations.has(request.action) &&
      request.action !== 'job.create' &&
      request.expectedRevision === null
    )
      throw new ActionFailure('INVALID_INPUT', 'Supply expectedRevision from current job context.');
    const ok = (data: unknown, actions: NextAction[] = []): ActionResponse => ({
      apiVersion: 1,
      requestId: request.requestId,
      status: 'ok',
      data: json(data),
      nextActions: actions,
    });
    if (request.action.startsWith('skill.')) {
      if (options.authority.principalRole !== 'operator')
        throw new ActionFailure('POLICY_DENIED', 'Skill management requires operator authority.');
      try {
        return ok(
          await executeSkillCommand(
            request.action.slice(6) as 'install' | 'update' | 'remove',
            skillCommandInputSchema.parse(parsed.data),
            { projectDirectory: options.projectDirectory },
          ),
        );
      } catch (error) {
        if (error instanceof SkillCommandFailure)
          throw new ActionFailure(error.code, error.message);
        throw error;
      }
    }
    if (request.action === 'schema') {
      const { name } = schemaInputSchema.parse(parsed.data);
      if (name in FOUNDATION_ACTION_SCHEMAS)
        return ok({
          schema: foundationActionSchema(name as keyof typeof FOUNDATION_ACTION_SCHEMAS),
        });
      if (name in PUBLIC_SCHEMAS)
        return ok({ schema: publicSchema(name as keyof typeof PUBLIC_SCHEMAS) });
      throw new ActionFailure('NOT_FOUND', 'Unknown schema.');
    }
    if (request.action === 'workspace.init') {
      const input = workspaceInitInputSchema.parse(parsed.data);
      const result = await initializeWorkspace(
        layout,
        { newId: id, now },
        {
          ...(input.contentRoot === undefined ? {} : { contentRoot: input.contentRoot }),
          ...(input.sourceRoots === undefined ? {} : { sourceRoots: input.sourceRoots }),
        },
      );
      const opened = await open();
      await opened.persistence.repository.close();
      return ok(result, [next('job.create', 'Create a video brief.')]);
    }
    if (request.action === 'doctor')
      return ok(
        await diagnoseRecipe(doctorInputSchema.parse(request.params), { installedProviders: [] }),
      );
    if (request.action === 'capabilities') {
      const configuration = await layout.readConfiguration();
      return ok(
        {
          actions: foundationActionDescriptors().filter(
            (action) =>
              options.authority.actions.includes('*') ||
              options.authority.actions.includes(action.name),
          ),
          schemas: Object.keys(PUBLIC_SCHEMAS).sort(),
          roles: options.authority.roles,
          examples: [
            {
              action: 'job.create',
              params: { title: 'Example', topic: 'Explain a topic', audience: 'Beginners' },
            },
          ],
          providers: [
            {
              id: 'sqlite',
              kind: 'persistence',
              installed: true,
              capabilities: ['metadata:transactions', 'records:research'],
              dependencies: [
                {
                  id: 'node-sqlite',
                  ready: typeof process.versions.node === 'string',
                  version: process.versions.node,
                },
              ],
            },
          ],
          unavailableCapabilities: ['production', 'quality-gates', 'approval', 'media-rendering'],
          policy: configuration?.policyCeiling ?? null,
          limits: {
            maxRequestBytes: MAX_REQUEST_BYTES,
            maxResponseBytes: MAX_RESPONSE_BYTES,
            maxPageItems: 100,
          },
        },
        configuration
          ? [next('job.list', 'Inspect persisted jobs.')]
          : [next('workspace.init', 'Initialize this workspace.')],
      );
    }
    const { workspace, persistence } = await open();
    try {
      if (request.action === 'job.create') {
        const input = jobCreationSchema.parse(parsed.data);
        if (input.sourceIds?.length)
          throw new ActionFailure(
            'INVALID_INPUT',
            'Register sources after creating their owning job.',
          );
        if (input.profiles?.length)
          throw new ActionFailure(
            'CAPABILITY_UNAVAILABLE',
            'Profile resolution requires a configured profile loader.',
          );
        const jobId = `job_${digest({ workspaceId: workspace.id, key: request.idempotencyKey }).slice(0, 40)}`;
        if (options.authority.jobIds)
          throw new ActionFailure(
            'POLICY_DENIED',
            'Job-scoped transports cannot create a different job.',
          );
        const existing = await persistence.repository.read(jobId);
        if (existing) {
          const initial = (await persistence.revisions.revisions(jobId))[0] ?? existing;
          const {
            schemaVersion: _s,
            id: _i,
            createdAt: _c,
            workspaceId: _w,
            revision: _r,
            ...original
          } = initial.brief;
          const normalized = {
            instructions: '',
            sourceIds: [],
            profiles: [],
            overrides: {},
            ...input,
          };
          if (canonicalJson(json(original)) !== canonicalJson(json(normalized)))
            throw new ActionFailure(
              'REVISION_CONFLICT',
              'Creation key was used for another brief.',
            );
          return ok(
            { jobId, revision: existing.status.revision, replayed: true },
            await nextActions(persistence, existing),
          );
        }
        // Resolve policy before any content or authoritative metadata is written.
        effective(workspace, { brief: { profiles: [], overrides: input.overrides ?? {} } });
        const created = await createWorkspaceJob(layout, { newId: () => jobId, now }, input);
        const record: JobRecord = {
          brief: created.brief,
          status: {
            jobId,
            revision: 1,
            lifecycle: 'waiting',
            waitReason: 'input',
            delivery: null,
            completedStages: 0,
            totalStages: 0,
          },
        };
        await persistence.repository.create(record);
        return ok(
          { jobId, revision: 1, directory: created.directory },
          await nextActions(persistence, record),
        );
      }
      if (request.action === 'job.list') {
        const input = listInputSchema.parse(parsed.data);
        const page = await persistence.repository.list(input.cursor, input.limit);
        return ok({
          items: page.jobs
            .filter(
              (record) =>
                !options.authority.jobIds || options.authority.jobIds.includes(record.brief.id),
            )
            .map((record) => ({
              jobId: record.brief.id,
              title: record.brief.title,
              status: record.status,
            })),
          nextCursor: page.nextCursor,
        });
      }
      const jobId = jobIdentityInputSchema.parse({ jobId: request.params.jobId }).jobId;
      const record = await job(persistence, jobId);
      if (['events', 'artifact.list', 'artifact.read'].includes(request.action))
        return ok(
          await executeInspectionAction(request, persistence, {
            projectDirectory: options.projectDirectory,
            workspace,
            knownSecrets: options.knownSecrets ?? [],
            now,
          }),
        );
      if (request.action === 'plan.approve' || lifecycleActions.has(request.action))
        return await control(request, record, persistence);
      if (request.action === 'plan.show') {
        const input = planShowInputSchema.parse(request.params);
        const plans = await persistence.repository.plans(jobId);
        const plan =
          input.revision === undefined
            ? plans.at(-1)
            : plans.find((plan) => plan.revision === input.revision);
        if (!plan) throw new ActionFailure('NOT_FOUND', 'Plan revision not found.');
        return ok(
          payloadRange(plan, 'plan', input.offset, input.length),
          await nextActions(persistence, record),
        );
      }
      if (request.action === 'plan.diff') {
        const input = planDiffInputSchema.parse(request.params);
        const plans = await persistence.repository.plans(jobId);
        const before = plans.find((plan) => plan.revision === input.beforeRevision);
        const after = plans.find((plan) => plan.revision === input.afterRevision);
        if (!before || !after) throw new ActionFailure('NOT_FOUND', 'Plan revision not found.');
        return ok({
          beforeRevision: before.revision,
          afterRevision: after.revision,
          ...comparePlanRevisions(before, after),
        });
      }
      if (request.action === 'plan.revise') {
        const input = planReviseInputSchema.parse(request.params);
        return await submit(request, { ...input, kind: 'plan' }, record, workspace, persistence);
      }
      if (request.action === 'job.inspect') {
        const input = jobInspectInputSchema.parse(parsed.data);
        const plans = await persistence.repository.plans(jobId);
        const artifacts = await persistence.repository.artifacts(jobId, null, 10);
        return ok(
          boundedView(
            {
              brief: record.brief,
              status: record.status,
              plans: plans.slice(-10).map((plan) => ({
                id: plan.id,
                revision: plan.revision,
                sceneCount: plan.scenes.length,
              })),
              artifacts: artifacts.artifacts.map((artifact) => ({
                id: artifact.id,
                kind: artifact.kind,
                digest: artifact.digest,
              })),
              nextArtifactCursor: artifacts.nextCursor,
              blockingReason: record.status.waitReason,
            },
            input.offset,
            input.length,
          ),
          await nextActions(persistence, record),
        );
      }
      if (request.action === 'job.submit')
        return await submit(
          request,
          jobSubmitInputSchema.parse(parsed.data),
          record,
          workspace,
          persistence,
        );
      if (request.action === 'source.create') {
        const input = sourceCreateInputSchema.parse(parsed.data);
        const sourceId = `source_${digest({ jobId, key: request.idempotencyKey }).slice(0, 40)}`;
        const old = (await persistence.research.sources(jobId)).find(
          (source) => source.id === sourceId,
        );
        if (old) {
          const prior = (await events(persistence, jobId)).find(
            (event) =>
              event.data.kind === 'source' && event.data.idempotencyKey === request.idempotencyKey,
          );
          if (
            prior?.data.requestDigest !== digest(request.params) ||
            prior.data.actorId !== options.authority.actorId
          )
            throw new ActionFailure(
              'REVISION_CONFLICT',
              'Source key was used for another request or actor.',
              { sourceId },
            );
          return ok(
            { source: old, revision: prior.data.acceptedRevision, replayed: true },
            await nextActions(persistence, record),
          );
        }
        checkRevision(request, record);
        const registrar = createLocalSourceRegistrar({
          projectDirectory: options.projectDirectory,
          jobDirectory: await jobDirectory(options.projectDirectory, workspace, jobId),
          jobId,
          workspace,
          settingsDigest: digest(json(effective(workspace, record))),
        });
        const result = await registerWorkspaceSource(
          registrar,
          jobId,
          { newId: () => sourceId, now },
          input.source,
        );
        const transaction = mutation(request, record, {
          actorId: options.authority.actorId,
          idempotencyKey: request.idempotencyKey,
          requestDigest: digest(request.params),
          kind: 'source',
          sourceId,
          acceptedRevision: record.status.revision + 1,
        });
        transaction.job.brief = {
          ...record.brief,
          revision: record.status.revision + 1,
          sourceIds: [...record.brief.sourceIds, sourceId],
        };
        transaction.artifacts = result.snapshot ? [result.snapshot] : [];
        await persistence.research.commitResearch(transaction, {
          sources: [result.source],
          evidence: [],
        });
        return ok(
          { source: result.source, revision: transaction.job.status.revision },
          await nextActions(persistence, transaction.job),
        );
      }
      if (request.action === 'source.inspect') {
        const input = sourceInspectInputSchema.parse(parsed.data);
        const source = (await persistence.research.sources(jobId)).find(
          (source) => source.id === input.sourceId,
        );
        if (!source) throw new ActionFailure('NOT_FOUND', 'Source not found.');
        return ok({ source }, await nextActions(persistence, record));
      }
      if (request.action === 'source.list') {
        const input = sourceListInputSchema.parse(parsed.data);
        const sources = [...(await persistence.research.sources(jobId))].sort((a, b) =>
          a.id.localeCompare(b.id),
        );
        let after = '';
        if (input.cursor) {
          after = Buffer.from(input.cursor, 'base64url').toString();
          if (
            !idSchema.safeParse(after).success ||
            Buffer.from(after).toString('base64url') !== input.cursor
          )
            throw new ActionFailure('INVALID_INPUT', 'Invalid source cursor.');
        }
        const page = sources.filter((source) => source.id > after).slice(0, input.limit + 1);
        return ok({
          items: page.slice(0, input.limit).map((source) => ({
            id: source.id,
            status: source.status,
            kind: source.input.kind,
            contentHash: source.contentHash,
            reason: source.reason,
          })),
          nextCursor:
            page.length > input.limit
              ? Buffer.from(page[input.limit - 1]!.id).toString('base64url')
              : null,
        });
      }
      if (request.action === 'job.submission') {
        const input = submissionInspectInputSchema.parse(parsed.data);
        const event = (await events(persistence, jobId)).find(
          (event) => event.id === input.submissionId,
        );
        if (!event?.data.payload)
          throw new ActionFailure('NOT_FOUND', 'Accepted submission not found.');
        return ok({
          submissionId: event.id,
          acceptedRevision: event.data.acceptedRevision,
          ...payloadRange(event.data.payload, 'payload', input.offset, input.length),
        });
      }
      const input = jobContextInputSchema.parse(parsed.data);
      if (!options.authority.roles.includes(input.role))
        throw new ActionFailure('POLICY_DENIED', 'Transport lacks the requested role.');
      const sources = await persistence.research.sources(jobId);
      const evidence = await persistence.research.evidence(jobId);
      const history = await events(persistence, jobId);
      const plans = await persistence.repository.plans(jobId);
      const plan = plans.at(-1);
      const roles = {
        researcher: 'ResearchReport',
        'writer-director': 'PlanRevision',
        reviewer: 'ReviewResult',
        repair: 'RevisionFeedback',
      } as const;
      const relevantKinds =
        input.role === 'researcher'
          ? ['research']
          : input.role === 'writer-director'
            ? ['research', 'plan']
            : ['plan', 'review', 'feedback'];
      return ok(
        boundedView(
          {
            role: input.role,
            brief: record.brief,
            jobRevision: record.status.revision,
            effective: effective(workspace, record),
            approvedRevision: null,
            plan:
              input.role === 'researcher' || !plan
                ? null
                : {
                    id: plan.id,
                    revision: plan.revision,
                    sceneIds: plan.scenes.slice(0, 100).map((scene) => scene.id),
                    truncated: plan.scenes.length > 100,
                  },
            sources: sources.slice(0, 100).map((source) => ({
              id: source.id,
              kind: source.input.kind,
              status: source.status,
              contentHash: source.contentHash,
            })),
            evidence: evidence
              .slice(0, 100)
              .map((item) => ({ id: item.id, sourceId: item.sourceId, status: item.status })),
            evidenceDigest: (await acceptedEvidence(persistence, record)).digest,
            submissions: history
              .filter((event) => relevantKinds.includes(String(event.data.kind)))
              .slice(-20)
              .map((event) => ({
                submissionId: event.id,
                kind: event.data.kind,
                acceptedRevision: event.data.acceptedRevision,
              })),
            truncated: sources.length > 100 || evidence.length > 100,
            retrieval: ['source.inspect', 'source.list', 'job.submission'],
            outputSchemaId: `urn:tutorialx:schema:1:${roles[input.role]}`,
            allowedActions: [
              'job.submit',
              'job.inspect',
              'source.inspect',
              'job.submission',
            ].filter(
              (action) =>
                options.authority.actions.includes('*') ||
                options.authority.actions.includes(action),
            ),
            remainingLimits: {
              budgetUsdMicros: effective(workspace, record).settings.policy.budgetUsdMicros,
              maxSubmissionBytes: MAX_REQUEST_BYTES,
            },
            sourceContentAuthority: 'data-only',
          },
          input.offset,
          input.length,
        ),
        await nextActions(persistence, record),
      );
    } finally {
      await persistence.repository.close();
    }
  }

  return {
    async execute(value: unknown): Promise<ActionResponse> {
      let requestId = id('request');
      try {
        if (Buffer.byteLength(JSON.stringify(value) ?? '') > MAX_REQUEST_BYTES)
          throw new ActionFailure('INVALID_INPUT', 'Request exceeds the maximum byte limit.');
        const parsed = actionRequestSchema.safeParse(value);
        if (!parsed.success)
          throw new ActionFailure('INVALID_INPUT', 'Request envelope failed schema validation.');
        requestId = parsed.data.requestId;
        const response = actionResponseSchema.parse(await dispatch(parsed.data));
        if (response.status !== 'error')
          response.data = redactPublicValue(
            response.data,
            options.knownSecrets ?? [],
          ) as JsonObject;
        response.nextActions = response.nextActions.map((action) => ({
          ...action,
          description: redactPublicValue(action.description, options.knownSecrets ?? []) as string,
          params: redactPublicValue(action.params, options.knownSecrets ?? []) as JsonObject,
        }));
        if (Buffer.byteLength(JSON.stringify(response)) > MAX_RESPONSE_BYTES)
          throw new ActionFailure(
            'INVALID_INPUT',
            'Result exceeds the response byte limit; use bounded summary and reference actions.',
          );
        // Do not recommend actions this transport cannot perform.
        response.nextActions = response.nextActions.filter(
          (action) =>
            options.authority.actions.includes('*') ||
            options.authority.actions.includes(action.action),
        );
        return response;
      } catch (error) {
        const known = error instanceof ActionFailure;
        const code = known
          ? error.code
          : error &&
              typeof error === 'object' &&
              'code' in error &&
              [
                'REVISION_CONFLICT',
                'POLICY_DENIED',
                'NOT_FOUND',
                'CAPABILITY_UNAVAILABLE',
                'INVALID_INPUT',
              ].includes(String(error.code))
            ? (error.code as ActionErrorCode)
            : 'INTERNAL_ERROR';
        return actionResponseSchema.parse({
          apiVersion: 1,
          requestId,
          status: 'error',
          error: {
            code,
            message: redactPublicValue(
              known
                ? error.message
                : code === 'INTERNAL_ERROR'
                  ? 'Action failed. Inspect workspace prerequisites and retry with a fresh context.'
                  : 'Action prerequisites, authority, or metadata validation failed.',
              options.knownSecrets ?? [],
            ),
            retryable: code === 'REVISION_CONFLICT',
            details: known ? redactPublicValue(error.details, options.knownSecrets ?? []) : {},
          },
          nextActions: known ? error.nextActions : [],
        });
      }
    },
  };
}
