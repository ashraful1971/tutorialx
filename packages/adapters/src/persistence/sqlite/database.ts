import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { timestampSchema } from '@tutorialx/contracts';

export class MetadataConflict extends Error {
  readonly code = 'REVISION_CONFLICT';
}
export class MetadataPolicyError extends Error {
  readonly code = 'POLICY_DENIED';
}

const migration = `
CREATE TABLE workspace (id TEXT PRIMARY KEY) STRICT;
CREATE TABLE jobs (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, json TEXT NOT NULL) STRICT;
CREATE TABLE revisions (job_id TEXT NOT NULL REFERENCES jobs(id), revision INTEGER NOT NULL, json TEXT NOT NULL, PRIMARY KEY(job_id,revision)) STRICT;
CREATE TABLE attempts (id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id), stage_id TEXT NOT NULL, ordinal INTEGER NOT NULL, json TEXT NOT NULL, UNIQUE(job_id,stage_id,ordinal)) STRICT;
CREATE TABLE stages (job_id TEXT NOT NULL REFERENCES jobs(id), id TEXT NOT NULL, attempt_id TEXT NOT NULL REFERENCES attempts(id), ordinal INTEGER NOT NULL, PRIMARY KEY(job_id,id)) STRICT;
CREATE TABLE artifacts (id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id), json TEXT NOT NULL) STRICT;
CREATE TABLE plans (job_id TEXT NOT NULL REFERENCES jobs(id), revision INTEGER NOT NULL, id TEXT NOT NULL, json TEXT NOT NULL, PRIMARY KEY(job_id,revision)) STRICT;
CREATE TABLE approvals (id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id), json TEXT NOT NULL) STRICT;
CREATE TABLE operations (id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id), operation_key TEXT NOT NULL, json TEXT NOT NULL, UNIQUE(job_id,operation_key)) STRICT;
CREATE TABLE sources (id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id), json TEXT NOT NULL) STRICT;
CREATE TABLE evidence (id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id), source_id TEXT NOT NULL REFERENCES sources(id), json TEXT NOT NULL) STRICT;
CREATE TABLE events (cursor INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, job_id TEXT REFERENCES jobs(id), json TEXT NOT NULL) STRICT;
CREATE TABLE outbox (id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id), available_at TEXT NOT NULL, dispatched INTEGER NOT NULL DEFAULT 0, json TEXT NOT NULL) STRICT;
CREATE TABLE usage_scopes (id TEXT PRIMARY KEY, kind TEXT NOT NULL, ceiling INTEGER NOT NULL) STRICT;
CREATE TABLE usage (id TEXT PRIMARY KEY, operation_id TEXT NOT NULL UNIQUE, reserved INTEGER NOT NULL, actual INTEGER, state TEXT NOT NULL, json TEXT NOT NULL) STRICT;
CREATE TABLE usage_members (reservation_id TEXT NOT NULL REFERENCES usage(id), scope_id TEXT NOT NULL REFERENCES usage_scopes(id), PRIMARY KEY(reservation_id,scope_id)) STRICT;
CREATE TABLE locks (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, token INTEGER NOT NULL, expires_at TEXT NOT NULL, released INTEGER NOT NULL DEFAULT 0) STRICT;
CREATE INDEX events_job_cursor ON events(job_id,cursor);
CREATE INDEX outbox_pending ON outbox(dispatched,available_at);
PRAGMA user_version = 1;
`;

export function sqliteDatabase(database: DatabaseSync, workspaceId: string, now: () => string) {
  const get = (sql: string, ...parameters: SQLInputValue[]) =>
    database.prepare(sql).get(...parameters);
  const all = (sql: string, ...parameters: SQLInputValue[]) =>
    database.prepare(sql).all(...parameters);
  const run = (sql: string, ...parameters: SQLInputValue[]) =>
    database.prepare(sql).run(...parameters);
  let initialized = false;
  let closed = false;
  function transaction<T>(operation: () => T): T {
    database.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      database.exec('COMMIT');
      return result;
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }
  function initialize() {
    if (closed) throw new Error('SQLite persistence is closed.');
    const version = Number(get('PRAGMA user_version')?.user_version);
    if (version > 2 || version < 0)
      throw new Error(`Unsupported SQLite schema version ${version}; use a compatible engine.`);
    database.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;');
    transaction(() => {
      // Re-read after acquiring the write transaction; another initializer may have migrated.
      const current = Number(get('PRAGMA user_version')?.user_version);
      if (current === 0) {
        database.exec(migration);
        run('INSERT INTO workspace(id) VALUES (?)', workspaceId);
      } else if (current !== 1 && current !== 2)
        throw new Error('Unsupported SQLite schema version.');
      if (get('SELECT id FROM workspace')?.id !== workspaceId)
        throw new MetadataPolicyError('Database belongs to another workspace.');
      if (current < 2)
        database.exec(
          `CREATE TABLE workflow_revisions (job_id TEXT NOT NULL, revision INTEGER NOT NULL, json TEXT NOT NULL, PRIMARY KEY(job_id,revision), FOREIGN KEY(job_id,revision) REFERENCES revisions(job_id,revision)) STRICT; PRAGMA user_version=2;`,
        );
    });
    database.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA trusted_schema=OFF;');
    initialized = true;
  }
  function requireReady() {
    if (!initialized || closed)
      throw new Error('Initialize SQLite persistence before accessing metadata.');
  }
  function clock() {
    requireReady();
    return new Date(timestampSchema.parse(now())).toISOString();
  }
  function decode<T>(row: ReturnType<typeof get>): T | null {
    return row ? (JSON.parse(String(row.json)) as T) : null;
  }
  function immutable(
    table: 'artifacts' | 'approvals' | 'sources',
    id: string,
    jobId: string,
    record: unknown,
  ) {
    const text = JSON.stringify(record);
    const existing = get(`SELECT json FROM ${table} WHERE id=?`, id);
    if (existing) {
      if (existing.json !== text)
        throw new MetadataConflict(`Immutable ${table} record already exists.`);
      return;
    }
    run(`INSERT INTO ${table}(id,job_id,json) VALUES (?,?,?)`, id, jobId, text);
  }
  return {
    get,
    all,
    run,
    transaction,
    initialize,
    requireReady,
    clock,
    decode,
    immutable,
    workspaceId,
    close() {
      if (!closed) {
        database.close();
        closed = true;
      }
    },
    ready() {
      return initialized && !closed;
    },
  };
}
export type SqliteDatabase = ReturnType<typeof sqliteDatabase>;
