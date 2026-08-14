import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { canonicalize } from '../src/core/hash.js';
import { WorldGraphStore } from '../src/world/graph.js';
import { WorldActionGateway } from '../src/world/gateway.js';
import { WorkshopAdapter } from '../src/places/hub/workshop/index.js';
import { createHub } from '../src/server/app.js';
import {
  OBJECT_STATE_COLUMNS, PASSAGE_COLUMNS, WORLD_A2_PROJECTION_TABLE_SQL, WORLD_INTEGRITY_TRIGGER_SQL,
  emptyWorldState, inspectWorldB1UpgradeDatabase, reduceWorldEvent, replayWorldEvents, verifyWorldA2Sqlite,
} from '../src/world/events.js';
import { installedTopologyHash, topologyEventPayload } from '../src/world/topology.js';
import { extendedTopologyHash, topologyExtensionEventPayload } from '../src/world/topology-b1.js';

const execFileAsync = promisify(execFile);

async function fixture(options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'hub-world-b1-')); const path = join(dir, 'world.sqlite');
  const world = new WorldGraphStore(path, { topologyVersion: 'b1', ...options }); const root = join(dir, 'repo'); await mkdir(root);
  const gateway = new WorldActionGateway({ world, workshop: new WorkshopAdapter(root) });
  return { dir, path, root, world, gateway, close: async () => { await gateway.close(); world.close(); await rm(dir, { recursive: true, force: true }); } };
}

function intent(name, args, id = `call-${name}`) { return { type: 'function', id, function: { name, arguments: JSON.stringify(args) } }; }
function execute(f, name, args, id) { return f.gateway.execute({ sessionId: 'life', wakeId: 'wake', intent: intent(name, args, id) }); }

function downgradeFreshB1ToExactA2(path) {
  const sqlite = new DatabaseSync(path); sqlite.exec('PRAGMA foreign_keys=OFF;');
  for (const trigger of ['world_event_journal_append_only_delete', 'world_nodes_append_only_update', 'world_nodes_append_only_delete', 'world_edges_append_only_update', 'world_edges_append_only_delete', 'world_passages_append_only_update', 'world_passages_append_only_delete']) sqlite.exec(`DROP TRIGGER IF EXISTS ${trigger}`);
  sqlite.exec("DELETE FROM world_edges WHERE last_event_sequence=2; DELETE FROM world_nodes WHERE last_event_sequence=2; DELETE FROM world_event_journal WHERE sequence=2; DROP TABLE world_passages; DROP TABLE world_object_states;");
  const nodeSql = WORLD_A2_PROJECTION_TABLE_SQL.world_nodes.replace('CREATE TABLE IF NOT EXISTS world_nodes', 'CREATE TABLE world_nodes_a2');
  const edgeSql = WORLD_A2_PROJECTION_TABLE_SQL.world_edges.replace('CREATE TABLE IF NOT EXISTS world_edges', 'CREATE TABLE world_edges_a2');
  sqlite.exec(nodeSql); sqlite.exec('INSERT INTO world_nodes_a2 SELECT * FROM world_nodes');
  sqlite.exec(edgeSql); sqlite.exec('INSERT INTO world_edges_a2 SELECT * FROM world_edges');
  sqlite.exec('DROP TABLE world_edges; DROP TABLE world_nodes; ALTER TABLE world_nodes_a2 RENAME TO world_nodes; ALTER TABLE world_edges_a2 RENAME TO world_edges;');
  for (const trigger of ['world_event_journal_append_only_delete', 'world_nodes_append_only_update', 'world_nodes_append_only_delete', 'world_edges_append_only_update', 'world_edges_append_only_delete']) sqlite.exec(WORLD_INTEGRITY_TRIGGER_SQL[trigger]);
  sqlite.exec('PRAGMA foreign_keys=ON;');
  assert.equal(verifyWorldA2Sqlite(sqlite).verified, true); sqlite.close();
}

