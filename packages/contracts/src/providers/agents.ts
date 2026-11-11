import type { JobBrief } from '../planning.js';
import type { EffectiveSettings } from '../settings.js';
import type { InputReference, SourceManifest } from '../sources.js';
import type { BaseProvider, JsonObject, OperationContext } from './descriptor.js';
import type { AgentTaskResult, ReaderResult } from './responses.js';

export interface ResearchReader extends BaseProvider<'research'> {
  read(
    request: {
      input: InputReference;
      source: SourceManifest;
      maxBytes: number;
      allowedRoots: readonly string[];
      allowedOrigins: readonly string[];
    },
    context: OperationContext,
  ): Promise<ReaderResult>;
}

export interface AgentTask {
  id: string;
  role: 'researcher' | 'writer-director' | 'reviewer' | 'repair';
  objective: string;
  jobRevision: number;
  planRevision: number | null;
  brief: JobBrief;
  effective: EffectiveSettings | null;
  evidenceIds: readonly string[];
  artifactIds: readonly string[];
  allowedActions: readonly string[];
  outputSchemaId: string;
  outputSchema: JsonObject;
  maxInputTokens: number;
  maxOutputTokens: number;
  maxToolCalls: number;
}

export interface AgentRunner extends BaseProvider<'agent'> {
  start(task: AgentTask, context: OperationContext): Promise<{ operationId: string }>;
  inspect(operationId: string, context: OperationContext): Promise<AgentTaskResult>;
  cancel(operationId: string, context: OperationContext): Promise<void>;
}
