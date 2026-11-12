import {
  type ManagedSkillManifest,
  managedSkillManifestSchema,
  SKILL_MANIFEST,
  type SkillFile,
  type SkillHost,
  type SkillInstallationPlan,
  type SkillOperation,
  skillFilePathSchema,
  skillHostSchema,
} from '@tutorialx/contracts';

/** root is a project or explicit user home; generic root is an explicitly chosen skills folder. */
export function supportedSkillDirectory(host: SkillHost): string {
  switch (skillHostSchema.parse(host)) {
    case 'codex':
      return '.agents/skills/tutorialx';
    case 'claude-code':
      return '.claude/skills/tutorialx';
    case 'generic':
      return 'tutorialx';
  }
}

export function planSkillInstallation(input: {
  operation: SkillOperation;
  installed: ManagedSkillManifest | null;
  current: Readonly<Record<string, SkillFile>>;
  supplied?: Readonly<Record<string, SkillFile>>;
  version?: string;
}): SkillInstallationPlan {
  const installed = input.installed && managedSkillManifestSchema.parse(input.installed);
  if (!['install', 'update', 'remove'].includes(input.operation))
    throw new Error('Unknown skill installation operation.');
  if (input.operation === 'install' && installed)
    throw new Error('Skill is already managed; use update.');
  if (input.operation === 'update' && !installed)
    throw new Error('Skill is not managed; use install.');
  for (const [path, sha256] of Object.entries(installed?.files ?? {})) {
    if (input.current[path]?.sha256 !== sha256)
      throw new Error(
        `Managed skill file changed: ${path}. Preserve your edits before continuing.`,
      );
  }
  const supplied = input.operation === 'remove' ? {} : input.supplied;
  if (!supplied || (input.operation !== 'remove' && !supplied['SKILL.md']))
    throw new Error('A skill package containing SKILL.md is required.');
  const pathPrefixes = new Map<string, string>();
  for (const path of Object.keys(input.current)) {
    const parts = path.split('/');
    for (let count = 1; count <= parts.length; count++) {
      const prefix = parts.slice(0, count).join('/');
      pathPrefixes.set(prefix.toLowerCase(), prefix);
    }
  }
  for (const path of Object.keys(supplied)) {
    skillFilePathSchema.parse(path);
    const parts = path.split('/');
    for (let count = 1; count <= parts.length; count++) {
      const prefix = parts.slice(0, count).join('/');
      const alias = pathPrefixes.get(prefix.toLowerCase());
      if (alias && alias !== prefix)
        throw new Error(`Refusing a case-insensitive skill path collision: ${path}.`);
      if (count < parts.length && (input.current[prefix] || supplied[prefix]))
        throw new Error(`Refusing a file/directory skill path collision: ${path}.`);
      pathPrefixes.set(prefix.toLowerCase(), prefix);
    }
    if (path === SKILL_MANIFEST) throw new Error('The package cannot supply manager metadata.');
    if (input.current[path] && !installed?.files[path])
      throw new Error(`Refusing to overwrite unmanaged skill file: ${path}.`);
  }
  if (!installed && input.current[SKILL_MANIFEST])
    throw new Error('Refusing to overwrite unmanaged skill metadata.');
  const manifest =
    input.operation === 'remove'
      ? null
      : managedSkillManifestSchema.parse({
          schemaVersion: 1,
          manager: 'tutorialx',
          version: input.version,
          files: Object.fromEntries(
            Object.entries(supplied).map(([path, file]) => [path, file.sha256]),
          ),
        });
  const paths = new Set([...Object.keys(installed?.files ?? {}), ...Object.keys(supplied)]);
  const changes = [...paths].sort().flatMap((path) => {
    const before = input.current[path]?.content ?? null;
    const after = supplied[path]?.content ?? null;
    return before === after ? [] : [{ path, before, after }];
  });
  const before = input.current[SKILL_MANIFEST]?.content ?? null;
  const after = manifest ? `${JSON.stringify(manifest, null, 2)}\n` : null;
  if (before !== after) changes.push({ path: SKILL_MANIFEST, before, after });
  return { operation: input.operation, version: manifest?.version ?? null, changes, manifest };
}
