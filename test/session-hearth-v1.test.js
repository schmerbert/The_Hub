import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHub } from '../src/server/app.js';
import { scrubProviderHistory } from '../src/scrub/provider-presentation.js';
import { validateOrientationResult } from '../src/hearth/handshake.js';

async function hubFixture(env = {}, provider) {
  const dir = await mkdtemp(join(tmpdir(), 'hub-session-hearth-v1-'));
  const hub = createHub({ env: { HUB_RESIDENT_MODE: 'fake', ...env, HUB_DB_PATH: join(dir, 'hub.sqlite'), HUB_SPINE_PATH: join(dir, 'spine.jsonl') }, provider });
  return { dir, hub, close: () => { hub.close(); return rm(dir, { recursive: true, force: true }); } };
}

test('Hearth accepts DeepSeek semantically-empty wrapping but refuses any carried value', () => {
  const result = argumentsText => ({ message: { role: 'assistant', content: null, tool_calls: [{ id: 'hearth', type: 'function', function: { name: 'tend_hearth', arguments: argumentsText } }] } });
  assert.deepEqual(validateOrientationResult(result('{}')).normalizedArguments, {});
  assert.deepEqual(validateOrientationResult(result('{"params":{}}')).normalizedArguments, {});
  assert.throws(() => validateOrientationResult(result('{"params":{"value":1}}')), /semantically empty/);
  assert.throws(() => validateOrientationResult(result('{"other":{}}')), /semantically empty/);
});

test('v1 first turn stores one user, performs two phases, and later turns stay ordinary', async () => {
  const f = await hubFixture();
  try {
    const first = await f.hub.wake('first exact user');
    assert.equal(first.status, 'committed');
    assert.deepEqual(first.phases.map(phase => phase.phase), ['orientation', 'response']);
    assert.equal(f.hub.provider.calls.length, 2);
    assert.equal(first.events.filter(event => event.actorKind === 'user').length, 1);
    assert.equal(first.events.filter(event => event.actorKind === 'resident' && event.eventKind === 'utterance').length, 1);
    assert.equal(first.events.filter(event => event.eventKind === 'state').length, 2);
    const orientation = JSON.parse(first.phases[0].requestBody);
    const response = JSON.parse(first.phases[1].requestBody);
    assert.equal(orientation.messages.at(-1).content, 'first exact user');
    assert.equal(response.messages.some(message => message.content === 'first exact user'), true);
    const hearthAction = JSON.parse(first.events.find(event => event.eventKind === 'state' && event.actorKind === 'resident').content);
    const carriedHearthAction = response.messages.find(message => message.tool_calls?.some(call => call.function?.name === 'tend_hearth'));
    assert.ok(carriedHearthAction);
    assert.deepEqual(carriedHearthAction.tool_calls, hearthAction.tool_calls);
    assert.equal(carriedHearthAction.reasoning_content, '');
    const hearthReturn = response.messages.find(message => message.role === 'tool' && message.content === first.hearth.scrollMarkdown);
    assert.ok(hearthReturn);
    assert.match(hearthReturn.content, /^# Hearth/);
    assert.doesNotMatch(hearthReturn.content, /schema_version|return_json|raw_return|Longshore Current/i);
    const later = await f.hub.wake('second exact user');
    assert.deepEqual(later.phases.map(phase => phase.phase), ['ordinary']);
    const laterRequest = JSON.parse(later.phases[0].requestBody);
    const laterMessages = laterRequest.messages;
    assert.equal(laterMessages.some(message => message.role === 'tool' && message.content.startsWith('# Wake inheritance')), false);
    assert.equal(laterMessages.some(message => message.tool_calls?.some(call => call.function?.name === 'tend_hearth')), true);
    assert.equal(laterMessages.some(message => message.role === 'tool' && message.content === first.hearth.scrollMarkdown), true);
    assert.equal(laterRequest.tools.some(tool => tool.function?.name === 'tend_hearth'), true);
    assert.equal(f.hub.provider.calls.length, 3);
    assert.equal(later.events.filter(event => event.actorKind === 'user').length, 1);
    assert.equal(f.hub.db.getActiveSession().wakeStatus, 'complete');
  } finally { await f.close(); }
});

test('hostile fake orientation variants fail closed without Hearth return or resident emission', async () => {
  for (const variant of ['prose', 'malformed', 'duplicate', 'wrong_tool', 'nonempty_args']) {
    const f = await hubFixture({ HUB_FAKE_ORIENTATION_VARIANT: variant });
    try {
      const wake = await f.hub.wake(`hostile ${variant}`);
      assert.equal(wake.status, 'failed', variant);
      assert.equal(wake.failureCode, 'hearth_orientation_invalid', variant);
      assert.equal(wake.phases.length, 1, variant);
      assert.equal(wake.hearth, null, variant);
      assert.equal(wake.events.filter(event => event.actorKind === 'resident' && event.eventKind === 'utterance').length, 0, variant);
    } finally { await f.close(); }
  }
});

test('provider scrub preserves nullable structured tool messages and provider fields', () => {
  const action = { role: 'assistant', content: null, tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'tend_hearth', arguments: '{}' } }], reasoning_content: 'unchanged' };
  const result = { role: 'tool', tool_call_id: 'call-1', content: '{"exact":true}' };
  const presentation = scrubProviderHistory([{ role: 'system', content: 'bootstrap' }, action, result]);
  assert.deepEqual(presentation.messages[1], action);
  assert.deepEqual(presentation.messages[2], result);
  assert.equal(presentation.receipt.sourceMessageContentLengths[1], 0);
});

