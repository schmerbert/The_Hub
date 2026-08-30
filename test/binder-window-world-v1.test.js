import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { WorldGraphStore } from '../src/world/graph.js';
import { createWorldEvent, insertWorldEvent, replayWorldEvents } from '../src/world/events.js';
import { binderWindowTopologyEventPayload } from '../src/world/topology-binder-window.js';

function fixture(version = 'binder_window', options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'hub-binder-window-world-'));
  const path = join(dir, 'world.sqlite');
  const world = new WorldGraphStore(path, { topologyVersion: version, ...options });
  return { dir, path, world, close() { world.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test('fresh current World installs only the passive Binder Window extension', () => {
  const fx = fixture();
  try {
    const events = fx.world.sqlite.prepare('SELECT event_kind,payload_json FROM world_event_journal ORDER BY sequence').all();
    assert.equal(events.at(-1).event_kind, 'topology.binder_window_installed/v1');
    assert.deepEqual(JSON.parse(events.at(-1).payload_json), binderWindowTopologyEventPayload());
    assert.equal(fx.world.node('fixture.binder_window').node_type, 'fixture');
    assert.deepEqual(fx.world.sqlite.prepare("SELECT edge_type,from_node_id,to_node_id,door_identity FROM world_edges WHERE to_node_id='fixture.binder_window'").all().map(row => ({ ...row })), [{ edge_type: 'contains', from_node_id: 'room.center', to_node_id: 'fixture.binder_window', door_identity: null }]);
    assert.equal(fx.world.sqlite.prepare("SELECT COUNT(*) AS count FROM world_nodes WHERE id='room.spotlight'").get().count, 0);
    assert.equal(fx.world.sqlite.prepare("SELECT COUNT(*) AS count FROM world_edges WHERE from_node_id='room.spotlight' OR to_node_id='room.spotlight'").get().count, 0);
    assert.equal(fx.world.sqlite.prepare("SELECT COUNT(*) AS count FROM world_edges WHERE edge_type IN ('door','passage') AND (from_node_id='fixture.binder_window' OR to_node_id='fixture.binder_window')").get().count, 0);
    assert.deepEqual(fx.world.availableTools('missing-session'), ['move_through_passage', 'operate_passage', 'inspect_fixture']);
    assert.equal(fx.world.verification().verified, true);
    const replay = replayWorldEvents(fx.world.sqlite);
    assert.ok(replay.binderWindowExtension);
    assert.ok(replay.nodes.some(row => row.id === 'fixture.binder_window'));
  } finally { fx.close(); }
});

test('Forest World requires an explicit backup-confirmed Binder Window migration and preserves lifespan location', () => {
  const fx = fixture('forest');
  try {
    fx.world.ensureLifespan('life');
    const before = fx.world.current('life').room_node_id;
    assert.equal(fx.world.inspectBinderWindowUpgrade().status, 'upgrade_required');
    assert.throws(() => fx.world.migrateBinderWindow(), error => error.code === 'world_binder_window_backup_required');
    const migrated = fx.world.migrateBinderWindow({ backupConfirmed: true });
    assert.equal(migrated.status, 'migrated');
    assert.equal(fx.world.current('life').room_node_id, before);
    assert.equal(fx.world.node('fixture.binder_window').node_type, 'fixture');
    assert.equal(fx.world.verification().verified, true);
    assert.equal(fx.world.inspectBinderWindowUpgrade().status, 'current');
    assert.throws(() => fx.world.sqlite.prepare("DELETE FROM world_event_journal WHERE event_kind='topology.binder_window_installed/v1'").run(), /append-only/);
  } finally { fx.close(); }
});

test('Binder Window migration rolls back on interruption and refuses a partial extension', () => {
  let interrupt = false;
  const failed = fixture('forest', { eventFailureInjector: ({ phase }) => { if (interrupt && phase === 'after_event_append') throw new Error('binder window interruption'); } });
  try {
    interrupt = true;
    assert.throws(() => failed.world.migrateBinderWindow({ backupConfirmed: true }), /binder window interruption/);
    assert.equal(failed.world.sqlite.prepare("SELECT COUNT(*) AS count FROM world_event_journal WHERE event_kind='topology.binder_window_installed/v1'").get().count, 0);
    assert.equal(failed.world.inspectBinderWindowUpgrade().status, 'upgrade_required');
  } finally { failed.close(); }

  const partial = fixture('forest');
  try {
    const head = partial.world.eventHead();
    const event = createWorldEvent({ head, eventKind: 'topology.binder_window_installed/v1', aggregateKind: 'topology_extension', aggregateId: 'binder_window', aggregateRevision: 1, actor: 'world_migration', causation: { boundary: 'binder_window_v1', physicalHeadHash: head.event_hash, physicalHeadSequence: head.sequence }, payload: binderWindowTopologyEventPayload(), occurredAt: new Date().toISOString() });
    insertWorldEvent(partial.world.sqlite, event);
    const inspection = partial.world.inspectBinderWindowUpgrade();
    assert.equal(inspection.status, 'corrupt_or_incomplete_binder_window');
    assert.equal(partial.world.verification().verified, false);
    assert.equal(partial.world.node('fixture.binder_window'), undefined);
  } finally { partial.close(); }
});
