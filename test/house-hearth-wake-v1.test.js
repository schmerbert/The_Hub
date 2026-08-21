import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHub } from '../src/server/app.js';
import { WorldGraphStore } from '../src/world/graph.js';
import { hearthTopologyEventPayload } from '../src/world/topology-hearth.js';
import { renderHearthPacket, SILVER_BULLET_ONE, SILVER_BULLET_TWO, SILVER_BULLET_THREE } from '../src/hearth/packet.js';

test('Hearth extension preserves B1 ancestry and starts new lifespans in the House', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-house-hearth-world-'));
  const world = new WorldGraphStore(join(dir, 'world.sqlite'));
  try {
    const events = world.sqlite.prepare('SELECT event_kind,payload_json FROM world_event_journal ORDER BY sequence').all();
    assert.deepEqual(events.map(row => row.event_kind), ['topology.installed/v1', 'topology.extended/v1', 'topology.hearth_installed/v1']);
    assert.deepEqual(JSON.parse(events[2].payload_json), hearthTopologyEventPayload());
    assert.equal(world.node('fixture.hearth').resident_text, 'A tended fire stands in the House.');
    assert.equal(world.current('new-life').room_node_id, 'place.house');
    assert.equal(world.fixtures('place.house').some(row => row.id === 'fixture.hearth'), true);
    assert.equal(world.listLocationEvents('new-life').length, 0);
    assert.equal(world.verification().verified, true);
  } finally { world.close(); await rm(dir, { recursive: true, force: true }); }
});

test('Hearth migration is backup-gated, append-only, and does not relocate an existing lifespan', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-house-hearth-migration-'));
  const path = join(dir, 'world.sqlite');
  const old = new WorldGraphStore(path, { topologyVersion: 'b1' });
  old.ensureLifespan('existing-life');
  const before = old.sqlite.prepare('SELECT sequence,event_hash FROM world_event_journal ORDER BY sequence').all();
  assert.equal(old.inspectHearthUpgrade().status, 'upgrade_required');
  assert.throws(() => old.migrateHearth(), error => error.code === 'world_hearth_backup_required');
  const migrated = old.migrateHearth({ backupConfirmed: true });
  assert.equal(migrated.status, 'migrated');
  assert.deepEqual(old.sqlite.prepare('SELECT sequence,event_hash FROM world_event_journal WHERE sequence<=? ORDER BY sequence').all(before.at(-1).sequence), before);
  assert.equal(old.sqlite.prepare('SELECT room_node_id FROM world_locations WHERE session_id=?').get('existing-life').room_node_id, 'room.center');
  old.close();
  const current = new WorldGraphStore(path);
  try {
    assert.equal(current.verification().verified, true);
    assert.equal(current.current('existing-life').room_node_id, 'room.center');
    assert.equal(current.current('new-life').room_node_id, 'place.house');
  } finally { current.close(); await rm(dir, { recursive: true, force: true }); }
});

test('Hearth packet shows three occupied bullets and no blank placeholders', () => {
  const packet = renderHearthPacket({ atoms: [], priorHorizon: { omittedEarlierCount: 0 }, budgetBytes: 3000 });
  assert.match(packet.markdown, /^# Hearth/);
  assert.match(packet.markdown, /## Ember/);
  assert.match(packet.markdown, /## Silver Bullets/);
  assert.match(packet.markdown, new RegExp(SILVER_BULLET_ONE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(packet.markdown, new RegExp(SILVER_BULLET_TWO.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(packet.markdown, new RegExp(SILVER_BULLET_THREE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(packet.markdown, /Slot Two|blank|Threads|Longshore Current/);
  assert.equal(packet.receipt.silverBulletSlots.count, 10);
  assert.equal(packet.receipt.silverBulletSlots.occupied.length, 3);
  assert.equal(packet.receipt.silverBulletSlots.blank, 7);
});

test('first wake receives the full Hearth causally and later wakes carry only the Silver Bullet holster under Glass', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-house-hearth-wake-'));
  const hub = createHub({ env: { HUB_RESIDENT_MODE: 'fake', HUB_DB_PATH: join(dir, 'hub.sqlite'), HUB_SPINE_PATH: join(dir, 'spine.jsonl'), HUB_WORLD_PATH: join(dir, 'world.sqlite'), HUB_FOREST_PATH: join(dir, 'forest.sqlite'), HUB_RESULT_PATH: join(dir, 'results.sqlite') } });
  try {
    const first = await hub.wake('Wake here with me.');
    assert.equal(first.status, 'committed');
    const orientation = JSON.parse(first.phases[0].requestBody).messages;
    assert.equal(orientation.some(message => /Current location: place\.house\./.test(message.content || '') && /fixture\.hearth/.test(message.content)), true);
    assert.equal(orientation.some(message => /Silver Bullets|Past Session/.test(message.content || '')), false);
    const response = JSON.parse(first.phases[1].requestBody).messages;
    assert.equal(response.filter(message => message.role === 'tool' && message.content.startsWith('# Hearth')).length, 1);
    assert.equal(response.filter(message => (message.content || '').includes(SILVER_BULLET_ONE)).length, 1);
    const later = await hub.wake('Continue from here.');
    assert.equal(later.status, 'committed');
    const ordinary = JSON.parse(later.phases[0].requestBody).messages;
    assert.match(ordinary[1].content, /^# Holster/);
    assert.match(ordinary[1].content, new RegExp(SILVER_BULLET_ONE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(ordinary[1].content, new RegExp(SILVER_BULLET_TWO.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(ordinary[1].content, new RegExp(SILVER_BULLET_THREE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.doesNotMatch(ordinary[1].content, /## Ember|Past Session/);
    assert.equal(later.phases[0].glassCast.receipt.cast.bands[1].mode, 'none');
    assert.equal(later.phases[0].glassCast.receipt.cast.bands[1].itemCount, 1);
  } finally { await hub.close(); await rm(dir, { recursive: true, force: true }); }
});
