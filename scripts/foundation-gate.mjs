import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = await mkdtemp(resolve(tmpdir(), 'tutorialx-packed-foundation-'));
const keep = process.argv.includes('--keep');
const transcript = [];
const sha256 = (text) => createHash('sha256').update(text).digest('hex');
function run(command, args, cwd, input) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    input,
    env: { ...process.env, CI: 'true', npm_config_audit: 'false', npm_config_fund: 'false' },
    timeout: 120_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error || result.status !== 0)
    throw new Error(
      `${command} ${args.join(' ')} failed: ${result.error?.message ?? result.stderr ?? result.stdout}`,
    );
  return result.stdout;
}
try {
  const supplied = process.argv.indexOf('--packages');
  const packages =
    supplied < 0 ? resolve(temporary, 'packages') : resolve(process.argv[supplied + 1]);
  if (supplied < 0) {
    await mkdir(packages);
    for (const name of ['contracts', 'core', 'adapters', 'cli'])
      run(
        'pnpm',
        ['pack', '--pack-destination', packages, '--json'],
        resolve(root, 'packages', name),
      );
  }
  const tarballs = (await readdir(packages))
    .filter((name) => name.endsWith('.tgz'))
    .map((name) => resolve(packages, name));
  assert.equal(tarballs.length, 4);
  if (process.argv.includes('--container')) {
    const report = run(
      'docker',
      [
        'run',
        '--rm',
        '--memory=2g',
        '--cpus=2',
        '--mount',
        `type=bind,source=${packages},target=/packages,readonly`,
        '--mount',
        `type=bind,source=${fileURLToPath(import.meta.url)},target=/gate.mjs,readonly`,
        'node:22.14.0-bookworm-slim',
        'node',
        '/gate.mjs',
        '--packages',
        '/packages',
      ],
      root,
    );
    process.stdout.write(report);
  } else {
    const installation = resolve(temporary, 'installation');
    await mkdir(installation);
    await writeFile(resolve(installation, 'package.json'), '{"private":true,"type":"module"}\n');
    // Local tarballs cover every TutorialX package. Only pinned public dependencies use the registry.
    run(
      'npm',
      ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--save-exact', ...tarballs],
      installation,
    );
    const binary = resolve(installation, 'node_modules/@tutorialx/cli/dist/bin.js');
    const installedContracts = await import(
      resolve(installation, 'node_modules/@tutorialx/contracts/dist/index.js')
    );
    const { canonicalJson, actionResponseSchema } = installedContracts;
    let request = 0;
    async function call(cwd, action, params = {}, expectedRevision = null, key = null) {
      const envelope = {
        apiVersion: 1,
        requestId: `gate_${request++}`,
        action,
        params,
        expectedRevision,
        idempotencyKey: key === null ? null : sha256(key),
      };
      const response = actionResponseSchema.parse(
        JSON.parse(
          run(
            process.execPath,
            [binary, 'action', '--json', '--input', '-'],
            cwd,
            JSON.stringify(envelope),
          ),
        ),
      );
      assert.equal(response.status, 'ok', JSON.stringify(response));
      transcript.push({
        action,
        status: response.status,
        revision: response.data.revision ?? null,
      });
      return response.data;
    }
    for (const style of ['dedicated', 'existing-project']) {
      const workspace = resolve(temporary, style);
      await mkdir(workspace);
      const appFile = resolve(workspace, 'app.txt');
      await writeFile(appFile, 'Existing application content.\n');
      const external = resolve(temporary, `${style}-private-content`);
      await call(
        workspace,
        'workspace.init',
        style === 'existing-project' ? { contentRoot: external } : {},
      );
      const host = style === 'dedicated' ? 'codex' : 'claude-code';
      const skill = await call(workspace, 'skill.install', { host });
      await call(workspace, 'skill.install', {
        host,
        apply: true,
        fingerprint: skill.preview.fingerprint,
      });
      const installedSkill = resolve(
        workspace,
        host === 'codex'
          ? '.agents/skills/tutorialx/SKILL.md'
          : '.claude/skills/tutorialx/SKILL.md',
      );
      assert.match(await readFile(installedSkill, 'utf8'), /name: tutorialx/);
      await call(
        workspace,
        'workspace.init',
        style === 'existing-project' ? { contentRoot: external } : {},
      );
      assert.equal(await readFile(appFile, 'utf8'), 'Existing application content.\n');
      const created = await call(
        workspace,
        'job.create',
        {
          title: 'Packed foundation fixture',
          topic: 'Explain supplied fixture material',
          audience: 'Contributors',
        },
        null,
        `create-${style}`,
      );
      const jobId = created.jobId;
      const sourceResult = await call(
        workspace,
        'source.create',
        {
          jobId,
          source: {
            input: { kind: 'text', text: 'TutorialX keeps approved plans as revisions.' },
            attribution: {
              origin: 'Authored TutorialX foundation fixture',
              license: 'Apache-2.0',
              requiredText: null,
              usage: 'permitted',
            },
          },
        },
        1,
        `source-${style}`,
      );
      const source = sourceResult.source;
      const evidence = {
        schemaVersion: 1,
        id: 'gate_evidence',
        createdAt: new Date().toISOString(),
        jobId,
        sourceId: source.id,
        sourceHash: source.contentHash,
        locator: { kind: 'whole' },
        claim: 'Plans are revisioned.',
        extract: 'TutorialX keeps approved plans as revisions.',
        status: 'supplied',
        artifactIds: [],
        limitations: [],
      };
      await call(
        workspace,
        'job.submit',
        {
          jobId,
          kind: 'research',
          evidence: [evidence],
          report: {
            schemaVersion: 1,
            id: 'gate_research',
            createdAt: evidence.createdAt,
            jobId,
            basedOnRevision: 2,
            sourceIds: [source.id],
            evidenceIds: [evidence.id],
            summary: 'An authored fixture claim.',
            blockers: [],
          },
        },
        2,
        `research-${style}`,
      );
      const context = await call(workspace, 'job.context', { jobId, role: 'writer-director' });
      const plan = {
        schemaVersion: 1,
        id: 'gate_plan',
        createdAt: evidence.createdAt,
        jobId,
        revision: 1,
        basedOnJobRevision: 3,
        researchReportId: 'gate_research',
        evidenceDigest: sha256(canonicalJson({ evidence: [evidence] })),
        effective: context.effective,
        scenes: [
          {
            id: 'gate_scene',
            title: 'Revisioned plans',
            narration: 'Plans are revisioned.',
            intent: 'Explain the supplied claim.',
            evidenceIds: [evidence.id],
            visual: {
              kind: 'text',
              headline: 'Revisioned plans',
              body: 'Review before production.',
            },
            estimatedDurationUs: 5_000_000,
            transition: 'cut',
            variantFraming: {},
          },
        ],
        costEstimate: { expectedUsdMicros: 0, upperBoundUsdMicros: 0, uncertainty: [] },
        limitations: [],
      };
      await call(workspace, 'job.submit', { jobId, kind: 'plan', plan }, 3, `plan-${style}`);
      const inspected = await call(workspace, 'job.inspect', { jobId });
      assert.equal(inspected.status.revision, 4);
      assert.equal(inspected.status.waitReason, 'approval');
      const shown = await call(workspace, 'plan.show', { jobId });
      assert.ok(shown);
      const capabilities = await call(workspace, 'capabilities');
      assert.ok(capabilities.actions.some((action) => action.name === 'plan.approve'));
      transcript.push({
        workspaceStyle: style,
        preservedApp: true,
        persistedRevision: 4,
        outcome: 'needs-approval',
        productionExecuted: false,
      });
    }
    const report = {
      gate: 'M1 packed foundation',
      platform: process.platform,
      arch: process.arch,
      node: process.versions.node,
      result: 'passed',
      packageCount: tarballs.length,
      transcript,
    };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (keep) process.stderr.write(`Retained fixture: ${temporary}\n`);
  }
} finally {
  if (!keep) await rm(temporary, { recursive: true, force: true });
}
