import { canonicalize, sha256 } from '../core/hash.js';
import {
  ACTION_RECEIPT_COLUMNS, APPROVAL_COLUMNS, APPROVAL_RECEIPT_COLUMNS, BRIEF_COLUMNS, EDGE_COLUMNS, FIXTURE_RUNTIME_COLUMNS,
  NODE_COLUMNS, TIMER_COLUMNS, WORLD_A2_PROJECTION_TABLE_SQL, WORLD_CUSTODY_TABLE_SQL, WORLD_INTEGRITY_TRIGGER_SQL,
  WORLD_PROJECTION_TABLE_SQL, createWorldEvent, custodyRowHash, insertWorldEvent, reduceWorldEvent, replayWorldEvents,
  verifyWorldA1Sqlite, verifyWorldA2Sqlite, verifyWorldSqlite,
} from './events.js';
import { topologyExtensionEventPayload } from './topology-b1.js';
import { hearthTopologyEventPayload } from './topology-hearth.js';
import { forestTopologyEventPayload } from './topology-forest.js';
import { binderWindowTopologyEventPayload } from './topology-binder-window.js';
import { spotlightTopologyEventPayload } from './topology-spotlight.js';
import { spotlightDoorTopologyEventPayload } from './topology-spotlight-door.js';

const EXTENSIONS = Object.freeze({
  hearth: {
    eventKind: 'topology.hearth_installed/v1', aggregateId: 'hearth', boundary: 'house_hearth_wake_v1', payload: hearthTopologyEventPayload,
    requirements: {}, priorRequirements: { requireHearth: false }, artifact: 'hearth', corruptStatus: 'corrupt_or_incomplete_hearth', priorCorruptStatus: 'corrupt_b1',
    backupExpectation: 'Create and verify a byte-for-byte backup of the World database before applying the House Hearth migration.',
    backupError: ['House Hearth migration requires explicit confirmation that a recoverable World database backup exists.', 'world_hearth_backup_required'],
    refusalError: ['House Hearth migration refused because the B1 journal is corrupt or a partial Hearth extension exists.', 'world_hearth_migration_refused'],
    verificationError: ['House Hearth migration did not produce a verified projection.', 'world_hearth_migration_verification_failed'], topologyVersion: 'hearth',
  },
  forest: {
    eventKind: 'topology.forest_installed/v1', aggregateId: 'forest', boundary: 'forest_place_v1', payload: forestTopologyEventPayload,
    requirements: { requireHearth: true, requireForest: true }, priorRequirements: { requireHearth: true, requireForest: false }, artifact: 'forest', corruptStatus: 'corrupt_or_incomplete_forest', priorCorruptStatus: 'corrupt_hearth',
    backupExpectation: 'Create and verify a byte-for-byte backup of the World database before applying the Forest-place migration.',
    backupError: ['Forest-place migration requires explicit confirmation that a recoverable World database backup exists.', 'world_forest_backup_required'],
    refusalError: ['Forest-place migration refused because the Hearth journal is corrupt or a partial Forest extension exists.', 'world_forest_migration_refused'],
    verificationError: ['Forest-place migration did not produce a verified projection.', 'world_forest_migration_verification_failed'], topologyVersion: 'forest',
  },
  binderWindow: {
    eventKind: 'topology.binder_window_installed/v1', aggregateId: 'binder_window', boundary: 'binder_window_v1', payload: binderWindowTopologyEventPayload,
    requirements: { requireHearth: true, requireForest: true, requireBinderWindow: true }, priorRequirements: { requireHearth: true, requireForest: true, requireBinderWindow: false }, artifact: 'binderWindow', corruptStatus: 'corrupt_or_incomplete_binder_window', priorCorruptStatus: 'corrupt_forest',
    backupExpectation: 'Create and verify a byte-for-byte backup of the World database before applying the Binder Window migration.',
    backupError: ['Binder Window migration requires explicit confirmation that a recoverable World database backup exists.', 'world_binder_window_backup_required'],
    refusalError: ['Binder Window migration refused because the Forest journal is corrupt or a partial Binder Window extension exists.', 'world_binder_window_migration_refused'],
    verificationError: ['Binder Window migration did not produce a verified projection.', 'world_binder_window_migration_verification_failed'], topologyVersion: 'binder_window',
  },
  spotlight: {
    eventKind: 'topology.spotlight_installed/v1', aggregateId: 'spotlight', boundary: 'spotlight_observatory_v1', payload: spotlightTopologyEventPayload,
    requirements: { requireHearth: true, requireForest: true, requireBinderWindow: true, requireSpotlight: true }, priorRequirements: { requireHearth: true, requireForest: true, requireBinderWindow: true, requireSpotlight: false }, artifact: 'spotlight', corruptStatus: 'corrupt_or_incomplete_spotlight', priorCorruptStatus: 'corrupt_binder_window',
    backupExpectation: 'Create and verify a byte-for-byte backup of the World database before applying the Spotlight Observatory migration.',
    backupError: ['Spotlight Observatory migration requires explicit confirmation that a recoverable World database backup exists.', 'world_spotlight_backup_required'],
    refusalError: ['Spotlight Observatory migration refused because the Binder Window journal is corrupt or a partial Spotlight extension exists.', 'world_spotlight_migration_refused'],
    verificationError: ['Spotlight Observatory migration did not produce a verified projection.', 'world_spotlight_migration_verification_failed'], topologyVersion: 'spotlight',
  },
  spotlightDoor: {
    eventKind: 'topology.spotlight_door_installed/v1', aggregateId: 'spotlight_door', boundary: 'spotlight_observatory_door_v1', payload: spotlightDoorTopologyEventPayload,
    requirements: { requireHearth: true, requireForest: true, requireBinderWindow: true, requireSpotlight: true, requireSpotlightDoor: true }, priorRequirements: { requireHearth: true, requireForest: true, requireBinderWindow: true, requireSpotlight: true, requireSpotlightDoor: false }, artifact: 'spotlightDoor', corruptStatus: 'corrupt_or_incomplete_spotlight_door', priorCorruptStatus: 'corrupt_spotlight',
    backupExpectation: 'Create and verify a byte-for-byte backup of the World database before applying the Spotlight door migration.',
    backupError: ['Spotlight door migration requires explicit confirmation that a recoverable World database backup exists.', 'world_spotlight_door_backup_required'],
    refusalError: ['Spotlight door migration refused because the Spotlight journal is corrupt or a partial door extension exists.', 'world_spotlight_door_migration_refused'],
    verificationError: ['Spotlight door migration did not produce a verified projection.', 'world_spotlight_door_migration_verification_failed'], topologyVersion: 'spotlight',
  },
});

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

