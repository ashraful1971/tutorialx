import { readFile } from 'node:fs/promises';
import { profileSchema } from '@tutorialx/contracts';
import { expect, it } from 'vitest';

const files = [
  'tutorial-embedded.json',
  'tutorial-sidecar.json',
  'reel-both.json',
  'reel-no-captions.json',
];

it('provides review-gated tutorial/reel presets covering every caption mode and creative control', async () => {
  const profiles = await Promise.all(
    files.map(async (file) =>
      profileSchema.parse(
        JSON.parse(
          await readFile(new URL(`../../examples/presets/${file}`, import.meta.url), 'utf8'),
        ),
      ),
    ),
  );
  expect(profiles.map((profile) => profile.settings.captions?.mode).sort()).toEqual([
    'both',
    'embedded',
    'none',
    'sidecar',
  ]);
  expect(new Set(profiles.map((profile) => profile.settings.recipe))).toEqual(
    new Set(['tutorial', 'reel']),
  );
  for (const profile of profiles) {
    expect(profile.settings.policy?.mode).toBe('review');
    expect(profile.settings.audio).toMatchObject({
      music: { enabled: false },
      effects: false,
      ducking: false,
    });
    expect(profile.settings.brand).toMatchObject({
      name: 'TutorialX',
      primaryColor: '#176bff',
    });
    expect(profile.settings.voice).toMatchObject({
      mode: 'synthesize',
      voiceId: 'example-en-us',
      pronunciations: { TutorialX: 'tutorial ex' },
    });
  }
});
