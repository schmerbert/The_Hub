import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { createHub } from '../src/server/app.js';
import { HubDatabase } from '../src/core/db.js';
import { buildContext } from '../src/core/context.js';
import { sha256 } from '../src/core/hash.js';
import { ARRIVAL_CHARTER } from '../src/resident/charter.js';

async function fixture(env = {}, provider) {
  const dir = await mkdtemp(join(tmpdir(), 'hub-first-breath-'));
  const hub = createHub({ env: { ...env, HUB_DB_PATH: join(dir, 'hub.sqlite') }, provider });
  await new Promise(resolve => hub.server.listen(0, resolve));
  const address = hub.server.address();
  const base = `http://127.0.0.1:${address.port}`;
  return { hub, base, dir, close: async () => { await new Promise(resolve => hub.server.close(resolve)); hub.close(); await rm(dir, { recursive: true, force: true }); } };
}
async function get(base, path) { const response = await fetch(base + path); return { response, body: await response.json() }; }
async function post(base, path, content) { const response = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content }) }); return { response, body: await response.json() }; }

test('schema initializes idempotently', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-schema-')); const path = join(dir, 'hub.sqlite');
  const first = new HubDatabase(path); const threadId = first.threadId; first.close();
  const second = new HubDatabase(path); assert.equal(second.threadId, threadId); second.close();
  await rm(dir, { recursive: true, force: true });
});

test('fake wake commits exact user/context/resident/provider records', async () => {
  const f = await fixture({ HUB_RESIDENT_MODE: 'fake' });
  try {
    const result = await post(f.base, '/api/wakes', 'Please orient yourself.');
    assert.equal(result.response.status, 200); assert.equal(result.body.status, 'committed'); assert.equal(result.body.provider, 'fake');
    assert.equal(result.body.events.filter(e => e.actorKind === 'resident').length, 1);
    assert.equal(result.body.events.find(e => e.actorKind === 'user').content, 'Please orient yourself.');
    assert.equal(result.body.context[0].content, ARRIVAL_CHARTER);
    assert.equal(result.body.context.at(-1).content, 'Please orient yourself.');
    assert.match(result.body.events.find(e => e.actorKind === 'resident').content, /^FAKE MODE/);
    assert.equal(f.hub.provider.calls.length, 1);
  } finally { await f.close(); }
});

test('context ordering and hashes match actual adapter input', async () => {
  const f = await fixture({ HUB_RESIDENT_MODE: 'fake' });
  try {
    const result = await post(f.base, '/api/wakes', 'Exact words.'); const included = result.body.context.filter(item => item.included);
    assert.deepEqual(f.hub.provider.calls[0].messages, included.map(item => ({ role: item.actorRole, content: item.content })));
    for (const item of result.body.context) assert.equal(item.contentHash, sha256(item.content));
  } finally { await f.close(); }
});

test('submitted whitespace is validated trimmed but preserved exactly', async () => {
  const f = await fixture({ HUB_RESIDENT_MODE: 'fake' });
  try {
    const submitted = '  exact text with edges  ';
    const result = await post(f.base, '/api/wakes', submitted);
    assert.equal(result.body.events.find(e => e.actorKind === 'user').content, submitted);
    assert.equal(result.body.context.at(-1).content, submitted);
    assert.equal(f.hub.provider.calls[0].messages.at(-1).content, submitted);
  } finally { await f.close(); }
});

test('default ceiling creates omission disclosure without a summary', async () => {
  const f = await fixture({ HUB_RESIDENT_MODE: 'fake', HUB_MESSAGE_CEILING: '2' });
  try {
    await post(f.base, '/api/wakes', 'first'); await post(f.base, '/api/wakes', 'second');
    const result = await post(f.base, '/api/wakes', 'third');
    const disclosure = result.body.context.find(item => item.itemKind === 'disclosure');
    assert.ok(disclosure); assert.match(disclosure.content, /3 older utterances omitted/); assert.doesNotMatch(disclosure.content, /first|second/);
    assert.equal(result.body.context.filter(item => item.included && item.itemKind === 'utterance').length, 2);
    assert.equal(result.body.context.filter(item => !item.included).length, 3);
  } finally { await f.close(); }
});