export function tableRows(store, table) {
  const exists = store.sqlite.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=?").get(table);
  return exists ? store.sqlite.prepare(`SELECT * FROM ${table}`).all() : [];
}

export function assertLegacyA1OperationalAdmission(store) {
  for (const [table, expected] of Object.entries(LEGACY_A1_OPERATIONAL_TABLE_SQL)) {
    const actual = store.sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table)?.sql;
    if (normalizeSchemaSql(actual) !== normalizeSchemaSql(expected)) throw Object.assign(new Error(`Unsupported pre-A2 schema for ${table}.`), { code: 'world_a2_legacy_schema_invalid', table });
  }
  for (const trigger of ['world_action_receipts_append_only_update', 'world_action_receipts_append_only_delete', 'world_approval_receipts_append_only_update', 'world_approval_receipts_append_only_delete']) {
    const actual = store.sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?").get(trigger)?.sql;
    if (normalizeTriggerSql(actual) !== normalizeTriggerSql(WORLD_INTEGRITY_TRIGGER_SQL[trigger])) throw Object.assign(new Error(`Unsupported pre-A2 integrity trigger: ${trigger}.`), { code: 'world_a2_legacy_trigger_invalid', trigger });
  }
  const violations = store.sqlite.prepare('PRAGMA foreign_key_check').all();
  if (violations.length) throw Object.assign(new Error('Pre-A2 World database has foreign-key violations.'), { code: 'world_a2_legacy_foreign_key_invalid', violations });
}

