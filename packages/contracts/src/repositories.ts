import type { WorkflowSnapshot } from './lineage.js';
import type { JobMutation, JobRecord } from './providers/infrastructure.js';
import type { EvidenceRecord, SourceManifest } from './sources.js';

/** Research records join the same metadata transaction as their owning job revision. */
export interface ResearchRepository {
  commitResearch(
    mutation: JobMutation,
    records: { sources: readonly SourceManifest[]; evidence: readonly EvidenceRecord[] },
  ): Promise<void>;
  sources(jobId: string): Promise<readonly SourceManifest[]>;
  evidence(jobId: string): Promise<readonly EvidenceRecord[]>;
}

export interface JobRevisionRepository {
  revisions(jobId: string): Promise<readonly JobRecord[]>;
}

export interface WorkflowRepository {
  commitWorkflow(
    mutation: JobMutation,
    snapshot: WorkflowSnapshot,
    research?: { sources: readonly SourceManifest[]; evidence: readonly EvidenceRecord[] },
  ): Promise<void>;
  /** Omit revision to read the current compatible input snapshot; historical reads are explicit. */
  readWorkflow(jobId: string, revision?: number): Promise<WorkflowSnapshot | null>;
}
