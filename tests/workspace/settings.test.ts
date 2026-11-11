import { createHash } from 'node:crypto';
import type { Profile, SettingsOverrides, WorkspaceConfig } from '@tutorialx/contracts';
import { resolveSettings, SettingsPolicyError } from '@tutorialx/core';
import { describe, expect, it } from 'vitest';
import { sampleSettings, timestamp } from '../fixtures/contracts.js';

const fingerprint = (profile: Profile) =>
  createHash('sha256').update(JSON.stringify(profile)).digest('hex');
function workspace(): WorkspaceConfig {
  return {
    schemaVersion: 1,
    id: 'workspace',
    createdAt: timestamp,
    revision: 3,
    contentRoot: 'tutorialx-videos',
    sourceRoots: ['.'],
    exclusions: [],
    defaults: {},
    policyCeiling: {
      ...sampleSettings().policy,
      budgetUsdMicros: 100,
      researchBudgetUsdMicros: 10,
      allowedOrigins: ['https://demo.example/'],
      mutationTargets: ['https://demo.example/settings'],
    },
  };
}
function profile(kind: Profile['kind'], settings: SettingsOverrides, id: string = kind): Profile {
  return {
    schemaVersion: 1,
    id,
    createdAt: timestamp,
    revision: 1,
    kind,
    name: id,
    settings,
    sourceIds: [],
    notes: '',
  };
}

describe('settings resolution and snapshots', () => {
  it('applies defaults, workspace, product, brand, ordered presets, then job overrides', () => {
    const space = workspace();
    space.defaults = { brand: { name: 'Workspace' }, language: 'en-GB' };
    const product = profile('product', { brand: { name: 'Product' } });
    const brand = profile('brand', { brand: { name: 'Brand', primaryColor: '#112233' } });
    const presets = [
      profile(
        'preset',
        { brand: { name: 'Preset one' }, captions: { style: { fontSize: 32 } } },
        'preset_one',
      ),
      profile('preset', { brand: { name: 'Preset two' } }, 'preset_two'),
    ];
    const result = resolveSettings(
      {
        defaults: sampleSettings(),
        workspace: space,
        product,
        brand,
        presets,
        overrides: { brand: { name: 'Job' }, captions: { mode: 'both', formats: ['vtt'] } },
      },
      fingerprint,
    );
    expect(result.effective.settings.brand).toMatchObject({ name: 'Job', primaryColor: '#112233' });
    expect(result.effective.settings.captions).toMatchObject({
      mode: 'both',
      formats: ['vtt'],
      style: { fontSize: 32, fontFamily: 'Inter' },
    });
    expect(result.effective.origins).toMatchObject({
      'brand.name': 'job',
      'brand.primaryColor': 'brand:brand@1',
      language: 'workspace:workspace@3',
      'captions.style.fontSize': 'preset:preset_one@1',
      'captions.formats': 'job',
      recipe: 'built-in',
    });
    expect(result.profiles.map((snapshot) => snapshot.profile.id)).toEqual([
      'product',
      'brand',
      'preset_one',
      'preset_two',
    ]);
    expect(result.workspace).toEqual({ id: 'workspace', revision: 3 });
  });

  it('retains earlier values through each precedence layer', () => {
    const space = workspace();
    space.defaults = { brand: { name: 'workspace' } };
    const input = {
      defaults: sampleSettings(),
      workspace: space,
      product: profile('product', { brand: { name: 'product' } }),
      brand: profile('brand', { brand: { name: 'brand' } }),
    };
    expect(resolveSettings(input, fingerprint).effective.settings.brand.name).toBe('brand');
    expect(
      resolveSettings(
        { defaults: input.defaults, workspace: input.workspace, product: input.product },
        fingerprint,
      ).effective.settings.brand.name,
    ).toBe('product');
    const base = { defaults: input.defaults, workspace: input.workspace };
    expect(resolveSettings(base, fingerprint).effective.settings.brand.name).toBe('workspace');
  });

  it('replaces discriminated unions and provider selections atomically', () => {
    const defaults = sampleSettings();
    defaults.audio.music = { enabled: true, assetId: 'music', gainDb: -20 };
    const result = resolveSettings(
      {
        defaults,
        workspace: workspace(),
        overrides: {
          voice: { mode: 'none' },
          audio: { music: { enabled: false } },
          providers: { renderer: { id: 'other', version: '2', config: {}, credentialRef: null } },
        },
      },
      fingerprint,
    );
    expect(result.effective.settings.voice).toEqual({ mode: 'none' });
    expect(result.effective.settings.audio.music).toEqual({ enabled: false });
    expect(result.effective.origins['voice.assetId']).toBeUndefined();
    expect(result.effective.origins['audio.music.assetId']).toBeUndefined();
    expect(result.effective.settings.providers.renderer.id).toBe('other');
  });

  it('snapshots profile values/revisions without mutating defaults, inputs, or an approved result', () => {
    const defaults = sampleSettings();
    const space = workspace();
    const brand = profile('brand', { brand: { name: 'Approved' } });
    const original = JSON.stringify({ defaults, space, brand });
    const approved = resolveSettings({ defaults, workspace: space, brand }, fingerprint);
    expect(JSON.stringify({ defaults, space, brand })).toBe(original);
    const approvedDigest = approved.profiles[0]!.digest;
    brand.settings.brand!.name = 'Changed';
    brand.revision = 2;
    space.defaults.brand = { name: 'New default' };
    const revised = resolveSettings({ defaults, workspace: space, brand }, fingerprint);
    expect(approved.effective.settings.brand.name).toBe('Approved');
    expect(approved.profiles[0]!.profile.revision).toBe(1);
    expect(revised.effective.settings.brand.name).toBe('Changed');
    expect(revised.profiles[0]!.digest).not.toBe(approvedDigest);
  });

  it('rejects unknown keys, contradictory final settings, duplicate profiles, and wrong profile roles', () => {
    const input = { defaults: sampleSettings(), workspace: workspace() };
    expect(() =>
      resolveSettings(
        { ...input, overrides: { unexpected: true } as SettingsOverrides },
        fingerprint,
      ),
    ).toThrow();
    expect(() =>
      resolveSettings({ ...input, overrides: { captions: { mode: 'none' } } }, fingerprint),
    ).toThrow();
    const preset = profile('preset', {});
    expect(() => resolveSettings({ ...input, presets: [preset, preset] }, fingerprint)).toThrow(
      'more than once',
    );
    expect(() => resolveSettings({ ...input, brand: preset }, fingerprint)).toThrow(
      'Expected a brand',
    );
  });
});