export function validateLegacyOperationalRelations(store, { fixtureRuntimes, timers, briefs, approvals, actionReceipts, approvalReceipts }) {
  const nodes = new Map(tableRows(store, 'world_nodes').map(row => [row.id, row]));
  const locations = new Map(tableRows(store, 'world_locations').map(row => [row.session_id, row]));
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

export function inspectA2Upgrade(store) {
  const installedB1 = verifyWorldSqlite(store.sqlite, { mismatchLimit: 50 });
  if (installedB1.verified) return { status: 'current', upgradeRequired: false, verification: installedB1, supersededBy: 'B1' };
  const current = verifyWorldA2Sqlite(store.sqlite, { mismatchLimit: 50 });
  if (current.verified) return { status: 'current', upgradeRequired: false, verification: current };
  const boundary = store.sqlite.prepare("SELECT sequence,event_hash FROM world_event_journal WHERE event_kind='operational_snapshot.imported/v1' ORDER BY sequence LIMIT 1").get();
  const a1 = verifyWorldA1Sqlite(store.sqlite, { mismatchLimit: 50 });
  if (boundary) return { status: 'corrupt_or_incomplete_a2', upgradeRequired: false, boundary, verification: current };
  if (!a1.verified) return { status: 'corrupt_a1', upgradeRequired: false, verification: a1 };
  return { status: 'upgrade_required', upgradeRequired: true, verification: a1, backupExpectation: 'Create and verify a byte-for-byte backup of the World database before applying the A2 migration.' };
}

export function inspectB1Upgrade(store) {
  const current = verifyWorldSqlite(store.sqlite, { mismatchLimit: 50, requireHearth: false });
  if (current.verified) return { status: 'current', upgradeRequired: false, verification: current };
  const extension = store.sqlite.prepare("SELECT sequence,event_hash FROM world_event_journal WHERE event_kind='topology.extended/v1' ORDER BY sequence LIMIT 1").get();
  const partialArtifacts = ['world_passages', 'world_object_states', 'world_passages_append_only_update', 'world_passages_append_only_delete'].filter(name => store.sqlite.prepare("SELECT 1 AS ok FROM sqlite_master WHERE name=? AND type IN ('table','trigger')").get(name));
  if (extension || partialArtifacts.length) return { status: 'corrupt_or_incomplete_b1', upgradeRequired: false, extension: extension || null, partialArtifacts, verification: current };
  const a2 = verifyWorldA2Sqlite(store.sqlite, { mismatchLimit: 50 });
  if (!a2.verified) return { status: 'corrupt_a2', upgradeRequired: false, verification: a2 };
  return { status: 'upgrade_required', upgradeRequired: true, verification: a2, backupExpectation: 'Create and verify a byte-for-byte backup of the World database before applying the B1 migration.' };
}

export function rebuildOperationalTablesForBoundary(store) {
  assertLegacyA1OperationalAdmission(store);
  const fixtureRuntimes = tableRows(store, 'world_fixture_runtime').map(row => ({ fixture_id: row.fixture_id, state_json: row.state_json, revision: 1, updated_at: row.updated_at })).sort((a, b) => a.fixture_id.localeCompare(b.fixture_id));
  const timers = tableRows(store, 'world_timers').map(row => ({ session_id: row.session_id, seconds: row.seconds, due_at: row.due_at, created_at: row.created_at, revision: 1 })).sort((a, b) => a.session_id.localeCompare(b.session_id));
  const briefs = tableRows(store, 'world_work_briefs').map(row => ({ brief_id: row.brief_id, session_id: row.session_id, revision: row.revision, objective: row.objective, scope_paths_json: row.scope_paths_json, acceptance_json: row.acceptance_json, non_goals_json: row.non_goals_json, field_hashes_json: row.field_hashes_json, created_at: row.created_at, updated_at: row.updated_at })).sort((a, b) => a.session_id.localeCompare(b.session_id) || a.revision - b.revision);
  const approvals = tableRows(store, 'world_approvals').map(row => ({ approval_id: row.approval_id, session_id: row.session_id, wake_id: row.wake_id ?? null, kind: row.kind, status: row.status, payload_json: row.payload_json, preview_json: row.preview_json, application_json: null, outcome_json: row.outcome_json ?? null, created_at: row.created_at, decided_at: row.decided_at ?? null, revision: 1 })).sort((a, b) => a.approval_id.localeCompare(b.approval_id));
  const actionReceipts = tableRows(store, 'world_action_receipts').map(row => ({ ...Object.fromEntries(ACTION_RECEIPT_COLUMNS.map(column => [column, column.startsWith('world_event_') ? null : (row[column] ?? null)])) })).sort((a, b) => a.receipt_id.localeCompare(b.receipt_id));
  const approvalReceipts = tableRows(store, 'world_approval_receipts').map(row => ({ ...Object.fromEntries(APPROVAL_RECEIPT_COLUMNS.map(column => [column, column.startsWith('world_event_') ? null : (row[column] ?? null)])) })).sort((a, b) => a.receipt_id.localeCompare(b.receipt_id));
  validateLegacyOperationalRelations(store, { fixtureRuntimes, timers, briefs, approvals, actionReceipts, approvalReceipts });
  for (const trigger of Object.keys(WORLD_INTEGRITY_TRIGGER_SQL).filter(name => name.includes('_receipts_'))) store.sqlite.exec(`DROP TRIGGER IF EXISTS ${trigger}`);
  for (const table of ['world_approval_receipts', 'world_action_receipts', 'world_work_briefs', 'world_timers', 'world_fixture_runtime', 'world_approvals']) store.sqlite.exec(`DROP TABLE IF EXISTS ${table}`);
  for (const definition of [WORLD_PROJECTION_TABLE_SQL.world_fixture_runtime, WORLD_PROJECTION_TABLE_SQL.world_timers, WORLD_PROJECTION_TABLE_SQL.world_work_briefs, WORLD_PROJECTION_TABLE_SQL.world_approvals, WORLD_CUSTODY_TABLE_SQL.world_action_receipts, WORLD_CUSTODY_TABLE_SQL.world_approval_receipts]) store.sqlite.exec(definition);
  store.sqlite.exec('CREATE INDEX IF NOT EXISTS world_action_receipts_session_order ON world_action_receipts(session_id, created_at, receipt_id)');
  store.sqlite.exec('CREATE INDEX IF NOT EXISTS world_approvals_session_order ON world_approvals(session_id, created_at, approval_id)');
  store.sqlite.exec('CREATE INDEX IF NOT EXISTS world_approval_receipts_approval_order ON world_approval_receipts(approval_id, created_at, receipt_id)');
  for (const row of actionReceipts) store.sqlite.prepare(`INSERT INTO world_action_receipts(${ACTION_RECEIPT_COLUMNS.join(',')}) VALUES(${ACTION_RECEIPT_COLUMNS.map(() => '?').join(',')})`).run(...ACTION_RECEIPT_COLUMNS.map(column => row[column]));
  for (const row of approvalReceipts) store.sqlite.prepare(`INSERT INTO world_approval_receipts(${APPROVAL_RECEIPT_COLUMNS.join(',')}) VALUES(${APPROVAL_RECEIPT_COLUMNS.map(() => '?').join(',')})`).run(...APPROVAL_RECEIPT_COLUMNS.map(column => row[column]));
  for (const trigger of Object.keys(WORLD_INTEGRITY_TRIGGER_SQL).filter(name => name.includes('_receipts_'))) store.sqlite.exec(WORLD_INTEGRITY_TRIGGER_SQL[trigger]);
  const legacyCustody = {
    actionReceipts: actionReceipts.map(row => ({ receiptId: row.receipt_id, rowSha256: custodyRowHash(row, 'action') })).sort((a, b) => a.receiptId.localeCompare(b.receiptId)),
    approvalReceipts: approvalReceipts.map(row => ({ receiptId: row.receipt_id, rowSha256: custodyRowHash(row, 'approval') })).sort((a, b) => a.receiptId.localeCompare(b.receiptId)),
  };
  return { fixtureRuntimes, timers, briefs, approvals, legacyCustody };
}

export function captureExactA2OperationalBoundary(store) {
  for (const [table, expected] of Object.entries({ ...WORLD_A2_PROJECTION_TABLE_SQL, ...WORLD_CUSTODY_TABLE_SQL }).filter(([table]) => !['world_nodes', 'world_edges', 'world_locations'].includes(table))) {
    const actual = store.sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table)?.sql;
    if (normalizeSchemaSql(actual) !== normalizeSchemaSql(expected)) throw Object.assign(new Error(`Unsupported exact A2 schema for ${table}.`), { code: 'world_a2_schema_invalid', table });
  }
  const fixtureRuntimes = tableRows(store, 'world_fixture_runtime').map(row => Object.fromEntries(FIXTURE_RUNTIME_COLUMNS.slice(0, -2).map(column => [column, row[column]])));
  const timers = tableRows(store, 'world_timers').map(row => Object.fromEntries(TIMER_COLUMNS.slice(0, -2).map(column => [column, row[column]])));
  const briefs = tableRows(store, 'world_work_briefs').map(row => Object.fromEntries(BRIEF_COLUMNS.slice(0, -2).map(column => [column, row[column]])));
  const approvals = tableRows(store, 'world_approvals').map(row => Object.fromEntries(APPROVAL_COLUMNS.slice(0, -2).map(column => [column, row[column]])));
  const actionReceipts = tableRows(store, 'world_action_receipts'); const approvalReceipts = tableRows(store, 'world_approval_receipts');
  if ([...actionReceipts, ...approvalReceipts].some(row => row.world_event_sequence !== null || row.world_event_hash !== null)) throw Object.assign(new Error('Journal-less exact A2 custody cannot contain World event pointers.'), { code: 'world_a2_legacy_relation_invalid' });
  validateLegacyOperationalRelations(store, { fixtureRuntimes, timers, briefs, approvals, actionReceipts, approvalReceipts });
  const legacyCustody = {
    actionReceipts: actionReceipts.map(row => ({ receiptId: row.receipt_id, rowSha256: custodyRowHash(row, 'action') })).sort((a, b) => a.receiptId.localeCompare(b.receiptId)),
    approvalReceipts: approvalReceipts.map(row => ({ receiptId: row.receipt_id, rowSha256: custodyRowHash(row, 'approval') })).sort((a, b) => a.receiptId.localeCompare(b.receiptId)),
  };
  return { fixtureRuntimes, timers, briefs, approvals, legacyCustody };
}