test('B1 is an exact immutable extension after the unchanged A1 root', async () => {
  const f = await fixture();
  try {
    const events = f.world.sqlite.prepare('SELECT event_kind,payload_json FROM world_event_journal ORDER BY sequence').all();
    assert.deepEqual(events.map(row => row.event_kind), ['topology.installed/v1', 'topology.extended/v1']);
    assert.deepEqual(JSON.parse(events[0].payload_json), topologyEventPayload());
    assert.equal(JSON.parse(events[0].payload_json).manifestSha256, installedTopologyHash());
    assert.equal(installedTopologyHash(), '2445a30ef6a95dd254552e9017ccea3ae293b836757c9d4844a123eb1903e8b6');
    assert.deepEqual(JSON.parse(events[1].payload_json), topologyExtensionEventPayload());
    assert.equal(JSON.parse(events[1].payload_json).manifestSha256, extendedTopologyHash());
    assert.equal(extendedTopologyHash(), '9f791d2de1bcfd66169ca8514793fdd7ddfe76633209ec3b64d7b5fa469d82b1');
    assert.equal(f.world.verification().verified, true);
    assert.deepEqual(replayWorldEvents(f.world.sqlite).objectStates.map(row => JSON.parse(row.state_json)), [{ turnCount: 0 }, { locked: false, open: false }]);
  } finally { await f.close(); }
});

test('opening, front door, and Threshold passages cross bidirectionally while boundaries never do', async () => {
  const f = await fixture();
  try {
    f.world.ensureLifespan('life');
    assert.equal((await execute(f, 'move_through_passage', { passage_id: 'passage.center_garden' }, 'cross-1')).result.toLocationId, 'place.garden');
    const before = f.world.verification().eventCount;
    await assert.rejects(() => execute(f, 'move_through_passage', { passage_id: 'passage.garden_house' }, 'cross-closed'), error => error.code === 'world_passage_closed');
    await assert.rejects(() => execute(f, 'move_through_passage', { passage_id: 'boundary.forest' }, 'cross-forest'), error => error.code === 'world_wrong_location_or_passage');
    assert.equal(f.world.verification().eventCount, before);
    await execute(f, 'operate_passage', { passage_id: 'passage.garden_house', action: 'open' }, 'open');
    assert.equal((await execute(f, 'move_through_passage', { passage_id: 'passage.garden_house' }, 'cross-2')).result.toLocationId, 'place.house');
    assert.equal((await execute(f, 'move_through_passage', { passage_id: 'passage.house_threshold' }, 'cross-3')).result.toLocationId, 'place.threshold');
    assert.equal((await execute(f, 'move_through_passage', { passage_id: 'passage.house_threshold' }, 'cross-4')).result.toLocationId, 'place.house');
    assert.equal((await execute(f, 'move_through_passage', { passage_id: 'passage.garden_house' }, 'cross-5')).result.toLocationId, 'place.garden');
    assert.equal((await execute(f, 'move_through_passage', { passage_id: 'passage.center_garden' }, 'cross-6')).result.toLocationId, 'room.center');
    assert.equal(f.world.verification().verified, true);
  } finally { await f.close(); }
});

