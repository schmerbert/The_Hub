import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { canonicalize, id, sha256 } from '../core/hash.js';
import { mountProfile, mountedToolNames, profilePresenceLine } from './ceiling.js';
import { INSTALLED_WORLD_EDGES, INSTALLED_WORLD_NODES, topologyEventPayload } from './topology.js';
import {
  EDGE_COLUMNS, LOCATION_COLUMNS, NODE_COLUMNS, assertWorldVerified, createWorldEvent,
  insertWorldEvent, installWorldEventSchema, readWorldProjection, reduceWorldEvent, verifyWorldSqlite,
  WORLD_INTEGRITY_TRIGGER_SQL, WORLD_PROJECTION_TABLE_SQL,
} from './events.js';

const NOW = () => new Date().toISOString();

export const WORKSHOP_ROOM_TEXT = 'The Workshop. Shelves hold the repository close to a scarred workbench; a kiln, ledger, and clipboard keep their separate places. Tools are mounted here without engaging; engagement is orientation only.';
export const KILN_FIXTURE_ID = 'fixture.workshop_kiln';

const SEED_NODES = INSTALLED_WORLD_NODES.filter(([, nodeType]) => nodeType !== 'station');
const SEED_EDGES = INSTALLED_WORLD_EDGES;

const RETIRED_STATION_IDS = ['station.spec_table', 'station.control_panel'];

const SCHEMA = `
${WORLD_PROJECTION_TABLE_SQL.world_nodes}
${WORLD_PROJECTION_TABLE_SQL.world_edges}
${WORLD_PROJECTION_TABLE_SQL.world_locations}
CREATE TABLE IF NOT EXISTS world_location_events (event_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, wake_id TEXT, actor TEXT NOT NULL, from_room TEXT REFERENCES world_nodes(id), to_room TEXT NOT NULL REFERENCES world_nodes(id), edge_id TEXT REFERENCES world_edges(id), door_identity TEXT, created_at TEXT NOT NULL, attribution_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS world_action_receipts (receipt_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, wake_id TEXT, room_node_id TEXT NOT NULL REFERENCES world_nodes(id), tool_name TEXT NOT NULL, arguments_json TEXT NOT NULL, result_json TEXT NOT NULL, outcome TEXT NOT NULL CHECK(outcome IN ('committed','refused')), request_record_id TEXT, spine_record_id TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS world_work_briefs (brief_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0), objective TEXT NOT NULL, scope_paths_json TEXT NOT NULL, acceptance_json TEXT NOT NULL, non_goals_json TEXT NOT NULL, field_hashes_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS world_approvals (approval_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, wake_id TEXT, kind TEXT NOT NULL CHECK(kind IN ('patch','unified_diff','write_file','create_path','delete_path','rename_path','git_add','commit','git_checkout','sandbox_promotion')), status TEXT NOT NULL CHECK(status IN ('pending','confirmed','rejected','cancelled')), payload_json TEXT NOT NULL, preview_json TEXT NOT NULL, outcome_json TEXT, created_at TEXT NOT NULL, decided_at TEXT);
CREATE TABLE IF NOT EXISTS world_approval_receipts (receipt_id TEXT PRIMARY KEY, approval_id TEXT NOT NULL REFERENCES world_approvals(approval_id), session_id TEXT NOT NULL, wake_id TEXT, phase TEXT NOT NULL CHECK(phase IN ('pending','confirmed','rejected','cancelled')), action_receipt_id TEXT NOT NULL REFERENCES world_action_receipts(receipt_id), result_json TEXT NOT NULL, host_return_scrub_json TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS world_fixture_runtime (fixture_id TEXT PRIMARY KEY, state_json TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS world_timers (session_id TEXT PRIMARY KEY, seconds INTEGER NOT NULL CHECK(seconds>=1 AND seconds<=3600), due_at TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS world_location_events_session_order ON world_location_events(session_id, created_at, event_id);
CREATE INDEX IF NOT EXISTS world_action_receipts_session_order ON world_action_receipts(session_id, created_at, receipt_id);
CREATE INDEX IF NOT EXISTS world_approvals_session_order ON world_approvals(session_id, created_at, approval_id);
CREATE INDEX IF NOT EXISTS world_approval_receipts_approval_order ON world_approval_receipts(approval_id, created_at, receipt_id);
${WORLD_INTEGRITY_TRIGGER_SQL.world_nodes_append_only_update}
${WORLD_INTEGRITY_TRIGGER_SQL.world_nodes_append_only_delete}
${WORLD_INTEGRITY_TRIGGER_SQL.world_edges_append_only_update}
${WORLD_INTEGRITY_TRIGGER_SQL.world_edges_append_only_delete}
CREATE TRIGGER IF NOT EXISTS world_location_events_append_only_update BEFORE UPDATE ON world_location_events BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TRIGGER IF NOT EXISTS world_location_events_append_only_delete BEFORE DELETE ON world_location_events BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TRIGGER IF NOT EXISTS world_action_receipts_append_only_update BEFORE UPDATE ON world_action_receipts BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TRIGGER IF NOT EXISTS world_action_receipts_append_only_delete BEFORE DELETE ON world_action_receipts BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TRIGGER IF NOT EXISTS world_approval_receipts_append_only_update BEFORE UPDATE ON world_approval_receipts BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TRIGGER IF NOT EXISTS world_approval_receipts_append_only_delete BEFORE DELETE ON world_approval_receipts BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
`;

function engagedColumn(row) {
  if (!row) return null;
  return row.engaged_fixture_id || row.engaged_station_id || null;
}
function fixtureName(id) { return String(id).replace(/^fixture\./, '').replace(/^workshop_/, '').replaceAll('_', ' '); }

