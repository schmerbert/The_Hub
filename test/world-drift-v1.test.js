import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { canonicalize, sha256 } from '../src/core/hash.js';
import { createHub } from '../src/server/app.js';
import { WorldGraphStore } from '../src/world/graph.js';
import { computeWorldEventHash, reduceWorldEvent, verifyWorldDatabase, WORLD_EVENT_KINDS, WORLD_INTEGRITY_TRIGGER_SQL } from '../src/world/events.js';
import { INSTALLED_WORLD_EDGES, installedTopologyHash } from '../src/world/topology.js';
import { WorkshopAdapter } from '../src/world/workshop.js';
import { WorldActionGateway } from '../src/world/gateway.js';

async function fixture(options) {
  const dir = await mkdtemp(join(tmpdir(), 'hub-world-drift-'));
  const path = join(dir, 'world.sqlite');
  const world = new WorldGraphStore(path, options);
  return { dir, path, world, close: async () => { world.close(); await rm(dir, { recursive: true, force: true }); } };
}

test('fresh topology, lifespan, movement, inspection, engagement, and leave clearing replay exactly', async () => {
  const f = await fixture();
  try {
    assert.deepEqual(f.world.sqlite.prepare('SELECT event_kind FROM world_event_journal ORDER BY sequence').all().map(row => row.event_kind), ['topology.installed/v1']);
    f.world.ensureLifespan('life');
    f.world.move({ sessionId: 'life', wakeId: 'wake-1', doorId: 'door.workshop' });
    f.world.inspect('life', 'src/world/graph.js');
    f.world.engageFixture({ sessionId: 'life', wakeId: 'wake-2', fixtureId: 'fixture.workshop_shelves' });
    f.world.engageFixture({ sessionId: 'life', wakeId: 'wake-3', fixtureId: 'fixture.workshop_workbench' });
    const left = f.world.move({ sessionId: 'life', wakeId: 'wake-4', doorId: 'door.workshop' });
    assert.equal(left.clearedFixtureId, 'fixture.workshop_workbench');
    const location = f.world.current('life');
    assert.equal(location.room_node_id, 'room.center');
    assert.equal(location.inspected_source, null);
    assert.equal(location.engaged_fixture_id, null);
    assert.equal(f.world.verification().verified, true);
    const events = f.world.sqlite.prepare('SELECT * FROM world_event_journal ORDER BY sequence').all();
    let replay = { nodes: [], edges: [], locations: [] };
    for (const event of events) replay = reduceWorldEvent(replay, event);
    assert.deepEqual(replay.locations, f.world.sqlite.prepare('SELECT session_id,room_node_id,inspected_source,engaged_fixture_id,revision,started_at,updated_at,last_event_sequence,last_event_hash FROM world_locations ORDER BY session_id').all().map(row => ({ ...row })));
  } finally { await f.close(); }
});

