import {
  approvalRecordSchema,
  artifactManifestSchema,
  type DispatchRequest,
  type EvidenceRecord,
  evidenceRecordSchema,
  executionEventSchema,
  idSchema,
  type JobMutation,
  type JobRecord,
  type JobRepository,
  type JobRevisionRepository,
  jobBriefSchema,
  jobStatusSchema,
  nonnegativeIntegerSchema,
  operationRecordSchema,
  paginationSchema,
  planRevisionSchema,
  positiveIntegerSchema,
  type ResearchRepository,
  type SourceManifest,
  type StageAttempt,
  sourceManifestSchema,
  stageAttemptSchema,
  timestampSchema,
} from '@tutorialx/contracts';
import { MetadataConflict, MetadataPolicyError, type SqliteDatabase } from './database.js';

function jobRecord(value: JobRecord): JobRecord {
  const brief = jobBriefSchema.parse(value.brief);
  const status = jobStatusSchema.parse(value.status);
  if (brief.id !== status.jobId || brief.revision > status.revision)
    throw new Error('Job identity/revision is inconsistent.');
  return { brief, status };
}
function dispatch(value: DispatchRequest): DispatchRequest {
  const result = structuredClone(value);
  if (
    Object.keys(result).sort().join(',') !==
    'availableAt,capabilityRequirements,expectedRevision,id,jobId,stageId'
  )
    throw new Error('Dispatch payloads contain references only; unknown fields are forbidden.');
  for (const id of [result.id, result.jobId, result.stageId]) idSchema.parse(id);
  positiveIntegerSchema.parse(result.expectedRevision);
  timestampSchema.parse(result.availableAt);
  if (
    result.capabilityRequirements.length > 1000 ||
    result.capabilityRequirements.some(
      (entry) => typeof entry !== 'string' || entry.length < 1 || entry.length > 100,
    )
  )
    throw new Error('Invalid dispatch capabilities.');
  return result;
}
function page(cursor: string | null, limit: number) {
  paginationSchema.parse({ cursor, limit });
  if (cursor === null) return '';
  const id = Buffer.from(cursor, 'base64url').toString('utf8');
  idSchema.parse(id);
  if (Buffer.from(id).toString('base64url') !== cursor)
    throw new Error('Invalid pagination cursor.');
  return id;
}

