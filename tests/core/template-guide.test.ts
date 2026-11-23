import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { HYPERFRAMES_PROVIDER_VERSION, HYPERFRAMES_VERSION } from '@tutorialx/adapters';
import { brandedTemplates, templateForRecipe } from '@tutorialx/core';
import { expect, it } from 'vitest';
import { builtInSettings } from '../../packages/cli/src/index.js';

it('keeps the extension guide aligned with maintained templates and renderer setup', async () => {
  const guide = await readFile(join(process.cwd(), 'docs/template-recipes.md'), 'utf8');
  for (const definition of brandedTemplates) expect(guide).toContain(definition.template.id);
  for (const recipe of ['tutorial', 'explainer', 'asset-video', 'reel', 'mixed'] as const)
    expect(guide).toContain(templateForRecipe(recipe).template.id);
  expect(guide).toContain(`provider version \`${HYPERFRAMES_PROVIDER_VERSION}\``);
  expect(guide).toContain(`CLI \`${HYPERFRAMES_VERSION}\``);
  expect(guide).toContain('requiredCapabilities');
  expect(guide).toContain('Missing support is a capability failure');
  expect(guide).toContain(
    'Never work around an unsupported primitive by editing generated renderer source.',
  );
});

it('ships an exact usable renderer selection instead of an unconfigured placeholder', () => {
  expect(builtInSettings().providers.renderer).toEqual({
    id: 'hyperframes',
    version: HYPERFRAMES_PROVIDER_VERSION,
    config: { fps: 30, quality: 'standard', maxOutputBytes: 2_147_483_648 },
    credentialRef: null,
  });
});