test('restart closes the prior lifespan, opens exactly one new lifespan, and carries exact prior tail', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-session-restart-v1-'));
  const dbPath = join(dir, 'hub.sqlite');
  const spinePath = join(dir, 'spine.jsonl');
  let first = createHub({ env: { HUB_RESIDENT_MODE: 'fake', HUB_DB_PATH: dbPath, HUB_SPINE_PATH: spinePath } });
  const prior = await first.wake('prior exact text');
  const priorSessionId = prior.sessionId;
  first.close();
  const second = createHub({ env: { HUB_RESIDENT_MODE: 'fake', HUB_DB_PATH: dbPath, HUB_SPINE_PATH: spinePath } });
  try {
    const sessions = second.db.listSessions();
    assert.equal(sessions.filter(session => session.status === 'open').length, 1);
    assert.equal(sessions.find(session => session.id === priorSessionId).closeReason, 'server_restart');
    const current = await second.wake('after restart');
    const hearth = JSON.parse(current.hearth.returnJson);
    assert.equal(hearth.priorHorizon.sourceSessionId, priorSessionId);
    assert.ok(hearth.atoms.some(item => item.excerpt === 'prior exact text'));
    assert.ok(hearth.atoms.some(item => item.excerpt === 'prior exact text'));
    assert.equal(hearth.selection.policy, 'deterministic_prior_session_recency');
    assert.doesNotMatch(current.hearth.returnJson, /"summary"\s*:|embedding|room_id|Longshore Current/i);
  } finally { second.close(); await rm(dir, { recursive: true, force: true }); }
});

test('Hearth walks past an empty restart lifespan to the nearest non-empty ancestry', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-session-empty-restart-v1-'));
  const dbPath = join(dir, 'hub.sqlite');
  const spinePath = join(dir, 'spine.jsonl');
  const first = createHub({ env: { HUB_RESIDENT_MODE: 'fake', HUB_DB_PATH: dbPath, HUB_SPINE_PATH: spinePath } });
  const ancestral = await first.wake('ancestral exact text');
  await first.close();
  const empty = createHub({ env: { HUB_RESIDENT_MODE: 'fake', HUB_DB_PATH: dbPath, HUB_SPINE_PATH: spinePath } });
  await empty.close();
  const current = createHub({ env: { HUB_RESIDENT_MODE: 'fake', HUB_DB_PATH: dbPath, HUB_SPINE_PATH: spinePath } });
  try {
    const wake = await current.wake('after empty restart');
    const hearth = JSON.parse(wake.hearth.returnJson);
    assert.equal(hearth.priorHorizon.sourceSessionId, ancestral.sessionId);
    assert.ok(hearth.atoms.some(atom => atom.excerpt === 'ancestral exact text'));
    const projection = current.db.getActiveThreadProjection();
    assert.equal(projection.projectionScope, 'active_session');
    assert.ok(projection.events.length > 0);
    assert.ok(projection.events.every(event => event.sessionId === wake.sessionId));
    assert.ok(projection.wakes.every(item => item.sessionId === wake.sessionId));
  } finally { await current.close(); await rm(dir, { recursive: true, force: true }); }
});