test('journal rejects update, delete, and non-contiguous insertion', async () => {
  const f = await fixture();
  try {
    const head = f.world.sqlite.prepare('SELECT * FROM world_event_journal').get();
    assert.throws(() => f.world.sqlite.prepare("UPDATE world_event_journal SET actor='tamper' WHERE sequence=1").run(), /append-only/);
    assert.throws(() => f.world.sqlite.prepare('DELETE FROM world_event_journal WHERE sequence=1').run(), /append-only/);
    assert.throws(() => f.world.sqlite.prepare(`INSERT INTO world_event_journal(sequence,event_id,event_schema_version,event_kind,aggregate_kind,aggregate_id,aggregate_revision,session_id,wake_id,actor,command_id,causation_json,payload_json,payload_sha256,previous_event_hash,event_hash,occurred_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      3, 'gap', 1, 'lifespan.started/v1', 'lifespan', 'gap', 1, 'gap', null, 'test', null, '{}', '{}', sha256('{}'), head.event_hash, '1'.repeat(64), new Date().toISOString(),
    ), /contiguous/);
  } finally { await f.close(); }
});

test('hash, version, aggregate revision, and projection tampering fail closed', async () => {
  const f = await fixture();
  try {
    f.world.ensureLifespan('life');
    f.world.sqlite.exec('DROP TRIGGER world_event_journal_append_only_update');
    f.world.sqlite.prepare("UPDATE world_event_journal SET event_schema_version=2,aggregate_revision=7,payload_json='{}' WHERE sequence=2").run();
    const verification = f.world.verification();
    assert.equal(verification.verified, false);
    assert.ok(verification.mismatches.some(item => item.code === 'event_schema_version_unknown'));
    assert.ok(verification.mismatches.some(item => item.code === 'aggregate_revision_gap'));
    assert.ok(verification.mismatches.some(item => item.code === 'payload_hash_mismatch'));
    for (const operation of [() => f.world.projection('life'), () => f.world.presenceMessage('life'), () => f.world.availableTools('life'), () => f.world.move({ sessionId: 'life', doorId: 'door.workshop' })]) {
      assert.throws(operation, error => error.code === 'world_projection_drift' && error.verification.mismatches.length <= 50);
    }
  } finally { await f.close(); }
});

test('missing, extra, altered-label, and last-pointer projection rows are drift', async () => {
  for (const mutate of [
    sqlite => sqlite.prepare("DELETE FROM world_locations WHERE session_id='life'").run(),
    sqlite => sqlite.prepare("INSERT INTO world_locations(session_id,room_node_id,revision,started_at,updated_at) VALUES('extra','room.center',1,'x','x')").run(),
    sqlite => { sqlite.exec('DROP TRIGGER world_edges_append_only_update'); sqlite.prepare("UPDATE world_edges SET label='False Door' WHERE id='edge.door.workshop.center_to_workshop'").run(); },
    sqlite => sqlite.prepare("UPDATE world_locations SET last_event_hash='bad' WHERE session_id='life'").run(),
  ]) {
    const f = await fixture();
    try {
      f.world.ensureLifespan('life'); mutate(f.world.sqlite);
      const verification = f.world.verification();
      assert.equal(verification.verified, false);
      assert.ok(verification.mismatches.some(item => ['projection_missing_row', 'projection_extra_row', 'projection_column_mismatch', 'projection_pointer_mismatch'].includes(item.code)));
    } finally { await f.close(); }
  }
});

test('code-owned topology hash refuses a coordinated alternate manifest', async () => {
  const f = await fixture();
  try {
    const event = f.world.sqlite.prepare('SELECT * FROM world_event_journal WHERE sequence=1').get();
    const payload = JSON.parse(event.payload_json);
    payload.edges[0].label = 'Counterfeit Workshop';
    payload.manifestSha256 = sha256(canonicalize({ nodes: payload.nodes, edges: payload.edges }));
    event.payload_json = canonicalize(payload);
    event.payload_sha256 = sha256(event.payload_json);
    event.event_hash = computeWorldEventHash(event);
    f.world.sqlite.exec('DROP TRIGGER world_event_journal_append_only_update; DROP TRIGGER world_edges_append_only_update; DROP TRIGGER world_nodes_append_only_update;');
    f.world.sqlite.prepare('UPDATE world_event_journal SET payload_json=?,payload_sha256=?,event_hash=? WHERE sequence=1').run(event.payload_json, event.payload_sha256, event.event_hash);
    f.world.sqlite.prepare("UPDATE world_edges SET label='Counterfeit Workshop',last_event_hash=? WHERE id=?").run(event.event_hash, payload.edges[0].id);
    f.world.sqlite.prepare('UPDATE world_edges SET last_event_hash=? WHERE id<>?').run(event.event_hash, payload.edges[0].id);
    f.world.sqlite.prepare('UPDATE world_nodes SET last_event_hash=?').run(event.event_hash);
    const verification = f.world.verification();
    assert.equal(verification.verified, false);
    assert.ok(verification.mismatches.some(item => item.code === 'replay_error' && /code-owned manifest/.test(item.message)));
  } finally { await f.close(); }
});

test('failure between journal append and projection rolls the whole transition back', async () => {
  const f = await fixture();
  try {
    f.world.ensureLifespan('life');
    const beforeCount = f.world.verification().eventCount;
    const before = f.world.current('life');
    f.world.eventFailureInjector = ({ phase, event }) => { if (phase === 'after_event_append' && event.event_kind === 'location.moved/v1') throw new Error('injected projector failure'); };
    assert.throws(() => f.world.move({ sessionId: 'life', doorId: 'door.workshop' }), /injected projector failure/);
    f.world.eventFailureInjector = null;
    assert.equal(f.world.verification().eventCount, beforeCount);
    assert.deepEqual(f.world.current('life'), before);
    assert.equal(f.world.verification().verified, true);
  } finally { await f.close(); }
});

test('journal-less material state receives one exact legacy boundary without fabricated history', async () => {
  const f = await fixture();
  f.world.ensureLifespan('legacy-life');
  f.world.move({ sessionId: 'legacy-life', doorId: 'door.workshop' });
  const ancestryCount = f.world.listLocationEvents('legacy-life').length;
  f.world.close();
  const sqlite = new DatabaseSync(f.path);
  sqlite.exec(`DROP TRIGGER world_event_journal_contiguous_insert;
    DROP TRIGGER world_event_journal_append_only_update;
    DROP TRIGGER world_event_journal_append_only_delete;
    DROP TABLE world_event_journal;
    DROP TRIGGER world_nodes_append_only_update;
    UPDATE world_nodes SET revision=4 WHERE id='room.workshop';
    PRAGMA foreign_keys=OFF;
    CREATE TABLE world_locations_historical (session_id TEXT PRIMARY KEY, room_node_id TEXT NOT NULL REFERENCES world_nodes(id), inspected_source TEXT, revision INTEGER NOT NULL CHECK(revision>0), started_at TEXT NOT NULL, updated_at TEXT NOT NULL, engaged_fixture_id TEXT REFERENCES world_nodes(id));
    INSERT INTO world_locations_historical(session_id,room_node_id,inspected_source,revision,started_at,updated_at,engaged_fixture_id) SELECT session_id,room_node_id,inspected_source,revision,started_at,updated_at,engaged_fixture_id FROM world_locations;
    DROP TABLE world_locations;
    ALTER TABLE world_locations_historical RENAME TO world_locations;
    PRAGMA foreign_keys=ON;`);
  sqlite.close();
  const migrated = new WorldGraphStore(f.path);
  try {
    const rows = migrated.sqlite.prepare('SELECT event_kind,payload_json FROM world_event_journal ORDER BY sequence').all();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].event_kind, 'legacy_snapshot.imported/v1');
    const payload = JSON.parse(rows[0].payload_json);
    assert.equal(payload.locations[0].room_node_id, 'room.workshop');
    assert.equal(payload.nodes.find(row => row.id === 'room.workshop').revision, 4);
    assert.equal(migrated.node('room.workshop').revision, 4);
    assert.deepEqual(migrated.sqlite.prepare('PRAGMA table_info(world_locations)').all().map(column => column.name), ['session_id', 'room_node_id', 'inspected_source', 'engaged_fixture_id', 'revision', 'started_at', 'updated_at', 'last_event_sequence', 'last_event_hash']);
    assert.equal(migrated.listLocationEvents('legacy-life').length, ancestryCount);
    assert.equal(migrated.verification().verified, true);
  } finally { migrated.close(); await rm(f.dir, { recursive: true, force: true }); }
});

test('read-only database verifier reports drift without repairing it', async () => {
  const f = await fixture();
  try {
    f.world.ensureLifespan('life');
    f.world.sqlite.prepare("UPDATE world_locations SET room_node_id='room.workshop' WHERE session_id='life'").run();
    const before = f.world.sqlite.prepare("SELECT room_node_id FROM world_locations WHERE session_id='life'").get().room_node_id;
    const verification = verifyWorldDatabase(f.path);
    const after = f.world.sqlite.prepare("SELECT room_node_id FROM world_locations WHERE session_id='life'").get().room_node_id;
    assert.equal(verification.verified, false);
    assert.equal(before, 'room.workshop');
    assert.equal(after, before);
  } finally { await f.close(); }
});

test('wake drift gate fails with a typed code before orientation provider dispatch', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-world-wake-drift-'));
  let providerCalls = 0;
  const provider = { async complete() { providerCalls += 1; throw new Error('provider must not be called'); } };
  const env = {
    HUB_RESIDENT_MODE: 'fake', HUB_DB_PATH: join(dir, 'hub.sqlite'), HUB_SPINE_PATH: join(dir, 'spine.jsonl'),
    HUB_WORLD_PATH: join(dir, 'world.sqlite'), HUB_RESULT_PATH: join(dir, 'results.sqlite'), HUB_WORKSHOP_ROOT: process.cwd(),
  };
  const initial = createHub({ env, provider });
  const sessionId = initial.db.session.id;
  initial.close();
  const tamper = new DatabaseSync(env.HUB_WORLD_PATH);
  tamper.prepare("UPDATE world_locations SET room_node_id='room.workshop' WHERE session_id=?").run(sessionId);
  tamper.close();
  const hub = createHub({ env, provider });
  await new Promise(resolve => hub.server.listen(0, resolve));
  try {
    const builder = await (await fetch(`http://127.0.0.1:${hub.server.address().port}/api/world`)).json();
    assert.equal(builder.verification.verified, false);
    assert.equal(builder.location, null);
    assert.deepEqual(builder.tools, []);
    const response = await fetch(`http://127.0.0.1:${hub.server.address().port}/api/wakes`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'Do not cross drift.' }),
    });
    const wake = await response.json();
    assert.equal(response.status, 500);
    assert.equal(wake.status, 'failed');
    assert.equal(wake.failureCode, 'world_projection_drift');
    assert.equal(providerCalls, 0);
    assert.equal(hub.db.sqlite.prepare('SELECT COUNT(*) AS count FROM provider_requests').get().count, 0);
  } finally {
    await new Promise(resolve => hub.server.close(resolve));
    hub.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('journal-bearing reopen never repairs missing or inert integrity triggers', async () => {
  for (const inert of [false, true]) {
    const f = await fixture();
    f.world.sqlite.exec('DROP TRIGGER world_event_journal_append_only_update;');
    if (inert) f.world.sqlite.exec("CREATE TRIGGER world_event_journal_append_only_update BEFORE UPDATE ON world_event_journal BEGIN SELECT CASE WHEN 0 THEN RAISE(ABORT,'never') END; END;");
    f.world.close();
    const reopened = new WorldGraphStore(f.path);
    try {
      const verification = reopened.verification();
      assert.equal(verification.verified, false);
      assert.ok(verification.mismatches.some(item => item.code === (inert ? 'trigger_definition_invalid' : 'journal_trigger_missing')));
      const trigger = reopened.sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='world_event_journal_append_only_update'").get();
      assert.equal(Boolean(trigger), inert);
      if (inert) assert.equal(reopened.sqlite.prepare("UPDATE world_event_journal SET actor='rewritten' WHERE sequence=1").run().changes, 1);
    } finally { reopened.close(); await rm(f.dir, { recursive: true, force: true }); }
  }
});

test('empty journal root and weakened projection schema with duplicate identities refuse', async () => {
  const empty = await fixture();
  empty.world.sqlite.exec('DROP TRIGGER world_event_journal_append_only_delete; DELETE FROM world_event_journal;');
  empty.world.sqlite.exec(WORLD_INTEGRITY_TRIGGER_SQL.world_event_journal_append_only_delete);
  assert.ok(empty.world.verification().mismatches.some(item => item.code === 'journal_root_missing'));
  await empty.close();

  const duplicate = await fixture();
  duplicate.world.ensureLifespan('life');
  duplicate.world.sqlite.exec(`PRAGMA foreign_keys=OFF;
    CREATE TABLE world_locations_bad AS SELECT * FROM world_locations;
    INSERT INTO world_locations_bad SELECT * FROM world_locations;
    DROP TABLE world_locations;
    ALTER TABLE world_locations_bad RENAME TO world_locations;
    PRAGMA foreign_keys=ON;`);
  const verification = duplicate.world.verification();
  assert.equal(verification.verified, false);
  assert.ok(verification.mismatches.some(item => item.code === 'schema_definition_invalid' && item.table === 'world_locations'));
  assert.ok(verification.mismatches.some(item => item.code === 'projection_duplicate_row' && item.table === 'world_locations'));
  await duplicate.close();
});

test('weakened journal schema and malformed builder stores stay inspectable without repair', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-world-malformed-builder-'));
  const env = {
    HUB_RESIDENT_MODE: 'fake', HUB_DB_PATH: join(dir, 'hub.sqlite'), HUB_SPINE_PATH: join(dir, 'spine.jsonl'),
    HUB_WORLD_PATH: join(dir, 'world.sqlite'), HUB_RESULT_PATH: join(dir, 'results.sqlite'), HUB_WORKSHOP_ROOT: process.cwd(),
  };
  let providerCalls = 0; const provider = { async complete() { providerCalls += 1; throw new Error('must not dispatch'); } };
  const initial = createHub({ env, provider }); initial.close();
  const sqlite = new DatabaseSync(env.HUB_WORLD_PATH);
  sqlite.exec(`DROP TRIGGER world_event_journal_contiguous_insert;
    DROP TRIGGER world_event_journal_append_only_update;
    DROP TRIGGER world_event_journal_append_only_delete;
    ALTER TABLE world_event_journal RENAME TO valid_world_event_journal;
    CREATE TABLE world_event_journal(sequence,event_kind);
    INSERT INTO world_event_journal VALUES(1,'topology.installed/v1');`);
  sqlite.close();
  const hub = createHub({ env, provider });
  await new Promise(resolve => hub.server.listen(0, resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${hub.server.address().port}/api/world`); const builder = await response.json();
    assert.equal(response.status, 200); assert.equal(builder.verification.verified, false);
    assert.ok(builder.verification.mismatches.some(item => item.code === 'schema_definition_invalid' && item.table === 'world_event_journal'));
    const wakeResponse = await fetch(`http://127.0.0.1:${hub.server.address().port}/api/wakes`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'Refuse malformed authority.' }) });
    const wake = await wakeResponse.json(); assert.equal(wake.failureCode, 'world_projection_drift'); assert.equal(providerCalls, 0);
  } finally { await new Promise(resolve => hub.server.close(resolve)); hub.close(); await rm(dir, { recursive: true, force: true }); }
});

test('missing required projection table remains a bounded builder mismatch', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-world-missing-projection-'));
  const env = { HUB_RESIDENT_MODE: 'fake', HUB_DB_PATH: join(dir, 'hub.sqlite'), HUB_SPINE_PATH: join(dir, 'spine.jsonl'), HUB_WORLD_PATH: join(dir, 'world.sqlite'), HUB_RESULT_PATH: join(dir, 'results.sqlite'), HUB_WORKSHOP_ROOT: process.cwd() };
  const initial = createHub({ env }); initial.close();
  const sqlite = new DatabaseSync(env.HUB_WORLD_PATH); sqlite.exec('DROP TABLE world_locations;'); sqlite.close();
  const hub = createHub({ env }); await new Promise(resolve => hub.server.listen(0, resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${hub.server.address().port}/api/world`); const builder = await response.json();
    assert.equal(response.status, 200); assert.equal(builder.verification.verified, false);
    assert.ok(builder.verification.mismatches.some(item => item.code === 'schema_missing' && item.table === 'world_locations'));
    assert.equal(builder.location, null); assert.deepEqual(builder.tools, []);
  } finally { await new Promise(resolve => hub.server.close(resolve)); hub.close(); await rm(dir, { recursive: true, force: true }); }
});

test('installed topology exports are deeply immutable', () => {
  const before = installedTopologyHash();
  assert.throws(() => { INSTALLED_WORLD_EDGES[0][5] = 'Counterfeit mutable label'; }, TypeError);
  assert.equal(installedTopologyHash(), before);
});

test('World event registrations are deeply immutable', () => {
  assert.throws(() => { WORLD_EVENT_KINDS['topology.installed/v1'].schemaVersion = 2; }, TypeError);
  assert.throws(() => { WORLD_EVENT_KINDS['timer.set/v1'].installed = true; }, TypeError);
  assert.equal(WORLD_EVENT_KINDS['topology.installed/v1'].schemaVersion, 1);
  assert.equal(WORLD_EVENT_KINDS['timer.set/v1'].installed, false);
});

test('legacy boundary refuses an altered or extra topology instead of blessing it', async () => {
  const f = await fixture();
  f.world.close();
  const sqlite = new DatabaseSync(f.path);
  sqlite.exec(`DROP TRIGGER world_event_journal_contiguous_insert;
    DROP TRIGGER world_event_journal_append_only_update;
    DROP TRIGGER world_event_journal_append_only_delete;
    DROP TABLE world_event_journal;
    DROP TRIGGER world_edges_append_only_update;
    UPDATE world_edges SET label='Counterfeit Legacy Door' WHERE id='edge.door.workshop.center_to_workshop';`);
  sqlite.close();
  try { assert.throws(() => new WorldGraphStore(f.path), error => error.code === 'world_legacy_topology_invalid'); }
  finally { await rm(f.dir, { recursive: true, force: true }); }
});

test('canonical rehashed movement clearing and causation lies fail replay', async () => {
  for (const mutation of ['clearing', 'causation']) {
    const f = await fixture();
    try {
      f.world.ensureLifespan('life'); f.world.move({ sessionId: 'life', doorId: 'door.workshop' });
      const event = f.world.sqlite.prepare('SELECT * FROM world_event_journal WHERE sequence=3').get();
      if (mutation === 'clearing') {
        const payload = JSON.parse(event.payload_json); payload.clearedFixtureId = 'fixture.never-cleared'; event.payload_json = canonicalize(payload); event.payload_sha256 = sha256(event.payload_json);
      } else event.causation_json = canonicalize({ doorIdentity: 'door.counterfeit', edgeId: JSON.parse(event.payload_json).edgeId });
      event.event_hash = computeWorldEventHash(event);
      f.world.sqlite.exec('DROP TRIGGER world_event_journal_append_only_update;');
      f.world.sqlite.prepare('UPDATE world_event_journal SET causation_json=?,payload_json=?,payload_sha256=?,event_hash=? WHERE sequence=3').run(event.causation_json, event.payload_json, event.payload_sha256, event.event_hash);
      f.world.sqlite.exec(WORLD_INTEGRITY_TRIGGER_SQL.world_event_journal_append_only_update);
      f.world.sqlite.prepare("UPDATE world_locations SET last_event_hash=? WHERE session_id='life'").run(event.event_hash);
      const verification = f.world.verification();
      assert.equal(verification.verified, false);
      assert.ok(verification.mismatches.some(item => item.code === 'replay_error' && (mutation === 'clearing' ? /clearing/.test(item.message) : /causation/.test(item.message))));
    } finally { await f.close(); }
  }
});

test('approval decisions refuse drift before host mutation or approval change', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-world-approval-drift-')); const root = join(dir, 'repo'); await mkdir(root);
  const path = join(root, 'target.txt'); await writeFile(path, 'before', 'utf8');
  const world = new WorldGraphStore(join(dir, 'world.sqlite')); world.ensureLifespan('life'); world.move({ sessionId: 'life', doorId: 'door.workshop' });
  const gateway = new WorldActionGateway({ world, workshop: new WorkshopAdapter(root), approvalMode: 'confirm' });
  const approval = world.createApproval({ sessionId: 'life', kind: 'write_file', payload: { path: 'target.txt', content: 'after' }, preview: { path: 'target.txt' } });
  world.sqlite.prepare("UPDATE world_locations SET room_node_id='room.center' WHERE session_id='life'").run();
  try {
    assert.throws(() => gateway.confirmApproval(approval.approvalId, 'life'), error => error.code === 'world_projection_drift');
    assert.throws(() => gateway.rejectApproval(approval.approvalId, 'life'), error => error.code === 'world_projection_drift');
    assert.throws(() => gateway.confirmSandboxPromotion({ approvalId: approval.approvalId, payload: { plan: {} } }, { recordCrossing: false }), error => error.code === 'world_projection_drift');
    assert.equal(await readFile(path, 'utf8'), 'before');
    assert.equal(world.getApproval(approval.approvalId).status, 'pending');
    assert.equal(world.sqlite.prepare('SELECT COUNT(*) AS count FROM world_action_receipts').get().count, 0);
  } finally { gateway.close(); world.close(); await rm(dir, { recursive: true, force: true }); }
});