test('front-door side and transition laws are exact, global across lifespans, and persistent across reopen', async () => {
  const f = await fixture();
  try {
    f.world.ensureLifespan('life'); await execute(f, 'move_through_passage', { passage_id: 'passage.center_garden' }, 'to-garden');
    const count = f.world.verification().eventCount;
    await assert.rejects(() => execute(f, 'operate_passage', { passage_id: 'passage.garden_house', action: 'lock' }, 'bad-lock'), error => error.code === 'world_passage_operation_refused');
    assert.equal(f.world.verification().eventCount, count);
    await execute(f, 'operate_passage', { passage_id: 'passage.garden_house', action: 'open' }, 'open');
    await execute(f, 'move_through_passage', { passage_id: 'passage.garden_house' }, 'inside');
    await execute(f, 'operate_passage', { passage_id: 'passage.garden_house', action: 'close' }, 'close');
    await execute(f, 'operate_passage', { passage_id: 'passage.garden_house', action: 'lock' }, 'lock');
    assert.deepEqual(({ locked: f.world.getObjectState('object.front_door').locked, open: f.world.getObjectState('object.front_door').open }), { locked: true, open: false });
    f.world.ensureLifespan('second'); assert.equal(f.world.current('second').room_node_id, 'room.center');
    await f.gateway.close(); f.world.close();
    const reopened = new WorldGraphStore(f.path, { topologyVersion: 'b1' });
    try { assert.deepEqual(({ locked: reopened.getObjectState('object.front_door').locked, open: reopened.getObjectState('object.front_door').open }), { locked: true, open: false }); assert.equal(reopened.current('second').room_node_id, 'room.center'); }
    finally { reopened.close(); }
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test('turning stone increments once and local inert objects inspect without mutation affordances', async () => {
  const f = await fixture();
  try {
    f.world.ensureLifespan('life');
    const marker = await execute(f, 'inspect_fixture', { fixture_id: 'object.marker' }, 'marker');
    assert.equal(marker.result.fixtureId, 'object.marker');
    await assert.rejects(() => execute(f, 'inspect_fixture', { fixture_id: 'fixture.house_window' }, 'remote-window'), error => error.code === 'world_fixture_unreachable');
    await execute(f, 'move_through_passage', { passage_id: 'passage.center_garden' }, 'garden');
    assert.equal((await execute(f, 'turn_fixture', { fixture_id: 'fixture.garden_turning_stone' }, 'turn-1')).result.turnCount, 1);
    assert.equal((await execute(f, 'turn_fixture', { fixture_id: 'fixture.garden_turning_stone' }, 'turn-2')).result.turnCount, 2);
    await execute(f, 'operate_passage', { passage_id: 'passage.garden_house', action: 'open' }, 'open');
    await execute(f, 'move_through_passage', { passage_id: 'passage.garden_house' }, 'house');
    assert.equal((await execute(f, 'inspect_fixture', { fixture_id: 'fixture.house_window' }, 'window')).result.fixtureId, 'fixture.house_window');
    assert.equal(f.world.availableTools('life').includes('turn_fixture'), false);
    assert.equal(f.world.verification().verified, true);
  } finally { await f.close(); }
});

test('B1 command mutations and custody are atomic; refusals and injected failures append nothing', async () => {
  const f = await fixture();
  try {
    f.world.ensureLifespan('life'); await execute(f, 'move_through_passage', { passage_id: 'passage.center_garden' }, 'garden');
    const beforeEvents = f.world.verification().eventCount; const beforeReceipts = f.world.sqlite.prepare('SELECT COUNT(*) count FROM world_action_receipts').get().count;
    f.world.eventFailureInjector = ({ phase, event }) => { if (phase === 'after_projection_apply' && event.event_kind === 'fixture.turned/v1') throw new Error('b1 injected rollback'); };
    await assert.rejects(() => execute(f, 'turn_fixture', { fixture_id: 'fixture.garden_turning_stone' }, 'turn-fail'), /b1 injected rollback/);
    f.world.eventFailureInjector = null;
    assert.equal(f.world.verification().eventCount, beforeEvents); assert.equal(f.world.sqlite.prepare('SELECT COUNT(*) count FROM world_action_receipts').get().count, beforeReceipts);
    assert.equal(f.world.getObjectState('fixture.garden_turning_stone').turnCount, 0);
    await assert.rejects(() => execute(f, 'move_through_passage', { passage_id: 'passage.garden_house' }, 'closed'), error => error.code === 'world_passage_closed');
    assert.equal(f.world.verification().eventCount, beforeEvents);
  } finally { await f.close(); }
});

test('A2 opens upgrade-required without writes and B1 migration is backup-gated and transactional', async () => {
  const f = await fixture(); await f.gateway.close(); f.world.close(); downgradeFreshB1ToExactA2(f.path);
  const before = await readFile(f.path); const world = new WorldGraphStore(f.path, { topologyVersion: 'b1', eventFailureInjector: ({ phase }) => { if (phase === 'after_projection_apply') throw new Error('b1 migration rollback'); } });
  try {
    assert.equal(world.verification().status, 'upgrade_required'); assert.equal(world.inspectB1Upgrade().status, 'upgrade_required');
    for (const backupConfirmed of [undefined, false, null, 'false', {}]) assert.throws(() => world.migrateB1({ backupConfirmed }), error => error.code === 'world_b1_backup_required');
    assert.equal(world.bootstrapB1Extension, undefined); assert.equal(world._migrateB1Boundary, undefined);
    assert.throws(() => world.migrateB1({ backupConfirmed: true }), /b1 migration rollback/);
    assert.equal(world.inspectB1Upgrade().status, 'upgrade_required'); assert.equal(world.sqlite.prepare("SELECT COUNT(*) count FROM world_event_journal WHERE event_kind='topology.extended/v1'").get().count, 0);
    world.eventFailureInjector = null; assert.equal(world.migrateB1({ backupConfirmed: true }).status, 'migrated'); assert.equal(world.verification().verified, true);
  } finally { world.close(); await rm(f.dir, { recursive: true, force: true }); }
  assert.ok(before.length > 0);
});

test('journal-bearing A2 startup stays read-only, serves Builder inspection, and blocks provider wake', async () => {
  const f = await fixture(); await f.gateway.close(); f.world.close(); downgradeFreshB1ToExactA2(f.path); const before = await readFile(f.path); let providerCalls = 0;
  const provider = { async complete() { providerCalls += 1; throw new Error('provider must not be called'); } };
  const env = { HUB_RESIDENT_MODE: 'fake', HUB_DB_PATH: join(f.dir, 'hub.sqlite'), HUB_SPINE_PATH: join(f.dir, 'spine.jsonl'), HUB_WORLD_PATH: f.path, HUB_RESULT_PATH: join(f.dir, 'results.sqlite'), HUB_WORKSHOP_ROOT: f.root };
  const hub = createHub({ env, provider }); await new Promise(resolve => hub.server.listen(0, '127.0.0.1', resolve)); const base = `http://127.0.0.1:${hub.server.address().port}`;
  try {
    const builderResponse = await fetch(`${base}/api/world`); const builder = await builderResponse.json(); assert.equal(builderResponse.status, 200); assert.equal(builder.verification.status, 'upgrade_required'); assert.equal(builder.graph.passages.length, 0); assert.equal(builder.collectionBounds.passages.available, false);
    const wakeResponse = await fetch(`${base}/api/wakes`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'Wait for migration.' }) }); const wake = await wakeResponse.json();
    assert.equal(wake.failureCode, 'world_b1_upgrade_required'); assert.equal(providerCalls, 0); assert.equal(hub.db.sqlite.prepare('SELECT COUNT(*) count FROM provider_requests').get().count, 0); assert.deepEqual(await readFile(f.path), before);
  } finally { await new Promise(resolve => hub.server.close(resolve)); await hub.close(); await rm(f.dir, { recursive: true, force: true }); }
});

