// SPDX-License-Identifier: Apache-2.0
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';

const defaults = Object.freeze({ siteTitle: 'TutorialX Demo', accent: '#176bff', revision: 1 });
const args = new Map();
for (let index = 2; index < process.argv.length; index += 2)
  args.set(process.argv[index], process.argv[index + 1]);
const statePath = resolve(args.get('--state') ?? 'demo-state.json');
const fixtureToken = args.get('--fixture-token') ?? '';
if (!fixtureToken) throw new Error('Supply --fixture-token for setup/reset operations.');

async function save(state) {
  await mkdir(dirname(statePath), { recursive: true });
  const temporary = `${statePath}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, statePath);
}
async function load() {
  try {
    return JSON.parse(await readFile(statePath, 'utf8'));
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    await save(defaults);
    return structuredClone(defaults);
  }
}
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character],
  );
async function body(request) {
  const chunks = [];
  let size = 0;
  for await (const part of request) {
    size += part.length;
    if (size > 10_000) throw new Error('Request body exceeds fixture limit.');
    chunks.push(part);
  }
  return Buffer.concat(chunks).toString('utf8');
}
function json(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(`${JSON.stringify(value)}\n`);
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', 'http://fixture.local');
    if (request.method === 'GET' && url.pathname === '/api/state') {
      json(response, 200, await load());
      return;
    }
    if (request.method === 'GET' && url.pathname === '/admin/settings') {
      const state = await load();
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(`<!doctype html><html><head><title>Demo settings</title></head><body>
<main><h1>Demo settings</h1>${url.searchParams.has('saved') ? '<p role="status">Settings saved.</p>' : ''}
<form method="post" action="/admin/settings">
<label>Site title <input data-testid="site-title" name="siteTitle" value="${escape(state.siteTitle)}" /></label>
<label>Accent color <input data-testid="accent" name="accent" value="${escape(state.accent)}" /></label>
<button type="submit">Save changes</button></form>
<div aria-hidden="true" style="height: 900px"></div>
<section data-testid="advanced"><h2>Advanced preview</h2><p>Fixture checkpoint.</p></section>
</main></body></html>`);
      return;
    }
    if (request.method === 'POST' && url.pathname === '/admin/settings') {
      const input = new URLSearchParams(await body(request));
      const siteTitle = input.get('siteTitle')?.trim() ?? '';
      const accent = input.get('accent')?.trim() ?? '';
      if (!siteTitle || siteTitle.length > 80 || !/^#[a-f0-9]{6}$/i.test(accent)) {
        json(response, 422, { code: 'INVALID_SETTINGS' });
        return;
      }
      const current = await load();
      const normalizedAccent = accent.toLowerCase();
      if (current.siteTitle !== siteTitle || current.accent !== normalizedAccent)
        await save({ siteTitle, accent: normalizedAccent, revision: current.revision + 1 });
      response.writeHead(303, { location: '/admin/settings?saved=1' });
      response.end();
      return;
    }
    if (request.method === 'POST' && url.pathname === '/__fixture/reset') {
      if (request.headers.authorization !== `Bearer ${fixtureToken}`) {
        json(response, 403, { code: 'FIXTURE_TOKEN_REQUIRED' });
        return;
      }
      await save(defaults);
      json(response, 200, await load());
      return;
    }
    json(response, 404, { code: 'NOT_FOUND' });
  } catch {
    json(response, 500, { code: 'FIXTURE_FAILURE' });
  }
});

server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture did not bind TCP.');
  process.stdout.write(`${JSON.stringify({ origin: `http://127.0.0.1:${address.port}` })}\n`);
});
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => server.close(() => process.exit(0)));
