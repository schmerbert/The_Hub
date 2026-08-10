import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { createHub } from '../src/server/app.js';
import { HubDatabase } from '../src/core/db.js';
import { buildContext } from '../src/core/context.js';
import { sha256 } from '../src/core/hash.js';
import { ARRIVAL_CHARTER } from '../src/resident/charter.js';

async function fixture(env = {}, provider) {
  const dir = await mkdtemp(join(tmpdir(), 'hub-first-breath-'));
  const hub = createHub({ env: { ...env, HUB_DB_PATH: join(dir, 'hub.sqlite'), HUB_SPINE_PATH: join(dir, 'spine.jsonl') }, provider });
  await new Promise(resolve => hub.server.listen(0, resolve));
  const address = hub.server.address();
  const base = `http://127.0.0.1:${address.port}`;
  return { hub, base, dir, close: async () => { await new Promise(resolve => hub.server.close(resolve)); hub.close(); await rm(dir, { recursive: true, force: true }); } };
}
async function get(base, path) { const response = await fetch(base + path); return { response, body: await response.json() }; }
async function post(base, path, content) { const response = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content }) }); return { response, body: await response.json() }; }

function manifestFrom(item) { return JSON.parse(item.content.slice('Host environment manifest:\n'.length)); }

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
    assert.equal(result.body.events.filter(e => e.actorKind === 'resident' && e.eventKind === 'utterance').length, 1);
    assert.equal(result.body.events.filter(e => e.eventKind === 'state').length, 2);
    assert.equal(result.body.events.find(e => e.actorKind === 'user').content, 'Please orient yourself.');
    assert.equal(result.body.context[0].itemKind, 'clinical_anchor');
    assert.equal(result.body.context.at(-1).content, 'Please orient yourself.');
    assert.match(result.body.events.find(e => e.actorKind === 'resident' && e.eventKind === 'utterance').content, /^FAKE MODE/);
    assert.deepEqual(result.body.phases.map(phase => phase.phase), ['orientation', 'response']);
    assert.equal(f.hub.provider.calls.length, 2);
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

test('orientation receipt matches persisted wake and provider input', async () => {
  const f = await fixture({ HUB_RESIDENT_MODE: 'fake' });
  try {
    const result = await post(f.base, '/api/wakes', 'Orient me.');
    const orientation = JSON.parse(result.body.phases[0].requestBody);
    assert.equal(orientation.messages.at(-1).content, 'Orient me.');
    assert.equal(orientation.tools[0].function.name, 'tend_hearth');
    assert.deepEqual(orientation.tool_choice, { type: 'function', function: { name: 'tend_hearth' } });
    assert.equal(result.body.phases[1].phase, 'response');
    assert.equal(result.body.hearth.toolCallId, 'call_fake_hearth');
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
    assert.equal(result.body.context.filter(item => !item.included).length, 0);
    assert.equal(result.body.phases.at(-1).messageSources.filter(item => item.sourceEventId).length, 5);
    assert.doesNotMatch(JSON.stringify(result.body), /"summary"\s*:/i);
  } finally { await f.close(); }
});