export function migrateA2Boundary(store, { requireBoundary = false } = {}) {
  let inspection = inspectA2Upgrade(store); let captured = null;
  const boundary = store.sqlite.prepare("SELECT 1 AS ok FROM world_event_journal WHERE event_kind='operational_snapshot.imported/v1' LIMIT 1").get();
  if (requireBoundary && inspection.status === 'current' && !inspection.supersededBy && !boundary) {
    captured = captureExactA2OperationalBoundary(store);
    inspection = { status: 'upgrade_required', upgradeRequired: true, verification: inspection.verification };
  }
  if (!inspection.upgradeRequired) {
    if (inspection.status === 'current') return inspection;
    throw Object.assign(new Error('World A2 migration refused because the A1 journal is corrupt or an incomplete A2 boundary already exists.'), { code: 'world_a2_migration_refused', inspection });
  }
  store.sqlite.exec('PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE;');
  try {
    const imported = captured || rebuildOperationalTablesForBoundary(store);
    const prior = replayWorldEvents(store.sqlite); const head = store.eventHead(); const exact = { ...imported };
    const event = createWorldEvent({ head, eventKind: 'operational_snapshot.imported/v1', aggregateKind: 'operational_snapshot', aggregateId: 'installed', aggregateRevision: 1, actor: 'world_migration', causation: { boundary: 'pre_a2_operational_projection', physicalHeadHash: head.event_hash, physicalHeadSequence: head.sequence }, payload: { projectionSha256: sha256(canonicalize(exact)), ...exact }, occurredAt: new Date(store.nowMs()).toISOString() });
    const next = reduceWorldEvent(prior, event); insertWorldEvent(store.sqlite, event);
    store.eventFailureInjector?.({ phase: 'after_event_append', event }); store._materializeProjection(next, prior); store.eventFailureInjector?.({ phase: 'after_projection_apply', event });
    const foreignKeyViolations = store.sqlite.prepare('PRAGMA foreign_key_check').all();
    if (foreignKeyViolations.length) throw Object.assign(new Error('World A2 migration produced foreign-key violations.'), { code: 'world_a2_migration_foreign_key_failed', violations: foreignKeyViolations });
    const verification = verifyWorldA2Sqlite(store.sqlite, { mismatchLimit: 50 });
    if (!verification.verified) throw Object.assign(new Error('World A2 migration did not produce a verified projection.'), { code: 'world_a2_migration_verification_failed', verification });
    store.sqlite.exec('COMMIT;');
    return { status: 'migrated', upgradeRequired: false, boundary: { sequence: event.sequence, eventHash: event.event_hash }, verification };
  } catch (error) { try { store.sqlite.exec('ROLLBACK;'); } catch {} throw error; }
  finally { store.sqlite.exec('PRAGMA foreign_keys=ON;'); }
}