test('a response-phase failure never repeats Hearth on the next wake', async () => {
  let responseFailed = false;
  const provider = {
    calls: [],
    prepareRequest({ presentation, model, tools, toolChoice }) {
      const requestBody = { model, messages: presentation.messages, stream: false, thinking: { type: 'disabled' } };
      if (tools) requestBody.tools = tools;
      if (toolChoice) requestBody.tool_choice = toolChoice;
      return { requestBodyString: JSON.stringify(requestBody) };
    },
    async complete({ phase, presentation }) {
      this.calls.push({ phase, messages: structuredClone(presentation.messages) });
      if (phase === 'orientation') return { content: null, message: { role: 'assistant', content: null, tool_calls: [{ id: 'retry-hearth', type: 'function', function: { name: 'tend_hearth', arguments: '{}' } }], reasoning_content: 'retry-safe' } };
      if (phase === 'response' && !responseFailed) { responseFailed = true; throw { code: 'provider_network_error', message: 'forced response failure' }; }
      return { content: 'ordinary after failed response', message: { role: 'assistant', content: 'ordinary after failed response' }, resolvedModel: 'test-model' };
    },
  };
  const f = await hubFixture({}, provider);
  try {
    const failed = await f.hub.wake('waiting user survives response failure');
    assert.equal(failed.status, 'failed');
    assert.deepEqual(failed.phases.map(phase => phase.phase), ['orientation', 'response']);
    assert.equal(f.hub.db.sqlite.prepare('SELECT COUNT(*) AS count FROM hearth_receipts WHERE session_id=?').get(failed.sessionId).count, 1);
    assert.equal(failed.events.filter(event => event.eventKind === 'state').length, 2);
    assert.equal(failed.events.filter(event => event.actorKind === 'user').length, 1);
    const retried = await f.hub.wake('next user after failed response');
    assert.equal(retried.status, 'committed');
    assert.deepEqual(retried.phases.map(phase => phase.phase), ['ordinary']);
    assert.deepEqual(f.hub.provider.calls.map(call => call.phase), ['orientation', 'response', 'ordinary']);
    assert.equal(f.hub.db.sqlite.prepare('SELECT COUNT(*) AS count FROM hearth_receipts WHERE session_id=?').get(failed.sessionId).count, 1);
    assert.equal(f.hub.db.getSessionHistory(failed.sessionId).filter(row => row.messageKind === 'assistant_tool_call').length, 1);
    assert.equal(f.hub.db.getSessionHistory(failed.sessionId).filter(row => row.messageKind === 'tool_result').length, 1);
  } finally { await f.close(); }
});

test('a failed wake remains in custody but is not presented as settled prior-session ancestry', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-failed-ancestry-'));
  const dbPath = join(dir, 'hub.sqlite');
  const spinePath = join(dir, 'spine.jsonl');
  const provider = {
    prepareRequest({ presentation, model, tools, toolChoice }) {
      const requestBody = { model, messages: presentation.messages, stream: false, thinking: { type: 'disabled' } };
      if (tools) requestBody.tools = tools;
      if (toolChoice) requestBody.tool_choice = toolChoice;
      return { requestBodyString: JSON.stringify(requestBody) };
    },
    async complete({ phase }) {
      if (phase === 'orientation') return { message: { role: 'assistant', content: null, tool_calls: [{ id: 'failed-hearth', type: 'function', function: { name: 'tend_hearth', arguments: '{}' } }] }, content: null };
      throw { code: 'provider_network_error', message: 'forced failed ancestry' };
    },
  };
  const first = createHub({ env: { HUB_RESIDENT_MODE: 'fake', HUB_DB_PATH: dbPath, HUB_SPINE_PATH: spinePath }, provider });
  try {
    const failed = await first.wake('do not replay this failed request');
    assert.equal(failed.status, 'failed');
  } finally { await first.close(); }
  const second = createHub({ env: { HUB_RESIDENT_MODE: 'fake', HUB_DB_PATH: dbPath, HUB_SPINE_PATH: spinePath } });
  try {
    const wake = await second.wake('new lifespan');
    assert.equal(wake.status, 'committed');
    assert.doesNotMatch(wake.hearth.scrollMarkdown, /do not replay this failed request/);
    assert.equal(second.db.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE content='do not replay this failed request'").get().count, 1);
  } finally { await second.close(); await rm(dir, { recursive: true, force: true }); }
});
