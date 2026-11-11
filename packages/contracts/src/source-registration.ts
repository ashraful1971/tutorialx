import type { ArtifactManifest } from './artifacts.js';
import type { SourceManifest } from './sources.js';

export interface RegisteredSource {
  source: SourceManifest;
  /** A copied file or directory inventory, pending normal artifact acceptance. */
  snapshot: ArtifactManifest | null;
}

export interface SourceRegistrar {
  register(source: SourceManifest): Promise<RegisteredSource>;
}
