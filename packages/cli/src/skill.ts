import { resolve } from 'node:path';
import { createLocalSkillInstaller } from '@tutorialx/adapters';
import {
  type SkillCommandInput,
  type SkillInstallationPreview,
  type SkillOperation,
  skillCommandInputSchema,
} from '@tutorialx/contracts';
import { bundledSkillPackage } from './bundled-skill.js';

export class SkillCommandFailure extends Error {
  constructor(
    readonly code: 'REVISION_CONFLICT' | 'POLICY_DENIED' | 'INVALID_INPUT' | 'MISSING_PREREQUISITE',
    message: string,
  ) {
    super(message);
  }
}

/** Operator scope is checked by the transport; apply is explicit and bound to a reviewed preview. */
export async function executeSkillCommand(
  operation: SkillOperation,
  rawInput: SkillCommandInput,
  options: { projectDirectory: string },
): Promise<{ preview: SkillInstallationPreview; applied: boolean }> {
  const input = skillCommandInputSchema.parse(rawInput);
  const bundled = bundledSkillPackage();
  const rootDirectory = resolve(options.projectDirectory, input.rootDirectory ?? '.');
  const installer = createLocalSkillInstaller({ rootDirectory, host: input.host });
  try {
    const preview = await installer.preview({
      operation,
      ...(operation === 'remove'
        ? {}
        : {
            packageRoot: input.packageRoot
              ? resolve(options.projectDirectory, input.packageRoot)
              : bundled.directory,
            version: input.version ?? bundled.version,
          }),
    });
    if (!input.apply) return { preview, applied: false };
    if (preview.fingerprint !== input.fingerprint)
      throw new SkillCommandFailure(
        'REVISION_CONFLICT',
        'Skill installation changed since preview. Review a fresh preview before applying.',
      );
    return { preview: await installer.apply(preview), applied: true };
  } catch (error) {
    if (error instanceof SkillCommandFailure) throw error;
    if (error instanceof Error && 'code' in error) {
      if (error.code === 'ENOENT')
        throw new SkillCommandFailure(
          'MISSING_PREREQUISITE',
          'The skill package or target root is missing. Select an existing root and installed bundle.',
        );
      if (error.code === 'EACCES' || error.code === 'EPERM')
        throw new SkillCommandFailure(
          'POLICY_DENIED',
          'The target root does not permit skill installation.',
        );
    }
    if (error instanceof Error && /since preview/.test(error.message))
      throw new SkillCommandFailure(
        'REVISION_CONFLICT',
        'Skill installation changed since preview. Review a fresh preview before applying.',
      );
    if (
      error instanceof Error &&
      /unmanaged|changed:|symlink|collision|redirected/.test(error.message)
    )
      throw new SkillCommandFailure('POLICY_DENIED', error.message.slice(0, 1000));
    if (error instanceof Error && /lock/.test(error.message))
      throw new SkillCommandFailure(
        'MISSING_PREREQUISITE',
        'Another installation owns the root lock. Inspect its process before recovery.',
      );
    throw new SkillCommandFailure(
      'INVALID_INPUT',
      'The skill package or managed manifest is invalid or exceeds the bounded text limits.',
    );
  }
}