test('legacy context schema migrates idempotently without losing records', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-legacy-')); const path = join(dir, 'hub.sqlite');
  const legacy = new DatabaseSync(path);
  legacy.exec(`
    CREATE TABLE threads (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, label TEXT);
    CREATE TABLE wakes (id TEXT PRIMARY KEY, thread_id TEXT NOT NULL REFERENCES threads(id), status TEXT NOT NULL, provider TEXT NOT NULL, requested_model TEXT NOT NULL, started_at TEXT NOT NULL);
    CREATE TABLE wake_context_items (
      id TEXT PRIMARY KEY, wake_id TEXT NOT NULL REFERENCES wakes(id), ordinal INTEGER NOT NULL,
      item_kind TEXT NOT NULL CHECK(item_kind IN ('charter','utterance','disclosure')),
      actor_role TEXT NOT NULL, content TEXT NOT NULL, source_event_id TEXT, source_description TEXT NOT NULL,
      authority TEXT NOT NULL, included INTEGER NOT NULL CHECK(included IN (0,1)), omission_reason TEXT, content_hash TEXT NOT NULL,
      UNIQUE(wake_id, ordinal)
    );
    INSERT INTO threads VALUES ('thread_legacy', '2026-08-05T00:00:00.000Z', NULL);
    INSERT INTO wakes(id, thread_id, status, provider, requested_model, started_at) VALUES ('wake_legacy', 'thread_legacy', 'committed', 'fake', 'legacy-model', '2026-08-05T00:00:01.000Z');
    INSERT INTO wake_context_items VALUES ('ctx_legacy', 'wake_legacy', 1, 'charter', 'system', 'legacy charter', NULL, 'legacy', 'host_receipt', 1, NULL, 'legacy-hash');
  `);
  legacy.close();
  try {
    const first = new HubDatabase(path);
    assert.equal(first.threadId, 'thread_legacy');
    assert.deepEqual(first.getWake('wake_legacy').context[0], {
      ordinal: 1, itemKind: 'charter', actorRole: 'system', content: 'legacy charter', sourceEventId: null,
      sourceDescription: 'legacy', authority: 'host_receipt', included: true, omissionReason: null, contentHash: 'legacy-hash',
    });
    first.close();
    const second = new HubDatabase(path);
    assert.equal(second.threadId, 'thread_legacy');
    assert.equal(second.getWake('wake_legacy').context.length, 1);
    const created = second.createWake({
      provider: 'fake', model: 'legacy-model', content: 'new wake',
      contextBuilder: ({ threadId, wakeId, startedAt }) => buildContext({
        utterances: [], newContent: 'new wake', ceiling: 20, threadId, wakeId,
        wakeStartedAtUtc: startedAt, residentMode: 'fake', requestedModel: 'legacy-model',
      }).items,
    });
    assert.equal(second.getWake(created.wakeId).context[1].itemKind, 'environment_manifest');
    second.close();
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('health, thread, and wake inspection are attributable', async () => {
  const f = await fixture({ HUB_RESIDENT_MODE: 'fake' });
  try {
    const health = await get(f.base, '/api/health'); assert.equal(health.body.residentMode, 'fake'); assert.equal(health.body.liveCredentialsAvailable, false); assert.ok(!JSON.stringify(health.body).includes('authorization'));
    const created = await post(f.base, '/api/wakes', 'inspect me'); const wakeId = created.body.id;
    const thread = await get(f.base, '/api/thread'); assert.equal(thread.body.wakes[0].id, wakeId);
    const inspection = await get(f.base, `/api/wakes/${wakeId}`); assert.equal(inspection.body.context[0].itemKind, 'clinical_anchor'); assert.deepEqual(inspection.body.phases.map(phase => phase.phase), ['orientation', 'response']); assert.ok(inspection.body.events.length >= 4);
  } finally { await f.close(); }
});

test('orientation manifest and API response exclude provider credentials and paths', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-secrets-')); const dbPath = join(dir, 'hub.sqlite');
  const hub = createHub({
    dbPath,
    spinePath: join(dir, 'spine.jsonl'),
    env: {
      HUB_RESIDENT_MODE: 'fake',
      HUB_DB_PATH: 'sentinel-db-path',
      DEEPSEEK_API_KEY: 'sentinel-api-key',
      DEEPSEEK_BASE_URL: 'https://sentinel-provider.example.invalid',
    },
  });
  await new Promise(resolve => hub.server.listen(0, resolve));
  const base = `http://127.0.0.1:${hub.server.address().port}`;
  try {
    const result = await post(base, '/api/wakes', 'credential boundary');
    const serialized = JSON.stringify(result.body);
    assert.equal(result.response.status, 200);
    assert.doesNotMatch(serialized, /sentinel-api-key/);
    assert.doesNotMatch(serialized, /sentinel-provider\.example\.invalid/);
    assert.doesNotMatch(serialized, /sentinel-db-path/);
    const bootstrap = result.body.context.find(item => item.itemKind === 'clinical_anchor').content;
    assert.doesNotMatch(bootstrap, /sentinel-api-key/);
    assert.doesNotMatch(bootstrap, /sentinel-provider\.example\.invalid/);
    assert.doesNotMatch(bootstrap, /sentinel-db-path/);
  } finally {
    await new Promise(resolve => hub.server.close(resolve)); hub.close(); await rm(dir, { recursive: true, force: true });
  }
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
  try { const result = await post(f.base, '/api/wakes', 'empty response'); assert.equal(result.response.status, 502); assert.equal(result.body.failureCode, 'hearth_orientation_invalid'); assert.equal(result.body.events.filter(e => e.actorKind === 'resident').length, 0); }
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
    const orientation = requestBodies.at(-1).tool_choice;
    response.end(JSON.stringify(orientation
      ? { id: 'orientation-test', model: 'deepseek-v4-flash', choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'deepseek-hearth', type: 'function', function: { name: 'tend_hearth', arguments: '{}' } }] }, finish_reason: 'tool_calls' }] }
      : { id: 'response-test', model: 'deepseek-v4-flash', choices: [{ message: { role: 'assistant', content: rawProviderContent, reasoning_content: 'response-cot' }, finish_reason: 'stop' }] }));
  });
  await new Promise(resolve => upstream.listen(0, resolve)); const port = upstream.address().port;
  const first = await fixture({ HUB_RESIDENT_MODE: 'live', DEEPSEEK_API_KEY: 'test-key', DEEPSEEK_BASE_URL: `http://127.0.0.1:${port}`, DEEPSEEK_THINKING: 'disabled' });
  const second = await fixture({ HUB_RESIDENT_MODE: 'live', DEEPSEEK_API_KEY: 'test-key', DEEPSEEK_BASE_URL: `http://127.0.0.1:${port}`, DEEPSEEK_THINKING: 'enabled' });
  try {
    const firstResult = await post(first.base, '/api/wakes', 'disabled thinking');
    assert.equal(firstResult.response.status, 200);
    assert.equal(firstResult.body.events.find(event => event.actorKind === 'resident' && event.eventKind === 'utterance').content, rawProviderContent);
    assert.equal((await post(second.base, '/api/wakes', 'enabled thinking')).response.status, 200);
    assert.deepEqual(requestBodies.map(body => body.thinking), [{ type: 'disabled' }, { type: 'disabled' }, { type: 'disabled' }, { type: 'enabled' }]);
    const enabledResponse = requestBodies[3];
    const assistantWithTools = enabledResponse.messages.filter(message => message.role === 'assistant' && Array.isArray(message.tool_calls));
    assert.ok(assistantWithTools.length >= 1);
    for (const message of assistantWithTools) assert.equal(Object.hasOwn(message, 'reasoning_content'), true);
    assert.equal(assistantWithTools[0].reasoning_content, '');
  } finally { await first.close(); await second.close(); await new Promise(resolve => upstream.close(resolve)); }
});