export class WorldGraphStore {
  constructor(path, { now = () => Date.now(), eventFailureInjector = null } = {}) {
    mkdirSync(dirname(path), { recursive: true });
    this.path = path;
    this.nowMs = now;
    this.eventFailureInjector = eventFailureInjector;
    this.sqlite = new DatabaseSync(path);
    this.sqlite.exec('PRAGMA foreign_keys=ON;');
    const hadWorldSchema = Boolean(this.sqlite.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='world_nodes'").get());
    const hadJournalSchema = Boolean(this.sqlite.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='world_event_journal'").get());
    if (hadJournalSchema) return;
    try {
      this.sqlite.exec(SCHEMA);
      this.migrate({ migrateTopology: true });
      if (hadWorldSchema) this.canonicalizeLegacyLocationSchema();
      installWorldEventSchema(this.sqlite);
      if (hadWorldSchema) {
        this.seed();
        this.bootstrapLegacyBoundary();
      } else this.bootstrapFreshTopology();
    } catch (error) {
      this.sqlite.close();
      throw error;
    }
  }
  migrate({ migrateTopology = true } = {}) {
    const columns = this.sqlite.prepare('PRAGMA table_info(world_action_receipts)').all().map(column => column.name);
    if (!columns.includes('request_record_id')) this.sqlite.exec('ALTER TABLE world_action_receipts ADD COLUMN request_record_id TEXT');
    if (!columns.includes('spine_record_id')) this.sqlite.exec('ALTER TABLE world_action_receipts ADD COLUMN spine_record_id TEXT');
    const locationColumns = this.sqlite.prepare('PRAGMA table_info(world_locations)').all().map(column => column.name);
    if (!locationColumns.includes('engaged_station_id') && !locationColumns.includes('engaged_fixture_id')) {
      this.sqlite.exec('ALTER TABLE world_locations ADD COLUMN engaged_fixture_id TEXT REFERENCES world_nodes(id)');
    } else if (!locationColumns.includes('engaged_fixture_id')) {
      this.sqlite.exec('ALTER TABLE world_locations ADD COLUMN engaged_fixture_id TEXT REFERENCES world_nodes(id)');
      if (migrateTopology) this.sqlite.exec('UPDATE world_locations SET engaged_fixture_id=engaged_station_id WHERE engaged_fixture_id IS NULL AND engaged_station_id IS NOT NULL');
    }
    const nodeSql = this.sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='world_nodes'").get()?.sql || '';
    if (migrateTopology && nodeSql && !nodeSql.includes("'station'")) this.rebuildNodesForStations();
    const approvalSql = this.sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='world_approvals'").get()?.sql || '';
    if (approvalSql && (!approvalSql.includes('unified_diff') || !approvalSql.includes('sandbox_promotion'))) this.rebuildApprovalsKinds();
    this.sqlite.exec('CREATE TABLE IF NOT EXISTS world_fixture_runtime (fixture_id TEXT PRIMARY KEY, state_json TEXT NOT NULL, updated_at TEXT NOT NULL)');
    this.sqlite.exec('CREATE TABLE IF NOT EXISTS world_timers (session_id TEXT PRIMARY KEY, seconds INTEGER NOT NULL CHECK(seconds>=1 AND seconds<=3600), due_at TEXT NOT NULL, created_at TEXT NOT NULL)');
    this.sqlite.exec("CREATE TABLE IF NOT EXISTS world_approval_receipts (receipt_id TEXT PRIMARY KEY, approval_id TEXT NOT NULL REFERENCES world_approvals(approval_id), session_id TEXT NOT NULL, wake_id TEXT, phase TEXT NOT NULL CHECK(phase IN ('pending','confirmed','rejected','cancelled')), action_receipt_id TEXT NOT NULL REFERENCES world_action_receipts(receipt_id), result_json TEXT NOT NULL, host_return_scrub_json TEXT NOT NULL, created_at TEXT NOT NULL)");
    this.sqlite.exec('CREATE INDEX IF NOT EXISTS world_approval_receipts_approval_order ON world_approval_receipts(approval_id, created_at, receipt_id)');
    this.sqlite.exec("CREATE TRIGGER IF NOT EXISTS world_approval_receipts_append_only_update BEFORE UPDATE ON world_approval_receipts BEGIN SELECT RAISE(ABORT, 'append-only table'); END;");
    this.sqlite.exec("CREATE TRIGGER IF NOT EXISTS world_approval_receipts_append_only_delete BEFORE DELETE ON world_approval_receipts BEGIN SELECT RAISE(ABORT, 'append-only table'); END;");
    if (migrateTopology) this.migrateWorkshopFixtures();
  }
  canonicalizeLegacyLocationSchema() {
    const columns = this.sqlite.prepare('PRAGMA table_info(world_locations)').all().map(column => column.name);
    const installed = new Set(LOCATION_COLUMNS); const extras = columns.filter(column => !installed.has(column));
    const source = new Set(columns);
    const expectedPresentOrder = LOCATION_COLUMNS.filter(column => source.has(column));
    if (!extras.length && columns.length === expectedPresentOrder.length && columns.every((column, index) => column === expectedPresentOrder[index])) return;
    const engaged = source.has('engaged_fixture_id') ? 'engaged_fixture_id' : source.has('engaged_station_id') ? 'engaged_station_id' : 'NULL';
    const lastSequence = source.has('last_event_sequence') ? 'last_event_sequence' : 'NULL';
    const lastHash = source.has('last_event_hash') ? 'last_event_hash' : 'NULL';
    const create = WORLD_PROJECTION_TABLE_SQL.world_locations.replace('CREATE TABLE IF NOT EXISTS world_locations', 'CREATE TABLE world_locations_a1');
    this.sqlite.exec('PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE;');
    try {
      this.sqlite.exec(create);
      this.sqlite.exec(`INSERT INTO world_locations_a1(${LOCATION_COLUMNS.join(',')}) SELECT session_id,room_node_id,inspected_source,${engaged},revision,started_at,updated_at,${lastSequence},${lastHash} FROM world_locations`);
      this.sqlite.exec('DROP TABLE world_locations; ALTER TABLE world_locations_a1 RENAME TO world_locations; COMMIT;');
    } catch (error) {
      try { this.sqlite.exec('ROLLBACK;'); } catch {}
      throw error;
    } finally { this.sqlite.exec('PRAGMA foreign_keys=ON;'); }
  }
  rebuildApprovalsKinds() {
    this.sqlite.exec('PRAGMA foreign_keys=OFF;');
    this.sqlite.exec(`
CREATE TABLE world_approvals_v2 (approval_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, wake_id TEXT, kind TEXT NOT NULL CHECK(kind IN ('patch','unified_diff','write_file','create_path','delete_path','rename_path','git_add','commit','git_checkout','sandbox_promotion')), status TEXT NOT NULL CHECK(status IN ('pending','confirmed','rejected','cancelled')), payload_json TEXT NOT NULL, preview_json TEXT NOT NULL, outcome_json TEXT, created_at TEXT NOT NULL, decided_at TEXT);
INSERT INTO world_approvals_v2 SELECT * FROM world_approvals;
DROP TABLE world_approvals;
ALTER TABLE world_approvals_v2 RENAME TO world_approvals;
CREATE INDEX IF NOT EXISTS world_approvals_session_order ON world_approvals(session_id, created_at, approval_id);
`);
    this.sqlite.exec('PRAGMA foreign_keys=ON;');
  }
  rebuildNodesForStations() {
    this.sqlite.exec('PRAGMA foreign_keys=OFF;');
    this.sqlite.exec('DROP TRIGGER IF EXISTS world_nodes_append_only_update;');
    this.sqlite.exec('DROP TRIGGER IF EXISTS world_nodes_append_only_delete;');
    this.sqlite.exec(`
CREATE TABLE world_nodes_v2 (id TEXT PRIMARY KEY, node_type TEXT NOT NULL CHECK(node_type IN ('room','fixture','object','station')), resident_text TEXT NOT NULL, state_json TEXT NOT NULL, lifecycle TEXT NOT NULL CHECK(lifecycle IN ('standing','retired')), revision INTEGER NOT NULL CHECK(revision>0), created_at TEXT NOT NULL);
INSERT INTO world_nodes_v2 SELECT * FROM world_nodes;
DROP TABLE world_nodes;
ALTER TABLE world_nodes_v2 RENAME TO world_nodes;
${WORLD_INTEGRITY_TRIGGER_SQL.world_nodes_append_only_update}
${WORLD_INTEGRITY_TRIGGER_SQL.world_nodes_append_only_delete}
`);
    this.sqlite.exec('PRAGMA foreign_keys=ON;');
  }
  withNodeMutations(fn) {
    this.sqlite.exec('DROP TRIGGER IF EXISTS world_nodes_append_only_update;');
    this.sqlite.exec('DROP TRIGGER IF EXISTS world_nodes_append_only_delete;');
    try { return fn(); }
    finally {
      this.sqlite.exec(WORLD_INTEGRITY_TRIGGER_SQL.world_nodes_append_only_update);
      this.sqlite.exec(WORLD_INTEGRITY_TRIGGER_SQL.world_nodes_append_only_delete);
    }
  }
  migrateWorkshopFixtures() {
    const now = NOW();
    this.withNodeMutations(() => {
      for (const [nodeId, nodeType, text, state] of SEED_NODES) {
        const node = this.sqlite.prepare('SELECT * FROM world_nodes WHERE id=?').get(nodeId);
        const stateJson = canonicalize(state);
        if (node && (node.resident_text !== text || canonicalize(JSON.parse(node.state_json)) !== stateJson)) {
          this.sqlite.prepare('UPDATE world_nodes SET resident_text=?, state_json=?, revision=revision+1 WHERE id=?').run(text, stateJson, nodeId);
        }
      }
      for (const stationId of RETIRED_STATION_IDS) {
        const row = this.sqlite.prepare('SELECT * FROM world_nodes WHERE id=?').get(stationId);
        if (row && row.lifecycle === 'standing') {
          this.sqlite.prepare("UPDATE world_nodes SET lifecycle='retired', revision=revision+1 WHERE id=?").run(stationId);
        }
      }
    });
    const locationColumns = this.sqlite.prepare('PRAGMA table_info(world_locations)').all().map(column => column.name);
    for (const stationId of RETIRED_STATION_IDS) {
      const engaged = this.sqlite.prepare('SELECT session_id, engaged_fixture_id FROM world_locations').all()
        .filter(row => row.engaged_fixture_id === stationId || (locationColumns.includes('engaged_station_id') && this.sqlite.prepare('SELECT engaged_station_id FROM world_locations WHERE session_id=?').get(row.session_id)?.engaged_station_id === stationId));
      for (const row of engaged) {
        this.sqlite.prepare('UPDATE world_locations SET engaged_fixture_id=NULL, updated_at=? WHERE session_id=?').run(now, row.session_id);
        if (locationColumns.includes('engaged_station_id')) this.sqlite.prepare('UPDATE world_locations SET engaged_station_id=NULL WHERE session_id=?').run(row.session_id);
      }
    }
  }
  transaction(fn) { this.sqlite.exec('BEGIN IMMEDIATE'); try { const result = fn(); this.sqlite.exec('COMMIT'); return result; } catch (error) { try { this.sqlite.exec('ROLLBACK'); } catch {} throw error; } }
  eventHead() { return this.sqlite.prepare('SELECT sequence,event_hash FROM world_event_journal ORDER BY sequence DESC LIMIT 1').get() || null; }
  verification(options) { return verifyWorldSqlite(this.sqlite, options); }
  assertVerified() { return assertWorldVerified(this.sqlite); }
  _withTopologyProjectionWrites(fn) {
    for (const trigger of ['world_nodes_append_only_update', 'world_nodes_append_only_delete', 'world_edges_append_only_update', 'world_edges_append_only_delete']) this.sqlite.exec(`DROP TRIGGER IF EXISTS ${trigger}`);
    try { return fn(); }
    finally {
      this.sqlite.exec(WORLD_INTEGRITY_TRIGGER_SQL.world_nodes_append_only_update);
      this.sqlite.exec(WORLD_INTEGRITY_TRIGGER_SQL.world_nodes_append_only_delete);
      this.sqlite.exec(WORLD_INTEGRITY_TRIGGER_SQL.world_edges_append_only_update);
      this.sqlite.exec(WORLD_INTEGRITY_TRIGGER_SQL.world_edges_append_only_delete);
    }
  }
  _materializeProjection(state) {
    const nodePointerUpdates = []; const edgePointerUpdates = [];
    for (const row of state.nodes) {
      const existing = this.sqlite.prepare(`SELECT ${NODE_COLUMNS.join(',')} FROM world_nodes WHERE id=?`).get(row.id);
      if (!existing) this.sqlite.prepare(`INSERT INTO world_nodes(${NODE_COLUMNS.join(',')}) VALUES(${NODE_COLUMNS.map(() => '?').join(',')})`).run(...NODE_COLUMNS.map(column => row[column]));
      else {
        for (const column of NODE_COLUMNS.slice(0, -2)) if (existing[column] !== row[column]) throw new Error(`World node projection conflict for ${row.id}.${column}.`);
        if (existing.last_event_sequence !== row.last_event_sequence || existing.last_event_hash !== row.last_event_hash) nodePointerUpdates.push(row);
      }
    }
    for (const row of state.edges) {
      const existing = this.sqlite.prepare(`SELECT ${EDGE_COLUMNS.join(',')} FROM world_edges WHERE id=?`).get(row.id);
      if (!existing) this.sqlite.prepare(`INSERT INTO world_edges(${EDGE_COLUMNS.join(',')}) VALUES(${EDGE_COLUMNS.map(() => '?').join(',')})`).run(...EDGE_COLUMNS.map(column => row[column]));
      else {
        for (const column of EDGE_COLUMNS.slice(0, -2)) if (existing[column] !== row[column]) throw new Error(`World edge projection conflict for ${row.id}.${column}.`);
        if (existing.last_event_sequence !== row.last_event_sequence || existing.last_event_hash !== row.last_event_hash) edgePointerUpdates.push(row);
      }
    }
    if (nodePointerUpdates.length || edgePointerUpdates.length) this._withTopologyProjectionWrites(() => {
      for (const row of nodePointerUpdates) this.sqlite.prepare('UPDATE world_nodes SET last_event_sequence=?,last_event_hash=? WHERE id=?').run(row.last_event_sequence, row.last_event_hash, row.id);
      for (const row of edgePointerUpdates) this.sqlite.prepare('UPDATE world_edges SET last_event_sequence=?,last_event_hash=? WHERE id=?').run(row.last_event_sequence, row.last_event_hash, row.id);
    });
    for (const row of state.locations) {
      const existing = this.sqlite.prepare('SELECT 1 AS ok FROM world_locations WHERE session_id=?').get(row.session_id);
      if (!existing) this.sqlite.prepare(`INSERT INTO world_locations(${LOCATION_COLUMNS.join(',')}) VALUES(${LOCATION_COLUMNS.map(() => '?').join(',')})`).run(...LOCATION_COLUMNS.map(column => row[column]));
      else this.sqlite.prepare(`UPDATE world_locations SET ${LOCATION_COLUMNS.slice(1).map(column => `${column}=?`).join(',')} WHERE session_id=?`).run(...LOCATION_COLUMNS.slice(1).map(column => row[column]), row.session_id);
    }
  }
  _appendPhysicalEvent({ eventKind, aggregateKind, aggregateId, aggregateRevision, sessionId = null, wakeId = null, actor, commandId = null, causation = {}, payload, skipVerification = false, replayPrior = null, afterProjection = null }) {
    if (!skipVerification) this.assertVerified();
    const event = createWorldEvent({
      head: this.eventHead(), eventKind, aggregateKind, aggregateId, aggregateRevision, sessionId, wakeId,
      actor, commandId, causation, payload, occurredAt: new Date(this.nowMs()).toISOString(),
    });
    const prior = replayPrior || readWorldProjection(this.sqlite);
    const next = reduceWorldEvent(prior, event);
    this.transaction(() => {
      insertWorldEvent(this.sqlite, event);
      this.eventFailureInjector?.({ phase: 'after_event_append', event });
      this._materializeProjection(next);
      afterProjection?.(event);
      this.eventFailureInjector?.({ phase: 'after_projection_apply', event });
    });
    return event;
  }
  bootstrapFreshTopology() {
    this._appendPhysicalEvent({
      eventKind: 'topology.installed/v1', aggregateKind: 'topology', aggregateId: 'installed', aggregateRevision: 1,
      actor: 'world_bootstrap', causation: { boundary: 'fresh_database' }, payload: topologyEventPayload(), skipVerification: true, replayPrior: { nodes: [], edges: [], locations: [] },
    });
  }
  bootstrapLegacyBoundary() {
    const projection = readWorldProjection(this.sqlite);
    const installed = topologyEventPayload();
    const nodeById = new Map(projection.nodes.map(row => [row.id, row])); const edgeById = new Map(projection.edges.map(row => [row.id, row]));
    if (nodeById.size !== installed.nodes.length || edgeById.size !== installed.edges.length) throw Object.assign(new Error('Legacy World topology does not match the installed manifest.'), { code: 'world_legacy_topology_invalid' });
    for (const expected of installed.nodes) {
      const actual = nodeById.get(expected.id);
      if (!actual || actual.node_type !== expected.nodeType || actual.resident_text !== expected.residentText || actual.lifecycle !== expected.lifecycle || canonicalize(JSON.parse(actual.state_json)) !== canonicalize(expected.state)) {
        throw Object.assign(new Error(`Legacy World node does not match the installed manifest: ${expected.id}.`), { code: 'world_legacy_topology_invalid' });
      }
    }
    for (const expected of installed.edges) {
      const actual = edgeById.get(expected.id);
      if (!actual || actual.edge_type !== expected.edgeType || actual.from_node_id !== expected.fromNodeId || actual.to_node_id !== expected.toNodeId || actual.door_identity !== expected.doorIdentity || actual.label !== expected.label) {
        throw Object.assign(new Error(`Legacy World edge does not match the installed manifest: ${expected.id}.`), { code: 'world_legacy_topology_invalid' });
      }
    }
    const snapshot = {
      nodes: projection.nodes.map(row => Object.fromEntries(NODE_COLUMNS.slice(0, -2).map(column => [column, row[column]]))),
      edges: projection.edges.map(row => Object.fromEntries(EDGE_COLUMNS.slice(0, -2).map(column => [column, row[column]]))),
      locations: projection.locations.map(row => Object.fromEntries(LOCATION_COLUMNS.slice(0, -2).map(column => [column, row[column]]))),
    };
    this._appendPhysicalEvent({
      eventKind: 'legacy_snapshot.imported/v1', aggregateKind: 'world_snapshot', aggregateId: 'legacy_boundary', aggregateRevision: 1,
      actor: 'world_migration', causation: { boundary: 'pre_journal_projection' }, payload: { projectionSha256: sha256(canonicalize(snapshot)), ...snapshot },
      skipVerification: true, replayPrior: { nodes: [], edges: [], locations: [] },
    });
  }
  seed() {
    const now = NOW();
    this.transaction(() => {
      for (const [nodeId, nodeType, text, state] of SEED_NODES) {
        const existing = this.sqlite.prepare('SELECT * FROM world_nodes WHERE id=?').get(nodeId);
        if (existing && (existing.node_type !== nodeType || existing.resident_text !== text || canonicalize(JSON.parse(existing.state_json)) !== canonicalize(state))) throw new Error(`World seed conflict for ${nodeId}.`);
        if (!existing) this.sqlite.prepare('INSERT INTO world_nodes(id,node_type,resident_text,state_json,lifecycle,revision,created_at) VALUES(?,?,?,?,?,?,?)').run(nodeId, nodeType, text, canonicalize(state), 'standing', 1, now);
      }
      for (const stationId of RETIRED_STATION_IDS) {
        const existing = this.sqlite.prepare('SELECT * FROM world_nodes WHERE id=?').get(stationId);
        if (!existing) {
          const text = stationId === 'station.spec_table'
            ? 'Spec Table. Retired Workshop station.'
            : 'Control Panel. Retired Workshop station.';
          this.sqlite.prepare('INSERT INTO world_nodes(id,node_type,resident_text,state_json,lifecycle,revision,created_at) VALUES(?,?,?,?,?,?,?)').run(stationId, 'station', text, canonicalize({ station: stationId.split('.')[1], retired: true }), 'retired', 1, now);
        }
      }
      for (const [edgeId, type, from, to, door, label] of SEED_EDGES) {
        const existing = this.sqlite.prepare('SELECT * FROM world_edges WHERE id=?').get(edgeId);
        if (existing && (existing.edge_type !== type || existing.from_node_id !== from || existing.to_node_id !== to || (existing.door_identity || null) !== door)) throw new Error(`World seed conflict for ${edgeId}.`);
        if (!existing) this.sqlite.prepare('INSERT INTO world_edges(id,edge_type,from_node_id,to_node_id,door_identity,label,created_at) VALUES(?,?,?,?,?,?,?)').run(edgeId, type, from, to, door, label, now);
      }
    });
  }
  ensureLifespan(sessionId) {
    const existing = this.sqlite.prepare('SELECT * FROM world_locations WHERE session_id=?').get(sessionId);
    if (existing) { this.assertVerified(); return existing; }
    this._appendPhysicalEvent({
      eventKind: 'lifespan.started/v1', aggregateKind: 'lifespan', aggregateId: sessionId, aggregateRevision: 1,
      sessionId, actor: 'world_lifespan', causation: { reason: 'lifespan_initialized' }, payload: { roomNodeId: 'room.center' },
    });
    return this.sqlite.prepare('SELECT * FROM world_locations WHERE session_id=?').get(sessionId);
  }
  activateLifespan(sessionId, reason = 'lifespan_replaced') {
    this.assertVerified();
    const location = this.ensureLifespan(sessionId);
    const pending = this.sqlite.prepare("SELECT approval_id FROM world_approvals WHERE session_id<>? AND status='pending' ORDER BY created_at, approval_id").all(sessionId);
    if (pending.length) {
      this.sqlite.prepare("UPDATE world_approvals SET status='cancelled', outcome_json=?, decided_at=? WHERE session_id<>? AND status='pending'")
        .run(JSON.stringify({ reason }), NOW(), sessionId);
    }
    return { location, cancelledApprovalIds: pending.map(row => row.approval_id) };
  }
  current(sessionId) { const row = this.sqlite.prepare('SELECT * FROM world_locations WHERE session_id=?').get(sessionId); if (row) { this.assertVerified(); return row; } return this.ensureLifespan(sessionId); }
  node(nodeId) { return this.sqlite.prepare('SELECT * FROM world_nodes WHERE id=?').get(nodeId); }
  exits(roomId) { return this.sqlite.prepare("SELECT * FROM world_edges WHERE edge_type='door' AND from_node_id=? ORDER BY id").all(roomId); }
  fixtures(roomId) {
    return this.sqlite.prepare("SELECT n.* FROM world_nodes n JOIN world_edges e ON e.to_node_id=n.id WHERE e.edge_type='contains' AND e.from_node_id=? AND n.lifecycle='standing' ORDER BY n.id").all(roomId);
  }
  getFixtureRuntime(fixtureId) {
    const row = this.sqlite.prepare('SELECT * FROM world_fixture_runtime WHERE fixture_id=?').get(fixtureId);
    return row ? JSON.parse(row.state_json) : null;
  }
  setFixtureRuntime(fixtureId, state) {
    this.assertVerified();
    const now = NOW();
    const json = JSON.stringify(state);
    this.sqlite.prepare(`INSERT INTO world_fixture_runtime(fixture_id, state_json, updated_at) VALUES(?,?,?)
      ON CONFLICT(fixture_id) DO UPDATE SET state_json=excluded.state_json, updated_at=excluded.updated_at`).run(fixtureId, json, now);
    return state;
  }
  setTimer(sessionId, seconds) {
    this.assertVerified();
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > 3600) throw Object.assign(new Error('Timer seconds must be an integer from 1 to 3600.'), { code: 'workshop_invalid_argument' });
    this.ensureLifespan(sessionId);
    const createdAt = new Date(this.nowMs()).toISOString();
    const dueAt = new Date(this.nowMs() + seconds * 1000).toISOString();
    this.sqlite.prepare(`INSERT INTO world_timers(session_id, seconds, due_at, created_at) VALUES(?,?,?,?)
      ON CONFLICT(session_id) DO UPDATE SET seconds=excluded.seconds, due_at=excluded.due_at, created_at=excluded.created_at`)
      .run(sessionId, seconds, dueAt, createdAt);
    return this.getTimer(sessionId);
  }
  cancelTimer(sessionId) {
    this.assertVerified();
    const prior = this.getTimer(sessionId);
    this.sqlite.prepare('DELETE FROM world_timers WHERE session_id=?').run(sessionId);
    return { kind: 'workshop_timer_cancel', cancelled: prior.status !== 'none', prior };
  }
  getTimer(sessionId) {
    const row = this.sqlite.prepare('SELECT * FROM world_timers WHERE session_id=?').get(sessionId);
    if (!row) return { kind: 'workshop_timer_status', status: 'none', seconds: null, dueAt: null, remainingSeconds: null };
    const dueMs = Date.parse(row.due_at);
    const remainingMs = dueMs - this.nowMs();
    if (remainingMs <= 0) {
      return { kind: 'workshop_timer_status', status: 'fired', seconds: row.seconds, dueAt: row.due_at, remainingSeconds: 0 };
    }
    return {
      kind: 'workshop_timer_status',
      status: 'armed',
      seconds: row.seconds,
      dueAt: row.due_at,
      remainingSeconds: Math.ceil(remainingMs / 1000),
    };
  }
  heartbeat(sessionId) {
    const kiln = this.getFixtureRuntime(KILN_FIXTURE_ID) || { status: 'idle' };
    const timer = this.getTimer(sessionId);
    const parts = [];
    if (kiln.status && kiln.status !== 'idle') parts.push(`kiln ${kiln.status}${kiln.recipe ? `:${kiln.recipe}` : ''}`);
    if (timer.status === 'armed') parts.push(`timer ${timer.remainingSeconds}s`);
    if (timer.status === 'fired') parts.push('timer fired');
    return {
      kiln: { status: kiln.status || 'idle', recipe: kiln.recipe || null, code: kiln.code ?? null, reason: kiln.reason || null },
      timer,
      line: parts.length ? parts.join(' · ') : null,
    };
  }
  projection(sessionId) {
    const location = this.current(sessionId); const room = this.node(location.room_node_id);
    const pendingApprovals = this.listApprovals(sessionId, { pendingOnly: true }).length;
    const contained = this.fixtures(room.id).map(item => {
      const base = JSON.parse(item.state_json);
      const runtime = this.getFixtureRuntime(item.id);
      const state = runtime ? { ...base, ...runtime } : base;
      return {
        id: item.id,
        type: item.node_type,
        text: item.resident_text,
        state: item.id === 'fixture.workshop_workbench' ? { ...state, pendingApprovals } : state,
      };
    });
    const heartbeat = this.heartbeat(sessionId);
    return {
      revision: location.revision,
      roomId: room.id,
      roomType: room.node_type,
      text: room.resident_text,
      fixtures: contained.filter(item => item.type === 'fixture' || item.type === 'object'),
      engagedFixtureId: engagedColumn(location),
      exits: this.exits(room.id).map(edge => ({ edgeId: edge.id, doorId: edge.door_identity, label: edge.label, to: edge.to_node_id })),
      inspectedSource: location.inspected_source || null,
      pendingApprovals,
      heartbeat,
      mountProfile: mountProfile(room.id),
    };
  }
  availableTools(sessionId) {
    return mountedToolNames(this.current(sessionId).room_node_id);
  }
  presenceMessage(sessionId) {
    const projection = this.projection(sessionId);
    const exits = projection.exits.length ? projection.exits.map(exit => `${exit.label} (${exit.doorId})`).join(', ') : 'none';
    const fixtures = projection.fixtures.length
      ? projection.fixtures.map(item => {
        const kiln = item.id === KILN_FIXTURE_ID && item.state?.status && item.state.status !== 'idle'
          ? ` [${item.state.status}${item.state.recipe ? `:${item.state.recipe}` : ''}]`
          : '';
        return `${item.id}${kiln}`;
      }).join(', ')
      : 'none';
    const engageable = projection.fixtures.filter(item => item.state?.engageable)
      .map(item => `${fixtureName(item.id)} (${item.id})`).join(', ') || 'none';
    const pending = projection.pendingApprovals > 0 ? ' Work waiting on the workbench.' : '';
    const engaged = projection.engagedFixtureId || 'none';
    const beat = projection.heartbeat?.line ? ` Heartbeat: ${projection.heartbeat.line}.` : '';
    const workshopHonesty = projection.roomId === 'room.workshop' ? ' Workshop tools are mounted without engaging; engage is orientation only.' : '';
    const patched = ` ${profilePresenceLine(projection.roomId)}`;
    return `Current room: ${projection.roomId}. ${projection.text} Fixtures: ${fixtures}. Engageable: ${engageable}. Engaged: ${engaged}. Exits: ${exits}.${workshopHonesty}${patched}${pending}${beat}`;
  }
  move({ sessionId, wakeId, doorId, actor = 'resident_tool' }) {
    if (typeof doorId !== 'string' || !doorId) throw Object.assign(new Error('A door identity is required.'), { code: 'world_invalid_argument' });
    const current = this.current(sessionId); const edge = this.sqlite.prepare("SELECT * FROM world_edges WHERE edge_type='door' AND from_node_id=? AND door_identity=?").get(current.room_node_id, doorId);
    if (!edge) throw Object.assign(new Error('That door is not reachable from the current room.'), { code: 'world_wrong_room_or_door' });
    const leavingWorkshop = current.room_node_id === 'room.workshop' && edge.to_node_id !== 'room.workshop';
    const clearedFixture = leavingWorkshop ? engagedColumn(current) : null;
    const event = this._appendPhysicalEvent({
      eventKind: 'location.moved/v1', aggregateKind: 'lifespan', aggregateId: sessionId, aggregateRevision: current.revision + 1,
      sessionId, wakeId: wakeId || null, actor, causation: { doorIdentity: edge.door_identity, edgeId: edge.id },
      payload: { fromRoomId: current.room_node_id, toRoomId: edge.to_node_id, edgeId: edge.id, doorIdentity: edge.door_identity, clearedFixtureId: clearedFixture || null },
      afterProjection: journalEvent => {
        this.sqlite.prepare('INSERT INTO world_location_events VALUES(?,?,?,?,?,?,?,?,?,?)').run(journalEvent.event_id, sessionId, wakeId || null, actor, current.room_node_id, edge.to_node_id, edge.id, edge.door_identity, journalEvent.occurred_at, canonicalize({ actor, wakeId: wakeId || null, clearedFixtureId: clearedFixture || null }));
      },
    });
    return { eventId: event.event_id, worldEventSequence: event.sequence, worldEventHash: event.event_hash, edgeId: edge.id, doorId, fromRoom: current.room_node_id, toRoom: edge.to_node_id, clearedFixtureId: clearedFixture || null, projection: this.projection(sessionId) };
  }
  engageFixture({ sessionId, wakeId, fixtureId, actor = 'resident_tool' }) {
    if (typeof fixtureId !== 'string' || !fixtureId) throw Object.assign(new Error('A fixture identity is required.'), { code: 'world_invalid_argument' });
    const current = this.current(sessionId);
    if (current.room_node_id !== 'room.workshop') throw Object.assign(new Error('Fixtures are only engageable inside the Workshop.'), { code: 'world_wrong_room' });
    const fixture = this.node(fixtureId);
    if (!fixture || fixture.node_type !== 'fixture' || fixture.lifecycle !== 'standing') throw Object.assign(new Error('That fixture is not installed.'), { code: 'world_fixture_unknown' });
    const state = JSON.parse(fixture.state_json);
    if (!state.engageable) throw Object.assign(new Error('That fixture is not engageable.'), { code: 'world_fixture_not_engageable' });
    const contained = this.sqlite.prepare("SELECT 1 AS ok FROM world_edges WHERE edge_type='contains' AND from_node_id='room.workshop' AND to_node_id=?").get(fixtureId);
    if (!contained) throw Object.assign(new Error('That fixture is not contained by the Workshop.'), { code: 'world_fixture_unreachable' });
    const previous = engagedColumn(current);
    const event = this._appendPhysicalEvent({
      eventKind: 'fixture.engaged/v1', aggregateKind: 'lifespan', aggregateId: sessionId, aggregateRevision: current.revision + 1,
      sessionId, wakeId: wakeId || null, actor, causation: { action: 'engage_fixture' }, payload: { fixtureId, previousFixtureId: previous || null },
      afterProjection: journalEvent => {
        this.sqlite.prepare('INSERT INTO world_location_events VALUES(?,?,?,?,?,?,?,?,?,?)').run(journalEvent.event_id, sessionId, wakeId || null, actor, current.room_node_id, current.room_node_id, null, null, journalEvent.occurred_at, canonicalize({ actor, wakeId: wakeId || null, action: 'engage_fixture', fixtureId, previousFixtureId: previous }));
      },
    });
    return { eventId: event.event_id, worldEventSequence: event.sequence, worldEventHash: event.event_hash, fixtureId, previousFixtureId: previous, projection: this.projection(sessionId) };
  }
  inspectFixture({ sessionId, fixtureId }) {
    if (typeof fixtureId !== 'string' || !fixtureId) throw Object.assign(new Error('A fixture identity is required.'), { code: 'world_invalid_argument' });
    const current = this.current(sessionId);
    if (current.room_node_id !== 'room.workshop') throw Object.assign(new Error('Fixtures are only inspectable inside the Workshop.'), { code: 'world_wrong_room' });
    const fixture = this.node(fixtureId);
    if (!fixture || fixture.node_type !== 'fixture' || fixture.lifecycle !== 'standing') throw Object.assign(new Error('That fixture is not installed.'), { code: 'world_fixture_unknown' });
    const contained = this.sqlite.prepare("SELECT 1 AS ok FROM world_edges WHERE edge_type='contains' AND from_node_id='room.workshop' AND to_node_id=?").get(fixtureId);
    if (!contained) throw Object.assign(new Error('That fixture is not contained by the Workshop.'), { code: 'world_fixture_unreachable' });
    const base = JSON.parse(fixture.state_json);
    const runtime = this.getFixtureRuntime(fixtureId);
    const state = runtime ? { ...base, ...runtime } : base;
    return {
      kind: 'fixture_inspect',
      fixtureId,
      text: fixture.resident_text,
      state: fixtureId === 'fixture.workshop_workbench'
        ? { ...state, pendingApprovals: this.listApprovals(sessionId, { pendingOnly: true }).length }
        : state,
      projection: this.projection(sessionId),
    };
  }
  disengageFixture({ sessionId, wakeId, actor = 'resident_tool' }) {
    const current = this.current(sessionId);
    if (current.room_node_id !== 'room.workshop') throw Object.assign(new Error('Disengage is only lawful inside the Workshop.'), { code: 'world_wrong_room' });
    const previous = engagedColumn(current);
    if (!previous) throw Object.assign(new Error('No fixture is currently engaged.'), { code: 'world_not_engaged' });
    const event = this._appendPhysicalEvent({
      eventKind: 'fixture.disengaged/v1', aggregateKind: 'lifespan', aggregateId: sessionId, aggregateRevision: current.revision + 1,
      sessionId, wakeId: wakeId || null, actor, causation: { action: 'disengage_fixture' }, payload: { fixtureId: previous },
      afterProjection: journalEvent => {
        this.sqlite.prepare('INSERT INTO world_location_events VALUES(?,?,?,?,?,?,?,?,?,?)').run(journalEvent.event_id, sessionId, wakeId || null, actor, current.room_node_id, current.room_node_id, null, null, journalEvent.occurred_at, canonicalize({ actor, wakeId: wakeId || null, action: 'disengage_fixture', previousFixtureId: previous }));
      },
    });
    return { eventId: event.event_id, worldEventSequence: event.sequence, worldEventHash: event.event_hash, previousFixtureId: previous, projection: this.projection(sessionId) };
  }
  /** @deprecated */
  engageStation(args) { return this.engageFixture({ ...args, fixtureId: args.stationId }); }
  /** @deprecated */
  disengageStation(args) { return this.disengageFixture(args); }
  inspect(sessionId, source) {
    const current = this.current(sessionId);
    const event = this._appendPhysicalEvent({
      eventKind: 'source.inspected/v1', aggregateKind: 'lifespan', aggregateId: sessionId, aggregateRevision: current.revision + 1,
      sessionId, actor: 'resident_tool', causation: { action: 'inspect_source' }, payload: { source: source || null },
    });
    return { eventId: event.event_id, source: source || null };
  }
  actionReceipt({ sessionId, wakeId, roomNodeId, toolName, arguments: args, result, outcome, requestRecordId = null, spineRecordId = null }) { this.assertVerified(); const receiptId = id('action'); this.sqlite.prepare('INSERT INTO world_action_receipts(receipt_id,session_id,wake_id,room_node_id,tool_name,arguments_json,result_json,outcome,request_record_id,spine_record_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(receiptId, sessionId, wakeId || null, roomNodeId, toolName, JSON.stringify(args), JSON.stringify(result), outcome, requestRecordId, spineRecordId, NOW()); return { receiptId, requestRecordId, spineRecordId }; }
  upsertBrief({ sessionId, objective, scopePaths = [], acceptance = [], nonGoals = [] }) {
    this.assertVerified();
    if (typeof objective !== 'string' || !objective.trim() || objective.length > 2000) throw Object.assign(new Error('Work brief objective is invalid.'), { code: 'workshop_invalid_argument' });
    if (!Array.isArray(scopePaths) || scopePaths.length > 40 || scopePaths.some(item => typeof item !== 'string' || !item || item.length > 260)) throw Object.assign(new Error('Work brief scope paths are invalid.'), { code: 'workshop_invalid_argument' });
    if (!Array.isArray(acceptance) || acceptance.length > 20 || acceptance.some(item => typeof item !== 'string' || !item || item.length > 400)) throw Object.assign(new Error('Work brief acceptance checks are invalid.'), { code: 'workshop_invalid_argument' });
    if (!Array.isArray(nonGoals) || nonGoals.length > 20 || nonGoals.some(item => typeof item !== 'string' || !item || item.length > 400)) throw Object.assign(new Error('Work brief non-goals are invalid.'), { code: 'workshop_invalid_argument' });
    const now = NOW();
    const fieldHashes = { objective: sha256(objective), scopePaths: sha256(JSON.stringify(scopePaths)), acceptance: sha256(JSON.stringify(acceptance)), nonGoals: sha256(JSON.stringify(nonGoals)) };
    const existing = this.sqlite.prepare('SELECT * FROM world_work_briefs WHERE session_id=? ORDER BY revision DESC LIMIT 1').get(sessionId);
    if (existing) {
      const revision = existing.revision + 1;
      this.sqlite.prepare('UPDATE world_work_briefs SET revision=?, objective=?, scope_paths_json=?, acceptance_json=?, non_goals_json=?, field_hashes_json=?, updated_at=? WHERE brief_id=?')
        .run(revision, objective, JSON.stringify(scopePaths), JSON.stringify(acceptance), JSON.stringify(nonGoals), JSON.stringify(fieldHashes), now, existing.brief_id);
      return this.getBrief(sessionId);
    }
    const briefId = id('brief');
    this.sqlite.prepare('INSERT INTO world_work_briefs VALUES(?,?,?,?,?,?,?,?,?,?)').run(briefId, sessionId, 1, objective, JSON.stringify(scopePaths), JSON.stringify(acceptance), JSON.stringify(nonGoals), JSON.stringify(fieldHashes), now, now);
    return this.getBrief(sessionId);
  }
  getBrief(sessionId) {
    const row = this.sqlite.prepare('SELECT * FROM world_work_briefs WHERE session_id=? ORDER BY revision DESC LIMIT 1').get(sessionId);
    if (!row) return { kind: 'workshop_brief', present: false };
    return {
      kind: 'workshop_brief',
      present: true,
      briefId: row.brief_id,
      revision: row.revision,
      objective: row.objective,
      scopePaths: JSON.parse(row.scope_paths_json),
      acceptance: JSON.parse(row.acceptance_json),
      nonGoals: JSON.parse(row.non_goals_json),
      fieldHashes: JSON.parse(row.field_hashes_json),
      updatedAt: row.updated_at,
    };
  }
  createApproval({ sessionId, wakeId, kind, payload, preview }) {
    this.assertVerified();
    const approvalId = id('approval');
    this.sqlite.prepare('INSERT INTO world_approvals VALUES(?,?,?,?,?,?,?,?,?,?)').run(approvalId, sessionId, wakeId || null, kind, 'pending', JSON.stringify(payload), JSON.stringify(preview), null, NOW(), null);
    return this.getApproval(approvalId);
  }
  getApproval(approvalId) {
    const row = this.sqlite.prepare('SELECT * FROM world_approvals WHERE approval_id=?').get(approvalId);
    if (!row) return null;
    return {
      approvalId: row.approval_id,
      sessionId: row.session_id,
      wakeId: row.wake_id,
      kind: row.kind,
      status: row.status,
      payload: JSON.parse(row.payload_json),
      preview: JSON.parse(row.preview_json),
      outcome: row.outcome_json ? JSON.parse(row.outcome_json) : null,
      createdAt: row.created_at,
      decidedAt: row.decided_at,
    };
  }
  listApprovals(sessionId, { pendingOnly = false } = {}) {
    const rows = pendingOnly
      ? this.sqlite.prepare("SELECT * FROM world_approvals WHERE session_id=? AND status='pending' ORDER BY created_at, approval_id").all(sessionId)
      : this.sqlite.prepare('SELECT * FROM world_approvals WHERE session_id=? ORDER BY created_at, approval_id').all(sessionId);
    return rows.map(row => this.getApproval(row.approval_id));
  }
  decideApproval(approvalId, decision, outcome = null) {
    this.assertVerified();
    const row = this.getApproval(approvalId);
    if (!row) throw Object.assign(new Error('Approval not found.'), { code: 'workshop_approval_not_found' });
    if (row.status !== 'pending') throw Object.assign(new Error('Approval is no longer pending.'), { code: 'workshop_approval_not_pending' });
    if (decision !== 'confirm' && decision !== 'reject') throw Object.assign(new Error('Approval decision must be confirm or reject.'), { code: 'workshop_invalid_argument' });
    const status = decision === 'confirm' ? 'confirmed' : 'rejected';
    this.sqlite.prepare('UPDATE world_approvals SET status=?, outcome_json=?, decided_at=? WHERE approval_id=?').run(status, outcome ? JSON.stringify(outcome) : null, NOW(), approvalId);
    return this.getApproval(approvalId);
  }
  cancelPendingApprovals(sessionId, reason) {
    this.assertVerified();
    const pending = this.listApprovals(sessionId, { pendingOnly: true });
    for (const item of pending) {
      this.sqlite.prepare("UPDATE world_approvals SET status='cancelled', outcome_json=?, decided_at=? WHERE approval_id=?").run(JSON.stringify({ reason }), NOW(), item.approvalId);
    }
    return pending.map(item => item.approvalId);
  }
  recordApprovalReceipt({ approvalId, phase, actionReceiptId, result, hostReturnScrub }) {
    this.assertVerified();
    const approval = this.getApproval(approvalId);
    if (!approval) throw Object.assign(new Error('Approval not found.'), { code: 'workshop_approval_not_found' });
    if (!['pending', 'confirmed', 'rejected', 'cancelled'].includes(phase)) throw Object.assign(new Error('Approval receipt phase is invalid.'), { code: 'workshop_invalid_argument' });
    const scrub = hostReturnScrub?.receipt ? hostReturnScrub.receipt : hostReturnScrub;
    if (!scrub || typeof scrub.receiptId !== 'string') throw Object.assign(new Error('Approval completion requires a host-return Scrub receipt.'), { code: 'host_return_scrub_invalid' });
    const receiptId = id('approval_receipt');
    this.sqlite.prepare('INSERT INTO world_approval_receipts(receipt_id,approval_id,session_id,wake_id,phase,action_receipt_id,result_json,host_return_scrub_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(receiptId, approvalId, approval.sessionId, approval.wakeId || null, phase, actionReceiptId, JSON.stringify(result), JSON.stringify(scrub), NOW());
    return { receiptId, approvalId, phase, actionReceiptId, hostReturnScrubReceiptId: scrub.receiptId };
  }
  listApprovalReceipts(approvalId) {
    return this.sqlite.prepare('SELECT receipt_id AS receiptId, approval_id AS approvalId, session_id AS sessionId, wake_id AS wakeId, phase, action_receipt_id AS actionReceiptId, result_json AS resultJson, host_return_scrub_json AS hostReturnScrubJson, created_at AS createdAt FROM world_approval_receipts WHERE approval_id=? ORDER BY created_at, receipt_id').all(approvalId)
      .map(row => ({ ...row, result: JSON.parse(row.resultJson), hostReturnScrub: JSON.parse(row.hostReturnScrubJson) }));
  }
  listLocationEvents(sessionId) { return this.sqlite.prepare('SELECT * FROM world_location_events WHERE session_id=? ORDER BY created_at,event_id').all(sessionId); }
  close() { this.sqlite.close(); }
}

export function seedWorldGraph(path) { const store = new WorldGraphStore(path); const result = { nodes: store.sqlite.prepare('SELECT COUNT(*) AS count FROM world_nodes').get().count, edges: store.sqlite.prepare('SELECT COUNT(*) AS count FROM world_edges').get().count }; store.close(); return result; }

export { assertWorkshopRepositoryPath, resolveRepositoryPath } from '../workshop/path-law.js';
