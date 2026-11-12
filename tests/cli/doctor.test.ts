import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type ProviderDescriptor, type ProviderKind } from '@tutorialx/contracts';
import { describe, expect, it, vi } from 'vitest';
import {
  createPathDependencyProbe,
  type DoctorProvider,
  diagnoseRecipe,
} from '../../packages/cli/src/doctor.js';
import { sampleSettings } from '../fixtures/contracts.js';

function provider(kind: ProviderKind, id: string): DoctorProvider {
  const descriptor: ProviderDescriptor = {
    id,
    kind,
    version: '1',
    contractVersion: 1,
    configurationSchema: {},
    capabilities: {
      features: [],
      formats: ['codec:h264', 'container:mp4'],
      languages: ['en-US'],
      modalities: [],
    },
    runtime: {
      platforms: ['darwin', 'linux', 'win32'],
      dependencies: [],
      memoryMiB: 1,
      gpu: false,
    },
    execution: {
      location: 'local',
      maxDurationMs: 1000,
      cancellation: 'cooperative',
      sideEffect: 'pure',
      idempotency: 'supported',
      permissions: [],
    },
    pricing: 'free',
  };
  return {
    descriptor,
    validateConfiguration: vi.fn(() => ({ ready: true, diagnostics: [] })),
    readiness: vi.fn(async () => ({ ready: true, diagnostics: [] })),
  };
}

function suppliedAssets() {
  const settings = sampleSettings();
  settings.recipe = 'asset-video';
  settings.captions = { ...settings.captions, mode: 'none', formats: [] };
  return settings;
}

