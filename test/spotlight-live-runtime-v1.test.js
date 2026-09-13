import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHub } from '../src/server/app.js';
import { readConfig, resolveHubConfig } from '../src/core/config.js';
import { createSpotlightRuntime } from '../src/runtime/spotlight-lifecycle.js';
import { createRobinhoodReadAdapter } from '../src/places/hub/spotlight/robinhood.js';
import { renderSpotlightReadGround } from '../src/places/hub/spotlight/presentation.js';
import { spotlightInstallationWitness } from '../src/rooms/spotlight-witness.js';

function tool(id, name, args = {}) {
  return { id, type: 'function', function: { name, arguments: JSON.stringify(args) } };
}
function answer(message) {
  return { message, content: message.content, resolvedModel: 'test-model', finishReason: message.tool_calls ? 'tool_calls' : 'stop' };
}
async function enter(hub) {
  const sessionId = hub.db.session.id;
  for (const [id, name, args] of [
    ['open', 'operate_passage', { passage_id: 'passage.garden_house', action: 'open' }],
    ['garden', 'move_through_passage', { passage_id: 'passage.garden_house' }],
    ['center', 'move_through_passage', { passage_id: 'passage.center_garden' }],
    ['spotlight', 'move_through_door', { door_id: 'door.spotlight' }],
  ]) await hub.gateway.execute({ sessionId, wakeId: `setup-${id}`, intent: tool(id, name, args) });
}

test('Spotlight configuration is opt-in and overridden databases keep sibling custody isolated', () => {
  assert.equal(readConfig({}).spotlightEnabled, false);
  const config = resolveHubConfig({ HUB_SPOTLIGHT_ENABLED: 'true' }, { dbPath: join(tmpdir(), 'isolated', 'hub.sqlite') });
  assert.equal(config.spotlightEnabled, true);
  assert.equal(config.spotlightObservationPath, join(tmpdir(), 'isolated', 'spotlight', 'observations.sqlite'));
  assert.equal(config.spotlightAuthPath, join(tmpdir(), 'isolated', 'spotlight', 'robinhood-auth.dpapi'));
  assert.equal(createSpotlightRuntime({ config: readConfig({ HUB_SPOTLIGHT_ENABLED: 'true', HUB_RESIDENT_MODE: 'fake' }) }).status().connection.code, 'spotlight_live_mode_required');
});