test('B1 migration CLI is read-only by default and requires backup confirmation to apply', async () => {
  const f = await fixture(); await f.gateway.close(); f.world.close(); downgradeFreshB1ToExactA2(f.path);
  try {
    const before = await readFile(f.path);
    const env = { ...process.env, HUB_WORLD_PATH: f.path };
    const inspect = await execFileAsync(process.execPath, ['src/scripts/world-migrate-b1.js'], { cwd: process.cwd(), env });
    assert.match(inspect.stdout, /"status": "upgrade_required"/); assert.deepEqual(await readFile(f.path), before);
    await assert.rejects(() => execFileAsync(process.execPath, ['src/scripts/world-migrate-b1.js', '--apply'], { cwd: process.cwd(), env }), error => error.code === 2);
    assert.deepEqual(await readFile(f.path), before);
    const applied = await execFileAsync(process.execPath, ['src/scripts/world-migrate-b1.js', '--apply', '--backup-confirmed'], { cwd: process.cwd(), env });
    assert.match(applied.stdout, /"status": "migrated"/); const current = new WorldGraphStore(f.path, { topologyVersion: 'b1' }); try { assert.equal(current.verification().verified, true); } finally { current.close(); }
    const currentInspect = await execFileAsync(process.execPath, ['src/scripts/world-migrate-b1.js'], { cwd: process.cwd(), env }); assert.match(currentInspect.stdout, /"status": "current"/);
    const help = await execFileAsync(process.execPath, ['src/scripts/world-migrate-b1.js', '--help'], { cwd: process.cwd(), env }); assert.match(help.stdout, /read-only/); assert.match(help.stdout, /--apply --backup-confirmed/);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test('B1 migration CLI refuses missing and corrupt stores without creating or changing them', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-world-b1-cli-refusal-')); const missing = join(dir, 'missing.sqlite');
  try {
    const env = { ...process.env, HUB_WORLD_PATH: missing };
    await assert.rejects(() => execFileAsync(process.execPath, ['src/scripts/world-migrate-b1.js'], { cwd: process.cwd(), env })); assert.equal(existsSync(missing), false);
    const path = join(dir, 'corrupt.sqlite'); const world = new WorldGraphStore(path, { topologyVersion: 'b1' }); world.sqlite.prepare("UPDATE world_object_states SET state_json='{}' WHERE object_id='object.front_door'").run(); world.close();
    const before = await readFile(path); await assert.rejects(() => execFileAsync(process.execPath, ['src/scripts/world-migrate-b1.js', '--apply', '--backup-confirmed'], { cwd: process.cwd(), env: { ...process.env, HUB_WORLD_PATH: path } })); assert.deepEqual(await readFile(path), before);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('partial B1 schema is drift, not clean A2 upgrade-required', async () => {
  const f = await fixture(); await f.gateway.close(); f.world.close(); downgradeFreshB1ToExactA2(f.path);
  const sqlite = new DatabaseSync(f.path); sqlite.exec('CREATE TABLE world_passages (edge_id TEXT);'); sqlite.close();
  const world = new WorldGraphStore(f.path, { topologyVersion: 'b1' });
  try { const verification = world.verification(); assert.equal(verification.verified, false); assert.notEqual(verification.status, 'upgrade_required'); assert.equal(world.inspectB1Upgrade().status, 'corrupt_or_incomplete_b1'); }
  finally { world.close(); await rm(f.dir, { recursive: true, force: true }); }
});

test('B1 verifier rejects missing, extra, pointer, duplicate, and weakened object projections', async () => {
  for (const mode of ['missing', 'extra', 'pointer', 'duplicate']) {
    const f = await fixture();
    try {
      if (mode === 'missing') f.world.sqlite.prepare("DELETE FROM world_object_states WHERE object_id='object.front_door'").run();
      if (mode === 'extra') f.world.sqlite.prepare(`INSERT INTO world_object_states(${OBJECT_STATE_COLUMNS.join(',')}) VALUES(?,?,?,?,?,?)`).run('object.marker', '{}', 1, new Date().toISOString(), 2, 'f'.repeat(64));
      if (mode === 'pointer') f.world.sqlite.prepare("UPDATE world_object_states SET last_event_hash=? WHERE object_id='object.front_door'").run('e'.repeat(64));
      if (mode === 'duplicate') {
        const rows = f.world.sqlite.prepare(`SELECT ${OBJECT_STATE_COLUMNS.join(',')} FROM world_object_states`).all();
        f.world.sqlite.exec('PRAGMA foreign_keys=OFF; DROP TABLE world_object_states; CREATE TABLE world_object_states (object_id TEXT,state_json TEXT,revision INTEGER,updated_at TEXT,last_event_sequence INTEGER,last_event_hash TEXT);');
        const insert = f.world.sqlite.prepare(`INSERT INTO world_object_states(${OBJECT_STATE_COLUMNS.join(',')}) VALUES(?,?,?,?,?,?)`);
        for (const row of [...rows, rows[0]]) insert.run(...OBJECT_STATE_COLUMNS.map(column => row[column]));
      }
      const verification = f.world.verification(); assert.equal(verification.verified, false);
      const expected = mode === 'missing' ? 'projection_missing_row' : mode === 'extra' ? 'projection_extra_row' : mode === 'pointer' ? 'projection_pointer_mismatch' : 'projection_duplicate_row';
      assert.ok(verification.mismatches.some(item => item.code === expected), `${mode}: ${JSON.stringify(verification.mismatches)}`);
      assert.throws(() => f.world.projection('life'), error => error.code === 'world_projection_drift');
    } finally { await f.close(); }
  }
});

test('replay refuses legacy extension ordering and every commandless B1 mutation', async () => {
  const f = await fixture();
  try {
    const root = f.world.sqlite.prepare('SELECT * FROM world_event_journal WHERE sequence=1').get();
    const extension = f.world.sqlite.prepare('SELECT * FROM world_event_journal WHERE sequence=2').get();
    const legacyState = { ...reduceWorldEvent(emptyWorldState(), root), rootBoundary: 'legacy' };
    assert.throws(() => reduceWorldEvent(legacyState, extension), /operational boundary/);
    f.world.ensureLifespan('life'); await execute(f, 'move_through_passage', { passage_id: 'passage.center_garden' }, 'cross');
    await execute(f, 'turn_fixture', { fixture_id: 'fixture.garden_turning_stone' }, 'turn');
    await execute(f, 'operate_passage', { passage_id: 'passage.garden_house', action: 'open' }, 'operate');
    for (const kind of ['location.crossed/v1', 'fixture.turned/v1', 'passage.operated/v1']) {
      const mutation = f.world.sqlite.prepare('SELECT * FROM world_event_journal WHERE event_kind=?').get(kind);
      let prior = emptyWorldState();
      for (const event of f.world.sqlite.prepare('SELECT * FROM world_event_journal WHERE sequence<? ORDER BY sequence').all(mutation.sequence)) prior = reduceWorldEvent(prior, event);
      assert.throws(() => reduceWorldEvent(prior, { ...mutation, command_id: null, actor: 'world_internal' }), /command envelope/);
    }
  } finally { await f.close(); }
});

test('B1 custody binds receipt location to the physical side or crossing destination', async () => {
  for (const [toolName, prepare] of [
    ['move_through_passage', async f => execute(f, 'move_through_passage', { passage_id: 'passage.center_garden' }, 'cross')],
    ['turn_fixture', async f => { await execute(f, 'move_through_passage', { passage_id: 'passage.center_garden' }, 'garden'); return execute(f, 'turn_fixture', { fixture_id: 'fixture.garden_turning_stone' }, 'turn'); }],
    ['operate_passage', async f => { await execute(f, 'move_through_passage', { passage_id: 'passage.center_garden' }, 'garden'); return execute(f, 'operate_passage', { passage_id: 'passage.garden_house', action: 'open' }, 'operate'); }],
  ]) {
    const f = await fixture();
    try {
      f.world.ensureLifespan('life'); await prepare(f);
      f.world.sqlite.exec('DROP TRIGGER world_action_receipts_append_only_update;');
      f.world.sqlite.prepare("UPDATE world_action_receipts SET room_node_id='room.workshop' WHERE tool_name=?").run(toolName);
      f.world.sqlite.exec(WORLD_INTEGRITY_TRIGGER_SQL.world_action_receipts_append_only_update);
      const verification = f.world.verification(); assert.equal(verification.verified, false); assert.ok(verification.mismatches.some(item => item.code === 'state_action_event_semantics_mismatch'));
    } finally { await f.close(); }
  }
});

test('builder inspection exposes bounded B1 passage and object-state projections under drift', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-world-b1-builder-')); const env = { HUB_RESIDENT_MODE: 'fake', HUB_DB_PATH: join(dir, 'hub.sqlite'), HUB_SPINE_PATH: join(dir, 'spine.jsonl'), HUB_WORLD_PATH: join(dir, 'world.sqlite'), HUB_RESULT_PATH: join(dir, 'results.sqlite'), HUB_WORKSHOP_ROOT: dir };
  const hub = createHub({ env }); await new Promise(resolve => hub.server.listen(0, '127.0.0.1', resolve)); const base = `http://127.0.0.1:${hub.server.address().port}`;
  try {
    let response = await fetch(`${base}/api/world`); let body = await response.json(); assert.equal(response.status, 200); assert.equal(body.graph.passages.length, 6); assert.equal(body.graph.objectStates.length, 2);
    hub.world.sqlite.prepare("UPDATE world_object_states SET state_json=? WHERE object_id='object.front_door'").run('x'.repeat(300000));
    hub.world.sqlite.exec('PRAGMA foreign_keys=OFF;');
    const insert = hub.world.sqlite.prepare(`INSERT INTO world_passages(${PASSAGE_COLUMNS.join(',')}) VALUES(?,?,?,?,?,?,?,?)`);
    for (let index = 0; index < 120; index += 1) insert.run(`edge.hostile.${index}`, `passage.hostile.${index}${index === 0 ? 'x'.repeat(300000) : ''}`, 'opening', 'room.center', 'place.garden', null, 2, 'f'.repeat(64));
    response = await fetch(`${base}/api/world`); const text = await response.text(); body = JSON.parse(text);
    assert.equal(response.status, 200); assert.equal(body.verification.verified, false); assert.equal(body.graph.passages.length, 100); assert.equal(body.collectionBounds.passages.truncated, true); assert.equal(body.collectionBounds.passages.total, null); assert.ok(text.length < 700000);
    assert.equal(body.graph.objectStates.find(row => row.object_id.value === 'object.front_door').state_json.truncated, true);
  } finally { await new Promise(resolve => hub.server.close(resolve)); await hub.close(); await rm(dir, { recursive: true, force: true }); }
});

test('B1 projection drift blocks every new crossing and wake before receipts or provider dispatch', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-world-b1-drift-gates-')); let providerCalls = 0;
  const provider = { async complete() { providerCalls += 1; throw new Error('provider must not be called'); } };
  const env = { HUB_RESIDENT_MODE: 'fake', HUB_DB_PATH: join(dir, 'hub.sqlite'), HUB_SPINE_PATH: join(dir, 'spine.jsonl'), HUB_WORLD_PATH: join(dir, 'world.sqlite'), HUB_RESULT_PATH: join(dir, 'results.sqlite'), HUB_WORKSHOP_ROOT: dir };
  const initial = createHub({ env, provider }); const sessionId = initial.db.session.id; await initial.close();
  const tamper = new DatabaseSync(env.HUB_WORLD_PATH); tamper.prepare("UPDATE world_object_states SET state_json='{}' WHERE object_id='object.front_door'").run(); tamper.close();
  const hub = createHub({ env, provider }); await new Promise(resolve => hub.server.listen(0, '127.0.0.1', resolve));
  try {
    const beforeEvents = hub.world.sqlite.prepare('SELECT COUNT(*) count FROM world_event_journal').get().count; const beforeReceipts = hub.world.sqlite.prepare('SELECT COUNT(*) count FROM world_action_receipts').get().count;
    for (const [name, args] of [['move_through_passage', { passage_id: 'passage.center_garden' }], ['operate_passage', { passage_id: 'passage.garden_house', action: 'open' }], ['turn_fixture', { fixture_id: 'fixture.garden_turning_stone' }]]) {
      await assert.rejects(() => hub.gateway.execute({ sessionId, wakeId: 'wake', intent: intent(name, args, `drift-${name}`) }), error => error.code === 'world_projection_drift');
    }
    assert.equal(hub.world.sqlite.prepare('SELECT COUNT(*) count FROM world_event_journal').get().count, beforeEvents); assert.equal(hub.world.sqlite.prepare('SELECT COUNT(*) count FROM world_action_receipts').get().count, beforeReceipts);
    const response = await fetch(`http://127.0.0.1:${hub.server.address().port}/api/wakes`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'Do not cross B1 drift.' }) });
    const wake = await response.json(); assert.equal(wake.failureCode, 'world_projection_drift'); assert.equal(providerCalls, 0); assert.equal(hub.db.sqlite.prepare('SELECT COUNT(*) count FROM provider_requests').get().count, 0);
  } finally { await new Promise(resolve => hub.server.close(resolve)); await hub.close(); await rm(dir, { recursive: true, force: true }); }
});