test('health, thread, and wake inspection are attributable', async () => {
  const f = await fixture({ HUB_RESIDENT_MODE: 'fake' });
  try {
    const health = await get(f.base, '/api/health'); assert.equal(health.body.residentMode, 'fake'); assert.equal(health.body.liveCredentialsAvailable, false); assert.ok(!JSON.stringify(health.body).includes('authorization'));
    const created = await post(f.base, '/api/wakes', 'inspect me'); const wakeId = created.body.id;
    const thread = await get(f.base, '/api/thread'); assert.equal(thread.body.wakes[0].id, wakeId);
    const inspection = await get(f.base, `/api/wakes/${wakeId}`); assert.equal(inspection.body.context[0].itemKind, 'charter'); assert.ok(inspection.body.events.length >= 2);
  } finally { await f.close(); }
});

test('empty and oversized input refuse before provider call', async () => {
  const f = await fixture({ HUB_RESIDENT_MODE: 'fake', HUB_MAX_MESSAGE_LENGTH: '5' });
  try {
    const empty = await post(f.base, '/api/wakes', '   '); assert.equal(empty.response.status, 400); assert.equal(empty.body.error.code, 'invalid_message');
    const big = await post(f.base, '/api/wakes', '123456'); assert.equal(big.response.status, 400); assert.equal(big.body.error.code, 'message_too_large');
    assert.equal(f.hub.provider.calls.length, 0); assert.equal(f.hub.db.getThread().wakes.length, 0);
  } finally { await f.close(); }
});

test('live mode without key fails honestly and creates no resident utterance', async () => {
  const f = await fixture({ HUB_RESIDENT_MODE: 'live', DEEPSEEK_API_KEY: '' });
  try {
    const result = await post(f.base, '/api/wakes', 'wake without credentials'); assert.equal(result.response.status, 503); assert.equal(result.body.failureCode, 'provider_unavailable');
    assert.equal(result.body.events.filter(e => e.actorKind === 'resident').length, 0); assert.equal(result.body.events.find(e => e.actorKind === 'host').authority, 'host_receipt');
  } finally { await f.close(); }
});

test('empty provider content fails honestly', async () => {
  const provider = { async complete() { return { content: '   ', resolvedModel: 'test' }; } };
  const f = await fixture({ HUB_RESIDENT_MODE: 'fake' }, provider);
  try { const result = await post(f.base, '/api/wakes', 'empty response'); assert.equal(result.response.status, 502); assert.equal(result.body.failureCode, 'provider_empty_content'); assert.equal(result.body.events.filter(e => e.actorKind === 'resident').length, 0); }
  finally { await f.close(); }
});

test('provider HTTP failure is typed and never stores authorization data', async () => {
  const secret = 'super-secret-authorization-value';
  const upstream = createServer((request, response) => { assert.equal(request.headers.authorization, `Bearer ${secret}`); response.writeHead(500, { 'content-type': 'application/json' }); response.end(JSON.stringify({ error: secret })); });
  await new Promise(resolve => upstream.listen(0, resolve)); const port = upstream.address().port;
  const f = await fixture({ HUB_RESIDENT_MODE: 'live', DEEPSEEK_API_KEY: secret, DEEPSEEK_BASE_URL: `http://127.0.0.1:${port}` });
  try { const result = await post(f.base, '/api/wakes', 'provider failure'); const serialized = JSON.stringify(result.body); assert.equal(result.response.status, 502); assert.equal(result.body.failureCode, 'provider_http_error'); assert.doesNotMatch(serialized, new RegExp(secret)); assert.doesNotMatch(serialized, /authorization/i); }
  finally { await f.close(); await new Promise(resolve => upstream.close(resolve)); }
});

