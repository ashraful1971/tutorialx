import {
  type SourceRegistrar,
  type SourceRegistration,
  sourceManifestSchema,
  sourceRegistrationSchema,
} from '@tutorialx/contracts';

/** Source content is data. Registration never grants access, spending, or execution authority. */
export async function registerWorkspaceSource(
  registrar: SourceRegistrar,
  jobId: string,
  identity: { newId(): string; now(): string },
  request: SourceRegistration,
) {
  const input = sourceRegistrationSchema.parse(request);
  const source = sourceManifestSchema.parse({
    schemaVersion: 1,
    id: identity.newId(),
    createdAt: identity.now(),
    jobId,
    sourceRevision: null,
    ...input,
    contentHash: null,
    status: 'pending',
    snapshotArtifactId: null,
    reason: null,
  });
  return registrar.register(source);
}