test('echoReasoningContentForContinuation preserves exact CoT and fills missing assistants', async () => {
  const { echoReasoningContentForContinuation } = await import('../src/providers/deepseek.js');
  const refs = [
    { sourceEventId: null, message: { role: 'system', content: 'ground' } },
    { sourceEventId: null, message: { role: 'assistant', content: null, tool_calls: [{ id: 'a' }] } },
    { sourceEventId: null, message: { role: 'assistant', content: 'hi', reasoning_content: 'exact-cot' } },
    { sourceEventId: null, message: { role: 'user', content: 'q' } },
  ];
  const echoed = echoReasoningContentForContinuation(refs, { thinking: 'enabled', tools: [{ type: 'function' }] });
  assert.equal(Object.hasOwn(echoed[1].message, 'reasoning_content'), true);
  assert.equal(echoed[1].message.reasoning_content, '');
  assert.equal(echoed[2].message.reasoning_content, 'exact-cot');
  assert.equal(Object.hasOwn(echoed[3].message, 'reasoning_content'), false);
  assert.equal(echoReasoningContentForContinuation(refs, { thinking: 'disabled', tools: undefined }), refs);
});

test('interrupted nonterminal wakes remain visible', async () => {
  const f = await fixture({ HUB_RESIDENT_MODE: 'fake' });
  try {
    const created = f.hub.db.createWake({
      provider: 'fake', model: 'deepseek-v4-flash', content: 'interrupted',
      contextBuilder: ({ threadId, wakeId, startedAt }) => buildContext({
        utterances: [], newContent: 'interrupted', ceiling: 20, threadId, wakeId,
        wakeStartedAtUtc: startedAt, residentMode: 'fake', requestedModel: 'deepseek-v4-flash',
      }).items,
    });
    const thread = await get(f.base, '/api/thread'); const wake = thread.body.wakes.find(item => item.id === created.wakeId); assert.equal(wake.status, 'assembling'); assert.notEqual(wake.status, 'committed');
  } finally { await f.close(); }
});

