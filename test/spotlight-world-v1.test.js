import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { WorldGraphStore } from '../src/world/graph.js';
import { createWorldEvent, insertWorldEvent, replayWorldEvents } from '../src/world/events.js';
import { spotlightTopologyEventPayload } from '../src/world/topology-spotlight.js';

function fixture(version = 'spotlight', options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'hub-spotlight-world-'));
  const path = join(dir, 'world.sqlite');
  const world = new WorldGraphStore(path, { topologyVersion: version, ...options });
  return { dir, path, world, close() { world.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test('fresh Spotlight World installs the observatory shell and enterable door after Binder Window', () => {
  const fx = fixture();
  try {
    const events = fx.world.sqlite.prepare('SELECT event_kind,payload_json FROM world_event_journal ORDER BY sequence').all();
    assert.equal(events.at(-3).event_kind, 'topology.binder_window_installed/v1');
    assert.equal(events.at(-2).event_kind, 'topology.spotlight_installed/v1');
    assert.equal(events.at(-1).event_kind, 'topology.spotlight_door_installed/v1');
    assert.deepEqual(JSON.parse(events.at(-2).payload_json), spotlightTopologyEventPayload());

    assert.equal(fx.world.node('room.spotlight').node_type, 'room');
    const fixtures = fx.world.sqlite.prepare("SELECT id FROM world_nodes WHERE node_type='fixture' AND id LIKE 'fixture.spotlight_%' ORDER BY id").all().map(row => row.id);
    assert.deepEqual(fixtures, [
      'fixture.spotlight_archive', 'fixture.spotlight_bell', 'fixture.spotlight_landscape', 'fixture.spotlight_table', 'fixture.spotlight_telescope',
    ]);
    const edges = fx.world.sqlite.prepare("SELECT edge_type,from_node_id,to_node_id,door_identity FROM world_edges WHERE from_node_id='room.spotlight' OR to_node_id='room.spotlight'").all();
    assert.equal(edges.length, 8);
    assert.equal(edges.filter(edge => edge.edge_type === 'contains').length, 6);
    assert.equal(edges.filter(edge => edge.from_node_id === 'room.spotlight' && edge.edge_type === 'contains').length, 5);
    assert.deepEqual({ ...edges.find(edge => edge.to_node_id === 'room.spotlight' && edge.edge_type === 'contains') }, { edge_type: 'contains', from_node_id: 'place.hub', to_node_id: 'room.spotlight', door_identity: null });
    assert.equal(fx.world.sqlite.prepare("SELECT COUNT(*) AS count FROM world_edges WHERE edge_type='door' AND door_identity='door.spotlight' AND (from_node_id='room.spotlight' OR to_node_id='room.spotlight')").get().count, 2);
    assert.equal(fx.world.verification().verified, true);
    assert.ok(replayWorldEvents(fx.world.sqlite).spotlightExtension);
  } finally { fx.close(); }
});

test('Binder Window World requires backup-confirmed Spotlight migration and preserves all existing locations', () => {
  const fx = fixture('binder_window');
  try {
    fx.world.ensureLifespan('life');
    const beforeLocation = fx.world.sqlite.prepare("SELECT room_node_id FROM world_locations WHERE session_id='life'").get()?.room_node_id || 'place.house';
    const beforeNodes = fx.world.sqlite.prepare('SELECT id,created_at,last_event_sequence,last_event_hash FROM world_nodes ORDER BY id').all();
    assert.equal(fx.world.inspectSpotlightUpgrade().status, 'upgrade_required');
    assert.throws(() => fx.world.migrateSpotlight(), error => error.code === 'world_spotlight_backup_required');
    const migrated = fx.world.migrateSpotlight({ backupConfirmed: true });
    assert.equal(migrated.status, 'migrated');
    assert.equal(fx.world.sqlite.prepare("SELECT room_node_id FROM world_locations WHERE session_id='life'").get().room_node_id, beforeLocation);
    assert.deepEqual(fx.world.sqlite.prepare("SELECT id,created_at,last_event_sequence,last_event_hash FROM world_nodes WHERE id IN ('room.center','room.workshop','fixture.binder_window') ORDER BY id").all(), beforeNodes.filter(row => ['room.center', 'room.workshop', 'fixture.binder_window'].includes(row.id)));
    assert.equal(fx.world.inspectSpotlightUpgrade().status, 'current');
    assert.equal(fx.world.inspectSpotlightDoorUpgrade().status, 'upgrade_required');
    fx.world.migrateSpotlightDoor({ backupConfirmed: true });
    assert.equal(fx.world.verification().verified, true);
    assert.throws(() => fx.world.sqlite.prepare("DELETE FROM world_event_journal WHERE event_kind='topology.spotlight_installed/v1'").run(), /append-only/);
  } finally { fx.close(); }
});

test('Spotlight migration rolls back on interruption and refuses partial or duplicate extensions', () => {
  let interrupt = false;
  const failed = fixture('binder_window', { eventFailureInjector: ({ phase }) => { if (interrupt && phase === 'after_event_append') throw new Error('spotlight interruption'); } });
  try {
    interrupt = true;
    assert.throws(() => failed.world.migrateSpotlight({ backupConfirmed: true }), /spotlight interruption/);
    assert.equal(failed.world.sqlite.prepare("SELECT COUNT(*) AS count FROM world_event_journal WHERE event_kind='topology.spotlight_installed/v1'").get().count, 0);
    assert.equal(failed.world.inspectSpotlightUpgrade().status, 'upgrade_required');
  } finally { failed.close(); }

  const partial = fixture('binder_window');
  try {
    const head = partial.world.eventHead();
    const event = createWorldEvent({ head, eventKind: 'topology.spotlight_installed/v1', aggregateKind: 'topology_extension', aggregateId: 'spotlight', aggregateRevision: 1, actor: 'world_migration', causation: { boundary: 'spotlight_observatory_v1', physicalHeadHash: head.event_hash, physicalHeadSequence: head.sequence }, payload: spotlightTopologyEventPayload(), occurredAt: new Date().toISOString() });
    insertWorldEvent(partial.world.sqlite, event);
    assert.equal(partial.world.inspectSpotlightUpgrade().status, 'corrupt_or_incomplete_spotlight');
    assert.equal(partial.world.node('room.spotlight'), undefined);
  } finally { partial.close(); }

  const duplicate = fixture();
  try {
    const head = duplicate.world.eventHead();
    const event = createWorldEvent({ head, eventKind: 'topology.spotlight_installed/v1', aggregateKind: 'topology_extension', aggregateId: 'spotlight', aggregateRevision: 2, actor: 'world_migration', causation: { boundary: 'spotlight_observatory_v1', physicalHeadHash: head.event_hash, physicalHeadSequence: head.sequence }, payload: spotlightTopologyEventPayload(), occurredAt: new Date().toISOString() });
    insertWorldEvent(duplicate.world.sqlite, event);
    assert.equal(duplicate.world.inspectSpotlightUpgrade().status, 'corrupt_or_incomplete_spotlight');
    assert.equal(duplicate.world.verification().verified, false);
  } finally { duplicate.close(); }
});
