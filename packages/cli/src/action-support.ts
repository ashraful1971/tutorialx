import { createHash, randomUUID } from 'node:crypto';
import type { SqlitePersistence } from '@tutorialx/adapters';
import {
  type ActionErrorCode,
  type ActionRequest,
  canonicalJson,
  type EffectiveSettings,
  type ExecutionEvent,
  type JobMutation,
  type JobRecord,
  type JsonObject,
  type NextAction,
  type PlanRevision,
  type WorkspaceConfig,
} from '@tutorialx/contracts';

export const digest = (value: JsonObject) =>
  createHash('sha256').update(canonicalJson(value)).digest('hex');
export const json = (value: unknown): JsonObject => JSON.parse(JSON.stringify(value)) as JsonObject;
export const id = (prefix: string) => `${prefix}_${randomUUID().replaceAll('-', '')}`;

/** Authority is assigned by the authenticated transport, never by request parameters. */
export interface ActionAuthority {
  actorId: string;
  actions: readonly string[];
  jobIds?: readonly string[];
  roles: readonly ('researcher' | 'writer-director' | 'reviewer' | 'repair')[];
  principalRole?: 'operator' | 'worker' | 'creative';
}
export interface ActionServiceOptions {
  projectDirectory: string;
  authority: ActionAuthority;
  now?: () => string;
  knownSecrets?: readonly string[];
}
export class ActionFailure extends Error {
  constructor(
    readonly code: ActionErrorCode,
    message: string,
    readonly details: JsonObject = {},
    readonly nextActions: NextAction[] = [],
  ) {
    super(message);
  }
}
export const next = (
  action: string,
  description: string,
  params: JsonObject = {},
  needsOperator = false,
): NextAction => ({ action, description, params, needsOperator });

export interface ActionDependencies {
  options: ActionServiceOptions;
  now(): string;
  events(persistence: SqlitePersistence, jobId: string): Promise<ExecutionEvent[]>;
  nextActions(persistence: SqlitePersistence, record: JobRecord): Promise<NextAction[]>;
  mutation(request: ActionRequest, record: JobRecord, data: JsonObject): JobMutation;
  checkRevision(request: ActionRequest, record: JobRecord): void;
  job(persistence: SqlitePersistence, jobId: string): Promise<JobRecord>;
  effective(
    workspace: WorkspaceConfig,
    record: { brief: Pick<JobRecord['brief'], 'profiles' | 'overrides'> },
  ): EffectiveSettings;
  acceptedEvidence(
    persistence: SqlitePersistence,
    record: JobRecord,
  ): Promise<{ report: JsonObject | undefined; digest: string }>;
  authorization(
    persistence: SqlitePersistence,
    record: JobRecord,
    plan: PlanRevision,
  ): Promise<{ authorized: boolean; approvalId: string | null; reason: string }>;
}