describe('recipe/provider doctor', () => {
  it('does not probe unused capture, Python or cloud credentials for supplied-asset video', async () => {
    const renderer = provider('renderer', 'hyperframes');
    const unused = provider('voice', 'kokoro');
    unused.descriptor.runtime.dependencies = [
      { id: 'python', versionRange: '>=3.11', optional: false },
    ];
    unused.readiness = vi.fn(async () => {
      throw new Error('unused cloud secret');
    });
    const probe = vi.fn(async () => ({ available: false, compatible: null }));
    const report = await diagnoseRecipe(
      { settings: suppliedAssets() },
      {
        installedProviders: [renderer, unused],
        probeDependency: probe,
        platform: 'linux',
      },
    );
    expect(report.ready).toBe(true);
    expect(probe).not.toHaveBeenCalled();
    expect(unused.readiness).not.toHaveBeenCalled();
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'capture', status: 'skipped', required: false }),
        expect.objectContaining({ id: 'voice', status: 'skipped', required: false }),
      ]),
    );
  });

  it('honestly reports unimplemented/unregistered selected providers with concrete remedies', async () => {
    const report = await diagnoseRecipe({ settings: suppliedAssets() }, { installedProviders: [] });
    expect(report.ready).toBe(false);
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        id: 'renderer:hyperframes:1',
        status: 'missing',
        required: true,
      }),
    );
    expect(report.nextActions[0]).toContain('register hyperframes version 1');
  });

  it('requires tutorial capture, requested headless runner and requested asset generation', async () => {
    const settings = suppliedAssets();
    settings.recipe = 'tutorial';
    const report = await diagnoseRecipe(
      { settings, headless: true, generateAssets: true },
      {
        installedProviders: [provider('renderer', 'hyperframes')],
      },
    );
    expect(report.ready).toBe(false);
    for (const id of ['capture', 'agent', 'assets'])
      expect(report.checks).toContainEqual(
        expect.objectContaining({ id, status: 'missing', required: true }),
      );
  });

  it('treats optional missing dependencies as advisory and required versions as blocking', async () => {
    const renderer = provider('renderer', 'hyperframes');
    renderer.descriptor.runtime.dependencies = [
      { id: 'ffmpeg', versionRange: '>=7', optional: false },
      { id: 'python', versionRange: '>=3.11', optional: true },
    ];
    const probe = vi.fn(async ({ id }: { id: string }) => ({
      available: id === 'ffmpeg',
      compatible: true,
    }));
    const report = await diagnoseRecipe(
      { settings: suppliedAssets() },
      { installedProviders: [renderer], probeDependency: probe },
    );
    expect(report.ready).toBe(true);
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        id: 'renderer:hyperframes:1:python',
        status: 'missing',
        required: false,
      }),
    );
    const blocked = await diagnoseRecipe(
      { settings: suppliedAssets() },
      {
        installedProviders: [renderer],
        probeDependency: async () => ({ available: true, compatible: false }),
      },
    );
    expect(blocked.ready).toBe(false);
    expect(blocked.nextActions.some((remedy) => remedy.includes('ffmpeg >=7'))).toBe(true);
  });

  it('requires inline word timing or alignment when captions are requested', async () => {
    const settings = suppliedAssets();
    settings.captions = { ...sampleSettings().captions };
    const renderer = provider('renderer', 'hyperframes');
    const missing = await diagnoseRecipe({ settings }, { installedProviders: [renderer] });
    expect(missing.ready).toBe(false);
    expect(missing.checks).toContainEqual(
      expect.objectContaining({ id: 'alignment', status: 'missing' }),
    );
    const supplied = await diagnoseRecipe(
      { settings, suppliedCaptionTimings: true },
      { installedProviders: [renderer] },
    );
    expect(supplied.ready).toBe(true);
    settings.voice = { mode: 'synthesize', voiceId: 'amy', pace: 1, tone: '', pronunciations: {} };
    settings.providers.voice = { id: 'voice', version: '1', config: {}, credentialRef: null };
    const voice = provider('voice', 'voice');
    const noWordTiming = await diagnoseRecipe(
      { settings },
      { installedProviders: [renderer, voice] },
    );
    expect(noWordTiming.checks).toContainEqual(
      expect.objectContaining({ id: 'voice:voice:1', status: 'unsupported' }),
    );
    voice.descriptor.capabilities.features = ['timing:word'];
    expect(
      (await diagnoseRecipe({ settings }, { installedProviders: [renderer, voice] })).ready,
    ).toBe(true);
  });

  it('bounds readiness and discovery, and suppresses private exception and diagnostic messages', async () => {
    const renderer = provider('renderer', 'hyperframes');
    renderer.readiness = async () => {
      throw new Error('TOKEN=secret');
    };
    const failed = await diagnoseRecipe(
      { settings: suppliedAssets() },
      { installedProviders: [renderer] },
    );
    expect(failed.ready).toBe(false);
    expect(JSON.stringify(failed)).not.toContain('TOKEN=secret');
    renderer.readiness = () => new Promise(() => {});
    const timedOut = await diagnoseRecipe(
      { settings: suppliedAssets() },
      { installedProviders: [renderer], timeoutMs: 5 },
    );
    expect(timedOut.ready).toBe(false);
    expect(timedOut.checks).toContainEqual(
      expect.objectContaining({ id: 'renderer:hyperframes:1', status: 'error' }),
    );
    renderer.descriptor.runtime.dependencies = [
      { id: 'ffmpeg', versionRange: '>=7', optional: false },
    ];
    const discovery = await diagnoseRecipe(
      { settings: suppliedAssets() },
      {
        installedProviders: [renderer],
        timeoutMs: 5,
        probeDependency: () => new Promise(() => {}),
      },
    );
    expect(discovery.ready).toBe(false);
    expect(discovery.checks).toContainEqual(
      expect.objectContaining({ id: 'renderer:hyperframes:1:ffmpeg', status: 'error' }),
    );
  });

  it('rejects unsupported platform, language, version and local-only remote selection', async () => {
    const renderer = provider('renderer', 'hyperframes');
    renderer.descriptor.runtime.platforms = ['linux'];
    const unsupported = await diagnoseRecipe(
      { settings: suppliedAssets() },
      { installedProviders: [renderer], platform: 'darwin' },
    );
    expect(unsupported.ready).toBe(false);
    renderer.descriptor.runtime.platforms = ['darwin', 'linux', 'win32'];
    renderer.descriptor.execution.location = 'remote';
    const local = await diagnoseRecipe(
      { settings: suppliedAssets() },
      { installedProviders: [renderer] },
    );
    expect(local.checks).toContainEqual(
      expect.objectContaining({ message: expect.stringContaining('LOCAL_ONLY_POLICY') }),
    );
    renderer.descriptor.version = '2';
    const version = await diagnoseRecipe(
      { settings: suppliedAssets() },
      { installedProviders: [renderer] },
    );
    expect(version.checks).toContainEqual(
      expect.objectContaining({ id: 'renderer:hyperframes:1', status: 'missing' }),
    );
  });

  it('discovers allowlisted PATH executables without executing them or accepting directories', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tutorialx-doctor-'));
    try {
      await writeFile(join(root, 'ffmpeg'), '#!/bin/sh\nexit 99\n');
      await chmod(join(root, 'ffmpeg'), 0o700);
      await mkdir(join(root, 'ffprobe'));
      const probe = createPathDependencyProbe({ path: root, platform: 'linux' });
      expect(await probe({ id: 'ffmpeg', versionRange: '>=7', optional: false })).toEqual({
        available: true,
        compatible: null,
      });
      expect(await probe({ id: 'ffprobe', versionRange: '*', optional: false })).toEqual({
        available: false,
        compatible: null,
      });
      expect(await probe({ id: '../arbitrary', versionRange: '*', optional: false })).toEqual({
        available: false,
        compatible: null,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