test('deliberate Resident read reaches source, durable Result Rack, provider attention and verified Glass without altering room installation', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-spotlight-live-'));
  const before = spotlightInstallationWitness();
  let reads = 0;
  let closed = false;
  let responseCount = 0;
  const requests = [];
  const adapter = createRobinhoodReadAdapter({ operations: {
    equity_quote: async request => {
      reads += 1;
      return { observedAt: '2026-09-11T12:00:00.000Z', data: { symbol: request.symbol, price: 123.45, currency: 'USD' } };
    },
  }, clock: () => '2026-09-11T12:00:01.000Z' });
  const source = {
    status: () => ({ state: 'connected', code: 'robinhood_connected' }),
    observe: (operation, args) => adapter.observe(operation, args),
    close: async () => { closed = true; },
  };
  const provider = {
    prepareRequest({ phase, messages, tools }) {
      requests.push({ phase, messages: structuredClone(messages), tools });
      return { requestBodyString: JSON.stringify({ model: 'test-model', messages, tools }) };
    },
    async complete({ phase }) {
      if (phase === 'orientation') return answer({ role: 'assistant', content: null, tool_calls: [tool('hearth', 'tend_hearth')] });
      if (++responseCount === 1) return answer({ role: 'assistant', content: null, tool_calls: [tool('quote', 'spotlight_observe', { instrument_id: 'equity:AAPL' })] });
      return answer({ role: 'assistant', content: 'I have the attributed observation.' });
    },
  };
  const hub = createHub({ env: { HUB_RESIDENT_MODE: 'fake', HUB_DB_PATH: join(dir, 'hub.sqlite'), HUB_SPOTLIGHT_ENABLED: 'true', HUB_WORKSHOP_ROOT: dir }, provider, spotlightSource: source });
  try {
    assert.equal(reads, 0);
    await assert.rejects(hub.gateway.execute({ sessionId: hub.db.session.id, wakeId: 'wrong-place', intent: tool('wrong', 'spotlight_observe', { instrument_id: 'equity:AAPL' }) }));
    assert.equal(reads, 0);
    await enter(hub);
    assert.equal(reads, 0, 'arrival cannot contact Robinhood');
    await new Promise(resolve => hub.server.listen(0, '127.0.0.1', resolve));
    const status = await fetch(`http://127.0.0.1:${hub.server.address().port}/api/spotlight/status`).then(response => response.json());
    assert.equal(status.connection.state, 'connected');
    assert.equal(reads, 0, 'status cannot contact Robinhood');
    const wake = await hub.wake('Observe AAPL through Spotlight.');
    assert.equal(wake.status, 'committed', wake.failureCode);
    assert.equal(reads, 1);
    const finalMessages = requests.at(-1).messages;
    const shownResult = finalMessages.find(message => message.role === 'tool' && message.tool_call_id === 'quote');
    assert.ok(shownResult);
    assert.match(shownResult.content, /123\.45/);
    assert.match(shownResult.content, /robinhood/);
    assert.match(shownResult.content, /2026-09-11T12:00:00/);
    assert.ok(finalMessages.some(message => message.role === 'system' && /Spotlight read ground for this phase/.test(message.content)));
    assert.equal(hub.db.verifyGlassTrace().verified, true);
    assert.equal(hub.world.verification().verified, true);
    assert.deepEqual(spotlightInstallationWitness(), before);
    const mutation = await hub.gateway.execute({ sessionId: hub.db.session.id, wakeId: 'trade-refusal', intent: tool('trade', 'spotlight_trade_execute', { proposal_id: 'made-up' }) });
    assert.equal(mutation.result.status, 'withheld');
    assert.equal(reads, 1);
    assert.equal(hub.world.listApprovals(hub.db.session.id).length, 0);
  } finally { await hub.close(); await rm(dir, { recursive: true, force: true }); }
  assert.equal(closed, true);
});

test('connection ground never equates installed configuration with source freshness', () => {
  const text = renderSpotlightReadGround({ connection: { state: 'connected' }, hands: [{ name: 'spotlight_observe', usable: true }] });
  assert.match(text, /does not prove fresh data/);
  assert.match(text, /need not be a real-time market price/);
  assert.match(renderSpotlightReadGround({ connection: { state: 'authentication_required' } }), /human to connect Robinhood/);
});

test('missing credentials leave Hub usable and never substitute a retained read for a live inquiry', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-spotlight-unavailable-'));
  let reads = 0;
  const hub = createHub({ env: { HUB_RESIDENT_MODE: 'fake', HUB_DB_PATH: join(dir, 'hub.sqlite'), HUB_SPOTLIGHT_ENABLED: 'true', HUB_WORKSHOP_ROOT: dir }, spotlightSource: {
    status: () => ({ state: 'authentication_required', code: 'robinhood_auth_missing' }),
    observe: async () => { reads += 1; throw new Error('must not fetch'); },
    close: async () => {},
  } });
  try {
    await enter(hub);
    const result = await hub.gateway.execute({ sessionId: hub.db.session.id, wakeId: 'no-auth', intent: tool('no-auth', 'spotlight_observe', { instrument_id: 'equity:AAPL' }) });
    assert.equal(result.result.availability, 'unavailable');
    assert.equal(result.result.network, false);
    assert.equal(reads, 0);
    assert.ok(result.actionReceipt.receiptId);
    assert.equal((await hub.wake('Hello from Spotlight.')).status, 'committed');
    assert.equal(hub.world.verification().verified, true);
  } finally { await hub.close(); await rm(dir, { recursive: true, force: true }); }
});