test('DeepSeek request explicitly carries configured thinking mode', async () => {
  const requestBodies = [];
  const rawProviderContent = '  provider answer with edges  ';
  const upstream = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    requestBodies.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ id: 'response-test', model: 'deepseek-v4-flash', choices: [{ message: { content: rawProviderContent }, finish_reason: 'stop' }] }));
  });
  await new Promise(resolve => upstream.listen(0, resolve)); const port = upstream.address().port;
  const first = await fixture({ HUB_RESIDENT_MODE: 'live', DEEPSEEK_API_KEY: 'test-key', DEEPSEEK_BASE_URL: `http://127.0.0.1:${port}`, DEEPSEEK_THINKING: 'disabled' });
  const second = await fixture({ HUB_RESIDENT_MODE: 'live', DEEPSEEK_API_KEY: 'test-key', DEEPSEEK_BASE_URL: `http://127.0.0.1:${port}`, DEEPSEEK_THINKING: 'enabled' });
  try {
    const firstResult = await post(first.base, '/api/wakes', 'disabled thinking');
    assert.equal(firstResult.response.status, 200);
    assert.equal(firstResult.body.events.find(event => event.actorKind === 'resident').content, rawProviderContent);
    assert.equal((await post(second.base, '/api/wakes', 'enabled thinking')).response.status, 200);
    assert.deepEqual(requestBodies.map(body => body.thinking), [{ type: 'disabled' }, { type: 'enabled' }]);
  } finally { await first.close(); await second.close(); await new Promise(resolve => upstream.close(resolve)); }
});

test('interrupted nonterminal wakes remain visible', async () => {
  const f = await fixture({ HUB_RESIDENT_MODE: 'fake' });
  try {
    const context = buildContext({ utterances: [], newContent: 'interrupted', ceiling: 20 });
    const created = f.hub.db.createWake({ provider: 'fake', model: 'deepseek-v4-flash', content: 'interrupted', contextItems: context.items });
    const thread = await get(f.base, '/api/thread'); const wake = thread.body.wakes.find(item => item.id === created.wakeId); assert.equal(wake.status, 'assembling'); assert.notEqual(wake.status, 'committed');
  } finally { await f.close(); }
});

test('Corner surface is static, responsive, and limited to First Breath APIs', async () => {
  const files = await Promise.all(['public/index.html', 'public/styles.css', 'public/app.js', 'public/wave.js'].map(path => readFile(new URL(`../${path}`, import.meta.url), 'utf8')));
  const [html, css, app, wave] = files;
  assert.match(html, /id="chip"/); assert.match(html, /id="bench"/); assert.match(html, /id="tray"/); assert.match(html, /aria-live/);
  assert.match(css, /\[hidden\] \{ display: none !important; \}/); assert.match(css, /@media \(min-width: 701px\)/); assert.match(css, /#app\[data-mode="compact"\] \.bench \{ display: none; \}/); assert.match(css, /#app\[data-mode="expanded"\] \.chip \{ display: none; \}/); assert.match(css, /@media \(max-width: 700px\)/); assert.match(css, /#btn-compact \{ display: none; \}/); assert.match(css, /prefers-reduced-motion/);
  assert.match(app, /matchMedia\('\(max-width: 700px\)'\)/); assert.match(app, /next === 'compact'\) next = 'expanded'/); assert.match(app, /setMode\('expanded'\)/); assert.match(app, /setMode\('compact'\)/); assert.match(app, /\/api\/wakes/); assert.match(app, /\/api\/thread/); assert.match(app, /Inspect wake/); assert.match(wave, /class CornerWave/);
  const surface = `${html}\n${css}\n${app}\n${wave}`.toLowerCase();
  for (const residue of ['chronicle', 'vault', 'forest', 'reach', 'empty reply', 'looking']) assert.equal(surface.includes(residue), false, `surface contains forbidden residue: ${residue}`);
});