function rebuildTopologySchemaForB1(store) {
  const nodes = store.sqlite.prepare(`SELECT ${NODE_COLUMNS.join(',')} FROM world_nodes ORDER BY id`).all();
  const edges = store.sqlite.prepare(`SELECT ${EDGE_COLUMNS.join(',')} FROM world_edges ORDER BY id`).all();
  for (const trigger of ['world_nodes_append_only_update', 'world_nodes_append_only_delete', 'world_edges_append_only_update', 'world_edges_append_only_delete']) store.sqlite.exec(`DROP TRIGGER IF EXISTS ${trigger}`);
  const nodeCreate = WORLD_PROJECTION_TABLE_SQL.world_nodes.replace('CREATE TABLE IF NOT EXISTS world_nodes', 'CREATE TABLE world_nodes_b1');
  const edgeCreate = WORLD_PROJECTION_TABLE_SQL.world_edges.replace('CREATE TABLE IF NOT EXISTS world_edges', 'CREATE TABLE world_edges_b1');
  store.sqlite.exec(nodeCreate);
  for (const row of nodes) store.sqlite.prepare(`INSERT INTO world_nodes_b1(${NODE_COLUMNS.join(',')}) VALUES(${NODE_COLUMNS.map(() => '?').join(',')})`).run(...NODE_COLUMNS.map(column => row[column]));
  store.sqlite.exec(edgeCreate);
  for (const row of edges) store.sqlite.prepare(`INSERT INTO world_edges_b1(${EDGE_COLUMNS.join(',')}) VALUES(${EDGE_COLUMNS.map(() => '?').join(',')})`).run(...EDGE_COLUMNS.map(column => row[column]));
  store.sqlite.exec('DROP TABLE world_edges; DROP TABLE world_nodes; ALTER TABLE world_nodes_b1 RENAME TO world_nodes; ALTER TABLE world_edges_b1 RENAME TO world_edges;');
  for (const trigger of ['world_nodes_append_only_update', 'world_nodes_append_only_delete', 'world_edges_append_only_update', 'world_edges_append_only_delete']) store.sqlite.exec(WORLD_INTEGRITY_TRIGGER_SQL[trigger]);
  store.sqlite.exec(WORLD_PROJECTION_TABLE_SQL.world_passages);
  store.sqlite.exec(WORLD_PROJECTION_TABLE_SQL.world_object_states);
  store.sqlite.exec(WORLD_INTEGRITY_TRIGGER_SQL.world_passages_append_only_update);
  store.sqlite.exec(WORLD_INTEGRITY_TRIGGER_SQL.world_passages_append_only_delete);
}

