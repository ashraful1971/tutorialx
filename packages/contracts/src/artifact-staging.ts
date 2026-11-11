import { z } from 'zod';
import type { Pagination } from './actions.js';
import { type ArtifactManifest, artifactManifestSchema } from './artifacts.js';
import { digestSchema, recordShape } from './common.js';
import type { OperationContext } from './providers/descriptor.js';

export const stagedArtifactSchema = z.strictObject({
  ...recordShape,
  manifest: artifactManifestSchema,
});
export type StagedArtifact = z.infer<typeof stagedArtifactSchema>;
export const artifactLineageSchema = artifactManifestSchema.shape.provenance
  .omit({ stageId: true, attemptId: true })
  .extend({ inputDigest: digestSchema });
export type ArtifactLineage = z.infer<typeof artifactLineageSchema>;
export interface RetainedArtifact {
  receiptId: string;
  phase: 'partial' | 'staged' | 'published' | 'unreadable';
  createdAt: string | null;
  manifest: ArtifactManifest | null;
}

/** Publication makes complete immutable bytes available, not an accepted stage result. */
export interface ArtifactStaging {
  stage(
    manifest: ArtifactManifest,
    bytes: AsyncIterable<Uint8Array>,
    context: OperationContext,
  ): Promise<StagedArtifact>;
  describe(receiptId: string, context: OperationContext): Promise<StagedArtifact>;
  publish(receiptId: string, context: OperationContext): Promise<ArtifactManifest>;
  verify(manifest: ArtifactManifest, context: OperationContext): Promise<void>;
  retained(
    page: Pagination,
    context: OperationContext,
  ): Promise<{ items: readonly RetainedArtifact[]; nextCursor: string | null }>;
}
