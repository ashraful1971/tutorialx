import { fileURLToPath } from 'node:url';

/** Resolved beside the built module, so this also works after packing/installing the CLI. */
export function bundledSkillPackage() {
  return {
    directory: fileURLToPath(new URL('../dist/skills/tutorialx/', import.meta.url)),
    version: '0.1.0',
  };
}
