import type {
  JobRepository,
  JobRevisionRepository,
  OperationRepository,
  ResearchRepository,
  ResourceCoordinator,
  WorkflowRepository,
} from '@tutorialx/contracts';
import { idSchema } from '@tutorialx/contracts';
import { sqliteCoordination } from './coordination.js';
import { sqliteDatabase } from './database.js';
import { sqliteOperations } from './operations.js';
import { sqliteRepository } from './repository.js';

export interface SqlitePersistence {
  repository: JobRepository;
  research: ResearchRepository;
  revisions: JobRevisionRepository;
  coordinator: ResourceCoordinator;
  workflow: WorkflowRepository;
  operations: OperationRepository;
}

/** SQLite is loaded only when selected. Node 22.12 requires --experimental-sqlite. */
export async function createSqlitePersistence(options: {
  filename: string;
  workspaceId: string;
  now(): string;
}): Promise<SqlitePersistence> {
  idSchema.parse(options.workspaceId);
  if (!options.filename || options.filename.length > 4096)
    throw new Error('Supply a SQLite filename.');
  let sqlite: typeof import('node:sqlite');
  try {
    sqlite = await import('node:sqlite');
  } catch {
    throw new Error(
      'SQLite requires Node 22.13+, Node 24/26, or --experimental-sqlite on Node 22.12.',
    );
  }
  const db = sqliteDatabase(
    new sqlite.DatabaseSync(options.filename),
    options.workspaceId,
    options.now,
  );
  const base: Pick<
    JobRepository,
    'descriptor' | 'validateConfiguration' | 'readiness' | 'estimate'
  > = {
    descriptor: {
      id: 'sqlite',
      kind: 'persistence',
      version: '1.1.0',
      contractVersion: 1,
      configurationSchema: {
        type: 'object',
        properties: { filename: { type: 'string', minLength: 1 } },
        required: ['filename'],
        additionalProperties: false,
      },
      capabilities: {
        features: [
          'metadata:transactions',
          'metadata:revisions',
          'metadata:workflow-inputs',
          'attempt:fencing',
          'dispatch:outbox',
          'records:research',
          'usage:reservations',
          'resource:leases',
        ],
        languages: [],
        formats: ['sqlite'],
        modalities: [],
      },
      runtime: {
        platforms: ['linux', 'darwin', 'win32'],
        dependencies: [
          {
            id: 'node-sqlite',
            versionRange: 'Node 22.13+, 24, 26; 22.12 with --experimental-sqlite',
            optional: false,
          },
        ],
        memoryMiB: 64,
        gpu: false,
      },
      execution: {
        location: 'local',
        maxDurationMs: 5000,
        cancellation: 'unsupported',
        sideEffect: 'idempotent',
        idempotency: 'supported',
        permissions: ['write-work'],
      },
      pricing: 'free',
    },
    validateConfiguration: (config) => ({
      ready: Object.keys(config).length === 1 && config.filename === options.filename,
      diagnostics: [],
    }),
    readiness: async () => ({
      ready: db.ready(),
      diagnostics: db.ready()
        ? []
        : [
            {
              code: 'SQLITE_NOT_INITIALIZED',
              classification: 'permanent',
              retryable: false,
              message: 'Initialize the selected SQLite repository before use.',
            },
          ],
    }),
    estimate: async (_operation, _input, context) => {
      context.signal.throwIfAborted();
      return { expectedUsdMicros: 0, upperBoundUsdMicros: 0, validUntil: null, uncertainty: [] };
    },
  };
  const ports = sqliteRepository(db, base);
  return { ...ports, coordinator: sqliteCoordination(db, base), operations: sqliteOperations(db) };
}