export function migrateB1Boundary(store, { admittedLegacy = false } = {}) {
  const inspection = inspectB1Upgrade(store);
  if (!inspection.upgradeRequired) {
    if (inspection.status === 'current') return inspection;
    throw Object.assign(new Error('World B1 migration refused because the A2 journal is corrupt or a partial B1 extension exists.'), { code: 'world_b1_migration_refused', inspection });
  }
  store.sqlite.exec('PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE;');
  try {
    rebuildTopologySchemaForB1(store);
    const prior = replayWorldEvents(store.sqlite); const head = store.eventHead();
    const event = createWorldEvent({ head, eventKind: 'topology.extended/v1', aggregateKind: 'topology_extension', aggregateId: 'installed', aggregateRevision: 1, actor: 'world_migration', causation: { boundary: 'b1_topology_extension', physicalHeadHash: head.event_hash, physicalHeadSequence: head.sequence }, payload: topologyExtensionEventPayload(), occurredAt: new Date(store.nowMs()).toISOString() });
    const next = reduceWorldEvent(prior, event); insertWorldEvent(store.sqlite, event);
    store.eventFailureInjector?.({ phase: 'after_event_append', event }); store._materializeProjection(next, prior); store.eventFailureInjector?.({ phase: 'after_projection_apply', event });
    const foreignKeyViolations = store.sqlite.prepare('PRAGMA foreign_key_check').all();
    if (foreignKeyViolations.length) throw Object.assign(new Error('World B1 migration produced foreign-key violations.'), { code: 'world_b1_migration_foreign_key_failed', violations: foreignKeyViolations });
    const verification = verifyWorldSqlite(store.sqlite, { mismatchLimit: 50, requireHearth: false });
    if (!verification.verified) throw Object.assign(new Error('World B1 migration did not produce a verified projection.'), { code: 'world_b1_migration_verification_failed', verification });
    store.sqlite.exec('COMMIT;');
    return { status: 'migrated', upgradeRequired: false, admittedLegacy, boundary: { sequence: event.sequence, eventHash: event.event_hash }, verification };
  } catch (error) { try { store.sqlite.exec('ROLLBACK;'); } catch {} throw error; }
  finally { store.sqlite.exec('PRAGMA foreign_keys=ON;'); }
}