test('copied configured legacy World migrates to B1 while source remains read-only', { skip: !existsSync(join(process.cwd(), '.runtime', 'world.sqlite')) }, async context => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-world-b1-runtime-copy-')); const source = join(process.cwd(), '.runtime', 'world.sqlite'); const copy = join(dir, 'world.sqlite');
  try {
    const sourceDb = new DatabaseSync(source, { readOnly: true });
    const sourceEventCount = sourceDb.prepare('SELECT COUNT(*) AS count FROM world_event_journal').get().count;
    if (sourceEventCount !== 2) { sourceDb.close(); context.skip('Configured World is no longer the two-event legacy migration fixture.'); return; }
    const tables = ['world_nodes', 'world_edges', 'world_locations', 'world_fixture_runtime', 'world_timers', 'world_work_briefs', 'world_approvals', 'world_action_receipts', 'world_approval_receipts'];
    const before = Object.fromEntries(tables.map(table => {
      const columns = sourceDb.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name);
      return [table, { columns, rows: sourceDb.prepare(`SELECT ${columns.join(',')} FROM ${table}`).all().map(row => ({ ...row })) }];
    })); sourceDb.close();
    await copyFile(source, copy); const world = new WorldGraphStore(copy, { topologyVersion: 'b1' });
    try {
      assert.equal(world.verification().verified, true); assert.equal(world.verification().eventCount, 3);
      for (const [table, snapshot] of Object.entries(before)) {
        const identityColumns = table === 'world_work_briefs' ? ['session_id', 'revision'] : [snapshot.columns[0]];
        const identity = row => identityColumns.map(column => row[column]).join(':'); const ids = new Set(snapshot.rows.map(identity));
        const after = world.sqlite.prepare(`SELECT ${snapshot.columns.join(',')} FROM ${table}`).all().map(row => ({ ...row })).filter(row => ids.has(identity(row)));
        assert.equal(canonicalize(after.sort((a, b) => identity(a).localeCompare(identity(b)))), canonicalize(snapshot.rows.sort((a, b) => identity(a).localeCompare(identity(b)))), table);
      }
      assert.equal(world.sqlite.prepare(`SELECT COUNT(*) count FROM world_passages`).get().count, topologyExtensionEventPayload().passages.length);
    } finally { world.close(); }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
