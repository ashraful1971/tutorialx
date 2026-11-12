import { describe, expect, it } from 'vitest';
import { isAllowedPackagePath } from '../../scripts/package-audit.mjs';

describe('distribution allowlist', () => {
  it.each([
    '.env',
    '.env.production',
    '.tutorialx/state.sqlite',
    'tutorialx-videos/jobs/demo/output/video.mp4',
    'input/private-reference.pdf',
    'dist/.tsbuildinfo',
    'dist/.env',
    'dist/session.json',
    'dist/recording.mp4',
    'dist/../secret.js',
    'dist/.private/secret.js',
    'src/index.ts',
    'dist/skills/tutorialx/private.md',
    'dist/skills/tutorialx/references/credentials.md',
    'dist/skills/tutorialx/recording.mp4',
  ])('rejects private or non-distributable file %s', (path) => {
    expect(isAllowedPackagePath(path)).toBe(false);
  });

  it.each([
    'package.json',
    'README.md',
    'LICENSE',
    'dist/index.js',
    'dist/index.d.ts',
    'dist/skills/tutorialx/SKILL.md',
    'dist/skills/tutorialx/references/actions.md',
  ])('permits intentional package file %s', (path) =>
    expect(isAllowedPackagePath(path)).toBe(true),
  );
});
