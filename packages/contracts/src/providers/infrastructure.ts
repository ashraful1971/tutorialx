import type { ApprovalRecord } from '../approval.js';
import type { ArtifactManifest, StorageReference } from '../artifacts.js';
import type { ExecutionEvent, JobStatus, OperationRecord, StageAttempt } from '../execution.js';
import type { JobBrief, PlanRevision } from '../planning.js';
import type { BaseProvider, OperationContext } from './descriptor.js';

export interface StoredObject {
  reference: StorageReference;
  digest: string;
  sizeBytes: number;
}

export interface StorageProvider extends BaseProvider<'storage'> {
  put(
    key: string,
    content: AsyncIterable<Uint8Array>,
    context: OperationContext,
  ): Promise<StoredObject>;
  read(
    reference: StorageReference,
    context: OperationContext,
    range?: { start: number; endExclusive: number },
  ): AsyncIterable<Uint8Array>;
  stat(reference: StorageReference, context: OperationContext): Promise<StoredObject | null>;
  remove(reference: StorageReference, context: OperationContext): Promise<void>;
  list(
    prefix: string,
    cursor: string | null,
    limit: number,
    context: OperationContext,
  ): Promise<{ objects: readonly StoredObject[]; nextCursor: string | null }>;
}

export interface JobRecord {
  brief: JobBrief;
  status: JobStatus;
}

export interface DispatchRequest {
  id: string;
  jobId: string;
  stageId: string;
  expectedRevision: number;
  capabilityRequirements: readonly string[];
  availableAt: string;
}

/** One metadata transaction. External provider work must happen outside this operation. */
export interface JobMutation {
  jobId: string;
  expectedRevision: number;
  job: JobRecord;
  fence: { attemptId: string; token: number } | null;
  attempts: readonly StageAttempt[];
  artifacts: readonly ArtifactManifest[];
  plans: readonly PlanRevision[];
  approvals: readonly ApprovalRecord[];
  operations: readonly OperationRecord[];
  events: readonly ExecutionEvent[];
  dispatch: readonly DispatchRequest[];
}

export interface JobRepository extends BaseProvider<'persistence'> {
  initialize(): Promise<void>;
  create(job: JobRecord): Promise<void>;
  read(jobId: string): Promise<JobRecord | null>;
  list(
    cursor: string | null,
    limit: number,
  ): Promise<{ jobs: readonly JobRecord[]; nextCursor: string | null }>;
  commit(mutation: JobMutation): Promise<void>;
  attempts(jobId: string): Promise<readonly StageAttempt[]>;
  artifacts(
    jobId: string,
    cursor: string | null,
    limit: number,
  ): Promise<{ artifacts: readonly ArtifactManifest[]; nextCursor: string | null }>;
  plans(jobId: string): Promise<readonly PlanRevision[]>;
  approvals(jobId: string): Promise<readonly ApprovalRecord[]>;
  operations(jobId: string): Promise<readonly OperationRecord[]>;
  events(jobId: string, afterCursor: number, limit: number): Promise<readonly ExecutionEvent[]>;
  pendingDispatch(limit: number): Promise<readonly DispatchRequest[]>;
  markDispatched(dispatchId: string): Promise<void>;
  close(): Promise<void>;
}

export interface QueueProvider extends BaseProvider<'queue'> {
  enqueue(request: DispatchRequest, context: OperationContext): Promise<void>;
  receive(context: OperationContext): Promise<{ request: DispatchRequest; receipt: string } | null>;
  acknowledge(receipt: string, context: OperationContext): Promise<void>;
  retry(receipt: string, availableAt: string, context: OperationContext): Promise<void>;
}

export interface IsolatedExecution {
  image: string;
  command: readonly string[];
  inputDirectory: string;
  outputDirectory: string;
  allowedOrigins: readonly string[];
  cpu: number;
  memoryMiB: number;
  maxDurationMs: number;
}

export interface IsolationProvider extends BaseProvider<'isolation'> {
  execute(
    request: IsolatedExecution,
    context: OperationContext,
  ): Promise<{
    exitCode: number;
    stdoutArtifact: StorageReference;
    stderrArtifact: StorageReference;
    outputReferences: readonly StorageReference[];
  }>;
}
