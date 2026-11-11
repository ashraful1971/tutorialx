import type { JobBrief } from './planning.js';
import type { WorkspaceConfig } from './workspace.js';

/** Workspace files and directory preparation, separate from authoritative job execution state. */
export interface WorkspaceLayout {
  readConfiguration(): Promise<WorkspaceConfig | null>;
  initialize(
    configuration: WorkspaceConfig,
  ): Promise<{ configuration: WorkspaceConfig; created: boolean }>;
  createJobDirectory(brief: JobBrief, directoryName: string): Promise<string>;
}
