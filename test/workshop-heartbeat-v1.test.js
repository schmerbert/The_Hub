import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KILN_FIXTURE_ID, WorldGraphStore } from '../src/world/graph.js';
import { WorkshopAdapter } from '../src/world/workshop.js';
import { WorldActionGateway } from '../src/world/gateway.js';

async function waitIdle(gateway, ms = 30000) {
  const deadline = Date.now() + ms;
  while (gateway.recipes.active && Date.now() < deadline) await new Promise(r => setTimeout(r, 20));
}

async function slowRepo() {
  const dir = await mkdtemp(join(tmpdir(), 'hub-heartbeat-'));
  const root = join(dir, 'repo');
  await mkdir(join(root, 'test'), { recursive: true });
  await writeFile(join(root, 'test', 'slow.test.js'), "const test = require('node:test');\ntest('slow', async () => { await new Promise(r => setTimeout(r, 400)); });", 'utf8');
  await writeFile(join(root, 'test', 'ok.test.js'), "const test = require('node:test');\ntest('ok', () => {});", 'utf8');
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'heartbeat', private: true }), 'utf8');
  return { dir, root };
}

test('async kiln starts immediately and settles in background', async () => {
  const { dir, root } = await slowRepo();
  const world = new WorldGraphStore(join(dir, 'world.sqlite'));
  world.ensureLifespan('life');
  world.move({ sessionId: 'life', doorId: 'door.workshop' });
  const gateway = new WorldActionGateway({ world, workshop: new WorkshopAdapter(root), approvalMode: 'auto', recipeTimeoutMs: 30000 });
  try {
    const started = await gateway.execute({ sessionId: 'life', wakeId: 'w', intent: { id: '1', type: 'function', function: { name: 'workshop_run_recipe', arguments: JSON.stringify({ recipe: 'node_test', path: 'test/slow.test.js' }) } } });
    assert.equal(started.result.status, 'started');
    assert.ok(gateway.recipes.active);
    assert.equal(world.getFixtureRuntime(KILN_FIXTURE_ID).status, 'running');
    const status = await gateway.execute({ sessionId: 'life', wakeId: 'w2', intent: { id: '2', type: 'function', function: { name: 'workshop_recipe_status', arguments: '{}' } } });
    assert.equal(status.result.running, true);
    assert.match(world.presenceMessage('life'), /Heartbeat: kiln running:node_test/);
    await waitIdle(gateway);
    assert.equal(world.getFixtureRuntime(KILN_FIXTURE_ID).status, 'settled');
    assert.match(world.presenceMessage('life'), /Heartbeat: kiln settled:node_test/);
  } finally { world.close(); await rm(dir, { recursive: true, force: true }); }
});

test('leave Workshop keeps kiln firing; disengage does not cancel', async () => {
  const { dir, root } = await slowRepo();
  const world = new WorldGraphStore(join(dir, 'world.sqlite'));
  world.ensureLifespan('life');
  world.move({ sessionId: 'life', doorId: 'door.workshop' });
  const gateway = new WorldActionGateway({ world, workshop: new WorkshopAdapter(root), approvalMode: 'auto', recipeTimeoutMs: 30000 });
  try {
    await gateway.execute({ sessionId: 'life', wakeId: 'w', intent: { id: '1', type: 'function', function: { name: 'workshop_run_recipe', arguments: JSON.stringify({ recipe: 'node_test', path: 'test/slow.test.js' }) } } });
    world.engageFixture({ sessionId: 'life', fixtureId: 'fixture.workshop_kiln' });
    await gateway.execute({ sessionId: 'life', wakeId: 'w2', intent: { id: '2', type: 'function', function: { name: 'disengage_fixture', arguments: '{}' } } });
    assert.ok(gateway.recipes.active);
    assert.equal(world.getFixtureRuntime(KILN_FIXTURE_ID).status, 'running');
    await gateway.execute({ sessionId: 'life', wakeId: 'w3', intent: { id: '3', type: 'function', function: { name: 'move_through_door', arguments: JSON.stringify({ door_id: 'door.workshop' }) } } });
    assert.equal(world.current('life').room_node_id, 'room.center');
    assert.deepEqual(world.availableTools('life'), ['move_through_door']);
    assert.ok(gateway.recipes.active);
    assert.equal(world.getFixtureRuntime(KILN_FIXTURE_ID).status, 'running');
    assert.match(world.presenceMessage('life'), /Heartbeat: kiln running:node_test/);
    await waitIdle(gateway);
    assert.equal(world.getFixtureRuntime(KILN_FIXTURE_ID).status, 'settled');
    assert.match(world.presenceMessage('life'), /Heartbeat: kiln settled/);
  } finally { world.close(); await rm(dir, { recursive: true, force: true }); }
});