test('wake storage rejects a prebuilt manifest with mismatched identity', async () => {
  const f = await fixture({ HUB_RESIDENT_MODE: 'fake' });
  try {
    const context = buildContext({
      utterances: [], newContent: 'mismatched', ceiling: 20,
      threadId: f.hub.db.threadId, wakeId: 'wake_not_allocated', wakeStartedAtUtc: '2026-08-05T00:00:00.000Z',
      residentMode: 'fake', requestedModel: 'deepseek-v4-flash',
    });
    assert.throws(() => f.hub.db.createWake({
      provider: 'fake', model: 'deepseek-v4-flash', content: 'mismatched', contextItems: context.items,
    }), /match its persisted wake/);
    assert.equal(f.hub.db.getThread().wakes.length, 0);
  } finally { await f.close(); }
});

test('Corner surface is static, responsive, and limited to First Breath APIs', async () => {
  const files = await Promise.all(['public/index.html', 'public/styles.css', 'public/app.js', 'public/wave.js'].map(path => readFile(new URL(`../${path}`, import.meta.url), 'utf8')));
  const [html, css, app, wave] = files;
  assert.match(html, /id="chip"/); assert.match(html, /id="bench"/); assert.match(html, /id="tray"/); assert.match(html, /aria-live/);
  assert.match(css, /\[hidden\] \{ display: none !important; \}/); assert.match(css, /@media \(min-width: 701px\)/); assert.match(css, /#app\[data-mode="compact"\] \.bench \{ display: none; \}/); assert.match(css, /#app\[data-mode="expanded"\] \.chip \{ display: none; \}/); assert.match(css, /@media \(max-width: 700px\)/); assert.match(css, /#btn-compact \{ display: none; \}/); assert.match(css, /prefers-reduced-motion/);
  assert.match(app, /matchMedia\('\(max-width: 700px\)'\)/); assert.match(app, /next === 'compact'\) next = 'expanded'/); assert.match(app, /setMode\('expanded'\)/); assert.match(app, /setMode\('compact'\)/); assert.match(app, /\/api\/wakes/); assert.match(app, /\/api\/thread/); assert.match(app, /Inspect wake/); assert.match(app, /wakesForActiveSession/); assert.match(app, /This lifespan/); assert.match(html, /This lifespan/); assert.match(wave, /class CornerWave/);
  const surface = `${html}\n${css}\n${app}\n${wave}`.toLowerCase();
  for (const residue of ['chronicle', 'vault', 'forest', 'reach', 'empty reply', 'looking']) assert.equal(surface.includes(residue), false, `surface contains forbidden residue: ${residue}`);
});
