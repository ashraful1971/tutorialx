import { z } from 'zod';
import { digestSchema } from './common.js';

export const SKILL_MANIFEST = '.tutorialx-managed.json';
export const skillHostSchema = z.enum(['codex', 'claude-code', 'generic']);
export type SkillHost = z.infer<typeof skillHostSchema>;
export type SkillOperation = 'install' | 'update' | 'remove';

export const skillFilePathSchema = z
  .string()
  .min(1)
  .max(240)
  .refine(
    (path) =>
      !path.includes('\\') &&
      path
        .split('/')
        .every(
          (part) =>
            /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(part) &&
            !part.endsWith('.') &&
            !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(part),
        ),
    'Skill files must use safe relative paths.',
  );

export const managedSkillManifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  manager: z.literal('tutorialx'),
  version: z.string().min(1).max(100),
  files: z.record(skillFilePathSchema, digestSchema),
});
export type ManagedSkillManifest = z.infer<typeof managedSkillManifestSchema>;

export interface SkillFile {
  sha256: string;
  content: string;
}

/** A text diff suitable for displaying before mutation. Null means absent. */
export interface SkillFileChange {
  path: string;
  before: string | null;
  after: string | null;
}

export interface SkillInstallationPlan {
  operation: SkillOperation;
  version: string | null;
  changes: SkillFileChange[];
  manifest: ManagedSkillManifest | null;
}

export interface SkillInstallationRequest {
  operation: SkillOperation;
  /** Root of the supplied, versioned skill package, containing SKILL.md. */
  packageRoot?: string;
  version?: string;
}

export interface SkillInstallationPreview extends SkillInstallationPlan {
  destination: string;
  fingerprint: string;
  request: SkillInstallationRequest;
}

export interface SkillInstaller {
  preview(request: SkillInstallationRequest): Promise<SkillInstallationPreview>;
  /** Recomputes the plan and refuses changes since preview; never trusts supplied file changes. */
  apply(preview: SkillInstallationPreview): Promise<SkillInstallationPreview>;
}
