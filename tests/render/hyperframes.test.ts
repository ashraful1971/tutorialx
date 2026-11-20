import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createHyperframesRenderer,
  HYPERFRAMES_VERSION,
  type ProcessRunner,
} from '@tutorialx/adapters';
import {
  type OperationContext,
  type RenderRequest,
  renderResultSchema,
} from '@tutorialx/contracts';
import { afterEach, expect, it } from 'vitest';
import { digest, samplePlan, timestamp } from '../fixtures/contracts.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function context(root: string): OperationContext {
  return {
    operationId: 'operation_render',
    jobId: 'job_example',
    attemptId: 'attempt_render',
    reservationId: null,
    outputDirectory: join(root, 'output'),
    deadlineAt: '2099-01-01T00:00:00Z',
    signal: new AbortController().signal,
  };
}

function request(): RenderRequest {
  return {
    plan: samplePlan(),
    timeline: {
      schemaVersion: 1,
      id: 'timeline_example',
      createdAt: timestamp,
      jobId: 'job_example',
      planId: 'plan_example',
      planRevision: 1,
      settingsDigest: digest,
      variantId: 'landscape',
      frameRate: { numerator: 30, denominator: 1 },
      durationUs: 1_000_000,
      clips: [],
      captionTrackId: null,
      intentionalIntervals: [],
    },
    assets: [],
    captions: null,
    templateId: 'fixture',
  };
}

function runner(): ProcessRunner {
  return {
    async run(_executable, args) {
      if (args.includes('--version'))
        return { exitCode: 0, stdout: `hyperframes ${HYPERFRAMES_VERSION}\n`, stderr: '' };
      if (args.includes('check'))
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            ok: true,
            lint: {
              findings: [
                { code: 'fixture_warning', severity: 'warning', message: 'Inspectable warning' },
              ],
            },
          }),
          stderr: '',
        };
      if (args.includes('render')) {
        const destination = args[args.indexOf('--output') + 1];
        if (!destination) throw new Error('missing output');
        await writeFile(destination, 'verified-video');
        return { exitCode: 0, stdout: 'rendered', stderr: '' };
      }
      if (args.includes('-show_streams'))
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            streams: [
              {
                codec_type: 'video',
                codec_name: 'h264',
                width: 640,
                height: 360,
                duration: '1.000000',
                avg_frame_rate: '30/1',
              },
            ],
          }),
          stderr: '',
        };
      throw new Error(`unexpected command: ${args.join(' ')}`);
    },
  };
}

async function fixture(requiredFiles: string[] = []) {
  const root = await mkdtemp(join(tmpdir(), 'tutorialx-hyperframes-'));
  roots.push(root);
  const template = join(root, 'template');
  await mkdir(template);
  await writeFile(join(template, 'index.html'), '<main>TutorialX</main>');
  const provider = createHyperframesRenderer(
    { fps: 30, quality: 'draft', maxOutputBytes: 1_000_000 },
    {
      workspaceId: 'workspace_example',
      settingsDigest: digest,
      artifactRoot: root,
      templates: { fixture: { directory: template, requiredFiles } },
      command: { executable: 'hyperframes' },
      ffprobePath: 'ffprobe',
      runner: runner(),
      now: () => timestamp,
    },
  );
  return { root, provider };
}

it('pins the CLI, stages a reproducible template, probes output, and accepts atomically', async () => {
  const { root, provider } = await fixture(['index.html']);
  expect(provider.descriptor.runtime.dependencies[0]).toEqual({
    id: 'hyperframes',
    versionRange: `=${HYPERFRAMES_VERSION}`,
    optional: false,
  });
  expect(await provider.readiness()).toEqual({ ready: true, diagnostics: [] });
  expect(await provider.preflight(request(), context(root))).toMatchObject({
    ready: true,
    diagnostics: [{ code: 'HYPERFRAMES_FIXTURE_WARNING' }],
  });
  const result = renderResultSchema.parse(await provider.render(request(), context(root)));
  expect(result.video.media).toMatchObject({
    durationUs: 1_000_000,
    width: 640,
    height: 360,
    frameRate: { numerator: 30, denominator: 1 },
    videoCodec: 'h264',
  });
  expect(result.video.digest).toBe(createHash('sha256').update('verified-video').digest('hex'));
  expect(await readFile(join(root, 'output', 'operation_render.mp4'), 'utf8')).toBe(
    'verified-video',
  );
  await expect(stat(join(root, 'output', '.operation_render.partial.mp4'))).rejects.toThrow();
});

it('fails preflight explicitly when a declared asset or font is absent', async () => {
  const missingAsset = await fixture(['missing.png']);
  await expect(
    missingAsset.provider.preflight(request(), context(missingAsset.root)),
  ).resolves.toEqual({
    ready: false,
    diagnostics: [
      {
        code: 'HYPERFRAMES_ASSET_MISSING',
        message: 'HyperFrames staging or preflight failed.',
        classification: 'permanent',
        retryable: false,
      },
    ],
  });

  const missingFont = await fixture();
  const template = join(missingFont.root, 'template');
  const provider = createHyperframesRenderer(
    { fps: 30, quality: 'draft', maxOutputBytes: 1_000_000 },
    {
      workspaceId: 'workspace_example',
      settingsDigest: digest,
      artifactRoot: missingFont.root,
      templates: { fixture: { directory: template, requiredFonts: ['fonts/Inter.woff2'] } },
      runner: runner(),
    },
  );
  await expect(provider.preflight(request(), context(missingFont.root))).resolves.toMatchObject({
    ready: false,
    diagnostics: [{ code: 'HYPERFRAMES_FONT_MISSING' }],
  });
});