describe('workspace policy ceilings', () => {
  it.each([
    { budgetUsdMicros: 101 },
    { researchBudgetUsdMicros: 11 },
    { maxAttempts: 4 },
    { maxRepairs: 3 },
    { localOnly: false },
    { mode: 'autonomous' },
    { allowedOrigins: ['https://other.example/'] },
    { mutationTargets: ['https://demo.example/admin'] },
    { requiredReviewModalities: ['text'] },
  ] as const)(
    'rejects a profile weakening %j even if a later job override could hide it',
    (policy) => {
      const preset = profile('preset', { policy: structuredClone(policy) } as SettingsOverrides);
      expect(() =>
        resolveSettings(
          {
            defaults: sampleSettings(),
            workspace: workspace(),
            presets: [preset],
            overrides: { policy: { budgetUsdMicros: 0 } },
          },
          fingerprint,
        ),
      ).toThrow(SettingsPolicyError);
    },
  );

  it('enforces a deadline and allows stricter overrides and explicitly permitted origins', () => {
    const space = workspace();
    space.policyCeiling.deadlineAt = '2026-11-12T00:00:00Z';
    const defaults = sampleSettings();
    defaults.policy.maxAttempts = 10;
    const input = { defaults, workspace: space };
    const result = resolveSettings(input, fingerprint);
    expect(result.effective.settings.policy.maxAttempts).toBe(3);
    expect(result.effective.settings.policy.deadlineAt).toBe(space.policyCeiling.deadlineAt);
    expect(result.effective.origins['policy.deadlineAt']).toBe(
      'workspace:workspace@3:policy-ceiling',
    );
    for (const deadlineAt of [null, '2026-11-13T00:00:00Z'])
      expect(() =>
        resolveSettings({ ...input, overrides: { policy: { deadlineAt } } }, fingerprint),
      ).toThrow(SettingsPolicyError);
    const constrained = resolveSettings(
      {
        ...input,
        overrides: {
          policy: {
            deadlineAt: '2026-11-11T20:00:00Z',
            maxAttempts: 1,
            budgetUsdMicros: 50,
            allowedOrigins: ['https://demo.example'],
          },
        },
      },
      fingerprint,
    );
    expect(constrained.effective.settings.policy.budgetUsdMicros).toBe(50);
    expect(constrained.effective.origins['policy.budgetUsdMicros']).toBe('job');
  });
});
