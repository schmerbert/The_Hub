import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { WorldGraphStore } from '../src/world/graph.js';
import { WorldActionGateway } from '../src/world/gateway.js';
import { WorkshopAdapter } from '../src/places/hub/workshop/index.js';
import { createWorldEvent, insertWorldEvent, replayWorldEvents } from '../src/world/events.js';
import { spotlightDoorTopologyEventPayload } from '../src/world/topology-spotlight-door.js';

function fixture(version = 'spotlight', options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'hub-spotlight-door-'));
  const path = join(dir, 'world.sqlite');
  const world = new WorldGraphStore(path, { topologyVersion: version, ...options });
  return { dir, path, world, close() { world.close(); rmSync(dir, { recursive: true, force: true }); } };
}

async function arriveAtCenter(gateway, world, sessionId = 'life') {
  world.ensureLifespan(sessionId);
  const execute = (id, name, args) => gateway.execute({ sessionId, wakeId: `wake-${id}`, intent: { type: 'function', id, function: { name, arguments: JSON.stringify(args) } } });
  await execute('open-front-door', 'operate_passage', { passage_id: 'passage.garden_house', action: 'open' });
  await execute('to-garden', 'move_through_passage', { passage_id: 'passage.garden_house' });
  await execute('to-center', 'move_through_passage', { passage_id: 'passage.center_garden' });
}

test('fresh Spotlight Worlds install an explicit bidirectional Center door and movement is passive', async () => {
  const fx = fixture();
  const root = join(fx.dir, 'repo'); mkdirSync(root);
  const gateway = new WorldActionGateway({ world: fx.world, workshop: new WorkshopAdapter(root) });
  try {
    const events = fx.world.sqlite.prepare('SELECT event_kind,payload_json FROM world_event_journal ORDER BY sequence').all();
    assert.equal(events.at(-1).event_kind, 'topology.spotlight_door_installed/v1');
    assert.deepEqual(JSON.parse(events.at(-1).payload_json), spotlightDoorTopologyEventPayload());
    assert.deepEqual(fx.world.sqlite.prepare("SELECT id,from_node_id,to_node_id,door_identity FROM world_edges WHERE edge_type='door' AND door_identity='door.spotlight' ORDER BY id").all().map(row => ({ ...row })), [
      { id: 'edge.door.spotlight.center_to_spotlight', from_node_id: 'room.center', to_node_id: 'room.spotlight', door_identity: 'door.spotlight' },
      { id: 'edge.door.spotlight.spotlight_to_center', from_node_id: 'room.spotlight', to_node_id: 'room.center', door_identity: 'door.spotlight' },
    ]);
    assert.equal(fx.world.verification().verified, true);
    assert.ok(replayWorldEvents(fx.world.sqlite).spotlightDoorExtension);

    await arriveAtCenter(gateway, fx.world);
    const intent = (id, name, args) => ({ type: 'function', id, function: { name, arguments: JSON.stringify(args) } });
    const entered = await gateway.execute({ sessionId: 'life', wakeId: 'wake-enter', intent: intent('move-enter', 'move_through_door', { door_id: 'door.spotlight' }) });
    assert.equal(entered.result.toRoom, 'room.spotlight');
    assert.equal(entered.projection.roomId, 'room.spotlight');
    assert.ok(entered.projection.exits.some(exit => exit.doorId === 'door.spotlight' && exit.to === 'room.center'));
    assert.ok(fx.world.availableTools('life').includes('move_through_door'));
    const left = await gateway.execute({ sessionId: 'life', wakeId: 'wake-leave', intent: intent('move-leave', 'move_through_door', { door_id: 'door.spotlight' }) });
    assert.equal(left.result.toRoom, 'room.center');
    assert.equal(fx.world.sqlite.prepare("SELECT COUNT(*) AS count FROM world_event_journal WHERE event_kind LIKE 'spotlight.%'").get().count, 0);
  } finally { await gateway.close(); fx.close(); }
});

test('an existing Spotlight shell requires backup-confirmed door migration and migration is idempotent', () => {
  const fx = fixture('binder_window');
  try {
    fx.world.migrateSpotlight({ backupConfirmed: true });
    const before = readFileSync(fx.path);
    assert.equal(fx.world.inspectSpotlightDoorUpgrade().status, 'upgrade_required');
    assert.throws(() => fx.world.migrateSpotlightDoor(), error => error.code === 'world_spotlight_door_backup_required');
    const migrated = fx.world.migrateSpotlightDoor({ backupConfirmed: true });
    assert.equal(migrated.status, 'migrated');
    assert.equal(fx.world.inspectSpotlightDoorUpgrade().status, 'current');
    assert.equal(fx.world.verification().verified, true);
    const second = fx.world.migrateSpotlightDoor({ backupConfirmed: true });
    assert.equal(second.status, 'current');
    assert.ok(readFileSync(fx.path).byteLength > before.byteLength);
    assert.equal(fx.world.sqlite.prepare("SELECT COUNT(*) AS count FROM world_event_journal WHERE event_kind='topology.spotlight_door_installed/v1'").get().count, 1);
  } finally { fx.close(); }
});

test('Spotlight door migration rolls back on interruption and refuses a partial event', () => {
  let interrupt = false;
  const failed = fixture('binder_window');
  try {
    failed.world.migrateSpotlight({ backupConfirmed: true });
    const before = readFileSync(failed.path);
    failed.world.eventFailureInjector = ({ phase }) => { if (interrupt && phase === 'after_projection_apply') throw new Error('spotlight door interruption'); };
    interrupt = true;
    assert.throws(() => failed.world.migrateSpotlightDoor({ backupConfirmed: true }), /spotlight door interruption/);
    assert.deepEqual(readFileSync(failed.path), before);
    assert.equal(failed.world.inspectSpotlightDoorUpgrade().status, 'upgrade_required');
  } finally { failed.close(); }

  const partial = fixture('binder_window');
  try {
    partial.world.migrateSpotlight({ backupConfirmed: true });
    const head = partial.world.eventHead();
    const event = createWorldEvent({ head, eventKind: 'topology.spotlight_door_installed/v1', aggregateKind: 'topology_extension', aggregateId: 'spotlight_door', aggregateRevision: 1, actor: 'world_migration', causation: { boundary: 'spotlight_observatory_door_v1', physicalHeadHash: head.event_hash, physicalHeadSequence: head.sequence }, payload: spotlightDoorTopologyEventPayload(), occurredAt: new Date().toISOString() });
    insertWorldEvent(partial.world.sqlite, event);
    assert.equal(partial.world.inspectSpotlightDoorUpgrade().status, 'corrupt_or_incomplete_spotlight_door');
    assert.equal(partial.world.sqlite.prepare("SELECT COUNT(*) AS count FROM world_edges WHERE door_identity='door.spotlight'").get().count, 0);
  } finally { partial.close(); }
});