export function inspectTopologyUpgrade(store, version) {
  const config = EXTENSIONS[version];
  const current = verifyWorldSqlite(store.sqlite, { mismatchLimit: 50, ...config.requirements });
  if (current.verified) return { status: 'current', upgradeRequired: false, verification: current };
  const artifact = store.sqlite.prepare(`SELECT sequence,event_hash FROM world_event_journal WHERE event_kind='${config.eventKind}' ORDER BY sequence LIMIT 1`).get();
  if (artifact) return { status: config.corruptStatus, upgradeRequired: false, [config.artifact]: artifact, verification: current };
  const prior = verifyWorldSqlite(store.sqlite, { mismatchLimit: 50, ...config.priorRequirements });
  if (!prior.verified) return { status: config.priorCorruptStatus, upgradeRequired: false, verification: prior };
  return { status: 'upgrade_required', upgradeRequired: true, verification: prior, backupExpectation: config.backupExpectation };
}

export function migrateTopologyExtension(store, version, { backupConfirmed = false } = {}) {
  const config = EXTENSIONS[version];
  if (backupConfirmed !== true) throw Object.assign(new Error(config.backupError[0]), { code: config.backupError[1] });
  const inspection = inspectTopologyUpgrade(store, version);
  if (!inspection.upgradeRequired) {
    if (inspection.status === 'current') return inspection;
    throw Object.assign(new Error(config.refusalError[0]), { code: config.refusalError[1], inspection });
  }
  store.sqlite.exec('BEGIN IMMEDIATE;');
  try {
    const prior = replayWorldEvents(store.sqlite); const head = store.eventHead();
    const event = createWorldEvent({ head, eventKind: config.eventKind, aggregateKind: 'topology_extension', aggregateId: config.aggregateId, aggregateRevision: 1, actor: 'world_migration', causation: { boundary: config.boundary, physicalHeadHash: head.event_hash, physicalHeadSequence: head.sequence }, payload: config.payload(), occurredAt: new Date(store.nowMs()).toISOString() });
    const next = reduceWorldEvent(prior, event); insertWorldEvent(store.sqlite, event); store.eventFailureInjector?.({ phase: 'after_event_append', event }); store._materializeProjection(next, prior); store.eventFailureInjector?.({ phase: 'after_projection_apply', event });
    const verification = verifyWorldSqlite(store.sqlite, { mismatchLimit: 50, ...config.requirements });
    if (!verification.verified) throw Object.assign(new Error(config.verificationError[0]), { code: config.verificationError[1], verification });
    store.sqlite.exec('COMMIT;'); store.topologyVersion = config.topologyVersion;
    return { status: 'migrated', upgradeRequired: false, boundary: { sequence: event.sequence, eventHash: event.event_hash }, verification };
  } catch (error) { try { store.sqlite.exec('ROLLBACK;'); } catch {} throw error; }
}