test('explicit recipe cancel smothers kiln', async () => {
  const { dir, root } = await slowRepo();
  const world = new WorldGraphStore(join(dir, 'world.sqlite'));
  world.ensureLifespan('life');
  world.move({ sessionId: 'life', doorId: 'door.workshop' });
  const gateway = new WorldActionGateway({ world, workshop: new WorkshopAdapter(root), approvalMode: 'auto', recipeTimeoutMs: 30000 });
  try {
    await gateway.execute({ sessionId: 'life', wakeId: 'w', intent: { id: '1', type: 'function', function: { name: 'workshop_run_recipe', arguments: JSON.stringify({ recipe: 'node_test', path: 'test/slow.test.js' }) } } });
    const cancel = await gateway.execute({ sessionId: 'life', wakeId: 'w2', intent: { id: '2', type: 'function', function: { name: 'workshop_recipe_cancel', arguments: '{}' } } });
    assert.equal(cancel.result.cancelled, true);
    await waitIdle(gateway);
    assert.equal(world.getFixtureRuntime(KILN_FIXTURE_ID).status, 'cancelled');
  } finally { world.close(); await rm(dir, { recursive: true, force: true }); }
});

test('timer arms, fires with fake clock, survives room move, Center cannot set', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-timer-'));
  let now = 1_000_000;
  const world = new WorldGraphStore(join(dir, 'world.sqlite'), { now: () => now });
  world.ensureLifespan('life');
  world.move({ sessionId: 'life', doorId: 'door.workshop' });
  const gateway = new WorldActionGateway({ world, workshop: new WorkshopAdapter(dir), approvalMode: 'auto' });
  try {
    const armed = await gateway.execute({ sessionId: 'life', wakeId: 'w', intent: { id: '1', type: 'function', function: { name: 'workshop_timer_set', arguments: JSON.stringify({ seconds: 60 }) } } });
    assert.equal(armed.result.status, 'armed');
    assert.equal(armed.result.remainingSeconds, 60);
    assert.match(world.presenceMessage('life'), /Heartbeat: timer 60s/);
    await gateway.execute({ sessionId: 'life', wakeId: 'w2', intent: { id: '2', type: 'function', function: { name: 'move_through_door', arguments: JSON.stringify({ door_id: 'door.workshop' }) } } });
    assert.equal(world.current('life').room_node_id, 'room.center');
    assert.equal(world.availableTools('life').includes('workshop_timer_set'), false);
    assert.match(world.presenceMessage('life'), /Heartbeat: timer 60s/);
    now += 61_000;
    assert.equal(world.getTimer('life').status, 'fired');
    assert.match(world.presenceMessage('life'), /Heartbeat: timer fired/);
    assert.equal(world.projection('life').heartbeat.timer.status, 'fired');
    world.move({ sessionId: 'life', doorId: 'door.workshop' });
    const cleared = await gateway.execute({ sessionId: 'life', wakeId: 'w3', intent: { id: '3', type: 'function', function: { name: 'workshop_timer_cancel', arguments: '{}' } } });
    assert.equal(cleared.result.cancelled, true);
    assert.equal(world.getTimer('life').status, 'none');
    assert.equal(world.presenceMessage('life').includes('Heartbeat:'), false);
  } finally { world.close(); await rm(dir, { recursive: true, force: true }); }
});
