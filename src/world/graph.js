import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { canonicalize, id, sha256 } from '../core/hash.js';
import { mountProfile, mountedToolNames, profilePresenceLine } from './ceiling.js';
import { INSTALLED_WORLD_EDGES, INSTALLED_WORLD_NODES, topologyEventPayload } from './topology.js';
import { topologyExtensionEventPayload } from './topology-b1.js';
import { hearthTopologyEventPayload } from './topology-hearth.js';
import { forestTopologyEventPayload } from './topology-forest.js';
import { binderWindowTopologyEventPayload } from './topology-binder-window.js';
import { spotlightTopologyEventPayload } from './topology-spotlight.js';
import {
  ACTION_RECEIPT_COLUMNS, APPROVAL_COLUMNS, APPROVAL_RECEIPT_COLUMNS, BRIEF_COLUMNS, EDGE_COLUMNS, FIXTURE_RUNTIME_COLUMNS,
  LOCATION_COLUMNS, NODE_COLUMNS, OBJECT_STATE_COLUMNS, PASSAGE_COLUMNS, TIMER_COLUMNS, assertWorldVerified, createWorldEvent, custodyRowHash, emptyWorldState,
  insertWorldEvent, installWorldEventSchema, readWorldPhysicalProjection, readWorldProjection, reduceWorldEvent, replayWorldEvents, verifyWorldA1Sqlite, verifyWorldA2Sqlite, verifyWorldSqlite,
  WORLD_A2_PROJECTION_TABLE_SQL, WORLD_CUSTODY_TABLE_SQL, WORLD_INTEGRITY_TRIGGER_SQL, WORLD_PROJECTION_TABLE_SQL,
} from './events.js';

const NOW = () => new Date().toISOString();

export const WORKSHOP_ROOM_TEXT = 'The Workshop. Shelves hold the repository close to a scarred workbench; a kiln, ledger, and clipboard keep their separate places. Tools are mounted here without engaging; engagement is orientation only.';
const WORKSHOP_PRESENCE_TEXT = 'The Workshop. Shelves hold the repository close to a scarred workbench; a kiln, ledger, and clipboard keep their separate places. One fixture may be brought into working focus at a time; choosing another moves focus directly.';
export const KILN_FIXTURE_ID = 'fixture.workshop_kiln';

const SEED_NODES = INSTALLED_WORLD_NODES.filter(([, nodeType]) => nodeType !== 'station');
const SEED_EDGES = INSTALLED_WORLD_EDGES;

const RETIRED_STATION_IDS = ['station.spec_table', 'station.control_panel'];

const LEGACY_A1_OPERATIONAL_TABLE_SQL = Object.freeze({
  world_fixture_runtime: 'CREATE TABLE world_fixture_runtime (fixture_id TEXT PRIMARY KEY, state_json TEXT NOT NULL, updated_at TEXT NOT NULL)',
  world_timers: 'CREATE TABLE world_timers (session_id TEXT PRIMARY KEY, seconds INTEGER NOT NULL CHECK(seconds>=1 AND seconds<=3600), due_at TEXT NOT NULL, created_at TEXT NOT NULL)',
  world_work_briefs: 'CREATE TABLE world_work_briefs (brief_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0), objective TEXT NOT NULL, scope_paths_json TEXT NOT NULL, acceptance_json TEXT NOT NULL, non_goals_json TEXT NOT NULL, field_hashes_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)',
  world_approvals: "CREATE TABLE world_approvals (approval_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, wake_id TEXT, kind TEXT NOT NULL CHECK(kind IN ('patch','unified_diff','write_file','create_path','delete_path','rename_path','git_add','commit','git_checkout','sandbox_promotion')), status TEXT NOT NULL CHECK(status IN ('pending','confirmed','rejected','cancelled')), payload_json TEXT NOT NULL, preview_json TEXT NOT NULL, outcome_json TEXT, created_at TEXT NOT NULL, decided_at TEXT)",
  world_action_receipts: "CREATE TABLE world_action_receipts (receipt_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, wake_id TEXT, room_node_id TEXT NOT NULL REFERENCES world_nodes(id), tool_name TEXT NOT NULL, arguments_json TEXT NOT NULL, result_json TEXT NOT NULL, outcome TEXT NOT NULL CHECK(outcome IN ('committed','refused')), request_record_id TEXT, spine_record_id TEXT, created_at TEXT NOT NULL)",
  world_approval_receipts: "CREATE TABLE world_approval_receipts (receipt_id TEXT PRIMARY KEY, approval_id TEXT NOT NULL REFERENCES world_approvals(approval_id), session_id TEXT NOT NULL, wake_id TEXT, phase TEXT NOT NULL CHECK(phase IN ('pending','confirmed','rejected','cancelled')), action_receipt_id TEXT NOT NULL REFERENCES world_action_receipts(receipt_id), result_json TEXT NOT NULL, host_return_scrub_json TEXT NOT NULL, created_at TEXT NOT NULL)",
});