export function sqliteRepository(
  db: SqliteDatabase,
  base: Pick<JobRepository, 'descriptor' | 'validateConfiguration' | 'readiness' | 'estimate'>,
): { repository: JobRepository; research: ResearchRepository; revisions: JobRevisionRepository } {
  const readJob = (id: string): JobRecord | null => {
    db.requireReady();
    const value = db.decode<JobRecord>(
      db.get('SELECT json FROM jobs WHERE id=?', idSchema.parse(id)),
    );
    return value ? jobRecord(value) : null;
  };
  const rows = <T>(table: string, jobId: string, parse: (value: unknown) => T): T[] => {
    db.requireReady();
    idSchema.parse(jobId);
    return db
      .all(`SELECT json FROM ${table} WHERE job_id=? ORDER BY rowid`, jobId)
      .map((row) => parse(JSON.parse(String(row.json))));
  };
  function commit(
    input: JobMutation,
    records: { sources: readonly SourceManifest[]; evidence: readonly EvidenceRecord[] },
  ) {
    db.requireReady();
    idSchema.parse(input.jobId);
    positiveIntegerSchema.parse(input.expectedRevision);
    const job = jobRecord(input.job);
    if (
      job.brief.id !== input.jobId ||
      job.brief.workspaceId !== db.workspaceId ||
      job.status.revision !== input.expectedRevision + 1
    )
      throw new MetadataPolicyError('Mutation must advance its own workspace job by one revision.');
    for (const values of [
      input.attempts,
      input.artifacts,
      input.plans,
      input.approvals,
      input.operations,
      input.events,
      input.dispatch,
      records.sources,
      records.evidence,
    ])
      if (values.length > 10_000) throw new Error('Metadata transaction exceeds the record limit.');
    const attempts = input.attempts.map((value) => stageAttemptSchema.parse(value));
    const artifacts = input.artifacts.map((value) => artifactManifestSchema.parse(value));
    const plans = input.plans.map((value) => planRevisionSchema.parse(value));
    const approvals = input.approvals.map((value) => approvalRecordSchema.parse(value));
    const operations = input.operations.map((value) => operationRecordSchema.parse(value));
    const events = input.events.map((value) => executionEventSchema.parse(value));
    const requests = input.dispatch.map(dispatch);
    const sources = records.sources.map((value) => sourceManifestSchema.parse(value));
    const evidence = records.evidence.map((value) => evidenceRecordSchema.parse(value));
    for (const value of [
      ...attempts,
      ...artifacts,
      ...plans,
      ...approvals,
      ...operations,
      ...sources,
      ...evidence,
      ...requests,
    ])
      if (value.jobId !== input.jobId)
        throw new MetadataPolicyError('Transaction contains another job record.');
    if (
      events.some((event) => event.jobId !== input.jobId || event.workspaceId !== db.workspaceId) ||
      artifacts.some((artifact) => artifact.workspaceId !== db.workspaceId)
    )
      throw new MetadataPolicyError('Transaction contains another workspace record.');
    db.transaction(() => {
      const old = readJob(input.jobId);
      if (!old || old.status.revision !== input.expectedRevision)
        throw new MetadataConflict('Job revision changed.');
      if (old.brief.createdAt !== job.brief.createdAt || job.brief.revision < old.brief.revision)
        throw new MetadataConflict('Job immutable metadata or brief revision changed.');
      if (
        JSON.stringify(job.brief) !== JSON.stringify(old.brief) &&
        job.brief.revision !== job.status.revision
      )
        throw new MetadataConflict('Changed brief content must receive the new job revision.');
      if (input.fence !== null) {
        const attempt = db.decode<StageAttempt>(
          db.get(
            'SELECT json FROM attempts WHERE id=? AND job_id=?',
            input.fence.attemptId,
            input.jobId,
          ),
        );
        const latest = attempt
          ? db.get(
              'SELECT attempt_id FROM stages WHERE job_id=? AND id=?',
              input.jobId,
              attempt.stageId,
            )
          : null;
        if (
          !attempt ||
          attempt.status !== 'running' ||
          !attempt.lease ||
          attempt.lease.token !== input.fence.token ||
          Date.parse(attempt.lease.expiresAt) <= Date.parse(db.clock()) ||
          latest?.attempt_id !== attempt.id
        )
          throw new MetadataConflict(
            'Attempt fence is stale, expired, or no longer owns this stage.',
          );
      }
      for (const attempt of attempts) {
        const previous = db.decode<StageAttempt>(
          db.get('SELECT json FROM attempts WHERE id=?', attempt.id),
        );
        if (
          previous &&
          (previous.jobId !== attempt.jobId ||
            previous.stageId !== attempt.stageId ||
            previous.attempt !== attempt.attempt ||
            previous.createdAt !== attempt.createdAt ||
            previous.inputDigest !== attempt.inputDigest ||
            previous.jobRevision !== attempt.jobRevision ||
            previous.stageKind !== attempt.stageKind)
        )
          throw new MetadataConflict('Attempt identity cannot change.');
        if (
          attempt.jobRevision > job.status.revision ||
          (previous?.lease && attempt.lease && attempt.lease.token < previous.lease.token)
        )
          throw new MetadataConflict('Attempt revision or lease token is invalid.');
        if (
          previous?.lease &&
          attempt.lease &&
          previous.lease.token === attempt.lease.token &&
          previous.lease.workerId !== attempt.lease.workerId
        )
          throw new MetadataConflict('Changing the attempt owner requires a newer fencing token.');
        if (
          attempt.status === 'succeeded' &&
          previous?.status !== 'succeeded' &&
          (previous?.status !== 'running' ||
            input.fence?.attemptId !== attempt.id ||
            input.fence.token !== previous.lease?.token)
        )
          throw new MetadataConflict(
            'Successful stage completion requires its active attempt fence.',
          );
        if (
          attempt.status === 'succeeded' &&
          previous?.status === 'succeeded' &&
          JSON.stringify(attempt) !== JSON.stringify(previous)
        )
          throw new MetadataConflict('An accepted attempt cannot silently change its outputs.');
        if (
          attempt.status === 'succeeded' &&
          attempt.outputArtifactIds.some(
            (id) =>
              !artifacts.some((artifact) => artifact.id === id) &&
              !db.get('SELECT id FROM artifacts WHERE id=? AND job_id=?', id, input.jobId),
          )
        )
          throw new MetadataConflict('Successful attempt references missing output artifacts.');
        db.run(
          'INSERT INTO attempts(id,job_id,stage_id,ordinal,json) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json',
          attempt.id,
          input.jobId,
          attempt.stageId,
          attempt.attempt,
          JSON.stringify(attempt),
        );
        const stage = db.get(
          'SELECT attempt_id,ordinal FROM stages WHERE job_id=? AND id=?',
          input.jobId,
          attempt.stageId,
        );
        if (!stage || Number(stage.ordinal) <= attempt.attempt)
          db.run(
            'INSERT INTO stages(job_id,id,attempt_id,ordinal) VALUES (?,?,?,?) ON CONFLICT(job_id,id) DO UPDATE SET attempt_id=excluded.attempt_id,ordinal=excluded.ordinal',
            input.jobId,
            attempt.stageId,
            attempt.id,
            attempt.attempt,
          );
      }
      for (const artifact of artifacts)
        db.immutable('artifacts', artifact.id, input.jobId, artifact);
      for (const plan of plans) {
        if (plan.basedOnJobRevision > job.status.revision)
          throw new MetadataConflict('Plan is based on a future job revision.');
        const oldPlan = db.get(
          'SELECT json FROM plans WHERE job_id=? AND revision=?',
          input.jobId,
          plan.revision,
        );
        if (oldPlan && oldPlan.json !== JSON.stringify(plan))
          throw new MetadataConflict('Plan revision is immutable.');
        if (!oldPlan)
          db.run(
            'INSERT INTO plans(job_id,revision,id,json) VALUES (?,?,?,?)',
            input.jobId,
            plan.revision,
            plan.id,
            JSON.stringify(plan),
          );
      }
      for (const approval of approvals) {
        if (
          db.get(
            'SELECT id FROM plans WHERE job_id=? AND revision=?',
            input.jobId,
            approval.planRevision,
          )?.id !== approval.planId
        )
          throw new MetadataConflict('Approval references a missing plan revision.');
        db.immutable('approvals', approval.id, input.jobId, approval);
      }
      for (const operation of operations) {
        const previous = db.get(
          'SELECT job_id,operation_key FROM operations WHERE id=?',
          operation.id,
        );
        if (
          previous &&
          (previous.job_id !== input.jobId || previous.operation_key !== operation.idempotencyKey)
        )
          throw new MetadataConflict('Operation identity cannot change.');
        db.run(
          'INSERT INTO operations(id,job_id,operation_key,json) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json',
          operation.id,
          input.jobId,
          operation.idempotencyKey,
          JSON.stringify(operation),
        );
      }
      for (const source of sources) db.immutable('sources', source.id, input.jobId, source);
      for (const item of evidence) {
        const source = db.decode<SourceManifest>(
          db.get('SELECT json FROM sources WHERE id=? AND job_id=?', item.sourceId, input.jobId),
        );
        if (!source || source.contentHash !== item.sourceHash)
          throw new MetadataConflict(
            'Evidence references a missing or changed source fingerprint.',
          );
        const previous = db.get('SELECT json FROM evidence WHERE id=?', item.id);
        if (previous && previous.json !== JSON.stringify(item))
          throw new MetadataConflict('Evidence record is immutable.');
        if (!previous)
          db.run(
            'INSERT INTO evidence(id,job_id,source_id,json) VALUES (?,?,?,?)',
            item.id,
            input.jobId,
            item.sourceId,
            JSON.stringify(item),
          );
      }
      for (const event of events) {
        if (db.get('SELECT id FROM events WHERE id=?', event.id))
          throw new MetadataConflict('Event identity already exists.');
        const inserted = db.run(
          'INSERT INTO events(id,job_id,json) VALUES (?,?,?)',
          event.id,
          input.jobId,
          JSON.stringify(event),
        );
        const cursor = positiveIntegerSchema.parse(Number(inserted.lastInsertRowid));
        db.run(
          'UPDATE events SET json=? WHERE cursor=?',
          JSON.stringify({ ...event, cursor }),
          cursor,
        );
      }
      for (const request of requests) {
        if (request.expectedRevision !== job.status.revision)
          throw new MetadataConflict('Dispatch must reference the committed job revision.');
        const previous = db.get('SELECT json FROM outbox WHERE id=?', request.id);
        if (previous && previous.json !== JSON.stringify(request))
          throw new MetadataConflict('Dispatch identity already has another payload.');
        if (!previous)
          db.run(
            'INSERT INTO outbox(id,job_id,available_at,json) VALUES (?,?,?,?)',
            request.id,
            input.jobId,
            new Date(request.availableAt).toISOString(),
            JSON.stringify(request),
          );
      }
      db.run(
        'UPDATE jobs SET revision=?,json=? WHERE id=?',
        job.status.revision,
        JSON.stringify(job),
        input.jobId,
      );
      db.run(
        'INSERT INTO revisions(job_id,revision,json) VALUES (?,?,?)',
        input.jobId,
        job.status.revision,
        JSON.stringify(job),
      );
    });
  }
  const repository: JobRepository = {
    ...base,
    async initialize() {
      db.initialize();
    },
    async create(input) {
      db.requireReady();
      const job = jobRecord(input);
      if (
        job.brief.workspaceId !== db.workspaceId ||
        job.brief.revision !== 1 ||
        job.status.revision !== 1
      )
        throw new MetadataPolicyError('New jobs must belong to this workspace at revision one.');
      db.transaction(() => {
        if (readJob(job.brief.id)) throw new MetadataConflict('Job already exists.');
        db.run(
          'INSERT INTO jobs(id,revision,json) VALUES (?,?,?)',
          job.brief.id,
          1,
          JSON.stringify(job),
        );
        db.run(
          'INSERT INTO revisions(job_id,revision,json) VALUES (?,?,?)',
          job.brief.id,
          1,
          JSON.stringify(job),
        );
      });
    },
    async read(id) {
      return readJob(id);
    },
    async list(cursor, limit) {
      db.requireReady();
      const after = page(cursor, limit);
      const records = db.all(
        'SELECT id,json FROM jobs WHERE id>? ORDER BY id LIMIT ?',
        after,
        limit + 1,
      );
      return {
        jobs: records.slice(0, limit).map((row) => jobRecord(JSON.parse(String(row.json)))),
        nextCursor:
          records.length > limit
            ? Buffer.from(String(records[limit - 1]!.id)).toString('base64url')
            : null,
      };
    },
    async commit(mutation) {
      commit(mutation, { sources: [], evidence: [] });
    },
    async attempts(id) {
      return rows('attempts', id, stageAttemptSchema.parse);
    },
    async artifacts(jobId, cursor, limit) {
      db.requireReady();
      idSchema.parse(jobId);
      const after = page(cursor, limit);
      const records = db.all(
        'SELECT id,json FROM artifacts WHERE job_id=? AND id>? ORDER BY id LIMIT ?',
        jobId,
        after,
        limit + 1,
      );
      return {
        artifacts: records
          .slice(0, limit)
          .map((row) => artifactManifestSchema.parse(JSON.parse(String(row.json)))),
        nextCursor:
          records.length > limit
            ? Buffer.from(String(records[limit - 1]!.id)).toString('base64url')
            : null,
      };
    },
    async plans(id) {
      return rows('plans', id, planRevisionSchema.parse);
    },
    async approvals(id) {
      return rows('approvals', id, approvalRecordSchema.parse);
    },
    async operations(id) {
      return rows('operations', id, operationRecordSchema.parse);
    },
    async events(id, afterCursor, limit) {
      db.requireReady();
      idSchema.parse(id);
      nonnegativeIntegerSchema.parse(afterCursor);
      paginationSchema.parse({ cursor: null, limit });
      return db
        .all(
          'SELECT json FROM events WHERE job_id=? AND cursor>? ORDER BY cursor LIMIT ?',
          id,
          afterCursor,
          limit,
        )
        .map((row) => executionEventSchema.parse(JSON.parse(String(row.json))));
    },
    async pendingDispatch(limit) {
      paginationSchema.parse({ cursor: null, limit });
      return db
        .all(
          'SELECT json FROM outbox WHERE dispatched=0 AND available_at<=? ORDER BY available_at,id LIMIT ?',
          db.clock(),
          limit,
        )
        .map((row) => dispatch(JSON.parse(String(row.json))));
    },
    async markDispatched(id) {
      db.requireReady();
      idSchema.parse(id);
      db.run('UPDATE outbox SET dispatched=1 WHERE id=?', id);
    },
    async close() {
      db.close();
    },
  };
  return {
    repository,
    research: {
      async commitResearch(mutation, records) {
        commit(mutation, records);
      },
      async sources(id) {
        return rows('sources', id, sourceManifestSchema.parse);
      },
      async evidence(id) {
        return rows('evidence', id, evidenceRecordSchema.parse);
      },
    },
    revisions: {
      async revisions(id) {
        return rows('revisions', id, (value) => jobRecord(value as JobRecord));
      },
    },
  };
}
