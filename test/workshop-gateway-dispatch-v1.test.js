import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { TOOL_NAMES } from '../src/world/tools.js';
import { WorldGraphStore } from '../src/world/graph.js';
import { WorkshopAdapter } from '../src/world/workshop.js';
import { WorldActionGateway, parseWorldToolIntent as facadeParseWorldToolIntent } from '../src/world/gateway.js';
import { WORLD_TOOL_HANDLER_NAMES, dispatchWorldTool, parseWorldToolIntent } from '../src/world/gateway/dispatch.js';

test('static Gateway registry covers every installed tool exactly once', () => {
  assert.deepEqual(WORLD_TOOL_HANDLER_NAMES, [...TOOL_NAMES].sort());
  assert.equal(new Set(WORLD_TOOL_HANDLER_NAMES).size, TOOL_NAMES.size);
  assert.ok(Object.isFrozen(WORLD_TOOL_HANDLER_NAMES));
  assert.strictEqual(facadeParseWorldToolIntent, parseWorldToolIntent);
});

test('dispatch handlers return only execution outcomes and do not write receipts', async () => {
  let receiptWrites = 0;
  const world = {
    getTimer: sessionId => ({ kind: 'workshop_timer', sessionId, status: 'idle' }),
    actionReceipt: () => { receiptWrites += 1; throw new Error('handler wrote receipt'); },
  };
  const dispatched = await dispatchWorldTool('workshop_timer_status', { world, sessionId: 'session-contract', args: {} });
  assert.deepEqual(dispatched, {
    result: { kind: 'workshop_timer', sessionId: 'session-contract', status: 'idle' },
    source: null,
    changedRoom: false,
  });
  assert.equal(receiptWrites, 0);
});

test('intent parsing and facade mount refusal preserve exact public errors', async () => {
  assert.throws(() => parseWorldToolIntent(null), error => error.code === 'world_tool_invalid' && error.message === 'Tool intent is malformed.');
  assert.throws(() => parseWorldToolIntent({ id: 'x', type: 'function', function: { name: 'not_installed', arguments: '{}' } }), error => error.code === 'world_tool_unknown' && error.message === 'The requested capability is not installed.');
  assert.throws(() => parseWorldToolIntent({ id: 'x', type: 'function', function: { name: 'move_through_door', arguments: '{' } }), error => error.code === 'world_tool_invalid' && error.message === 'Tool arguments are not valid JSON.');
  assert.throws(() => parseWorldToolIntent({ id: 'x', type: 'function', function: { name: 'move_through_door', arguments: '[]' } }), error => error.code === 'world_tool_invalid' && error.message === 'Tool arguments must be an object.');
  await assert.rejects(dispatchWorldTool('not_installed', {}), error => error.code === 'world_tool_unknown' && error.message === 'The requested capability is not installed.');

  const dir = await mkdtemp(join(tmpdir(), 'hub-gateway-dispatch-'));
  const world = new WorldGraphStore(join(dir, 'world.sqlite'));
  world.ensureLifespan('session-center');
  const gateway = new WorldActionGateway({ world, workshop: new WorkshopAdapter(dir) });
  try {
    await assert.rejects(gateway.execute({
      sessionId: 'session-center', wakeId: 'wake-center', requestRecordId: null, spineRecordId: null,
      intent: { id: 'call-unmounted', type: 'function', function: { name: 'workshop_list', arguments: '{}' } },
    }), error => error.code === 'world_wrong_station' && error.message === 'Tool workshop_list is not mounted for the current room.');
  } finally {
    await gateway.close();
    world.close();
    await rm(dir, { recursive: true, force: true });
  }
});