function normalizeSchemaSql(sql) {
  return String(sql || '').toLowerCase().replace(/create\s+table\s+if\s+not\s+exists/, 'create table').replace(/["`\[\]]/g, '').replace(/\s+/g, '').replace(/;+$/g, '');
}
function normalizeTriggerSql(sql) {
  return String(sql || '').toLowerCase().replace(/create\s+trigger\s+if\s+not\s+exists/, 'create trigger').replace(/\s+/g, '').replace(/;+$/g, '');
}

const SCHEMA = `
${WORLD_PROJECTION_TABLE_SQL.world_nodes}
${WORLD_PROJECTION_TABLE_SQL.world_edges}
${WORLD_PROJECTION_TABLE_SQL.world_locations}
CREATE TABLE IF NOT EXISTS world_location_events (event_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, wake_id TEXT, actor TEXT NOT NULL, from_room TEXT REFERENCES world_nodes(id), to_room TEXT NOT NULL REFERENCES world_nodes(id), edge_id TEXT REFERENCES world_edges(id), door_identity TEXT, created_at TEXT NOT NULL, attribution_json TEXT NOT NULL);
${WORLD_CUSTODY_TABLE_SQL.world_action_receipts}
${WORLD_PROJECTION_TABLE_SQL.world_work_briefs}
${WORLD_PROJECTION_TABLE_SQL.world_approvals}
${WORLD_CUSTODY_TABLE_SQL.world_approval_receipts}
${WORLD_PROJECTION_TABLE_SQL.world_fixture_runtime}
${WORLD_PROJECTION_TABLE_SQL.world_timers}
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
${WORLD_INTEGRITY_TRIGGER_SQL.world_action_receipts_append_only_update}
${WORLD_INTEGRITY_TRIGGER_SQL.world_action_receipts_append_only_delete}
${WORLD_INTEGRITY_TRIGGER_SQL.world_approval_receipts_append_only_update}
${WORLD_INTEGRITY_TRIGGER_SQL.world_approval_receipts_append_only_delete}
`;

function engagedColumn(row) {
  if (!row) return null;
  return row.engaged_fixture_id || row.engaged_station_id || null;
}
function fixtureName(id) { return String(id).replace(/^fixture\./, '').replace(/^workshop_/, '').replaceAll('_', ' '); }

export class WorldGraphStore {
  constructor(path, { now = () => Date.now(), eventFailureInjector = null, topologyVersion = 'hearth' } = {}) {
    if (!['b1', 'hearth', 'forest', 'binder_window', 'spotlight'].includes(topologyVersion)) throw new Error('World topology version is invalid.');
    mkdirSync(dirname(path), { recursive: true });
    this.path = path;
    this.nowMs = now;
    this.eventFailureInjector = eventFailureInjector;
    this.topologyVersion = topologyVersion;
    this.transactionDepth = 0;
    this.transactionNeedsVerification = false;
    // Lifespan-scoped presentation state. Exact Hearth custody remains in the
    // Ledger; this map only lets the current World show the settled affordance.
    this.hearthSettlements = new Map();
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
        this._migrateA2Boundary({ requireBoundary: true });
        this.#migrateB1Boundary({ admittedLegacy: true });
        if (['hearth', 'forest', 'binder_window', 'spotlight'].includes(this.topologyVersion)) this.#bootstrapHearthExtension('world_migration');
        if (['forest', 'binder_window', 'spotlight'].includes(this.topologyVersion)) this.#bootstrapForestExtension('world_migration');
        if (['binder_window', 'spotlight'].includes(this.topologyVersion)) this.#bootstrapBinderWindowExtension('world_migration');
        if (this.topologyVersion === 'spotlight') this.#bootstrapSpotlightExtension('world_migration');
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
  transaction(fn, { verify = false } = {}) {
    if (this.transactionDepth > 0) {
      if (verify) this.transactionNeedsVerification = true;
      return fn();
    }
    if (verify) assertWorldVerified(this.sqlite, { requireHearth: this.topologyVersion !== 'b1', requireForest: ['forest', 'binder_window', 'spotlight'].includes(this.topologyVersion), requireBinderWindow: ['binder_window', 'spotlight'].includes(this.topologyVersion), requireSpotlight: this.topologyVersion === 'spotlight' });
    this.sqlite.exec('BEGIN IMMEDIATE'); this.transactionDepth += 1;
    this.transactionNeedsVerification = verify;
    try {
      const result = fn();
      if (this.transactionNeedsVerification) assertWorldVerified(this.sqlite, { requireHearth: this.topologyVersion !== 'b1', requireForest: ['forest', 'binder_window', 'spotlight'].includes(this.topologyVersion), requireBinderWindow: ['binder_window', 'spotlight'].includes(this.topologyVersion), requireSpotlight: this.topologyVersion === 'spotlight' });
      this.sqlite.exec('COMMIT');
      return result;
    } catch (error) {
      try { this.sqlite.exec('ROLLBACK'); } catch {}
      throw error;
    } finally { this.transactionDepth -= 1; this.transactionNeedsVerification = false; }
  }
  eventHead() { return this.sqlite.prepare('SELECT sequence,event_hash FROM world_event_journal ORDER BY sequence DESC LIMIT 1').get() || null; }
  appendRoomInstallationRevisionEvent({ payload, afterEvent = null } = {}) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw Object.assign(new Error('Room installation revision payload is required.'), { code: 'room_installation_revision_invalid' });
    this.assertVerified();
    const existing = this.sqlite.prepare("SELECT * FROM world_event_journal WHERE event_kind='room.installation.revised/v1' AND aggregate_kind='room_installation' AND aggregate_id='room.workshop' ORDER BY aggregate_revision DESC LIMIT 1").get();
    if (existing) {
      let existingPayload;
      try { existingPayload = JSON.parse(existing.payload_json); } catch { throw Object.assign(new Error('Existing room installation revision payload is invalid.'), { code: 'room_installation_revision_conflict' }); }
      if (canonicalize(existingPayload) !== canonicalize(payload)) throw Object.assign(new Error('Conflicting Workshop installation revision event already exists.'), { code: 'room_installation_revision_conflict' });
      return { status: 'current', event: existing };
    }
    const head = this.eventHead();
    const event = this._appendPhysicalEvent({
      eventKind: 'room.installation.revised/v1', aggregateKind: 'room_installation', aggregateId: 'room.workshop', aggregateRevision: this.aggregateRevision('room_installation', 'room.workshop') + 1,
      actor: 'world_migration', causation: { boundary: 'room_installation_revision_v1', physicalHeadHash: head?.event_hash || null, physicalHeadSequence: head?.sequence || 0 },
      payload, replayPrior: replayWorldEvents(this.sqlite), afterProjection: afterEvent,
    });
    return { status: 'migrated', event };
  }
  aggregateRevision(aggregateKind, aggregateId, projectionRevision = 0) {
    const row = this.sqlite.prepare('SELECT MAX(aggregate_revision) AS revision FROM world_event_journal WHERE aggregate_kind=? AND aggregate_id=?').get(aggregateKind, aggregateId);
    return Math.max(row?.revision || 0, projectionRevision || 0);
  }
  verification(options = {}) { return verifyWorldSqlite(this.sqlite, { requireHearth: this.topologyVersion !== 'b1', requireForest: ['forest', 'binder_window', 'spotlight'].includes(this.topologyVersion), requireBinderWindow: ['binder_window', 'spotlight'].includes(this.topologyVersion), requireSpotlight: this.topologyVersion === 'spotlight', ...options }); }
  assertVerified() { return this.transactionDepth > 0 ? { verified: true, deferred: true } : assertWorldVerified(this.sqlite, { requireHearth: this.topologyVersion !== 'b1', requireForest: ['forest', 'binder_window', 'spotlight'].includes(this.topologyVersion), requireBinderWindow: ['binder_window', 'spotlight'].includes(this.topologyVersion), requireSpotlight: this.topologyVersion === 'spotlight' }); }
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
  _materializeProjection(state, prior = emptyWorldState()) {
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
    for (const row of state.fixtureRuntimes) {
      const existing = this.sqlite.prepare('SELECT 1 AS ok FROM world_fixture_runtime WHERE fixture_id=?').get(row.fixture_id);
      if (!existing) this.sqlite.prepare(`INSERT INTO world_fixture_runtime(${FIXTURE_RUNTIME_COLUMNS.join(',')}) VALUES(${FIXTURE_RUNTIME_COLUMNS.map(() => '?').join(',')})`).run(...FIXTURE_RUNTIME_COLUMNS.map(column => row[column]));
      else this.sqlite.prepare(`UPDATE world_fixture_runtime SET ${FIXTURE_RUNTIME_COLUMNS.slice(1).map(column => `${column}=?`).join(',')} WHERE fixture_id=?`).run(...FIXTURE_RUNTIME_COLUMNS.slice(1).map(column => row[column]), row.fixture_id);
    }
    for (const row of state.timers) {
      const existing = this.sqlite.prepare('SELECT 1 AS ok FROM world_timers WHERE session_id=?').get(row.session_id);
      if (!existing) this.sqlite.prepare(`INSERT INTO world_timers(${TIMER_COLUMNS.join(',')}) VALUES(${TIMER_COLUMNS.map(() => '?').join(',')})`).run(...TIMER_COLUMNS.map(column => row[column]));
      else this.sqlite.prepare(`UPDATE world_timers SET ${TIMER_COLUMNS.slice(1).map(column => `${column}=?`).join(',')} WHERE session_id=?`).run(...TIMER_COLUMNS.slice(1).map(column => row[column]), row.session_id);
    }
    const timerIds = new Set(state.timers.map(row => row.session_id));
    for (const row of prior.timers || []) if (!timerIds.has(row.session_id)) this.sqlite.prepare('DELETE FROM world_timers WHERE session_id=?').run(row.session_id);
    for (const row of state.briefs) {
      const existing = this.sqlite.prepare('SELECT 1 AS ok FROM world_work_briefs WHERE session_id=? AND revision=?').get(row.session_id, row.revision);
      if (!existing) this.sqlite.prepare(`INSERT INTO world_work_briefs(${BRIEF_COLUMNS.join(',')}) VALUES(${BRIEF_COLUMNS.map(() => '?').join(',')})`).run(...BRIEF_COLUMNS.map(column => row[column]));
    }
    for (const row of state.approvals) {
      const existing = this.sqlite.prepare('SELECT 1 AS ok FROM world_approvals WHERE approval_id=?').get(row.approval_id);
      if (!existing) this.sqlite.prepare(`INSERT INTO world_approvals(${APPROVAL_COLUMNS.join(',')}) VALUES(${APPROVAL_COLUMNS.map(() => '?').join(',')})`).run(...APPROVAL_COLUMNS.map(column => row[column]));
      else this.sqlite.prepare(`UPDATE world_approvals SET ${APPROVAL_COLUMNS.slice(1).map(column => `${column}=?`).join(',')} WHERE approval_id=?`).run(...APPROVAL_COLUMNS.slice(1).map(column => row[column]), row.approval_id);
    }
    const hasB1Projection = Boolean(this.sqlite.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='world_passages'").get());
    for (const row of hasB1Projection ? (state.passages || []) : []) {
      const existing = this.sqlite.prepare('SELECT 1 AS ok FROM world_passages WHERE edge_id=?').get(row.edge_id);
      if (!existing) this.sqlite.prepare(`INSERT INTO world_passages(${PASSAGE_COLUMNS.join(',')}) VALUES(${PASSAGE_COLUMNS.map(() => '?').join(',')})`).run(...PASSAGE_COLUMNS.map(column => row[column]));
    }
    for (const row of hasB1Projection ? (state.objectStates || []) : []) {
      const existing = this.sqlite.prepare('SELECT 1 AS ok FROM world_object_states WHERE object_id=?').get(row.object_id);
      if (!existing) this.sqlite.prepare(`INSERT INTO world_object_states(${OBJECT_STATE_COLUMNS.join(',')}) VALUES(${OBJECT_STATE_COLUMNS.map(() => '?').join(',')})`).run(...OBJECT_STATE_COLUMNS.map(column => row[column]));
      else this.sqlite.prepare(`UPDATE world_object_states SET ${OBJECT_STATE_COLUMNS.slice(1).map(column => `${column}=?`).join(',')} WHERE object_id=?`).run(...OBJECT_STATE_COLUMNS.slice(1).map(column => row[column]), row.object_id);
    }
  }
  _appendPhysicalEvent({ eventKind, aggregateKind, aggregateId, aggregateRevision, sessionId = null, wakeId = null, actor, commandId = null, causation = {}, payload, occurredAt = null, skipVerification = false, replayPrior = null, afterProjection = null }) {
    if (!skipVerification) this.assertVerified();
    const event = createWorldEvent({
      head: this.eventHead(), eventKind, aggregateKind, aggregateId, aggregateRevision, sessionId, wakeId,
      actor, commandId, causation, payload, occurredAt: occurredAt || new Date(this.nowMs()).toISOString(),
    });
    const prior = replayPrior || readWorldProjection(this.sqlite);
    const next = reduceWorldEvent(prior, event);
    this.transaction(() => {
      insertWorldEvent(this.sqlite, event);
      this.eventFailureInjector?.({ phase: 'after_event_append', event });
      this._materializeProjection(next, prior);
      afterProjection?.(event);
      this.eventFailureInjector?.({ phase: 'after_projection_apply', event });
    }, { verify: !skipVerification });
    return event;
  }
  bootstrapFreshTopology() {
    this.sqlite.exec(WORLD_PROJECTION_TABLE_SQL.world_passages);
    this.sqlite.exec(WORLD_PROJECTION_TABLE_SQL.world_object_states);
    this.sqlite.exec(WORLD_INTEGRITY_TRIGGER_SQL.world_passages_append_only_update);
    this.sqlite.exec(WORLD_INTEGRITY_TRIGGER_SQL.world_passages_append_only_delete);
    this._appendPhysicalEvent({
      eventKind: 'topology.installed/v1', aggregateKind: 'topology', aggregateId: 'installed', aggregateRevision: 1,
      actor: 'world_bootstrap', causation: { boundary: 'fresh_database' }, payload: topologyEventPayload(), skipVerification: true, replayPrior: emptyWorldState(),
    });
    this.#bootstrapB1Extension('world_bootstrap');
    if (['hearth', 'forest', 'binder_window', 'spotlight'].includes(this.topologyVersion)) this.#bootstrapHearthExtension('world_bootstrap');
    if (['forest', 'binder_window', 'spotlight'].includes(this.topologyVersion)) this.#bootstrapForestExtension('world_bootstrap');
    if (['binder_window', 'spotlight'].includes(this.topologyVersion)) this.#bootstrapBinderWindowExtension('world_bootstrap');
    if (this.topologyVersion === 'spotlight') this.#bootstrapSpotlightExtension('world_bootstrap');
  }
  #bootstrapB1Extension(actor = 'world_migration') {
    const head = this.eventHead();
    return this._appendPhysicalEvent({
      eventKind: 'topology.extended/v1', aggregateKind: 'topology_extension', aggregateId: 'installed', aggregateRevision: 1,
      actor, causation: { boundary: 'b1_topology_extension', physicalHeadHash: head.event_hash, physicalHeadSequence: head.sequence }, payload: topologyExtensionEventPayload(), skipVerification: true,
      replayPrior: replayWorldEvents(this.sqlite),
    });
  }
  #bootstrapHearthExtension(actor = 'world_migration') {
    const head = this.eventHead();
    return this._appendPhysicalEvent({
      eventKind: 'topology.hearth_installed/v1', aggregateKind: 'topology_extension', aggregateId: 'hearth', aggregateRevision: 1,
      actor, causation: { boundary: 'house_hearth_wake_v1', physicalHeadHash: head.event_hash, physicalHeadSequence: head.sequence }, payload: hearthTopologyEventPayload(), skipVerification: true,
      replayPrior: replayWorldEvents(this.sqlite),
    });
  }
  #bootstrapForestExtension(actor = 'world_migration') {
    const head = this.eventHead();
    return this._appendPhysicalEvent({
      eventKind: 'topology.forest_installed/v1', aggregateKind: 'topology_extension', aggregateId: 'forest', aggregateRevision: 1,
      actor, causation: { boundary: 'forest_place_v1', physicalHeadHash: head.event_hash, physicalHeadSequence: head.sequence }, payload: forestTopologyEventPayload(), skipVerification: true,
      replayPrior: replayWorldEvents(this.sqlite),
    });
  }
  #bootstrapBinderWindowExtension(actor = 'world_migration') {
    const head = this.eventHead();
    return this._appendPhysicalEvent({
      eventKind: 'topology.binder_window_installed/v1', aggregateKind: 'topology_extension', aggregateId: 'binder_window', aggregateRevision: 1,
      actor, causation: { boundary: 'binder_window_v1', physicalHeadHash: head.event_hash, physicalHeadSequence: head.sequence }, payload: binderWindowTopologyEventPayload(), skipVerification: true,
      replayPrior: replayWorldEvents(this.sqlite),
    });
  }
  #bootstrapSpotlightExtension(actor = 'world_migration') {
    const head = this.eventHead();
    return this._appendPhysicalEvent({
      eventKind: 'topology.spotlight_installed/v1', aggregateKind: 'topology_extension', aggregateId: 'spotlight', aggregateRevision: 1,
      actor, causation: { boundary: 'spotlight_observatory_v1', physicalHeadHash: head.event_hash, physicalHeadSequence: head.sequence }, payload: spotlightTopologyEventPayload(), skipVerification: true,
      replayPrior: replayWorldEvents(this.sqlite),
    });
  }
  bootstrapLegacyBoundary() {
    const projection = readWorldPhysicalProjection(this.sqlite);
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
  inspectA2Upgrade() {
    const installedB1 = verifyWorldSqlite(this.sqlite, { mismatchLimit: 50 });
    if (installedB1.verified) return { status: 'current', upgradeRequired: false, verification: installedB1, supersededBy: 'B1' };
    const current = verifyWorldA2Sqlite(this.sqlite, { mismatchLimit: 50 });
    if (current.verified) return { status: 'current', upgradeRequired: false, verification: current };
    const boundary = this.sqlite.prepare("SELECT sequence,event_hash FROM world_event_journal WHERE event_kind='operational_snapshot.imported/v1' ORDER BY sequence LIMIT 1").get();
    const a1 = verifyWorldA1Sqlite(this.sqlite, { mismatchLimit: 50 });
    if (boundary) return { status: 'corrupt_or_incomplete_a2', upgradeRequired: false, boundary, verification: current };
    if (!a1.verified) return { status: 'corrupt_a1', upgradeRequired: false, verification: a1 };
    return {
      status: 'upgrade_required', upgradeRequired: true, verification: a1,
      backupExpectation: 'Create and verify a byte-for-byte backup of the World database before applying the A2 migration.',
    };
  }
  migrateA2({ backupConfirmed = false } = {}) {
    if (backupConfirmed !== true) throw Object.assign(new Error('A2 migration requires explicit confirmation that a recoverable World database backup exists.'), { code: 'world_a2_backup_required' });
    return this._migrateA2Boundary();
  }
  _tableRows(table) {
    const exists = this.sqlite.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=?").get(table);
    return exists ? this.sqlite.prepare(`SELECT * FROM ${table}`).all() : [];
  }
  _assertLegacyA1OperationalAdmission() {
    for (const [table, expected] of Object.entries(LEGACY_A1_OPERATIONAL_TABLE_SQL)) {
      const actual = this.sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table)?.sql;
      if (normalizeSchemaSql(actual) !== normalizeSchemaSql(expected)) throw Object.assign(new Error(`Unsupported pre-A2 schema for ${table}.`), { code: 'world_a2_legacy_schema_invalid', table });
    }
    for (const trigger of ['world_action_receipts_append_only_update', 'world_action_receipts_append_only_delete', 'world_approval_receipts_append_only_update', 'world_approval_receipts_append_only_delete']) {
      const actual = this.sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?").get(trigger)?.sql;
      if (normalizeTriggerSql(actual) !== normalizeTriggerSql(WORLD_INTEGRITY_TRIGGER_SQL[trigger])) throw Object.assign(new Error(`Unsupported pre-A2 integrity trigger: ${trigger}.`), { code: 'world_a2_legacy_trigger_invalid', trigger });
    }
    const violations = this.sqlite.prepare('PRAGMA foreign_key_check').all();
    if (violations.length) throw Object.assign(new Error('Pre-A2 World database has foreign-key violations.'), { code: 'world_a2_legacy_foreign_key_invalid', violations });
  }
  _validateLegacyOperationalRelations({ fixtureRuntimes, timers, briefs, approvals, actionReceipts, approvalReceipts }) {
    const nodes = new Map(this._tableRows('world_nodes').map(row => [row.id, row]));
    const locations = new Map(this._tableRows('world_locations').map(row => [row.session_id, row]));
    const approvalById = new Map(approvals.map(row => [row.approval_id, row])); const actionById = new Map(actionReceipts.map(row => [row.receipt_id, row]));
    const invalid = (relation, identity) => { throw Object.assign(new Error(`Invalid pre-A2 operational relation: ${relation}.`), { code: 'world_a2_legacy_relation_invalid', relation, identity }); };
    for (const row of fixtureRuntimes) if (!nodes.has(row.fixture_id)) invalid('fixture_runtime.fixture_id', row.fixture_id);
    for (const row of timers) if (!locations.has(row.session_id)) invalid('timer.session_id', row.session_id);
    for (const row of briefs) if (!locations.has(row.session_id)) invalid('brief.session_id', row.session_id);
    for (const row of approvals) if (!locations.has(row.session_id)) invalid('approval.session_id', row.approval_id);
    for (const row of actionReceipts) if (!nodes.has(row.room_node_id)) invalid('action_receipt.room_node_id', row.receipt_id);
    for (const row of approvalReceipts) {
      const approval = approvalById.get(row.approval_id); const action = actionById.get(row.action_receipt_id);
      if (!approval) invalid('approval_receipt.approval_id', row.receipt_id);
      if (!action) invalid('approval_receipt.action_receipt_id', row.receipt_id);
      if (row.session_id !== approval.session_id || row.session_id !== action.session_id || (row.wake_id || null) !== (approval.wake_id || null) || (row.wake_id || null) !== (action.wake_id || null)) invalid('approval_receipt.session_wake', row.receipt_id);
      if (row.phase !== 'pending' && row.phase !== approval.status) invalid('approval_receipt.phase_status', row.receipt_id);
      if (action.outcome !== 'committed') invalid('approval_receipt.action_outcome', row.receipt_id);
    }
  }
  _rebuildOperationalTablesForBoundary() {
    this._assertLegacyA1OperationalAdmission();
    const fixtureRuntimes = this._tableRows('world_fixture_runtime').map(row => ({ fixture_id: row.fixture_id, state_json: row.state_json, revision: 1, updated_at: row.updated_at })).sort((a, b) => a.fixture_id.localeCompare(b.fixture_id));
    const timers = this._tableRows('world_timers').map(row => ({ session_id: row.session_id, seconds: row.seconds, due_at: row.due_at, created_at: row.created_at, revision: 1 })).sort((a, b) => a.session_id.localeCompare(b.session_id));
    const briefs = this._tableRows('world_work_briefs').map(row => ({ brief_id: row.brief_id, session_id: row.session_id, revision: row.revision, objective: row.objective, scope_paths_json: row.scope_paths_json, acceptance_json: row.acceptance_json, non_goals_json: row.non_goals_json, field_hashes_json: row.field_hashes_json, created_at: row.created_at, updated_at: row.updated_at })).sort((a, b) => a.session_id.localeCompare(b.session_id) || a.revision - b.revision);
    const approvals = this._tableRows('world_approvals').map(row => ({ approval_id: row.approval_id, session_id: row.session_id, wake_id: row.wake_id ?? null, kind: row.kind, status: row.status, payload_json: row.payload_json, preview_json: row.preview_json, application_json: null, outcome_json: row.outcome_json ?? null, created_at: row.created_at, decided_at: row.decided_at ?? null, revision: 1 })).sort((a, b) => a.approval_id.localeCompare(b.approval_id));
    const actionReceipts = this._tableRows('world_action_receipts').map(row => ({ ...Object.fromEntries(ACTION_RECEIPT_COLUMNS.map(column => [column, column.startsWith('world_event_') ? null : (row[column] ?? null)])) })).sort((a, b) => a.receipt_id.localeCompare(b.receipt_id));
    const approvalReceipts = this._tableRows('world_approval_receipts').map(row => ({ ...Object.fromEntries(APPROVAL_RECEIPT_COLUMNS.map(column => [column, column.startsWith('world_event_') ? null : (row[column] ?? null)])) })).sort((a, b) => a.receipt_id.localeCompare(b.receipt_id));
    this._validateLegacyOperationalRelations({ fixtureRuntimes, timers, briefs, approvals, actionReceipts, approvalReceipts });
    for (const trigger of Object.keys(WORLD_INTEGRITY_TRIGGER_SQL).filter(name => name.includes('_receipts_'))) this.sqlite.exec(`DROP TRIGGER IF EXISTS ${trigger}`);
    for (const table of ['world_approval_receipts', 'world_action_receipts', 'world_work_briefs', 'world_timers', 'world_fixture_runtime', 'world_approvals']) this.sqlite.exec(`DROP TABLE IF EXISTS ${table}`);
    for (const [table, definition] of [
      ['world_fixture_runtime', WORLD_PROJECTION_TABLE_SQL.world_fixture_runtime], ['world_timers', WORLD_PROJECTION_TABLE_SQL.world_timers],
      ['world_work_briefs', WORLD_PROJECTION_TABLE_SQL.world_work_briefs], ['world_approvals', WORLD_PROJECTION_TABLE_SQL.world_approvals],
      ['world_action_receipts', WORLD_CUSTODY_TABLE_SQL.world_action_receipts], ['world_approval_receipts', WORLD_CUSTODY_TABLE_SQL.world_approval_receipts],
    ]) this.sqlite.exec(definition);
    this.sqlite.exec('CREATE INDEX IF NOT EXISTS world_action_receipts_session_order ON world_action_receipts(session_id, created_at, receipt_id)');
    this.sqlite.exec('CREATE INDEX IF NOT EXISTS world_approvals_session_order ON world_approvals(session_id, created_at, approval_id)');
    this.sqlite.exec('CREATE INDEX IF NOT EXISTS world_approval_receipts_approval_order ON world_approval_receipts(approval_id, created_at, receipt_id)');
    for (const row of actionReceipts) this.sqlite.prepare(`INSERT INTO world_action_receipts(${ACTION_RECEIPT_COLUMNS.join(',')}) VALUES(${ACTION_RECEIPT_COLUMNS.map(() => '?').join(',')})`).run(...ACTION_RECEIPT_COLUMNS.map(column => row[column]));
    for (const row of approvalReceipts) this.sqlite.prepare(`INSERT INTO world_approval_receipts(${APPROVAL_RECEIPT_COLUMNS.join(',')}) VALUES(${APPROVAL_RECEIPT_COLUMNS.map(() => '?').join(',')})`).run(...APPROVAL_RECEIPT_COLUMNS.map(column => row[column]));
    for (const trigger of Object.keys(WORLD_INTEGRITY_TRIGGER_SQL).filter(name => name.includes('_receipts_'))) this.sqlite.exec(WORLD_INTEGRITY_TRIGGER_SQL[trigger]);
    const legacyCustody = {
      actionReceipts: actionReceipts.map(row => ({ receiptId: row.receipt_id, rowSha256: custodyRowHash(row, 'action') })).sort((a, b) => a.receiptId.localeCompare(b.receiptId)),
      approvalReceipts: approvalReceipts.map(row => ({ receiptId: row.receipt_id, rowSha256: custodyRowHash(row, 'approval') })).sort((a, b) => a.receiptId.localeCompare(b.receiptId)),
    };
    return { fixtureRuntimes, timers, briefs, approvals, legacyCustody };
  }
  _captureExactA2OperationalBoundary() {
    for (const [table, expected] of Object.entries({ ...WORLD_A2_PROJECTION_TABLE_SQL, ...WORLD_CUSTODY_TABLE_SQL }).filter(([table]) => !['world_nodes', 'world_edges', 'world_locations'].includes(table))) {
      const actual = this.sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table)?.sql;
      if (normalizeSchemaSql(actual) !== normalizeSchemaSql(expected)) throw Object.assign(new Error(`Unsupported exact A2 schema for ${table}.`), { code: 'world_a2_schema_invalid', table });
    }
    const fixtureRuntimes = this._tableRows('world_fixture_runtime').map(row => Object.fromEntries(FIXTURE_RUNTIME_COLUMNS.slice(0, -2).map(column => [column, row[column]])));
    const timers = this._tableRows('world_timers').map(row => Object.fromEntries(TIMER_COLUMNS.slice(0, -2).map(column => [column, row[column]])));
    const briefs = this._tableRows('world_work_briefs').map(row => Object.fromEntries(BRIEF_COLUMNS.slice(0, -2).map(column => [column, row[column]])));
    const approvals = this._tableRows('world_approvals').map(row => Object.fromEntries(APPROVAL_COLUMNS.slice(0, -2).map(column => [column, row[column]])));
    const actionReceipts = this._tableRows('world_action_receipts'); const approvalReceipts = this._tableRows('world_approval_receipts');
    if ([...actionReceipts, ...approvalReceipts].some(row => row.world_event_sequence !== null || row.world_event_hash !== null)) throw Object.assign(new Error('Journal-less exact A2 custody cannot contain World event pointers.'), { code: 'world_a2_legacy_relation_invalid' });
    this._validateLegacyOperationalRelations({ fixtureRuntimes, timers, briefs, approvals, actionReceipts, approvalReceipts });
    const legacyCustody = {
      actionReceipts: actionReceipts.map(row => ({ receiptId: row.receipt_id, rowSha256: custodyRowHash(row, 'action') })).sort((a, b) => a.receiptId.localeCompare(b.receiptId)),
      approvalReceipts: approvalReceipts.map(row => ({ receiptId: row.receipt_id, rowSha256: custodyRowHash(row, 'approval') })).sort((a, b) => a.receiptId.localeCompare(b.receiptId)),
    };
    return { fixtureRuntimes, timers, briefs, approvals, legacyCustody };
  }
  _migrateA2Boundary({ requireBoundary = false } = {}) {
    let inspection = this.inspectA2Upgrade(); let captured = null;
    const boundary = this.sqlite.prepare("SELECT 1 AS ok FROM world_event_journal WHERE event_kind='operational_snapshot.imported/v1' LIMIT 1").get();
    if (requireBoundary && inspection.status === 'current' && !inspection.supersededBy && !boundary) {
      captured = this._captureExactA2OperationalBoundary();
      inspection = { status: 'upgrade_required', upgradeRequired: true, verification: inspection.verification };
    }
    if (!inspection.upgradeRequired) {
      if (inspection.status === 'current') return inspection;
      throw Object.assign(new Error('World A2 migration refused because the A1 journal is corrupt or an incomplete A2 boundary already exists.'), { code: 'world_a2_migration_refused', inspection });
    }
    this.sqlite.exec('PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE;');
    try {
      const imported = captured || this._rebuildOperationalTablesForBoundary();
      const prior = replayWorldEvents(this.sqlite); const head = this.eventHead();
      const exact = { ...imported };
      const event = createWorldEvent({
        head, eventKind: 'operational_snapshot.imported/v1', aggregateKind: 'operational_snapshot', aggregateId: 'installed', aggregateRevision: 1,
        actor: 'world_migration', causation: { boundary: 'pre_a2_operational_projection', physicalHeadHash: head.event_hash, physicalHeadSequence: head.sequence },
        payload: { projectionSha256: sha256(canonicalize(exact)), ...exact }, occurredAt: new Date(this.nowMs()).toISOString(),
      });
      const next = reduceWorldEvent(prior, event); insertWorldEvent(this.sqlite, event);
      this.eventFailureInjector?.({ phase: 'after_event_append', event }); this._materializeProjection(next, prior);
      this.eventFailureInjector?.({ phase: 'after_projection_apply', event });
      const foreignKeyViolations = this.sqlite.prepare('PRAGMA foreign_key_check').all();
      if (foreignKeyViolations.length) throw Object.assign(new Error('World A2 migration produced foreign-key violations.'), { code: 'world_a2_migration_foreign_key_failed', violations: foreignKeyViolations });
      const verification = verifyWorldA2Sqlite(this.sqlite, { mismatchLimit: 50 });
      if (!verification.verified) throw Object.assign(new Error('World A2 migration did not produce a verified projection.'), { code: 'world_a2_migration_verification_failed', verification });
      this.sqlite.exec('COMMIT;');
      return { status: 'migrated', upgradeRequired: false, boundary: { sequence: event.sequence, eventHash: event.event_hash }, verification };
    } catch (error) {
      try { this.sqlite.exec('ROLLBACK;'); } catch {}
      throw error;
    } finally { this.sqlite.exec('PRAGMA foreign_keys=ON;'); }
  }
  inspectB1Upgrade() {
    const current = verifyWorldSqlite(this.sqlite, { mismatchLimit: 50, requireHearth: false });
    if (current.verified) return { status: 'current', upgradeRequired: false, verification: current };
    const extension = this.sqlite.prepare("SELECT sequence,event_hash FROM world_event_journal WHERE event_kind='topology.extended/v1' ORDER BY sequence LIMIT 1").get();
    const partialArtifacts = ['world_passages', 'world_object_states', 'world_passages_append_only_update', 'world_passages_append_only_delete']
      .filter(name => this.sqlite.prepare("SELECT 1 AS ok FROM sqlite_master WHERE name=? AND type IN ('table','trigger')").get(name));
    if (extension || partialArtifacts.length) return { status: 'corrupt_or_incomplete_b1', upgradeRequired: false, extension: extension || null, partialArtifacts, verification: current };
    const a2 = verifyWorldA2Sqlite(this.sqlite, { mismatchLimit: 50 });
    if (!a2.verified) return { status: 'corrupt_a2', upgradeRequired: false, verification: a2 };
    return {
      status: 'upgrade_required', upgradeRequired: true, verification: a2,
      backupExpectation: 'Create and verify a byte-for-byte backup of the World database before applying the B1 migration.',
    };
  }
  migrateB1({ backupConfirmed = false } = {}) {
    if (backupConfirmed !== true) throw Object.assign(new Error('B1 migration requires explicit confirmation that a recoverable World database backup exists.'), { code: 'world_b1_backup_required' });
    return this.#migrateB1Boundary({ admittedLegacy: false });
  }
  inspectHearthUpgrade() {
    const current = verifyWorldSqlite(this.sqlite, { mismatchLimit: 50 });
    if (current.verified) return { status: 'current', upgradeRequired: false, verification: current };
    const hearth = this.sqlite.prepare("SELECT sequence,event_hash FROM world_event_journal WHERE event_kind='topology.hearth_installed/v1' ORDER BY sequence LIMIT 1").get();
    if (hearth) return { status: 'corrupt_or_incomplete_hearth', upgradeRequired: false, hearth, verification: current };
    const b1 = verifyWorldSqlite(this.sqlite, { mismatchLimit: 50, requireHearth: false });
    if (!b1.verified) return { status: 'corrupt_b1', upgradeRequired: false, verification: b1 };
    return { status: 'upgrade_required', upgradeRequired: true, verification: b1, backupExpectation: 'Create and verify a byte-for-byte backup of the World database before applying the House Hearth migration.' };
  }
  migrateHearth({ backupConfirmed = false } = {}) {
    if (backupConfirmed !== true) throw Object.assign(new Error('House Hearth migration requires explicit confirmation that a recoverable World database backup exists.'), { code: 'world_hearth_backup_required' });
    const inspection = this.inspectHearthUpgrade();
    if (!inspection.upgradeRequired) {
      if (inspection.status === 'current') return inspection;
      throw Object.assign(new Error('House Hearth migration refused because the B1 journal is corrupt or a partial Hearth extension exists.'), { code: 'world_hearth_migration_refused', inspection });
    }
    this.sqlite.exec('BEGIN IMMEDIATE;');
    try {
      const prior = replayWorldEvents(this.sqlite); const head = this.eventHead();
      const event = createWorldEvent({ head, eventKind: 'topology.hearth_installed/v1', aggregateKind: 'topology_extension', aggregateId: 'hearth', aggregateRevision: 1, actor: 'world_migration', causation: { boundary: 'house_hearth_wake_v1', physicalHeadHash: head.event_hash, physicalHeadSequence: head.sequence }, payload: hearthTopologyEventPayload(), occurredAt: new Date(this.nowMs()).toISOString() });
      const next = reduceWorldEvent(prior, event); insertWorldEvent(this.sqlite, event); this.eventFailureInjector?.({ phase: 'after_event_append', event }); this._materializeProjection(next, prior); this.eventFailureInjector?.({ phase: 'after_projection_apply', event });
      const verification = verifyWorldSqlite(this.sqlite, { mismatchLimit: 50 });
      if (!verification.verified) throw Object.assign(new Error('House Hearth migration did not produce a verified projection.'), { code: 'world_hearth_migration_verification_failed', verification });
      this.sqlite.exec('COMMIT;');
      this.topologyVersion = 'hearth';
      return { status: 'migrated', upgradeRequired: false, boundary: { sequence: event.sequence, eventHash: event.event_hash }, verification };
    } catch (error) { try { this.sqlite.exec('ROLLBACK;'); } catch {} throw error; }
  }
  inspectForestUpgrade() {
    const current = verifyWorldSqlite(this.sqlite, { mismatchLimit: 50, requireHearth: true, requireForest: true });
    if (current.verified) return { status: 'current', upgradeRequired: false, verification: current };
    const forest = this.sqlite.prepare("SELECT sequence,event_hash FROM world_event_journal WHERE event_kind='topology.forest_installed/v1' ORDER BY sequence LIMIT 1").get();
    if (forest) return { status: 'corrupt_or_incomplete_forest', upgradeRequired: false, forest, verification: current };
    const hearth = verifyWorldSqlite(this.sqlite, { mismatchLimit: 50, requireHearth: true, requireForest: false });
    if (!hearth.verified) return { status: 'corrupt_hearth', upgradeRequired: false, verification: hearth };
    return { status: 'upgrade_required', upgradeRequired: true, verification: hearth, backupExpectation: 'Create and verify a byte-for-byte backup of the World database before applying the Forest-place migration.' };
  }
  migrateForest({ backupConfirmed = false } = {}) {
    if (backupConfirmed !== true) throw Object.assign(new Error('Forest-place migration requires explicit confirmation that a recoverable World database backup exists.'), { code: 'world_forest_backup_required' });
    const inspection = this.inspectForestUpgrade();
    if (!inspection.upgradeRequired) {
      if (inspection.status === 'current') return inspection;
      throw Object.assign(new Error('Forest-place migration refused because the Hearth journal is corrupt or a partial Forest extension exists.'), { code: 'world_forest_migration_refused', inspection });
    }
    this.sqlite.exec('BEGIN IMMEDIATE;');
    try {
      const prior = replayWorldEvents(this.sqlite); const head = this.eventHead();
      const event = createWorldEvent({ head, eventKind: 'topology.forest_installed/v1', aggregateKind: 'topology_extension', aggregateId: 'forest', aggregateRevision: 1, actor: 'world_migration', causation: { boundary: 'forest_place_v1', physicalHeadHash: head.event_hash, physicalHeadSequence: head.sequence }, payload: forestTopologyEventPayload(), occurredAt: new Date(this.nowMs()).toISOString() });
      const next = reduceWorldEvent(prior, event); insertWorldEvent(this.sqlite, event); this.eventFailureInjector?.({ phase: 'after_event_append', event }); this._materializeProjection(next, prior); this.eventFailureInjector?.({ phase: 'after_projection_apply', event });
      const verification = verifyWorldSqlite(this.sqlite, { mismatchLimit: 50, requireHearth: true, requireForest: true });
      if (!verification.verified) throw Object.assign(new Error('Forest-place migration did not produce a verified projection.'), { code: 'world_forest_migration_verification_failed', verification });
      this.sqlite.exec('COMMIT;'); this.topologyVersion = 'forest';
      return { status: 'migrated', upgradeRequired: false, boundary: { sequence: event.sequence, eventHash: event.event_hash }, verification };
    } catch (error) { try { this.sqlite.exec('ROLLBACK;'); } catch {} throw error; }
  }
  inspectBinderWindowUpgrade() {
    const current = verifyWorldSqlite(this.sqlite, { mismatchLimit: 50, requireHearth: true, requireForest: true, requireBinderWindow: true });
    if (current.verified) return { status: 'current', upgradeRequired: false, verification: current };
    const binderWindow = this.sqlite.prepare("SELECT sequence,event_hash FROM world_event_journal WHERE event_kind='topology.binder_window_installed/v1' ORDER BY sequence LIMIT 1").get();
    if (binderWindow) return { status: 'corrupt_or_incomplete_binder_window', upgradeRequired: false, binderWindow, verification: current };
    const forest = verifyWorldSqlite(this.sqlite, { mismatchLimit: 50, requireHearth: true, requireForest: true, requireBinderWindow: false });
    if (!forest.verified) return { status: 'corrupt_forest', upgradeRequired: false, verification: forest };
    return { status: 'upgrade_required', upgradeRequired: true, verification: forest, backupExpectation: 'Create and verify a byte-for-byte backup of the World database before applying the Binder Window migration.' };
  }
  migrateBinderWindow({ backupConfirmed = false } = {}) {
    if (backupConfirmed !== true) throw Object.assign(new Error('Binder Window migration requires explicit confirmation that a recoverable World database backup exists.'), { code: 'world_binder_window_backup_required' });
    const inspection = this.inspectBinderWindowUpgrade();
    if (!inspection.upgradeRequired) {
      if (inspection.status === 'current') return inspection;
      throw Object.assign(new Error('Binder Window migration refused because the Forest journal is corrupt or a partial Binder Window extension exists.'), { code: 'world_binder_window_migration_refused', inspection });
    }
    this.sqlite.exec('BEGIN IMMEDIATE;');
    try {
      const prior = replayWorldEvents(this.sqlite); const head = this.eventHead();
      const event = createWorldEvent({ head, eventKind: 'topology.binder_window_installed/v1', aggregateKind: 'topology_extension', aggregateId: 'binder_window', aggregateRevision: 1, actor: 'world_migration', causation: { boundary: 'binder_window_v1', physicalHeadHash: head.event_hash, physicalHeadSequence: head.sequence }, payload: binderWindowTopologyEventPayload(), occurredAt: new Date(this.nowMs()).toISOString() });
      const next = reduceWorldEvent(prior, event); insertWorldEvent(this.sqlite, event); this.eventFailureInjector?.({ phase: 'after_event_append', event }); this._materializeProjection(next, prior); this.eventFailureInjector?.({ phase: 'after_projection_apply', event });
      const verification = verifyWorldSqlite(this.sqlite, { mismatchLimit: 50, requireHearth: true, requireForest: true, requireBinderWindow: true });
      if (!verification.verified) throw Object.assign(new Error('Binder Window migration did not produce a verified projection.'), { code: 'world_binder_window_migration_verification_failed', verification });
      this.sqlite.exec('COMMIT;'); this.topologyVersion = 'binder_window';
      return { status: 'migrated', upgradeRequired: false, boundary: { sequence: event.sequence, eventHash: event.event_hash }, verification };
    } catch (error) { try { this.sqlite.exec('ROLLBACK;'); } catch {} throw error; }
  }
  inspectSpotlightUpgrade() {
    const current = verifyWorldSqlite(this.sqlite, { mismatchLimit: 50, requireHearth: true, requireForest: true, requireBinderWindow: true, requireSpotlight: true });
    if (current.verified) return { status: 'current', upgradeRequired: false, verification: current };
    const spotlight = this.sqlite.prepare("SELECT sequence,event_hash FROM world_event_journal WHERE event_kind='topology.spotlight_installed/v1' ORDER BY sequence LIMIT 1").get();
    if (spotlight) return { status: 'corrupt_or_incomplete_spotlight', upgradeRequired: false, spotlight, verification: current };
    const binderWindow = verifyWorldSqlite(this.sqlite, { mismatchLimit: 50, requireHearth: true, requireForest: true, requireBinderWindow: true, requireSpotlight: false });
    if (!binderWindow.verified) return { status: 'corrupt_binder_window', upgradeRequired: false, verification: binderWindow };
    return { status: 'upgrade_required', upgradeRequired: true, verification: binderWindow, backupExpectation: 'Create and verify a byte-for-byte backup of the World database before applying the Spotlight Observatory migration.' };
  }
  migrateSpotlight({ backupConfirmed = false } = {}) {
    if (backupConfirmed !== true) throw Object.assign(new Error('Spotlight Observatory migration requires explicit confirmation that a recoverable World database backup exists.'), { code: 'world_spotlight_backup_required' });
    const inspection = this.inspectSpotlightUpgrade();
    if (!inspection.upgradeRequired) {
      if (inspection.status === 'current') return inspection;
      throw Object.assign(new Error('Spotlight Observatory migration refused because the Binder Window journal is corrupt or a partial Spotlight extension exists.'), { code: 'world_spotlight_migration_refused', inspection });
    }
    this.sqlite.exec('BEGIN IMMEDIATE;');
    try {
      const prior = replayWorldEvents(this.sqlite); const head = this.eventHead();
      const event = createWorldEvent({ head, eventKind: 'topology.spotlight_installed/v1', aggregateKind: 'topology_extension', aggregateId: 'spotlight', aggregateRevision: 1, actor: 'world_migration', causation: { boundary: 'spotlight_observatory_v1', physicalHeadHash: head.event_hash, physicalHeadSequence: head.sequence }, payload: spotlightTopologyEventPayload(), occurredAt: new Date(this.nowMs()).toISOString() });
      const next = reduceWorldEvent(prior, event); insertWorldEvent(this.sqlite, event); this.eventFailureInjector?.({ phase: 'after_event_append', event }); this._materializeProjection(next, prior); this.eventFailureInjector?.({ phase: 'after_projection_apply', event });
      const verification = verifyWorldSqlite(this.sqlite, { mismatchLimit: 50, requireHearth: true, requireForest: true, requireBinderWindow: true, requireSpotlight: true });
      if (!verification.verified) throw Object.assign(new Error('Spotlight Observatory migration did not produce a verified projection.'), { code: 'world_spotlight_migration_verification_failed', verification });
      this.sqlite.exec('COMMIT;'); this.topologyVersion = 'spotlight';
      return { status: 'migrated', upgradeRequired: false, boundary: { sequence: event.sequence, eventHash: event.event_hash }, verification };
    } catch (error) { try { this.sqlite.exec('ROLLBACK;'); } catch {} throw error; }
  }
  #rebuildTopologySchemaForB1() {
    const nodes = this.sqlite.prepare(`SELECT ${NODE_COLUMNS.join(',')} FROM world_nodes ORDER BY id`).all();
    const edges = this.sqlite.prepare(`SELECT ${EDGE_COLUMNS.join(',')} FROM world_edges ORDER BY id`).all();
    for (const trigger of ['world_nodes_append_only_update', 'world_nodes_append_only_delete', 'world_edges_append_only_update', 'world_edges_append_only_delete']) this.sqlite.exec(`DROP TRIGGER IF EXISTS ${trigger}`);
    const nodeCreate = WORLD_PROJECTION_TABLE_SQL.world_nodes.replace('CREATE TABLE IF NOT EXISTS world_nodes', 'CREATE TABLE world_nodes_b1');
    const edgeCreate = WORLD_PROJECTION_TABLE_SQL.world_edges.replace('CREATE TABLE IF NOT EXISTS world_edges', 'CREATE TABLE world_edges_b1');
    this.sqlite.exec(nodeCreate);
    for (const row of nodes) this.sqlite.prepare(`INSERT INTO world_nodes_b1(${NODE_COLUMNS.join(',')}) VALUES(${NODE_COLUMNS.map(() => '?').join(',')})`).run(...NODE_COLUMNS.map(column => row[column]));
    this.sqlite.exec(edgeCreate);
    for (const row of edges) this.sqlite.prepare(`INSERT INTO world_edges_b1(${EDGE_COLUMNS.join(',')}) VALUES(${EDGE_COLUMNS.map(() => '?').join(',')})`).run(...EDGE_COLUMNS.map(column => row[column]));
    this.sqlite.exec('DROP TABLE world_edges; DROP TABLE world_nodes; ALTER TABLE world_nodes_b1 RENAME TO world_nodes; ALTER TABLE world_edges_b1 RENAME TO world_edges;');
    for (const trigger of ['world_nodes_append_only_update', 'world_nodes_append_only_delete', 'world_edges_append_only_update', 'world_edges_append_only_delete']) this.sqlite.exec(WORLD_INTEGRITY_TRIGGER_SQL[trigger]);
    this.sqlite.exec(WORLD_PROJECTION_TABLE_SQL.world_passages);
    this.sqlite.exec(WORLD_PROJECTION_TABLE_SQL.world_object_states);
    this.sqlite.exec(WORLD_INTEGRITY_TRIGGER_SQL.world_passages_append_only_update);
    this.sqlite.exec(WORLD_INTEGRITY_TRIGGER_SQL.world_passages_append_only_delete);
  }
  #migrateB1Boundary({ admittedLegacy = false } = {}) {
    const inspection = this.inspectB1Upgrade();
    if (!inspection.upgradeRequired) {
      if (inspection.status === 'current') return inspection;
      throw Object.assign(new Error('World B1 migration refused because the A2 journal is corrupt or a partial B1 extension exists.'), { code: 'world_b1_migration_refused', inspection });
    }
    this.sqlite.exec('PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE;');
    try {
      this.#rebuildTopologySchemaForB1();
      const prior = replayWorldEvents(this.sqlite); const head = this.eventHead();
      const event = createWorldEvent({
        head, eventKind: 'topology.extended/v1', aggregateKind: 'topology_extension', aggregateId: 'installed', aggregateRevision: 1,
        actor: 'world_migration', causation: { boundary: 'b1_topology_extension', physicalHeadHash: head.event_hash, physicalHeadSequence: head.sequence },
        payload: topologyExtensionEventPayload(), occurredAt: new Date(this.nowMs()).toISOString(),
      });
      const next = reduceWorldEvent(prior, event); insertWorldEvent(this.sqlite, event);
      this.eventFailureInjector?.({ phase: 'after_event_append', event }); this._materializeProjection(next, prior);
      this.eventFailureInjector?.({ phase: 'after_projection_apply', event });
      const foreignKeyViolations = this.sqlite.prepare('PRAGMA foreign_key_check').all();
      if (foreignKeyViolations.length) throw Object.assign(new Error('World B1 migration produced foreign-key violations.'), { code: 'world_b1_migration_foreign_key_failed', violations: foreignKeyViolations });
      const verification = verifyWorldSqlite(this.sqlite, { mismatchLimit: 50, requireHearth: false });
      if (!verification.verified) throw Object.assign(new Error('World B1 migration did not produce a verified projection.'), { code: 'world_b1_migration_verification_failed', verification });
      this.sqlite.exec('COMMIT;');
      return { status: 'migrated', upgradeRequired: false, admittedLegacy, boundary: { sequence: event.sequence, eventHash: event.event_hash }, verification };
    } catch (error) {
      try { this.sqlite.exec('ROLLBACK;'); } catch {}
      throw error;
    } finally { this.sqlite.exec('PRAGMA foreign_keys=ON;'); }
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
      sessionId, actor: 'world_lifespan', causation: { reason: 'lifespan_initialized' }, payload: { roomNodeId: this.topologyVersion === 'b1' ? 'room.center' : 'place.house' },
      replayPrior: replayWorldEvents(this.sqlite),
    });
    return this.sqlite.prepare('SELECT * FROM world_locations WHERE session_id=?').get(sessionId);
  }
  activateLifespan(sessionId, reason = 'lifespan_replaced') {
    this.assertVerified();
    const location = this.ensureLifespan(sessionId);
    const pending = this.sqlite.prepare("SELECT approval_id FROM world_approvals WHERE session_id<>? AND status='pending' ORDER BY created_at, approval_id").all(sessionId);
    for (const row of pending) this._cancelApproval(row.approval_id, reason, { actor: 'world_lifespan' });
    return { location, cancelledApprovalIds: pending.map(row => row.approval_id) };
  }
  current(sessionId) { const row = this.sqlite.prepare('SELECT * FROM world_locations WHERE session_id=?').get(sessionId); if (row) { this.assertVerified(); return row; } return this.ensureLifespan(sessionId); }
  setHearthSettlement(sessionId, { wakeId = null, packetHash = null, settled = true } = {}) {
    if (typeof sessionId !== 'string' || !sessionId) throw new Error('Hearth settlement requires a session identity.');
    if (!settled) { this.hearthSettlements.delete(sessionId); return null; }
    const value = { state: 'completed', symbol: '✓', label: 'Tended this wake', wakeId: wakeId || null, packetHash: packetHash || null };
    this.hearthSettlements.set(sessionId, value);
    return structuredClone(value);
  }
  hearthSettlement(sessionId) { return structuredClone(this.hearthSettlements.get(sessionId) || null); }
  ageHearthSettlement(sessionId) {
    const prior = this.hearthSettlements.get(sessionId);
    if (!prior || prior.label === 'Recently tended') return structuredClone(prior || null);
    const aged = { ...prior, label: 'Recently tended' };
    this.hearthSettlements.set(sessionId, aged);
    return structuredClone(aged);
  }
  node(nodeId) { return this.sqlite.prepare('SELECT * FROM world_nodes WHERE id=?').get(nodeId); }
  exits(roomId) { return this.sqlite.prepare("SELECT * FROM world_edges WHERE edge_type='door' AND from_node_id=? ORDER BY id").all(roomId); }
  passages(locationId) {
    this.assertVerified();
    return this.sqlite.prepare('SELECT p.*,e.label FROM world_passages p JOIN world_edges e ON e.id=p.edge_id WHERE p.from_node_id=? ORDER BY p.edge_id').all(locationId);
  }
  boundaries(locationId) { this.assertVerified(); return this.sqlite.prepare("SELECT * FROM world_edges WHERE edge_type='boundary' AND from_node_id=? ORDER BY id").all(locationId); }
  fixtures(roomId) {
    return this.sqlite.prepare("SELECT n.* FROM world_nodes n JOIN world_edges e ON e.to_node_id=n.id WHERE e.edge_type='contains' AND e.from_node_id=? AND n.lifecycle='standing' ORDER BY n.id").all(roomId);
  }
  getFixtureRuntime(fixtureId) {
    this.assertVerified();
    const row = this.sqlite.prepare('SELECT * FROM world_fixture_runtime WHERE fixture_id=?').get(fixtureId);
    return row ? JSON.parse(row.state_json) : null;
  }
  getObjectState(objectId) {
    this.assertVerified();
    const row = this.sqlite.prepare('SELECT * FROM world_object_states WHERE object_id=?').get(objectId);
    return row ? { ...JSON.parse(row.state_json), revision: row.revision, worldEventSequence: row.last_event_sequence, worldEventHash: row.last_event_hash } : null;
  }
  setFixtureRuntime(fixtureId, state, { sessionId = null, wakeId = null, commandId = null, actor = null, action = null } = {}) {
    this.assertVerified();
    const current = this.sqlite.prepare('SELECT revision,state_json,last_event_sequence,last_event_hash FROM world_fixture_runtime WHERE fixture_id=?').get(fixtureId);
    const priorState = current ? JSON.parse(current.state_json) : null;
    const resolvedAction = action || (state?.status === 'running' ? 'recipe_started' : null);
    if (!resolvedAction) throw Object.assign(new Error('Fixture runtime transition action is required.'), { code: 'world_runtime_action_required' });
    const effectiveActor = actor || (commandId ? 'resident_tool' : resolvedAction === 'recipe_started' || resolvedAction === 'recipe_cancelled' ? 'world_internal' : 'world_runtime');
    const boundaryRunId = resolvedAction === 'restart_reconciled' && priorState?.status === 'running' && !priorState.runId
      ? `legacy_run_${sha256(canonicalize({ fixtureId, boundaryEventHash: current.last_event_hash, stateSha256: sha256(current.state_json) }))}`
      : null;
    const normalized = {
      status: state?.status || 'failed', runId: state?.runId || priorState?.runId || boundaryRunId || (resolvedAction === 'recipe_started' ? id('kiln_run') : null), recipe: state?.recipe || priorState?.recipe || null, code: state?.code ?? null, signal: state?.signal ?? null,
      reason: state?.reason || null, summaryTail: typeof state?.summaryTail === 'string' ? state.summaryTail.slice(0, 240) : null,
    };
    const revision = this.aggregateRevision('fixture_runtime', fixtureId, current?.revision || 0) + 1;
    const event = this._appendPhysicalEvent({
      eventKind: 'fixture_runtime.replaced/v1', aggregateKind: 'fixture_runtime', aggregateId: fixtureId, aggregateRevision: revision,
      sessionId, wakeId, actor: effectiveActor, commandId, causation: { action: resolvedAction }, payload: { fixtureId, state: normalized },
    });
    return { ...normalized, worldEventSequence: event.sequence, worldEventHash: event.event_hash };
  }
  setTimer(sessionId, seconds, { wakeId = null, commandId = null, actor = commandId ? 'resident_tool' : 'world_internal' } = {}) {
    this.assertVerified();
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > 3600) throw Object.assign(new Error('Timer seconds must be an integer from 1 to 3600.'), { code: 'workshop_invalid_argument' });
    this.ensureLifespan(sessionId);
    const observedNow = this.nowMs(); const createdAt = new Date(observedNow).toISOString(); const dueAt = new Date(observedNow + seconds * 1000).toISOString();
    const current = this.sqlite.prepare('SELECT revision FROM world_timers WHERE session_id=?').get(sessionId);
    const revision = this.aggregateRevision('timer', sessionId, current?.revision || 0) + 1;
    const event = this._appendPhysicalEvent({
      eventKind: 'timer.set/v1', aggregateKind: 'timer', aggregateId: sessionId, aggregateRevision: revision,
      sessionId, wakeId, actor, commandId, causation: { action: 'timer_set' }, payload: { seconds, dueAt, createdAt }, occurredAt: createdAt,
    });
    return { ...this.getTimer(sessionId), worldEventSequence: event.sequence, worldEventHash: event.event_hash };
  }
  cancelTimer(sessionId, { wakeId = null, commandId = null, actor = commandId ? 'resident_tool' : 'world_internal', reason = 'cancelled_by_tool' } = {}) {
    this.assertVerified();
    const prior = this.getTimer(sessionId);
    if (prior.status === 'none') return { kind: 'workshop_timer_cancel', cancelled: false, prior };
    const current = this.sqlite.prepare('SELECT revision,due_at FROM world_timers WHERE session_id=?').get(sessionId);
    const revision = this.aggregateRevision('timer', sessionId, current.revision) + 1;
    const event = this._appendPhysicalEvent({
      eventKind: 'timer.cleared/v1', aggregateKind: 'timer', aggregateId: sessionId, aggregateRevision: revision,
      sessionId, wakeId, actor, commandId, causation: { action: 'timer_cleared' }, payload: { priorDueAt: current.due_at, reason },
    });
    return { kind: 'workshop_timer_cancel', cancelled: true, prior, worldEventSequence: event.sequence, worldEventHash: event.event_hash };
  }
  getTimer(sessionId) {
    this.assertVerified();
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
    const hearthSettlement = this.hearthSettlement(sessionId);
    const contained = this.fixtures(room.id).map(item => {
      const base = JSON.parse(item.state_json);
      const runtime = this.getFixtureRuntime(item.id);
      const objectState = this.getObjectState(item.id);
      const state = runtime ? { ...base, ...runtime } : objectState ? { ...base, ...objectState } : base;
      const affordance = item.id === 'fixture.hearth'
        ? hearthSettlement
          ? { name: 'tend_hearth', state: hearthSettlement.state, symbol: hearthSettlement.symbol, label: hearthSettlement.label, available: false, wakeId: hearthSettlement.wakeId }
          : { name: 'tend_hearth', state: 'available', symbol: '○', label: 'Tend the Hearth', available: true }
        : null;
      return {
        id: item.id,
        type: item.node_type,
        text: item.resident_text,
        state: item.id === 'fixture.workshop_workbench' ? { ...state, pendingApprovals } : affordance ? { ...state, affordance } : state,
      };
    });
    const heartbeat = this.heartbeat(sessionId);
    const passages = this.passages(room.id).map(route => ({
      edgeId: route.edge_id, passageId: route.passage_id, passageKind: route.passage_kind, label: route.label,
      to: route.to_node_id, governedObjectId: route.governed_object_id,
      state: route.governed_object_id ? this.getObjectState(route.governed_object_id) : null,
    }));
    const supersededBoundaryTargets = new Set(passages.map(route => route.to === 'place.forest' ? 'boundary.forest' : null).filter(Boolean));
    const boundaries = this.boundaries(room.id).filter(edge => !supersededBoundaryTargets.has(edge.to_node_id))
      .map(edge => ({ edgeId: edge.id, label: edge.label, to: edge.to_node_id, text: this.node(edge.to_node_id)?.resident_text || '' }));
    return {
      revision: location.revision,
      roomId: room.id,
      roomType: room.node_type,
      text: room.resident_text,
      fixtures: contained.filter(item => item.type === 'fixture' || item.type === 'object'),
      engagedFixtureId: engagedColumn(location),
      exits: this.exits(room.id).map(edge => ({ edgeId: edge.id, doorId: edge.door_identity, label: edge.label, to: edge.to_node_id })),
      passages,
      boundaries,
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
          ? ` [${item.state.status}]`
          : '';
        return `${item.id}${kiln}`;
      }).join(', ')
      : 'none';
    const engageable = projection.fixtures.filter(item => item.state?.engageable)
      .map(item => `${fixtureName(item.id)} (${item.id})`).join(', ') || 'none';
    const pending = projection.pendingApprovals > 0 ? ' Work waiting on the workbench.' : '';
    const engaged = projection.engagedFixtureId || 'none';
    const kilnState = projection.heartbeat?.kiln?.status && projection.heartbeat.kiln.status !== 'idle'
      ? ` Kiln: ${projection.heartbeat.kiln.status}.`
      : '';
    const timerState = projection.heartbeat?.timer?.status && projection.heartbeat.timer.status !== 'none'
      ? ` Timer: ${projection.heartbeat.timer.status}.`
      : '';
    const beat = `${kilnState}${timerState}`;
    const workshopHonesty = projection.roomId === 'room.workshop' ? ' One fixture may be in working focus; engaging another moves focus directly, while disengaging steps away from fixture work.' : '';
    const patched = projection.roomId === 'room.workshop' ? '' : ` ${profilePresenceLine(projection.roomId).replace(/^Patched:/, 'Actions within reach:')}`;
    const passages = projection.passages.length ? projection.passages.map(item => {
      const state = item.state && item.governedObjectId === 'object.front_door'
        ? ` [${item.state.open ? 'open' : 'closed'}, ${item.state.locked ? 'locked' : 'unlocked'}]`
        : ' [open]';
      return `${item.label} (${item.passageId})${state}`;
    }).join(', ') : 'none';
    const boundaries = projection.boundaries.length ? projection.boundaries.map(item => `${item.label}: ${item.text}`).join(' ') : 'none';
    const hearth = projection.fixtures.find(item => item.id === 'fixture.hearth');
    const hearthAffordance = hearth?.state?.affordance
      ? ` Hearth affordance: ${hearth.state.affordance.symbol} ${hearth.state.affordance.label}.`
      : '';
    const roomText = projection.roomId === 'room.workshop' ? WORKSHOP_PRESENCE_TEXT : projection.text;
    return `Current World ground for this phase. Current location: ${projection.roomId}. ${roomText} Nearby fixtures and objects: ${fixtures}. Focusable fixtures: ${engageable}. Working focus: ${engaged}. Direct room exits: ${exits}. Stateful passages: ${passages}. Boundaries: ${boundaries}.${workshopHonesty}${patched}${pending}${beat}${hearthAffordance}`;
  }
  move({ sessionId, wakeId, commandId = null, doorId, actor = commandId ? 'resident_tool' : 'world_internal' }) {
    if (typeof doorId !== 'string' || !doorId) throw Object.assign(new Error('A door identity is required.'), { code: 'world_invalid_argument' });
    const current = this.current(sessionId); const edge = this.sqlite.prepare("SELECT * FROM world_edges WHERE edge_type='door' AND from_node_id=? AND door_identity=?").get(current.room_node_id, doorId);
    if (!edge) throw Object.assign(new Error('That door is not reachable from the current room.'), { code: 'world_wrong_room_or_door' });
    const leavingWorkshop = current.room_node_id === 'room.workshop' && edge.to_node_id !== 'room.workshop';
    const clearedFixture = leavingWorkshop ? engagedColumn(current) : null;
    const event = this._appendPhysicalEvent({
      eventKind: 'location.moved/v1', aggregateKind: 'lifespan', aggregateId: sessionId, aggregateRevision: current.revision + 1,
      sessionId, wakeId: wakeId || null, actor, commandId, causation: { doorIdentity: edge.door_identity, edgeId: edge.id },
      payload: { fromRoomId: current.room_node_id, toRoomId: edge.to_node_id, edgeId: edge.id, doorIdentity: edge.door_identity, clearedFixtureId: clearedFixture || null },
      afterProjection: journalEvent => {
        this.sqlite.prepare('INSERT INTO world_location_events VALUES(?,?,?,?,?,?,?,?,?,?)').run(journalEvent.event_id, sessionId, wakeId || null, actor, current.room_node_id, edge.to_node_id, edge.id, edge.door_identity, journalEvent.occurred_at, canonicalize({ actor, wakeId: wakeId || null, clearedFixtureId: clearedFixture || null }));
      },
    });
    return { eventId: event.event_id, worldEventSequence: event.sequence, worldEventHash: event.event_hash, edgeId: edge.id, doorId, fromRoom: current.room_node_id, toRoom: edge.to_node_id, clearedFixtureId: clearedFixture || null, projection: this.projection(sessionId) };
  }
  moveThroughPassage({ sessionId, wakeId, commandId, passageId }) {
    if (typeof passageId !== 'string' || !passageId) throw Object.assign(new Error('A passage identity is required.'), { code: 'world_invalid_argument' });
    if (typeof commandId !== 'string' || !commandId) throw Object.assign(new Error('Passage traversal requires a causal resident command.'), { code: 'world_command_required' });
    const current = this.current(sessionId);
    const passage = this.sqlite.prepare('SELECT p.*,e.label FROM world_passages p JOIN world_edges e ON e.id=p.edge_id WHERE p.from_node_id=? AND p.passage_id=?').get(current.room_node_id, passageId);
    if (!passage) throw Object.assign(new Error('That passage is not reachable from the current location.'), { code: 'world_wrong_location_or_passage' });
    if (passage.passage_kind === 'door') {
      const door = this.getObjectState(passage.governed_object_id);
      if (!door?.open) throw Object.assign(new Error('The front door is closed.'), { code: 'world_passage_closed' });
    }
    const leavingWorkshop = current.room_node_id === 'room.workshop' && passage.to_node_id !== 'room.workshop';
    const clearedFixture = leavingWorkshop ? engagedColumn(current) : null;
    const event = this._appendPhysicalEvent({
      eventKind: 'location.crossed/v1', aggregateKind: 'lifespan', aggregateId: sessionId, aggregateRevision: current.revision + 1,
      sessionId, wakeId: wakeId || null, actor: 'resident_tool', commandId, causation: { action: 'move_through_passage', passageId },
      payload: { fromLocationId: current.room_node_id, toLocationId: passage.to_node_id, edgeId: passage.edge_id, passageId, passageKind: passage.passage_kind, governedObjectId: passage.governed_object_id, clearedFixtureId: clearedFixture || null },
      afterProjection: journalEvent => this.sqlite.prepare('INSERT INTO world_location_events VALUES(?,?,?,?,?,?,?,?,?,?)').run(journalEvent.event_id, sessionId, wakeId || null, 'resident_tool', current.room_node_id, passage.to_node_id, passage.edge_id, null, journalEvent.occurred_at, canonicalize({ actor: 'resident_tool', wakeId: wakeId || null, action: 'move_through_passage', passageId })),
    });
    const crossingCheck = current.room_node_id === 'place.forest' && passage.to_node_id === 'place.garden'
      ? { kind:'forest_homeward_check', status:'clear', policyVersion:'forest_homeward/v1' }
      : null;
    return { eventId: event.event_id, worldEventSequence: event.sequence, worldEventHash: event.event_hash, edgeId: passage.edge_id, passageId, passageKind: passage.passage_kind, fromLocationId: current.room_node_id, toLocationId: passage.to_node_id, crossingCheck, projection: this.projection(sessionId) };
  }
  operatePassage({ sessionId, wakeId, commandId, passageId, action }) {
    if (typeof commandId !== 'string' || !commandId) throw Object.assign(new Error('Passage operation requires a causal resident command.'), { code: 'world_command_required' });
    if (passageId !== 'passage.garden_house' || !['open', 'close', 'lock', 'unlock'].includes(action)) throw Object.assign(new Error('That passage operation is not installed.'), { code: 'world_passage_operation_invalid' });
    const current = this.current(sessionId);
    const route = this.sqlite.prepare('SELECT * FROM world_passages WHERE passage_id=? AND from_node_id=?').get(passageId, current.room_node_id);
    if (!route || route.governed_object_id !== 'object.front_door') throw Object.assign(new Error('The front door is not operable from the current location.'), { code: 'world_wrong_location_or_passage' });
    const stored = this.sqlite.prepare('SELECT * FROM world_object_states WHERE object_id=?').get(route.governed_object_id); const prior = JSON.parse(stored.state_json);
    let next;
    if (action === 'open' && !prior.open && !prior.locked) next = { locked: false, open: true };
    else if (action === 'close' && prior.open) next = { locked: false, open: false };
    else if (action === 'lock' && current.room_node_id === 'place.house' && !prior.open && !prior.locked) next = { locked: true, open: false };
    else if (action === 'unlock' && current.room_node_id === 'place.house' && !prior.open && prior.locked) next = { locked: false, open: false };
    else throw Object.assign(new Error('That front-door transition is not lawful from the current side and state.'), { code: 'world_passage_operation_refused' });
    const event = this._appendPhysicalEvent({
      eventKind: 'passage.operated/v1', aggregateKind: 'world_object', aggregateId: route.governed_object_id, aggregateRevision: stored.revision + 1,
      sessionId, wakeId: wakeId || null, actor: 'resident_tool', commandId, causation: { action: 'operate_passage', passageId },
      payload: { passageId, objectId: route.governed_object_id, fromLocationId: current.room_node_id, operation: action, priorState: prior, nextState: next },
    });
    return { eventId: event.event_id, worldEventSequence: event.sequence, worldEventHash: event.event_hash, passageId, action, objectId: route.governed_object_id, state: next };
  }
  turnFixture({ sessionId, wakeId, commandId, fixtureId }) {
    if (typeof commandId !== 'string' || !commandId) throw Object.assign(new Error('Fixture turning requires a causal resident command.'), { code: 'world_command_required' });
    if (fixtureId !== 'fixture.garden_turning_stone') throw Object.assign(new Error('That fixture is not turnable.'), { code: 'world_fixture_not_turnable' });
    const current = this.current(sessionId);
    if (current.room_node_id !== 'place.garden') throw Object.assign(new Error('The turning stone is only reachable in the Garden.'), { code: 'world_wrong_room' });
    const stored = this.sqlite.prepare('SELECT * FROM world_object_states WHERE object_id=?').get(fixtureId); const prior = JSON.parse(stored.state_json); const nextTurnCount = prior.turnCount + 1;
    const event = this._appendPhysicalEvent({
      eventKind: 'fixture.turned/v1', aggregateKind: 'world_object', aggregateId: fixtureId, aggregateRevision: stored.revision + 1,
      sessionId, wakeId: wakeId || null, actor: 'resident_tool', commandId, causation: { action: 'turn_fixture' },
      payload: { fixtureId, fromLocationId: current.room_node_id, priorTurnCount: prior.turnCount, nextTurnCount },
    });
    return { eventId: event.event_id, worldEventSequence: event.sequence, worldEventHash: event.event_hash, fixtureId, turnCount: nextTurnCount };
  }
  engageFixture({ sessionId, wakeId, commandId = null, fixtureId, actor = commandId ? 'resident_tool' : 'world_internal' }) {
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
      sessionId, wakeId: wakeId || null, actor, commandId, causation: { action: 'engage_fixture' }, payload: { fixtureId, previousFixtureId: previous || null },
      afterProjection: journalEvent => {
        this.sqlite.prepare('INSERT INTO world_location_events VALUES(?,?,?,?,?,?,?,?,?,?)').run(journalEvent.event_id, sessionId, wakeId || null, actor, current.room_node_id, current.room_node_id, null, null, journalEvent.occurred_at, canonicalize({ actor, wakeId: wakeId || null, action: 'engage_fixture', fixtureId, previousFixtureId: previous }));
      },
    });
    return { eventId: event.event_id, worldEventSequence: event.sequence, worldEventHash: event.event_hash, fixtureId, previousFixtureId: previous, projection: this.projection(sessionId) };
  }
  inspectFixture({ sessionId, fixtureId }) {
    if (typeof fixtureId !== 'string' || !fixtureId) throw Object.assign(new Error('A fixture identity is required.'), { code: 'world_invalid_argument' });
    const current = this.current(sessionId);
    const fixture = this.node(fixtureId);
    if (!fixture || !['fixture', 'object'].includes(fixture.node_type) || fixture.lifecycle !== 'standing') throw Object.assign(new Error('That fixture or object is not installed.'), { code: 'world_fixture_unknown' });
    const contained = this.sqlite.prepare("SELECT 1 AS ok FROM world_edges WHERE edge_type='contains' AND from_node_id=? AND to_node_id=?").get(current.room_node_id, fixtureId);
    if (!contained) throw Object.assign(new Error('That fixture or object is not contained by the current location.'), { code: 'world_fixture_unreachable' });
    const base = JSON.parse(fixture.state_json);
    const runtime = this.getFixtureRuntime(fixtureId);
    const objectState = this.getObjectState(fixtureId);
    const state = runtime ? { ...base, ...runtime } : objectState ? { ...base, ...objectState } : base;
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
  disengageFixture({ sessionId, wakeId, commandId = null, actor = commandId ? 'resident_tool' : 'world_internal' }) {
    const current = this.current(sessionId);
    if (current.room_node_id !== 'room.workshop') throw Object.assign(new Error('Disengage is only lawful inside the Workshop.'), { code: 'world_wrong_room' });
    const previous = engagedColumn(current);
    if (!previous) throw Object.assign(new Error('No fixture is currently engaged.'), { code: 'world_not_engaged' });
    const event = this._appendPhysicalEvent({
      eventKind: 'fixture.disengaged/v1', aggregateKind: 'lifespan', aggregateId: sessionId, aggregateRevision: current.revision + 1,
      sessionId, wakeId: wakeId || null, actor, commandId, causation: { action: 'disengage_fixture' }, payload: { fixtureId: previous },
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
  inspect(sessionId, source, { wakeId = null, commandId = null, actor = commandId ? 'resident_tool' : 'world_internal' } = {}) {
    const current = this.current(sessionId);
    const event = this._appendPhysicalEvent({
      eventKind: 'source.inspected/v1', aggregateKind: 'lifespan', aggregateId: sessionId, aggregateRevision: current.revision + 1,
      sessionId, wakeId, actor, commandId, causation: { action: 'inspect_source' }, payload: { source: source || null },
    });
    return { eventId: event.event_id, source: source || null, worldEventSequence: event.sequence, worldEventHash: event.event_hash };
  }
  actionReceipt({ sessionId, wakeId, roomNodeId, toolName, arguments: args, result, outcome, requestRecordId = null, spineRecordId = null, worldEventSequence = null, worldEventHash = null }) {
    this.assertVerified();
    if ((worldEventSequence === null) !== (worldEventHash === null)) throw Object.assign(new Error('Action receipt World event link is incomplete.'), { code: 'world_event_link_invalid' });
    if (outcome === 'refused' && worldEventSequence !== null) throw Object.assign(new Error('A refused action cannot cite a World state event.'), { code: 'world_refusal_event_invalid' });
    if (worldEventSequence !== null) {
      const event = this.sqlite.prepare('SELECT event_hash FROM world_event_journal WHERE sequence=?').get(worldEventSequence);
      if (!event || event.event_hash !== worldEventHash) throw Object.assign(new Error('Action receipt World event link does not resolve.'), { code: 'world_event_link_invalid' });
    }
    const receiptId = id('action');
    this.sqlite.prepare(`INSERT INTO world_action_receipts(${ACTION_RECEIPT_COLUMNS.join(',')}) VALUES(${ACTION_RECEIPT_COLUMNS.map(() => '?').join(',')})`).run(
      receiptId, sessionId, wakeId || null, roomNodeId, toolName, canonicalize(args), canonicalize(result), outcome, requestRecordId, spineRecordId, worldEventSequence, worldEventHash, NOW(),
    );
    return { receiptId, requestRecordId, spineRecordId, worldEventSequence, worldEventHash };
  }
  upsertBrief({ sessionId, wakeId = null, commandId = null, actor = commandId ? 'resident_tool' : 'world_internal', objective, scopePaths = [], acceptance = [], nonGoals = [] }) {
    this.assertVerified();
    if (typeof objective !== 'string' || !objective.trim() || objective.length > 2000) throw Object.assign(new Error('Work brief objective is invalid.'), { code: 'workshop_invalid_argument' });
    if (!Array.isArray(scopePaths) || scopePaths.length > 40 || scopePaths.some(item => typeof item !== 'string' || !item || item.length > 260)) throw Object.assign(new Error('Work brief scope paths are invalid.'), { code: 'workshop_invalid_argument' });
    if (!Array.isArray(acceptance) || acceptance.length > 20 || acceptance.some(item => typeof item !== 'string' || !item || item.length > 400)) throw Object.assign(new Error('Work brief acceptance checks are invalid.'), { code: 'workshop_invalid_argument' });
    if (!Array.isArray(nonGoals) || nonGoals.length > 20 || nonGoals.some(item => typeof item !== 'string' || !item || item.length > 400)) throw Object.assign(new Error('Work brief non-goals are invalid.'), { code: 'workshop_invalid_argument' });
    this.ensureLifespan(sessionId);
    const fieldHashes = { objective: sha256(objective), scopePaths: sha256(JSON.stringify(scopePaths)), acceptance: sha256(JSON.stringify(acceptance)), nonGoals: sha256(JSON.stringify(nonGoals)) };
    const existing = this.sqlite.prepare('SELECT * FROM world_work_briefs WHERE session_id=? ORDER BY revision DESC LIMIT 1').get(sessionId);
    const briefId = existing?.brief_id || id('brief'); const revision = this.aggregateRevision('brief', sessionId, existing?.revision || 0) + 1;
    const createdAt = existing?.created_at || new Date(this.nowMs()).toISOString();
    const event = this._appendPhysicalEvent({
      eventKind: 'brief.revised/v1', aggregateKind: 'brief', aggregateId: sessionId, aggregateRevision: revision,
      sessionId, wakeId, actor, commandId, causation: { action: 'brief_revised' },
      payload: { briefId, objective, scopePaths, acceptance, nonGoals, fieldHashes, createdAt },
    });
    return { ...this.getBrief(sessionId), worldEventSequence: event.sequence, worldEventHash: event.event_hash };
  }
  getBrief(sessionId) {
    this.assertVerified();
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
  listBriefRevisions(sessionId) {
    this.assertVerified();
    return this.sqlite.prepare('SELECT * FROM world_work_briefs WHERE session_id=? ORDER BY revision').all(sessionId).map(row => ({
      briefId: row.brief_id, sessionId: row.session_id, revision: row.revision, objective: row.objective,
      scopePaths: JSON.parse(row.scope_paths_json), acceptance: JSON.parse(row.acceptance_json), nonGoals: JSON.parse(row.non_goals_json),
      fieldHashes: JSON.parse(row.field_hashes_json), createdAt: row.created_at, updatedAt: row.updated_at,
      worldEventSequence: row.last_event_sequence, worldEventHash: row.last_event_hash,
    }));
  }
  createApproval({ sessionId, wakeId = null, commandId = null, actor = commandId ? 'resident_tool' : 'world_internal', kind, payload, preview }) {
    this.assertVerified();
    this.ensureLifespan(sessionId);
    const approvalId = id('approval');
    const event = this._appendPhysicalEvent({
      eventKind: 'approval.opened/v1', aggregateKind: 'approval', aggregateId: approvalId, aggregateRevision: 1,
      sessionId, wakeId, actor, commandId, causation: { action: 'approval_opened' }, payload: { approvalId, kind, payload, preview },
    });
    return { ...this.getApproval(approvalId), worldEventSequence: event.sequence, worldEventHash: event.event_hash };
  }
  getApproval(approvalId) {
    this.assertVerified();
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
      application: row.application_json ? JSON.parse(row.application_json) : null,
      outcome: row.outcome_json ? JSON.parse(row.outcome_json) : null,
      createdAt: row.created_at,
      decidedAt: row.decided_at,
      revision: row.revision,
      worldEventSequence: row.last_event_sequence,
      worldEventHash: row.last_event_hash,
    };
  }
  listApprovals(sessionId, { pendingOnly = false } = {}) {
    this.assertVerified();
    const rows = pendingOnly
      ? this.sqlite.prepare("SELECT * FROM world_approvals WHERE session_id=? AND status='pending' ORDER BY created_at, approval_id").all(sessionId)
      : this.sqlite.prepare('SELECT * FROM world_approvals WHERE session_id=? ORDER BY created_at, approval_id').all(sessionId);
    return rows.map(row => this.getApproval(row.approval_id));
  }
  beginApprovalApplication(approvalId, { attemptId = id('approval_attempt'), evidence, commandId, actor = 'builder' } = {}) {
    this.assertVerified();
    const row = this.getApproval(approvalId);
    if (!row) throw Object.assign(new Error('Approval not found.'), { code: 'workshop_approval_not_found' });
    if (row.status !== 'pending') throw Object.assign(new Error('Approval is no longer pending.'), { code: 'workshop_approval_not_pending' });
    if (typeof commandId !== 'string' || !commandId || typeof attemptId !== 'string' || !attemptId || !evidence || typeof evidence !== 'object' || Array.isArray(evidence)) throw Object.assign(new Error('Approval application identity and evidence are required.'), { code: 'workshop_approval_application_invalid' });
    const revision = this.aggregateRevision('approval', approvalId, row.revision) + 1;
    const event = this._appendPhysicalEvent({
      eventKind: 'approval.applying/v1', aggregateKind: 'approval', aggregateId: approvalId, aggregateRevision: revision,
      sessionId: row.sessionId, wakeId: row.wakeId, actor, commandId, causation: { action: 'approval_applying' }, payload: { attemptId, evidence },
    });
    return { ...this.getApproval(approvalId), worldEventSequence: event.sequence, worldEventHash: event.event_hash };
  }
  decideApproval(approvalId, decision, outcome = null, { commandId = null, actor = commandId ? 'builder' : 'world_internal' } = {}) {
    this.assertVerified();
    const row = this.getApproval(approvalId);
    if (!row) throw Object.assign(new Error('Approval not found.'), { code: 'workshop_approval_not_found' });
    if (decision !== 'confirm' && decision !== 'reject') throw Object.assign(new Error('Approval decision must be confirm or reject.'), { code: 'workshop_invalid_argument' });
    const status = decision === 'confirm' ? 'confirmed' : 'rejected';
    if (decision === 'confirm' && row.status !== 'applying' || decision === 'reject' && row.status !== 'pending') throw Object.assign(new Error('Approval is no longer in a state that permits this decision.'), { code: 'workshop_approval_not_pending' });
    const attemptId = decision === 'confirm' ? row.application?.attemptId : null;
    const revision = this.aggregateRevision('approval', approvalId, row.revision) + 1;
    const event = this._appendPhysicalEvent({
      eventKind: 'approval.resolved/v1', aggregateKind: 'approval', aggregateId: approvalId, aggregateRevision: revision,
      sessionId: row.sessionId, wakeId: row.wakeId, actor, commandId, causation: { action: decision === 'confirm' ? 'approval_confirmed' : 'approval_rejected' }, payload: { status, attemptId, outcome },
    });
    return { ...this.getApproval(approvalId), worldEventSequence: event.sequence, worldEventHash: event.event_hash };
  }
  _cancelApproval(approvalId, reason, { actor = 'world_lifespan', commandId = null } = {}) {
    const row = this.getApproval(approvalId);
    if (!row || row.status !== 'pending') return null;
    const revision = this.aggregateRevision('approval', approvalId, row.revision) + 1;
    const event = this._appendPhysicalEvent({
      eventKind: 'approval.cancelled/v1', aggregateKind: 'approval', aggregateId: approvalId, aggregateRevision: revision,
      sessionId: row.sessionId, wakeId: row.wakeId, actor, commandId, causation: { action: 'approval_cancelled' }, payload: { reason },
    });
    return { ...this.getApproval(approvalId), worldEventSequence: event.sequence, worldEventHash: event.event_hash };
  }
  cancelPendingApprovals(sessionId, reason) {
    this.assertVerified();
    const pending = this.listApprovals(sessionId, { pendingOnly: true });
    for (const item of pending) this._cancelApproval(item.approvalId, reason);
    return pending.map(item => item.approvalId);
  }
  recordApprovalReceipt({ approvalId, phase, actionReceiptId, result, hostReturnScrub, worldEventSequence = null, worldEventHash = null }) {
    this.assertVerified();
    const approval = this.getApproval(approvalId);
    if (!approval) throw Object.assign(new Error('Approval not found.'), { code: 'workshop_approval_not_found' });
    if (!['pending', 'applying', 'reconciliation_required', 'confirmed', 'rejected', 'cancelled'].includes(phase)) throw Object.assign(new Error('Approval receipt phase is invalid.'), { code: 'workshop_invalid_argument' });
    const scrub = hostReturnScrub?.receipt ? hostReturnScrub.receipt : hostReturnScrub;
    if (!scrub || typeof scrub.receiptId !== 'string') throw Object.assign(new Error('Approval completion requires a host-return Scrub receipt.'), { code: 'host_return_scrub_invalid' });
    if ((worldEventSequence === null) !== (worldEventHash === null) || worldEventSequence === null) throw Object.assign(new Error('Approval receipt requires one exact World event link.'), { code: 'world_event_link_invalid' });
    const action = this.sqlite.prepare('SELECT world_event_sequence,world_event_hash FROM world_action_receipts WHERE receipt_id=?').get(actionReceiptId);
    if (!action || action.world_event_sequence !== worldEventSequence || action.world_event_hash !== worldEventHash) throw Object.assign(new Error('Approval and action receipt World event links differ.'), { code: 'world_event_link_invalid' });
    const receiptId = id('approval_receipt');
    this.sqlite.prepare(`INSERT INTO world_approval_receipts(${APPROVAL_RECEIPT_COLUMNS.join(',')}) VALUES(${APPROVAL_RECEIPT_COLUMNS.map(() => '?').join(',')})`)
      .run(receiptId, approvalId, approval.sessionId, approval.wakeId || null, phase, actionReceiptId, canonicalize(result), canonicalize(scrub), worldEventSequence, worldEventHash, NOW());
    return { receiptId, approvalId, phase, actionReceiptId, hostReturnScrubReceiptId: scrub.receiptId, worldEventSequence, worldEventHash };
  }
  listApprovalReceipts(approvalId) {
    return this.sqlite.prepare('SELECT receipt_id AS receiptId, approval_id AS approvalId, session_id AS sessionId, wake_id AS wakeId, phase, action_receipt_id AS actionReceiptId, result_json AS resultJson, host_return_scrub_json AS hostReturnScrubJson, world_event_sequence AS worldEventSequence, world_event_hash AS worldEventHash, created_at AS createdAt FROM world_approval_receipts WHERE approval_id=? ORDER BY created_at, receipt_id').all(approvalId)
      .map(row => ({ ...row, result: JSON.parse(row.resultJson), hostReturnScrub: JSON.parse(row.hostReturnScrubJson) }));
  }
  listLocationEvents(sessionId) { return this.sqlite.prepare('SELECT * FROM world_location_events WHERE session_id=? ORDER BY created_at,event_id').all(sessionId); }
  close() { this.sqlite.close(); }
}

export function seedWorldGraph(path) { const store = new WorldGraphStore(path); const result = { nodes: store.sqlite.prepare('SELECT COUNT(*) AS count FROM world_nodes').get().count, edges: store.sqlite.prepare('SELECT COUNT(*) AS count FROM world_edges').get().count }; store.close(); return result; }

export { assertWorkshopRepositoryPath, resolveRepositoryPath } from '../places/hub/workshop/path-law.js';
