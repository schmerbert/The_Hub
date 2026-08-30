import { DatabaseSync } from 'node:sqlite';
import { canonicalize, id, sha256 } from '../core/hash.js';
import { installedTopologyHash, installedTopologyManifest } from './topology.js';
import { extendedTopologyHash, extendedTopologyManifest } from './topology-b1.js';
import { hearthTopologyHash, hearthTopologyManifest } from './topology-hearth.js';
import { forestTopologyHash, forestTopologyManifest } from './topology-forest.js';
import { binderWindowTopologyHash, binderWindowTopologyManifest } from './topology-binder-window.js';
import { spotlightTopologyHash, spotlightTopologyManifest } from './topology-spotlight.js';

export const WORLD_PROJECTOR_VERSION = 6;
export const WORLD_EVENT_GENESIS_HASH = '0'.repeat(64);

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

export const WORLD_EVENT_KINDS = deepFreeze({
  'topology.installed/v1': { schemaVersion: 1, stretch: 'A1' },
  'legacy_snapshot.imported/v1': { schemaVersion: 1, stretch: 'A1' },
  'lifespan.started/v1': { schemaVersion: 1, stretch: 'A1' },
  'location.moved/v1': { schemaVersion: 1, stretch: 'A1' },
  'source.inspected/v1': { schemaVersion: 1, stretch: 'A1' },
  'fixture.engaged/v1': { schemaVersion: 1, stretch: 'A1' },
  'fixture.disengaged/v1': { schemaVersion: 1, stretch: 'A1' },
  'operational_snapshot.imported/v1': { schemaVersion: 1, stretch: 'A2' },
  'fixture_runtime.replaced/v1': { schemaVersion: 1, stretch: 'A2' },
  'timer.set/v1': { schemaVersion: 1, stretch: 'A2' },
  'timer.cleared/v1': { schemaVersion: 1, stretch: 'A2' },
  'brief.revised/v1': { schemaVersion: 1, stretch: 'A2' },
  'approval.opened/v1': { schemaVersion: 1, stretch: 'A2' },
  'approval.applying/v1': { schemaVersion: 1, stretch: 'A2' },
  'approval.resolved/v1': { schemaVersion: 1, stretch: 'A2' },
  'approval.cancelled/v1': { schemaVersion: 1, stretch: 'A2' },
  'approval.reconciliation_required/v1': { schemaVersion: 1, stretch: 'A2' },
  'topology.extended/v1': { schemaVersion: 1, stretch: 'B1' },
  'topology.hearth_installed/v1': { schemaVersion: 1, stretch: 'H1' },
  'topology.forest_installed/v1': { schemaVersion: 1, stretch: 'F1' },
  'topology.binder_window_installed/v1': { schemaVersion: 1, stretch: 'BW1' },
  'topology.spotlight_installed/v1': { schemaVersion: 1, stretch: 'SP1' },
  'room.installation.revised/v1': { schemaVersion: 1, stretch: 'B1' },
  'location.crossed/v1': { schemaVersion: 1, stretch: 'B1' },
  'passage.operated/v1': { schemaVersion: 1, stretch: 'B1' },
  'fixture.turned/v1': { schemaVersion: 1, stretch: 'B1' },
});

export const WORLD_INTEGRITY_TRIGGER_SQL = Object.freeze({
  world_event_journal_contiguous_insert: `CREATE TRIGGER IF NOT EXISTS world_event_journal_contiguous_insert BEFORE INSERT ON world_event_journal
BEGIN
  SELECT CASE WHEN NEW.sequence != COALESCE((SELECT MAX(sequence)+1 FROM world_event_journal),1)
    THEN RAISE(ABORT, 'world event sequence must be contiguous') END;
END;`,
  world_event_journal_append_only_update: `CREATE TRIGGER IF NOT EXISTS world_event_journal_append_only_update BEFORE UPDATE ON world_event_journal
BEGIN SELECT RAISE(ABORT, 'world event journal is append-only'); END;`,
  world_event_journal_append_only_delete: `CREATE TRIGGER IF NOT EXISTS world_event_journal_append_only_delete BEFORE DELETE ON world_event_journal
BEGIN SELECT RAISE(ABORT, 'world event journal is append-only'); END;`,
  world_nodes_append_only_update: `CREATE TRIGGER IF NOT EXISTS world_nodes_append_only_update BEFORE UPDATE ON world_nodes
BEGIN SELECT RAISE(ABORT, 'standing world nodes are append-only'); END;`,
  world_nodes_append_only_delete: `CREATE TRIGGER IF NOT EXISTS world_nodes_append_only_delete BEFORE DELETE ON world_nodes
BEGIN SELECT RAISE(ABORT, 'standing world nodes are append-only'); END;`,
  world_edges_append_only_update: `CREATE TRIGGER IF NOT EXISTS world_edges_append_only_update BEFORE UPDATE ON world_edges
BEGIN SELECT RAISE(ABORT, 'standing world edges are append-only'); END;`,
  world_edges_append_only_delete: `CREATE TRIGGER IF NOT EXISTS world_edges_append_only_delete BEFORE DELETE ON world_edges
BEGIN SELECT RAISE(ABORT, 'standing world edges are append-only'); END;`,
  world_passages_append_only_update: `CREATE TRIGGER IF NOT EXISTS world_passages_append_only_update BEFORE UPDATE ON world_passages
BEGIN SELECT RAISE(ABORT, 'standing world passages are append-only'); END;`,
  world_passages_append_only_delete: `CREATE TRIGGER IF NOT EXISTS world_passages_append_only_delete BEFORE DELETE ON world_passages
BEGIN SELECT RAISE(ABORT, 'standing world passages are append-only'); END;`,
  world_action_receipts_append_only_update: `CREATE TRIGGER IF NOT EXISTS world_action_receipts_append_only_update BEFORE UPDATE ON world_action_receipts
BEGIN SELECT RAISE(ABORT, 'append-only table'); END;`,
  world_action_receipts_append_only_delete: `CREATE TRIGGER IF NOT EXISTS world_action_receipts_append_only_delete BEFORE DELETE ON world_action_receipts
BEGIN SELECT RAISE(ABORT, 'append-only table'); END;`,
  world_approval_receipts_append_only_update: `CREATE TRIGGER IF NOT EXISTS world_approval_receipts_append_only_update BEFORE UPDATE ON world_approval_receipts
BEGIN SELECT RAISE(ABORT, 'append-only table'); END;`,
  world_approval_receipts_append_only_delete: `CREATE TRIGGER IF NOT EXISTS world_approval_receipts_append_only_delete BEFORE DELETE ON world_approval_receipts
BEGIN SELECT RAISE(ABORT, 'append-only table'); END;`,
});

export const WORLD_A2_PROJECTION_TABLE_SQL = Object.freeze({
  world_nodes: "CREATE TABLE IF NOT EXISTS world_nodes (id TEXT PRIMARY KEY, node_type TEXT NOT NULL CHECK(node_type IN ('room','fixture','object','station')), resident_text TEXT NOT NULL, state_json TEXT NOT NULL, lifecycle TEXT NOT NULL CHECK(lifecycle IN ('standing','retired')), revision INTEGER NOT NULL CHECK(revision>0), created_at TEXT NOT NULL, last_event_sequence INTEGER, last_event_hash TEXT);",
  world_edges: "CREATE TABLE IF NOT EXISTS world_edges (id TEXT PRIMARY KEY, edge_type TEXT NOT NULL CHECK(edge_type IN ('door','contains')), from_node_id TEXT NOT NULL REFERENCES world_nodes(id), to_node_id TEXT NOT NULL REFERENCES world_nodes(id), door_identity TEXT, label TEXT, created_at TEXT NOT NULL, last_event_sequence INTEGER, last_event_hash TEXT, UNIQUE(edge_type, from_node_id, to_node_id));",
  world_locations: "CREATE TABLE IF NOT EXISTS world_locations (session_id TEXT PRIMARY KEY, room_node_id TEXT NOT NULL REFERENCES world_nodes(id), inspected_source TEXT, engaged_fixture_id TEXT REFERENCES world_nodes(id), revision INTEGER NOT NULL CHECK(revision>0), started_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_event_sequence INTEGER, last_event_hash TEXT);",
  world_fixture_runtime: "CREATE TABLE IF NOT EXISTS world_fixture_runtime (fixture_id TEXT PRIMARY KEY REFERENCES world_nodes(id), state_json TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0), updated_at TEXT NOT NULL, last_event_sequence INTEGER NOT NULL, last_event_hash TEXT NOT NULL);",
  world_timers: "CREATE TABLE IF NOT EXISTS world_timers (session_id TEXT PRIMARY KEY REFERENCES world_locations(session_id), seconds INTEGER NOT NULL CHECK(seconds>=1 AND seconds<=3600), due_at TEXT NOT NULL, created_at TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0), last_event_sequence INTEGER NOT NULL, last_event_hash TEXT NOT NULL);",
  world_work_briefs: "CREATE TABLE IF NOT EXISTS world_work_briefs (brief_id TEXT NOT NULL, session_id TEXT NOT NULL REFERENCES world_locations(session_id), revision INTEGER NOT NULL CHECK(revision>0), objective TEXT NOT NULL, scope_paths_json TEXT NOT NULL, acceptance_json TEXT NOT NULL, non_goals_json TEXT NOT NULL, field_hashes_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_event_sequence INTEGER NOT NULL, last_event_hash TEXT NOT NULL, PRIMARY KEY(session_id,revision));",
  world_approvals: "CREATE TABLE IF NOT EXISTS world_approvals (approval_id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES world_locations(session_id), wake_id TEXT, kind TEXT NOT NULL CHECK(kind IN ('patch','unified_diff','write_file','create_path','delete_path','rename_path','git_add','commit','git_checkout','sandbox_promotion')), status TEXT NOT NULL CHECK(status IN ('pending','applying','reconciliation_required','confirmed','rejected','cancelled')), payload_json TEXT NOT NULL, preview_json TEXT NOT NULL, application_json TEXT, outcome_json TEXT, created_at TEXT NOT NULL, decided_at TEXT, revision INTEGER NOT NULL CHECK(revision>0), last_event_sequence INTEGER NOT NULL, last_event_hash TEXT NOT NULL);",
});

export const WORLD_PROJECTION_TABLE_SQL = Object.freeze({
  ...WORLD_A2_PROJECTION_TABLE_SQL,
  world_nodes: "CREATE TABLE IF NOT EXISTS world_nodes (id TEXT PRIMARY KEY, node_type TEXT NOT NULL CHECK(node_type IN ('room','fixture','object','station','place','boundary')), resident_text TEXT NOT NULL, state_json TEXT NOT NULL, lifecycle TEXT NOT NULL CHECK(lifecycle IN ('standing','retired')), revision INTEGER NOT NULL CHECK(revision>0), created_at TEXT NOT NULL, last_event_sequence INTEGER, last_event_hash TEXT);",
  world_edges: "CREATE TABLE IF NOT EXISTS world_edges (id TEXT PRIMARY KEY, edge_type TEXT NOT NULL CHECK(edge_type IN ('door','contains','passage','boundary')), from_node_id TEXT NOT NULL REFERENCES world_nodes(id), to_node_id TEXT NOT NULL REFERENCES world_nodes(id), door_identity TEXT, label TEXT, created_at TEXT NOT NULL, last_event_sequence INTEGER, last_event_hash TEXT, UNIQUE(edge_type, from_node_id, to_node_id));",
  world_passages: "CREATE TABLE IF NOT EXISTS world_passages (edge_id TEXT PRIMARY KEY REFERENCES world_edges(id), passage_id TEXT NOT NULL, passage_kind TEXT NOT NULL CHECK(passage_kind IN ('opening','door','threshold')), from_node_id TEXT NOT NULL REFERENCES world_nodes(id), to_node_id TEXT NOT NULL REFERENCES world_nodes(id), governed_object_id TEXT REFERENCES world_nodes(id), last_event_sequence INTEGER NOT NULL, last_event_hash TEXT NOT NULL, UNIQUE(passage_id,from_node_id,to_node_id));",
  world_object_states: "CREATE TABLE IF NOT EXISTS world_object_states (object_id TEXT PRIMARY KEY REFERENCES world_nodes(id), state_json TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0), updated_at TEXT NOT NULL, last_event_sequence INTEGER NOT NULL, last_event_hash TEXT NOT NULL);",
});

export const WORLD_CUSTODY_TABLE_SQL = Object.freeze({
  world_action_receipts: "CREATE TABLE IF NOT EXISTS world_action_receipts (receipt_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, wake_id TEXT, room_node_id TEXT NOT NULL REFERENCES world_nodes(id), tool_name TEXT NOT NULL, arguments_json TEXT NOT NULL, result_json TEXT NOT NULL, outcome TEXT NOT NULL CHECK(outcome IN ('committed','refused')), request_record_id TEXT, spine_record_id TEXT, world_event_sequence INTEGER REFERENCES world_event_journal(sequence), world_event_hash TEXT, created_at TEXT NOT NULL);",
  world_approval_receipts: "CREATE TABLE IF NOT EXISTS world_approval_receipts (receipt_id TEXT PRIMARY KEY, approval_id TEXT NOT NULL REFERENCES world_approvals(approval_id), session_id TEXT NOT NULL, wake_id TEXT, phase TEXT NOT NULL CHECK(phase IN ('pending','applying','reconciliation_required','confirmed','rejected','cancelled')), action_receipt_id TEXT NOT NULL REFERENCES world_action_receipts(receipt_id), result_json TEXT NOT NULL, host_return_scrub_json TEXT NOT NULL, world_event_sequence INTEGER REFERENCES world_event_journal(sequence), world_event_hash TEXT, created_at TEXT NOT NULL);",
});

export const WORLD_EVENT_JOURNAL_TABLE_SQL = `CREATE TABLE IF NOT EXISTS world_event_journal (
  sequence INTEGER PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE,
  event_schema_version INTEGER NOT NULL CHECK(event_schema_version>0),
  event_kind TEXT NOT NULL,
  aggregate_kind TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  aggregate_revision INTEGER NOT NULL CHECK(aggregate_revision>0),
  session_id TEXT,
  wake_id TEXT,
  actor TEXT NOT NULL,
  command_id TEXT,
  causation_json TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL,
  previous_event_hash TEXT NOT NULL,
  event_hash TEXT NOT NULL UNIQUE,
  occurred_at TEXT NOT NULL
);`;

export const WORLD_EVENT_SCHEMA = `
${WORLD_EVENT_JOURNAL_TABLE_SQL}
${WORLD_INTEGRITY_TRIGGER_SQL.world_event_journal_contiguous_insert}
${WORLD_INTEGRITY_TRIGGER_SQL.world_event_journal_append_only_update}
${WORLD_INTEGRITY_TRIGGER_SQL.world_event_journal_append_only_delete}
`;

export const NODE_COLUMNS = Object.freeze(['id', 'node_type', 'resident_text', 'state_json', 'lifecycle', 'revision', 'created_at', 'last_event_sequence', 'last_event_hash']);
export const EDGE_COLUMNS = Object.freeze(['id', 'edge_type', 'from_node_id', 'to_node_id', 'door_identity', 'label', 'created_at', 'last_event_sequence', 'last_event_hash']);
export const LOCATION_COLUMNS = Object.freeze(['session_id', 'room_node_id', 'inspected_source', 'engaged_fixture_id', 'revision', 'started_at', 'updated_at', 'last_event_sequence', 'last_event_hash']);
export const FIXTURE_RUNTIME_COLUMNS = Object.freeze(['fixture_id', 'state_json', 'revision', 'updated_at', 'last_event_sequence', 'last_event_hash']);
export const TIMER_COLUMNS = Object.freeze(['session_id', 'seconds', 'due_at', 'created_at', 'revision', 'last_event_sequence', 'last_event_hash']);
export const BRIEF_COLUMNS = Object.freeze(['brief_id', 'session_id', 'revision', 'objective', 'scope_paths_json', 'acceptance_json', 'non_goals_json', 'field_hashes_json', 'created_at', 'updated_at', 'last_event_sequence', 'last_event_hash']);
export const APPROVAL_COLUMNS = Object.freeze(['approval_id', 'session_id', 'wake_id', 'kind', 'status', 'payload_json', 'preview_json', 'application_json', 'outcome_json', 'created_at', 'decided_at', 'revision', 'last_event_sequence', 'last_event_hash']);
export const ACTION_RECEIPT_COLUMNS = Object.freeze(['receipt_id', 'session_id', 'wake_id', 'room_node_id', 'tool_name', 'arguments_json', 'result_json', 'outcome', 'request_record_id', 'spine_record_id', 'world_event_sequence', 'world_event_hash', 'created_at']);
export const APPROVAL_RECEIPT_COLUMNS = Object.freeze(['receipt_id', 'approval_id', 'session_id', 'wake_id', 'phase', 'action_receipt_id', 'result_json', 'host_return_scrub_json', 'world_event_sequence', 'world_event_hash', 'created_at']);
export const PASSAGE_COLUMNS = Object.freeze(['edge_id', 'passage_id', 'passage_kind', 'from_node_id', 'to_node_id', 'governed_object_id', 'last_event_sequence', 'last_event_hash']);
export const OBJECT_STATE_COLUMNS = Object.freeze(['object_id', 'state_json', 'revision', 'updated_at', 'last_event_sequence', 'last_event_hash']);

export function installWorldEventSchema(sqlite) {
  sqlite.exec(WORLD_EVENT_SCHEMA);
  for (const [table, columns] of [
    ['world_nodes', [['last_event_sequence', 'INTEGER'], ['last_event_hash', 'TEXT']]],
    ['world_edges', [['last_event_sequence', 'INTEGER'], ['last_event_hash', 'TEXT']]],
    ['world_locations', [['last_event_sequence', 'INTEGER'], ['last_event_hash', 'TEXT']]],
  ]) {
    const present = new Set(sqlite.prepare(`PRAGMA table_info(${table})`).all().map(column => column.name));
    for (const [column, type] of columns) if (!present.has(column)) sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

export function emptyWorldState() { return { nodes: [], edges: [], locations: [], fixtureRuntimes: [], timers: [], briefs: [], approvals: [], passages: [], objectStates: [], legacyCustody: { actionReceipts: [], approvalReceipts: [] }, rootBoundary: null, operationalBoundary: null, topologyExtension: null, hearthExtension: null, forestExtension: null, binderWindowExtension: null, spotlightExtension: null }; }
function copyState(state) {
  return {
    nodes: state.nodes.map(row => ({ ...row })), edges: state.edges.map(row => ({ ...row })), locations: state.locations.map(row => ({ ...row })),
    fixtureRuntimes: state.fixtureRuntimes.map(row => ({ ...row })), timers: state.timers.map(row => ({ ...row })), briefs: state.briefs.map(row => ({ ...row })), approvals: state.approvals.map(row => ({ ...row })),
    passages: (state.passages || []).map(row => ({ ...row })), objectStates: (state.objectStates || []).map(row => ({ ...row })),
    legacyCustody: { actionReceipts: state.legacyCustody.actionReceipts.map(row => ({ ...row })), approvalReceipts: state.legacyCustody.approvalReceipts.map(row => ({ ...row })) },
    operationalBoundary: state.operationalBoundary ? { ...state.operationalBoundary } : null,
    topologyExtension: state.topologyExtension ? { ...state.topologyExtension } : null,
    hearthExtension: state.hearthExtension ? { ...state.hearthExtension } : null,
    forestExtension: state.forestExtension ? { ...state.forestExtension } : null,
    binderWindowExtension: state.binderWindowExtension ? { ...state.binderWindowExtension } : null,
    spotlightExtension: state.spotlightExtension ? { ...state.spotlightExtension } : null,
    rootBoundary: state.rootBoundary || null,
  };
}
function canonicalObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value;
}
function exactKeys(value, keys, label) {
  const actual = Object.keys(value).sort(); const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new Error(`${label} fields are not installed.`);
}
function requiredString(value, label, { nullable = false } = {}) {
  if (nullable && value === null) return;
  if (typeof value !== 'string' || !value) throw new Error(`${label} must be a non-empty string.`);
}
function pointer(event) { return { last_event_sequence: event.sequence, last_event_hash: event.event_hash }; }
function findBy(rows, column, value) { return rows.find(row => row[column] === value); }
function replaceBy(rows, column, value, next) { return rows.map(row => row[column] === value ? next : row); }

function topologyRows(payload, event) {
  exactKeys(payload, ['manifestSha256', 'nodes', 'edges'], 'topology payload');
  if (!Array.isArray(payload.nodes) || !Array.isArray(payload.edges)) throw new Error('Topology payload rows are invalid.');
  const nodes = payload.nodes.map(node => {
    exactKeys(node, ['id', 'nodeType', 'residentText', 'state', 'lifecycle', 'revision'], 'topology node');
    canonicalObject(node, 'topology node'); requiredString(node.id, 'topology node id'); requiredString(node.nodeType, 'topology node type'); requiredString(node.residentText, 'topology resident text');
    if (!node.state || typeof node.state !== 'object' || Array.isArray(node.state)) throw new Error('Topology node state is invalid.');
    if (!['standing', 'retired'].includes(node.lifecycle) || node.revision !== 1) throw new Error('Topology node lifecycle or revision is invalid.');
    return { id: node.id, node_type: node.nodeType, resident_text: node.residentText, state_json: canonicalize(node.state), lifecycle: node.lifecycle, revision: 1, created_at: event.occurred_at, ...pointer(event) };
  });
  const edges = payload.edges.map(edge => {
    exactKeys(edge, ['id', 'edgeType', 'fromNodeId', 'toNodeId', 'doorIdentity', 'label'], 'topology edge');
    canonicalObject(edge, 'topology edge'); requiredString(edge.id, 'topology edge id'); requiredString(edge.edgeType, 'topology edge type'); requiredString(edge.fromNodeId, 'topology edge source'); requiredString(edge.toNodeId, 'topology edge target');
    if (edge.doorIdentity !== null) requiredString(edge.doorIdentity, 'topology door identity');
    if (edge.label !== null) requiredString(edge.label, 'topology edge label');
    return { id: edge.id, edge_type: edge.edgeType, from_node_id: edge.fromNodeId, to_node_id: edge.toNodeId, door_identity: edge.doorIdentity, label: edge.label, created_at: event.occurred_at, ...pointer(event) };
  });
  const manifest = { nodes: payload.nodes, edges: payload.edges };
  if (payload.manifestSha256 !== sha256(canonicalize(manifest))) throw new Error('Installed topology manifest hash is invalid.');
  if (payload.manifestSha256 !== installedTopologyHash()) throw new Error('Installed topology does not match the code-owned manifest.');
  if (new Set(nodes.map(row => row.id)).size !== nodes.length || new Set(edges.map(row => row.id)).size !== edges.length) throw new Error('Topology contains duplicate identities.');
  const ids = new Set(nodes.map(row => row.id));
  if (edges.some(row => !ids.has(row.from_node_id) || !ids.has(row.to_node_id))) throw new Error('Topology edge references an absent node.');
  return { nodes: nodes.sort((a, b) => a.id.localeCompare(b.id)), edges: edges.sort((a, b) => a.id.localeCompare(b.id)) };
}

function topologyExtensionRows(payload, event, priorState) {
  exactKeys(payload, ['manifestSha256', 'nodes', 'edges', 'passages', 'objectStates'], 'topology extension payload');
  if (!Array.isArray(payload.nodes) || !Array.isArray(payload.edges) || !Array.isArray(payload.passages) || !Array.isArray(payload.objectStates)) throw new Error('Topology extension payload rows are invalid.');
  const manifest = { nodes: payload.nodes, edges: payload.edges, passages: payload.passages, objectStates: payload.objectStates };
  if (payload.manifestSha256 !== sha256(canonicalize(manifest)) || payload.manifestSha256 !== extendedTopologyHash()) throw new Error('Topology extension does not match the code-owned manifest.');
  if (canonicalize(manifest) !== canonicalize(extendedTopologyManifest())) throw new Error('Topology extension manifest bytes are not installed.');
  const installedIds = new Set(priorState.nodes.map(row => row.id));
  const nodes = payload.nodes.map(node => {
    exactKeys(node, ['id', 'nodeType', 'residentText', 'state', 'lifecycle', 'revision'], 'extension node');
    requiredString(node.id, 'extension node id'); requiredString(node.nodeType, 'extension node type'); requiredString(node.residentText, 'extension resident text'); canonicalObject(node.state, 'extension node state');
    if (!['place', 'boundary', 'fixture', 'object'].includes(node.nodeType) || node.lifecycle !== 'standing' || node.revision !== 1 || installedIds.has(node.id)) throw new Error('Extension node identity, kind, lifecycle, or revision is invalid.');
    installedIds.add(node.id);
    return { id: node.id, node_type: node.nodeType, resident_text: node.residentText, state_json: canonicalize(node.state), lifecycle: node.lifecycle, revision: 1, created_at: event.occurred_at, ...pointer(event) };
  });
  const edgeIds = new Set(priorState.edges.map(row => row.id));
  const edges = payload.edges.map(edge => {
    exactKeys(edge, ['id', 'edgeType', 'fromNodeId', 'toNodeId', 'doorIdentity', 'label'], 'extension edge');
    requiredString(edge.id, 'extension edge id'); requiredString(edge.edgeType, 'extension edge type'); requiredString(edge.fromNodeId, 'extension edge source'); requiredString(edge.toNodeId, 'extension edge target');
    if (!['contains', 'passage', 'boundary'].includes(edge.edgeType) || edgeIds.has(edge.id) || !installedIds.has(edge.fromNodeId) || !installedIds.has(edge.toNodeId)) throw new Error('Extension edge identity, kind, or endpoint is invalid.');
    if (edge.doorIdentity !== null) requiredString(edge.doorIdentity, 'extension door identity');
    if (edge.label !== null) requiredString(edge.label, 'extension edge label');
    edgeIds.add(edge.id);
    return { id: edge.id, edge_type: edge.edgeType, from_node_id: edge.fromNodeId, to_node_id: edge.toNodeId, door_identity: edge.doorIdentity, label: edge.label, created_at: event.occurred_at, ...pointer(event) };
  });
  const edgeById = new Map(edges.map(row => [row.id, row]));
  const passages = payload.passages.map(row => {
    exactKeys(row, ['edgeId', 'passageId', 'passageKind', 'fromNodeId', 'toNodeId', 'governedObjectId'], 'extension passage');
    requiredString(row.edgeId, 'passage edge'); requiredString(row.passageId, 'passage identity'); requiredString(row.passageKind, 'passage kind'); requiredString(row.fromNodeId, 'passage source'); requiredString(row.toNodeId, 'passage target');
    if (row.governedObjectId !== null) requiredString(row.governedObjectId, 'passage governed object');
    const edge = edgeById.get(row.edgeId);
    if (!edge || edge.edge_type !== 'passage' || edge.from_node_id !== row.fromNodeId || edge.to_node_id !== row.toNodeId || !['opening', 'door', 'threshold'].includes(row.passageKind) || (row.governedObjectId !== null && !installedIds.has(row.governedObjectId))) throw new Error('Passage definition does not match its installed edge.');
    return { edge_id: row.edgeId, passage_id: row.passageId, passage_kind: row.passageKind, from_node_id: row.fromNodeId, to_node_id: row.toNodeId, governed_object_id: row.governedObjectId, ...pointer(event) };
  });
  if (new Set(passages.map(row => row.edge_id)).size !== passages.length) throw new Error('Topology extension contains duplicate passage routes.');
  const objectStates = payload.objectStates.map(row => {
    exactKeys(row, ['objectId', 'state', 'revision'], 'extension object state'); requiredString(row.objectId, 'object state identity'); canonicalObject(row.state, 'object state');
    if (row.revision !== 1 || !installedIds.has(row.objectId)) throw new Error('Extension object state identity or revision is invalid.');
    return { object_id: row.objectId, state_json: canonicalize(row.state), revision: 1, updated_at: event.occurred_at, ...pointer(event) };
  });
  if (new Set(objectStates.map(row => row.object_id)).size !== objectStates.length) throw new Error('Topology extension contains duplicate object states.');
  return { nodes, edges, passages, objectStates };
}

function hearthExtensionRows(payload, event, priorState) {
  exactKeys(payload, ['manifestSha256', 'nodes', 'edges'], 'Hearth topology payload');
  const manifest = { nodes: payload.nodes, edges: payload.edges };
  if (payload.manifestSha256 !== sha256(canonicalize(manifest)) || payload.manifestSha256 !== hearthTopologyHash() || canonicalize(manifest) !== canonicalize(hearthTopologyManifest())) throw new Error('Hearth topology does not match the code-owned manifest.');
  const installedIds = new Set(priorState.nodes.map(row => row.id));
  const nodes = payload.nodes.map(node => {
    exactKeys(node, ['id', 'nodeType', 'residentText', 'state', 'lifecycle', 'revision'], 'Hearth node');
    if (node.id !== 'fixture.hearth' || node.nodeType !== 'fixture' || node.lifecycle !== 'standing' || node.revision !== 1 || installedIds.has(node.id)) throw new Error('Hearth node is invalid.');
    canonicalObject(node.state, 'Hearth node state'); installedIds.add(node.id);
    return { id: node.id, node_type: node.nodeType, resident_text: node.residentText, state_json: canonicalize(node.state), lifecycle: node.lifecycle, revision: 1, created_at: event.occurred_at, ...pointer(event) };
  });
  const edgeIds = new Set(priorState.edges.map(row => row.id));
  const edges = payload.edges.map(edge => {
    exactKeys(edge, ['id', 'edgeType', 'fromNodeId', 'toNodeId', 'doorIdentity', 'label'], 'Hearth edge');
    if (edge.id !== 'edge.contains.house_hearth' || edge.edgeType !== 'contains' || edge.fromNodeId !== 'place.house' || edge.toNodeId !== 'fixture.hearth' || edge.doorIdentity !== null || edgeIds.has(edge.id) || !installedIds.has(edge.fromNodeId) || !installedIds.has(edge.toNodeId)) throw new Error('Hearth containment is invalid.');
    return { id: edge.id, edge_type: edge.edgeType, from_node_id: edge.fromNodeId, to_node_id: edge.toNodeId, door_identity: null, label: edge.label, created_at: event.occurred_at, ...pointer(event) };
  });
  return { nodes, edges };
}

function forestExtensionRows(payload, event, priorState) {
  exactKeys(payload, ['manifestSha256', 'nodes', 'edges', 'passages'], 'Forest topology payload');
  const manifest = { nodes: payload.nodes, edges: payload.edges, passages: payload.passages };
  if (payload.manifestSha256 !== sha256(canonicalize(manifest)) || payload.manifestSha256 !== forestTopologyHash() || canonicalize(manifest) !== canonicalize(forestTopologyManifest())) throw new Error('Forest topology does not match the code-owned manifest.');
  if (!priorState.hearthExtension || priorState.forestExtension) throw new Error('Forest topology requires the Hearth generation and may be installed only once.');
  const installedIds = new Set(priorState.nodes.map(row => row.id));
  const nodes = payload.nodes.map(node => {
    exactKeys(node, ['id', 'nodeType', 'residentText', 'state', 'lifecycle', 'revision'], 'Forest node');
    if (node.id !== 'place.forest' || node.nodeType !== 'place' || node.lifecycle !== 'standing' || node.revision !== 1 || installedIds.has(node.id)) throw new Error('Forest place node is invalid.');
    canonicalObject(node.state, 'Forest place state'); installedIds.add(node.id);
    return { id: node.id, node_type: node.nodeType, resident_text: node.residentText, state_json: canonicalize(node.state), lifecycle: node.lifecycle, revision: 1, created_at: event.occurred_at, ...pointer(event) };
  });
  const edgeIds = new Set(priorState.edges.map(row => row.id));
  const edges = payload.edges.map(edge => {
    exactKeys(edge, ['id', 'edgeType', 'fromNodeId', 'toNodeId', 'doorIdentity', 'label'], 'Forest edge');
    if (edge.edgeType !== 'passage' || edge.doorIdentity !== null || edgeIds.has(edge.id) || !installedIds.has(edge.fromNodeId) || !installedIds.has(edge.toNodeId)) throw new Error('Forest path edge is invalid.');
    edgeIds.add(edge.id);
    return { id: edge.id, edge_type: edge.edgeType, from_node_id: edge.fromNodeId, to_node_id: edge.toNodeId, door_identity: null, label: edge.label, created_at: event.occurred_at, ...pointer(event) };
  });
  const edgeById = new Map(edges.map(row => [row.id, row]));
  const passages = payload.passages.map(row => {
    exactKeys(row, ['edgeId', 'passageId', 'passageKind', 'fromNodeId', 'toNodeId', 'governedObjectId'], 'Forest passage');
    const edge = edgeById.get(row.edgeId);
    if (!edge || row.passageId !== 'passage.garden_forest' || row.passageKind !== 'opening' || row.governedObjectId !== null || edge.from_node_id !== row.fromNodeId || edge.to_node_id !== row.toNodeId) throw new Error('Forest passage definition is invalid.');
    return { edge_id: row.edgeId, passage_id: row.passageId, passage_kind: row.passageKind, from_node_id: row.fromNodeId, to_node_id: row.toNodeId, governed_object_id: null, ...pointer(event) };
  });
  return { nodes, edges, passages };
}

function binderWindowExtensionRows(payload, event, priorState) {
  exactKeys(payload, ['manifestSha256', 'nodes', 'edges'], 'Binder Window topology payload');
  if (!Array.isArray(payload.nodes) || !Array.isArray(payload.edges)) throw new Error('Binder Window topology payload rows are invalid.');
  const manifest = { nodes: payload.nodes, edges: payload.edges };
  if (payload.manifestSha256 !== sha256(canonicalize(manifest)) || payload.manifestSha256 !== binderWindowTopologyHash() || canonicalize(manifest) !== canonicalize(binderWindowTopologyManifest())) throw new Error('Binder Window topology does not match the code-owned manifest.');
  if (!priorState.forestExtension || priorState.binderWindowExtension) throw new Error('Binder Window topology requires the Forest generation and may be installed only once.');
  const installedIds = new Set(priorState.nodes.map(row => row.id));
  const nodes = payload.nodes.map(node => {
    exactKeys(node, ['id', 'nodeType', 'residentText', 'state', 'lifecycle', 'revision'], 'Binder Window node');
    if (node.id !== 'fixture.binder_window' || node.nodeType !== 'fixture' || node.lifecycle !== 'standing' || node.revision !== 1 || installedIds.has(node.id)) throw new Error('Binder Window node is invalid.');
    canonicalObject(node.state, 'Binder Window node state'); installedIds.add(node.id);
    return { id: node.id, node_type: node.nodeType, resident_text: node.residentText, state_json: canonicalize(node.state), lifecycle: node.lifecycle, revision: 1, created_at: event.occurred_at, ...pointer(event) };
  });
  const edgeIds = new Set(priorState.edges.map(row => row.id));
  const edges = payload.edges.map(edge => {
    exactKeys(edge, ['id', 'edgeType', 'fromNodeId', 'toNodeId', 'doorIdentity', 'label'], 'Binder Window edge');
    if (edge.id !== 'edge.contains.center_binder_window' || edge.edgeType !== 'contains' || edge.fromNodeId !== 'room.center' || edge.toNodeId !== 'fixture.binder_window' || edge.doorIdentity !== null || edgeIds.has(edge.id) || !installedIds.has(edge.fromNodeId) || !installedIds.has(edge.toNodeId)) throw new Error('Binder Window containment is invalid.');
    return { id: edge.id, edge_type: edge.edgeType, from_node_id: edge.fromNodeId, to_node_id: edge.toNodeId, door_identity: null, label: edge.label, created_at: event.occurred_at, ...pointer(event) };
  });
  return { nodes, edges };
}

function spotlightExtensionRows(payload, event, priorState) {
  exactKeys(payload, ['manifestSha256', 'nodes', 'edges'], 'Spotlight topology payload');
  if (!Array.isArray(payload.nodes) || !Array.isArray(payload.edges)) throw new Error('Spotlight topology payload rows are invalid.');
  const manifest = { nodes: payload.nodes, edges: payload.edges };
  if (payload.manifestSha256 !== sha256(canonicalize(manifest)) || payload.manifestSha256 !== spotlightTopologyHash() || canonicalize(manifest) !== canonicalize(spotlightTopologyManifest())) throw new Error('Spotlight topology does not match the code-owned manifest.');
  if (!priorState.binderWindowExtension || priorState.spotlightExtension) throw new Error('Spotlight topology requires the Binder Window generation and may be installed only once.');

  const expectedNodeIds = new Set(['room.spotlight', 'fixture.spotlight_landscape', 'fixture.spotlight_telescope', 'fixture.spotlight_archive', 'fixture.spotlight_table', 'fixture.spotlight_bell']);
  const installedIds = new Set(priorState.nodes.map(row => row.id));
  const nodes = payload.nodes.map(node => {
    exactKeys(node, ['id', 'nodeType', 'residentText', 'state', 'lifecycle', 'revision'], 'Spotlight node');
    if (!expectedNodeIds.has(node.id) || node.lifecycle !== 'standing' || node.revision !== 1 || installedIds.has(node.id)) throw new Error('Spotlight node identity, lifecycle, or revision is invalid.');
    if (node.id === 'room.spotlight' && node.nodeType !== 'room') throw new Error('Spotlight room node is invalid.');
    if (node.id !== 'room.spotlight' && node.nodeType !== 'fixture') throw new Error('Spotlight fixture node is invalid.');
    canonicalObject(node.state, 'Spotlight node state'); installedIds.add(node.id);
    return { id: node.id, node_type: node.nodeType, resident_text: node.residentText, state_json: canonicalize(node.state), lifecycle: 'standing', revision: 1, created_at: event.occurred_at, ...pointer(event) };
  });
  if (new Set(nodes.map(row => row.id)).size !== expectedNodeIds.size || nodes.length !== expectedNodeIds.size) throw new Error('Spotlight topology must install exactly one room and five fixtures.');

  const expectedEdgeIds = new Set(['edge.contains.hub_spotlight', 'edge.contains.spotlight_landscape', 'edge.contains.spotlight_telescope', 'edge.contains.spotlight_archive', 'edge.contains.spotlight_table', 'edge.contains.spotlight_bell']);
  const edgeIds = new Set(priorState.edges.map(row => row.id));
  const edges = payload.edges.map(edge => {
    exactKeys(edge, ['id', 'edgeType', 'fromNodeId', 'toNodeId', 'doorIdentity', 'label'], 'Spotlight edge');
    if (!expectedEdgeIds.has(edge.id) || edge.edgeType !== 'contains' || edge.doorIdentity !== null || edgeIds.has(edge.id) || !installedIds.has(edge.fromNodeId) || !installedIds.has(edge.toNodeId)) throw new Error('Spotlight containment edge is invalid.');
    if (edge.id === 'edge.contains.hub_spotlight' && (edge.fromNodeId !== 'place.hub' || edge.toNodeId !== 'room.spotlight')) throw new Error('Spotlight Hub containment is invalid.');
    if (edge.id !== 'edge.contains.hub_spotlight' && (edge.fromNodeId !== 'room.spotlight' || !edge.toNodeId.startsWith('fixture.spotlight_'))) throw new Error('Spotlight fixture containment is invalid.');
    edgeIds.add(edge.id);
    return { id: edge.id, edge_type: 'contains', from_node_id: edge.fromNodeId, to_node_id: edge.toNodeId, door_identity: null, label: edge.label, created_at: event.occurred_at, ...pointer(event) };
  });
  if (new Set(edges.map(row => row.id)).size !== expectedEdgeIds.size || edges.length !== expectedEdgeIds.size) throw new Error('Spotlight topology must install exactly six containment edges.');
  return { nodes: nodes.sort((a, b) => a.id.localeCompare(b.id)), edges: edges.sort((a, b) => a.id.localeCompare(b.id)) };
}

function legacyRows(payload, event) {
  exactKeys(payload, ['projectionSha256', 'nodes', 'edges', 'locations'], 'legacy snapshot payload');
  if (!Array.isArray(payload.nodes) || !Array.isArray(payload.edges) || !Array.isArray(payload.locations)) throw new Error('Legacy snapshot rows are invalid.');
  const exact = { nodes: payload.nodes, edges: payload.edges, locations: payload.locations };
  if (payload.projectionSha256 !== sha256(canonicalize(exact))) throw new Error('Legacy snapshot projection hash is invalid.');
  const nodes = payload.nodes.map(row => ({ ...row, ...pointer(event) }));
  const edges = payload.edges.map(row => ({ ...row, ...pointer(event) }));
  const locations = payload.locations.map(row => ({ ...row, ...pointer(event) }));
  for (const row of nodes) exactKeys(row, NODE_COLUMNS, 'legacy node');
  for (const row of edges) exactKeys(row, EDGE_COLUMNS, 'legacy edge');
  for (const row of locations) exactKeys(row, LOCATION_COLUMNS, 'legacy location');
  if (new Set(nodes.map(row => row.id)).size !== nodes.length || new Set(edges.map(row => row.id)).size !== edges.length || new Set(locations.map(row => row.session_id)).size !== locations.length) throw new Error('Legacy snapshot contains duplicate identities.');
  const installed = installedTopologyManifest(); const nodeById = new Map(nodes.map(row => [row.id, row])); const edgeById = new Map(edges.map(row => [row.id, row]));
  if (nodeById.size !== installed.nodes.length || edgeById.size !== installed.edges.length) throw new Error('Legacy snapshot topology does not match the code-owned manifest.');
  for (const expected of installed.nodes) {
    const actual = nodeById.get(expected.id);
    if (!actual || actual.node_type !== expected.nodeType || actual.resident_text !== expected.residentText || actual.lifecycle !== expected.lifecycle || canonicalize(JSON.parse(actual.state_json)) !== canonicalize(expected.state)) throw new Error(`Legacy snapshot node does not match the code-owned manifest: ${expected.id}.`);
  }
  for (const expected of installed.edges) {
    const actual = edgeById.get(expected.id);
    if (!actual || actual.edge_type !== expected.edgeType || actual.from_node_id !== expected.fromNodeId || actual.to_node_id !== expected.toNodeId || actual.door_identity !== expected.doorIdentity || actual.label !== expected.label) throw new Error(`Legacy snapshot edge does not match the code-owned manifest: ${expected.id}.`);
  }
  return { nodes: nodes.sort((a, b) => a.id.localeCompare(b.id)), edges: edges.sort((a, b) => a.id.localeCompare(b.id)), locations: locations.sort((a, b) => a.session_id.localeCompare(b.session_id)) };
}

function validJsonText(value, label) {
  requiredString(value, label);
  try { JSON.parse(value); } catch { throw new Error(`${label} is not valid JSON.`); }
}
function validIso(value, label) {
  requiredString(value, label);
  if (Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) throw new Error(`${label} is not an exact ISO timestamp.`);
}
function validateRuntimeState(state) {
  canonicalObject(state, 'fixture runtime state');
  exactKeys(state, ['status', 'runId', 'recipe', 'code', 'signal', 'reason', 'summaryTail'], 'fixture runtime state');
  if (!['running', 'stopping', 'settled', 'failed', 'cancelled'].includes(state.status)) throw new Error('Fixture runtime status is not installed.');
  for (const key of ['runId', 'recipe', 'signal', 'reason', 'summaryTail']) if (state[key] !== null && typeof state[key] !== 'string') throw new Error(`Fixture runtime ${key} is invalid.`);
  requiredString(state.runId, 'fixture runtime run identity'); requiredString(state.recipe, 'fixture runtime recipe');
  if (state.code !== null && !Number.isInteger(state.code)) throw new Error('Fixture runtime code is invalid.');
}
function legacyBoundaryRunId(fixtureId, row) {
  return `legacy_run_${sha256(canonicalize({ fixtureId, boundaryEventHash: row.last_event_hash, stateSha256: sha256(row.state_json) }))}`;
}
const APPROVAL_KINDS = new Set(['patch', 'unified_diff', 'write_file', 'create_path', 'delete_path', 'rename_path', 'git_add', 'commit', 'git_checkout', 'sandbox_promotion']);
function operationalRows(payload, event, priorState) {
  exactKeys(payload, ['projectionSha256', 'fixtureRuntimes', 'timers', 'briefs', 'approvals', 'legacyCustody'], 'operational snapshot payload');
  for (const key of ['fixtureRuntimes', 'timers', 'briefs', 'approvals']) if (!Array.isArray(payload[key])) throw new Error(`Operational snapshot ${key} rows are invalid.`);
  canonicalObject(payload.legacyCustody, 'legacy custody'); exactKeys(payload.legacyCustody, ['actionReceipts', 'approvalReceipts'], 'legacy custody');
  for (const key of ['actionReceipts', 'approvalReceipts']) {
    if (!Array.isArray(payload.legacyCustody[key])) throw new Error(`Legacy custody ${key} is invalid.`);
    for (const row of payload.legacyCustody[key]) {
      canonicalObject(row, 'legacy custody row'); exactKeys(row, ['receiptId', 'rowSha256'], 'legacy custody row');
      requiredString(row.receiptId, 'legacy receipt identity');
      if (!/^[0-9a-f]{64}$/.test(row.rowSha256)) throw new Error('Legacy receipt row hash is invalid.');
    }
    if (new Set(payload.legacyCustody[key].map(row => row.receiptId)).size !== payload.legacyCustody[key].length) throw new Error('Legacy custody contains duplicate receipt identities.');
  }
  const exact = { fixtureRuntimes: payload.fixtureRuntimes, timers: payload.timers, briefs: payload.briefs, approvals: payload.approvals, legacyCustody: payload.legacyCustody };
  if (payload.projectionSha256 !== sha256(canonicalize(exact))) throw new Error('Operational snapshot projection hash is invalid.');
  const fixtureRuntimes = payload.fixtureRuntimes.map(row => ({ ...row, ...pointer(event) }));
  const timers = payload.timers.map(row => ({ ...row, ...pointer(event) }));
  const briefs = payload.briefs.map(row => ({ ...row, ...pointer(event) }));
  const approvals = payload.approvals.map(row => ({ ...row, ...pointer(event) }));
  for (const row of fixtureRuntimes) {
    exactKeys(row, FIXTURE_RUNTIME_COLUMNS, 'legacy fixture runtime'); requiredString(row.fixture_id, 'fixture runtime identity'); validJsonText(row.state_json, 'fixture runtime state');
    if (!Number.isInteger(row.revision) || row.revision < 1) throw new Error('Fixture runtime revision is invalid.'); validIso(row.updated_at, 'fixture runtime update time');
    const fixture = findBy(priorState.nodes, 'id', row.fixture_id); if (!fixture || fixture.node_type !== 'fixture' || fixture.lifecycle !== 'standing') throw new Error('Fixture runtime references an unavailable fixture.');
  }
  for (const row of timers) {
    exactKeys(row, TIMER_COLUMNS, 'legacy timer'); requiredString(row.session_id, 'timer session');
    if (!Number.isInteger(row.seconds) || row.seconds < 1 || row.seconds > 3600 || !Number.isInteger(row.revision) || row.revision < 1) throw new Error('Timer value or revision is invalid.');
    validIso(row.due_at, 'timer due time'); validIso(row.created_at, 'timer created time');
    if (!findBy(priorState.locations, 'session_id', row.session_id)) throw new Error('Timer references an unavailable lifespan.');
  }
  for (const row of briefs) {
    exactKeys(row, BRIEF_COLUMNS, 'legacy brief'); requiredString(row.brief_id, 'brief identity'); requiredString(row.session_id, 'brief session'); requiredString(row.objective, 'brief objective');
    if (!Number.isInteger(row.revision) || row.revision < 1) throw new Error('Brief revision is invalid.');
    for (const key of ['scope_paths_json', 'acceptance_json', 'non_goals_json', 'field_hashes_json']) validJsonText(row[key], `brief ${key}`);
    validIso(row.created_at, 'brief created time'); validIso(row.updated_at, 'brief updated time');
    if (!findBy(priorState.locations, 'session_id', row.session_id)) throw new Error('Brief references an unavailable lifespan.');
  }
  for (const row of approvals) {
    exactKeys(row, APPROVAL_COLUMNS, 'legacy approval'); requiredString(row.approval_id, 'approval identity'); requiredString(row.session_id, 'approval session'); requiredString(row.kind, 'approval kind');
    if (!APPROVAL_KINDS.has(row.kind) || !['pending', 'applying', 'reconciliation_required', 'confirmed', 'rejected', 'cancelled'].includes(row.status) || !Number.isInteger(row.revision) || row.revision < 1) throw new Error('Approval kind, status, or revision is invalid.');
    validJsonText(row.payload_json, 'approval payload'); validJsonText(row.preview_json, 'approval preview'); if (row.application_json !== null) validJsonText(row.application_json, 'approval application'); if (row.outcome_json !== null) validJsonText(row.outcome_json, 'approval outcome');
    validIso(row.created_at, 'approval created time'); if (row.decided_at !== null) validIso(row.decided_at, 'approval decision time');
    if (!findBy(priorState.locations, 'session_id', row.session_id)) throw new Error('Approval references an unavailable lifespan.');
  }
  if (new Set(fixtureRuntimes.map(row => row.fixture_id)).size !== fixtureRuntimes.length || new Set(timers.map(row => row.session_id)).size !== timers.length || new Set(briefs.map(row => `${row.session_id}:${row.revision}`)).size !== briefs.length || new Set(approvals.map(row => row.approval_id)).size !== approvals.length) throw new Error('Operational snapshot contains duplicate identities.');
  return {
    fixtureRuntimes: fixtureRuntimes.sort((a, b) => a.fixture_id.localeCompare(b.fixture_id)), timers: timers.sort((a, b) => a.session_id.localeCompare(b.session_id)),
    briefs: briefs.sort((a, b) => a.session_id.localeCompare(b.session_id) || a.revision - b.revision), approvals: approvals.sort((a, b) => a.approval_id.localeCompare(b.approval_id)),
    legacyCustody: { actionReceipts: payload.legacyCustody.actionReceipts.map(row => ({ ...row })), approvalReceipts: payload.legacyCustody.approvalReceipts.map(row => ({ ...row })) },
    operationalBoundary: { sequence: event.sequence, eventHash: event.event_hash },
  };
}

export function reduceWorldEvent(priorState, event) {
  const registration = WORLD_EVENT_KINDS[event.event_kind];
  if (!registration || registration.installed === false) throw new Error(`World event kind is not installed: ${event.event_kind}`);
  if (event.event_schema_version !== registration.schemaVersion) throw new Error(`World event schema version is not installed: ${event.event_kind}@${event.event_schema_version}`);
  const payload = typeof event.payload_json === 'string' ? JSON.parse(event.payload_json) : event.payload;
  const causation = typeof event.causation_json === 'string' ? JSON.parse(event.causation_json) : event.causation;
  canonicalObject(payload, 'event payload');
  canonicalObject(causation, 'event causation');
  requiredString(event.event_id, 'event identity'); requiredString(event.actor, 'event actor'); requiredString(event.aggregate_kind, 'aggregate kind'); requiredString(event.aggregate_id, 'aggregate identity');
  if (event.session_id !== null) requiredString(event.session_id, 'event session');
  if (event.wake_id !== null) requiredString(event.wake_id, 'event wake identity');
  if (event.command_id !== null) requiredString(event.command_id, 'event command identity');
  if (!Number.isInteger(event.sequence) || event.sequence < 1 || !Number.isInteger(event.aggregate_revision) || event.aggregate_revision < 1) throw new Error('Event sequence or aggregate revision is invalid.');
  if (typeof event.occurred_at !== 'string' || Number.isNaN(Date.parse(event.occurred_at)) || new Date(event.occurred_at).toISOString() !== event.occurred_at) throw new Error('Event occurrence time is invalid.');
  if (event.event_kind === 'topology.installed/v1') {
    exactKeys(causation, ['boundary'], 'topology causation');
    if (causation.boundary !== 'fresh_database') throw new Error('Topology causation boundary is invalid.');
    if (event.aggregate_kind !== 'topology' || event.aggregate_id !== 'installed' || event.aggregate_revision !== 1 || event.session_id !== null) throw new Error('Topology event aggregate envelope is invalid.');
    if (priorState.nodes.length || priorState.edges.length || priorState.locations.length) throw new Error('Topology can only be installed into an empty projection.');
    return { ...emptyWorldState(), ...topologyRows(payload, event), rootBoundary: 'fresh' };
  }
  if (event.event_kind === 'legacy_snapshot.imported/v1') {
    exactKeys(causation, ['boundary'], 'legacy causation');
    if (causation.boundary !== 'pre_journal_projection') throw new Error('Legacy causation boundary is invalid.');
    if (event.aggregate_kind !== 'world_snapshot' || event.aggregate_id !== 'legacy_boundary' || event.aggregate_revision !== 1 || event.session_id !== null) throw new Error('Legacy boundary aggregate envelope is invalid.');
    if (priorState.nodes.length || priorState.edges.length || priorState.locations.length) throw new Error('A legacy boundary can only be imported into an empty replay.');
    return { ...emptyWorldState(), ...legacyRows(payload, event), rootBoundary: 'legacy' };
  }
  const state = copyState(priorState);
  if (event.event_kind === 'room.installation.revised/v1') {
    exactKeys(causation, ['boundary', 'physicalHeadHash', 'physicalHeadSequence'], 'room installation revision causation');
    if (causation.boundary !== 'room_installation_revision_v1' || causation.physicalHeadSequence !== event.sequence - 1 || causation.physicalHeadHash !== event.previous_event_hash) throw new Error('Room installation revision causation is invalid.');
    if (event.aggregate_kind !== 'room_installation' || event.aggregate_id !== 'room.workshop' || event.session_id !== null || event.wake_id !== null || event.command_id !== null || event.actor !== 'world_migration') throw new Error('Room installation revision aggregate envelope is invalid.');
    exactKeys(payload, ['roomId', 'priorReceiptId', 'priorReceiptHash', 'priorPackageVersion', 'priorManifestHash', 'priorWitnessHash', 'newPackageVersion', 'newManifestHash', 'newWitnessHash', 'reason', 'admission'], 'room installation revision payload');
    if (payload.roomId !== 'room.workshop') throw new Error('Room installation revision room identity is invalid.');
    for (const [value, label] of [[payload.priorReceiptId, 'prior receipt identity'], [payload.priorPackageVersion, 'prior package version'], [payload.priorManifestHash, 'prior manifest hash'], [payload.priorWitnessHash, 'prior witness hash'], [payload.newPackageVersion, 'new package version'], [payload.newManifestHash, 'new manifest hash'], [payload.newWitnessHash, 'new witness hash'], [payload.reason, 'revision reason']]) requiredString(value, label);
    for (const hash of [payload.priorReceiptHash, payload.priorManifestHash, payload.priorWitnessHash, payload.newManifestHash, payload.newWitnessHash]) if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('Room installation revision hash is invalid.');
    if (!payload.priorReceiptId.startsWith('room_installation_')) throw new Error('Room installation prior receipt identity is invalid.');
    if (payload.priorPackageVersion === payload.newPackageVersion || payload.priorManifestHash === payload.newManifestHash || payload.priorWitnessHash === payload.newWitnessHash) throw new Error('Room installation revision must advance package, manifest, and witness identity.');
    canonicalObject(payload.admission, 'room installation revision admission');
    return state;
  } else if (event.event_kind === 'topology.extended/v1') {
    exactKeys(causation, ['boundary', 'physicalHeadHash', 'physicalHeadSequence'], 'topology extension causation');
    if (causation.boundary !== 'b1_topology_extension' || causation.physicalHeadSequence !== event.sequence - 1 || causation.physicalHeadHash !== event.previous_event_hash) throw new Error('Topology extension boundary causation is invalid.');
    if (event.aggregate_kind !== 'topology_extension' || event.aggregate_id !== 'installed' || event.aggregate_revision !== 1 || event.session_id !== null || event.wake_id !== null || event.command_id !== null || !['world_bootstrap', 'world_migration'].includes(event.actor)) throw new Error('Topology extension aggregate envelope is invalid.');
    if (state.topologyExtension) throw new Error('Topology extension can only be installed once.');
    if (state.rootBoundary === 'legacy' && !state.operationalBoundary) throw new Error('A legacy topology requires its A2 operational boundary before extension.');
    const installed = installedTopologyManifest();
    if (state.nodes.length !== installed.nodes.length || state.edges.length !== installed.edges.length) throw new Error('Topology extension requires the exact A1 topology projection.');
    const extension = topologyExtensionRows(payload, event, state);
    state.nodes.push(...extension.nodes); state.edges.push(...extension.edges); state.passages = extension.passages; state.objectStates = extension.objectStates;
    state.topologyExtension = { sequence: event.sequence, eventHash: event.event_hash };
  } else if (event.event_kind === 'topology.hearth_installed/v1') {
    exactKeys(causation, ['boundary', 'physicalHeadHash', 'physicalHeadSequence'], 'Hearth topology causation');
    if (causation.boundary !== 'house_hearth_wake_v1' || causation.physicalHeadSequence !== event.sequence - 1 || causation.physicalHeadHash !== event.previous_event_hash) throw new Error('Hearth topology boundary causation is invalid.');
    if (event.aggregate_kind !== 'topology_extension' || event.aggregate_id !== 'hearth' || event.aggregate_revision !== 1 || event.session_id !== null || event.wake_id !== null || event.command_id !== null || !['world_bootstrap', 'world_migration'].includes(event.actor)) throw new Error('Hearth topology aggregate envelope is invalid.');
    if (!state.topologyExtension || state.hearthExtension) throw new Error('Hearth topology requires B1 and may be installed only once.');
    const extension = hearthExtensionRows(payload, event, state);
    state.nodes.push(...extension.nodes); state.edges.push(...extension.edges);
    state.hearthExtension = { sequence: event.sequence, eventHash: event.event_hash };
  } else if (event.event_kind === 'topology.forest_installed/v1') {
    exactKeys(causation, ['boundary', 'physicalHeadHash', 'physicalHeadSequence'], 'Forest topology causation');
    if (causation.boundary !== 'forest_place_v1' || causation.physicalHeadSequence !== event.sequence - 1 || causation.physicalHeadHash !== event.previous_event_hash) throw new Error('Forest topology boundary causation is invalid.');
    if (event.aggregate_kind !== 'topology_extension' || event.aggregate_id !== 'forest' || event.aggregate_revision !== 1 || event.session_id !== null || event.wake_id !== null || event.command_id !== null || !['world_bootstrap', 'world_migration'].includes(event.actor)) throw new Error('Forest topology aggregate envelope is invalid.');
    const extension = forestExtensionRows(payload, event, state);
    state.nodes.push(...extension.nodes); state.edges.push(...extension.edges); state.passages.push(...extension.passages);
    state.forestExtension = { sequence: event.sequence, eventHash: event.event_hash };
  } else if (event.event_kind === 'topology.binder_window_installed/v1') {
    exactKeys(causation, ['boundary', 'physicalHeadHash', 'physicalHeadSequence'], 'Binder Window topology causation');
    if (causation.boundary !== 'binder_window_v1' || causation.physicalHeadSequence !== event.sequence - 1 || causation.physicalHeadHash !== event.previous_event_hash) throw new Error('Binder Window topology boundary causation is invalid.');
    if (event.aggregate_kind !== 'topology_extension' || event.aggregate_id !== 'binder_window' || event.aggregate_revision !== 1 || event.session_id !== null || event.wake_id !== null || event.command_id !== null || !['world_bootstrap', 'world_migration'].includes(event.actor)) throw new Error('Binder Window topology aggregate envelope is invalid.');
    const extension = binderWindowExtensionRows(payload, event, state);
    state.nodes.push(...extension.nodes); state.edges.push(...extension.edges);
    state.binderWindowExtension = { sequence: event.sequence, eventHash: event.event_hash };
  } else if (event.event_kind === 'topology.spotlight_installed/v1') {
    exactKeys(causation, ['boundary', 'physicalHeadHash', 'physicalHeadSequence'], 'Spotlight topology causation');
    if (causation.boundary !== 'spotlight_observatory_v1' || causation.physicalHeadSequence !== event.sequence - 1 || causation.physicalHeadHash !== event.previous_event_hash) throw new Error('Spotlight topology boundary causation is invalid.');
    if (event.aggregate_kind !== 'topology_extension' || event.aggregate_id !== 'spotlight' || event.aggregate_revision !== 1 || event.session_id !== null || event.wake_id !== null || event.command_id !== null || !['world_bootstrap', 'world_migration'].includes(event.actor)) throw new Error('Spotlight topology aggregate envelope is invalid.');
    const extension = spotlightExtensionRows(payload, event, state);
    state.nodes.push(...extension.nodes); state.edges.push(...extension.edges);
    state.spotlightExtension = { sequence: event.sequence, eventHash: event.event_hash };
  } else if (event.event_kind === 'operational_snapshot.imported/v1') {
    exactKeys(causation, ['boundary', 'physicalHeadHash', 'physicalHeadSequence'], 'operational snapshot causation');
    if (causation.boundary !== 'pre_a2_operational_projection' || causation.physicalHeadSequence !== event.sequence - 1 || causation.physicalHeadHash !== event.previous_event_hash) throw new Error('Operational snapshot boundary causation is invalid.');
    if (event.aggregate_kind !== 'operational_snapshot' || event.aggregate_id !== 'installed' || event.aggregate_revision !== 1 || event.session_id !== null) throw new Error('Operational snapshot aggregate envelope is invalid.');
    if (state.topologyExtension || state.operationalBoundary || state.fixtureRuntimes.length || state.timers.length || state.briefs.length || state.approvals.length || state.legacyCustody.actionReceipts.length || state.legacyCustody.approvalReceipts.length) throw new Error('Operational snapshot can only be imported before the topology extension and only once.');
    Object.assign(state, operationalRows(payload, event, state));
  } else if (event.event_kind === 'lifespan.started/v1') {
    exactKeys(causation, ['reason'], 'lifespan causation');
    if (causation.reason !== 'lifespan_initialized') throw new Error('Lifespan causation reason is invalid.');
    exactKeys(payload, ['roomNodeId'], 'lifespan payload');
    if (event.aggregate_kind !== 'lifespan' || event.aggregate_id !== event.session_id || event.aggregate_revision !== 1) throw new Error('Lifespan event aggregate envelope is invalid.');
    requiredString(event.session_id, 'lifespan session'); requiredString(payload.roomNodeId, 'starting room');
    if (findBy(state.locations, 'session_id', event.session_id)) throw new Error('Lifespan is already initialized.');
    const startingRoom = findBy(state.nodes, 'id', payload.roomNodeId);
    const expectedStart = state.hearthExtension ? 'place.house' : 'room.center';
    const occupiable = startingRoom && startingRoom.lifecycle === 'standing' && (startingRoom.node_type === 'room' || (startingRoom.node_type === 'place' && JSON.parse(startingRoom.state_json).occupiable === true));
    if (!occupiable || payload.roomNodeId !== expectedStart) throw new Error('Starting location does not match the installed lifespan law.');
    state.locations.push({ session_id: event.session_id, room_node_id: payload.roomNodeId, inspected_source: null, engaged_fixture_id: null, revision: event.aggregate_revision, started_at: event.occurred_at, updated_at: event.occurred_at, ...pointer(event) });
  } else if (WORLD_EVENT_KINDS[event.event_kind].stretch === 'A1') {
    requiredString(event.session_id, 'event session');
    if (event.aggregate_kind !== 'lifespan' || event.aggregate_id !== event.session_id) throw new Error('Physical event aggregate envelope is invalid.');
    const current = findBy(state.locations, 'session_id', event.session_id);
    if (!current) throw new Error('Lifespan is not initialized.');
    if (current.revision + 1 !== event.aggregate_revision) throw new Error('Lifespan aggregate revision is not contiguous.');
    let next;
    if (event.event_kind === 'location.moved/v1') {
      exactKeys(causation, ['doorIdentity', 'edgeId'], 'movement causation');
      exactKeys(payload, ['fromRoomId', 'toRoomId', 'edgeId', 'doorIdentity', 'clearedFixtureId'], 'movement payload');
      requiredString(payload.fromRoomId, 'movement source'); requiredString(payload.toRoomId, 'movement target'); requiredString(payload.edgeId, 'movement edge'); requiredString(payload.doorIdentity, 'movement door');
      if (current.room_node_id !== payload.fromRoomId) throw new Error('Movement source does not match the prior location.');
      const fromRoom = findBy(state.nodes, 'id', payload.fromRoomId); const toRoom = findBy(state.nodes, 'id', payload.toRoomId);
      if (!fromRoom || fromRoom.node_type !== 'room' || fromRoom.lifecycle !== 'standing' || !toRoom || toRoom.node_type !== 'room' || toRoom.lifecycle !== 'standing') throw new Error('Movement endpoints must be installed standing rooms.');
      const edge = findBy(state.edges, 'id', payload.edgeId);
      if (!edge || edge.edge_type !== 'door' || edge.from_node_id !== payload.fromRoomId || edge.to_node_id !== payload.toRoomId || edge.door_identity !== payload.doorIdentity) throw new Error('Movement does not follow an installed door.');
      if (causation.edgeId !== payload.edgeId || causation.doorIdentity !== payload.doorIdentity) throw new Error('Movement causation does not match its payload.');
      const leavingWorkshop = current.room_node_id === 'room.workshop' && payload.toRoomId !== 'room.workshop';
      const expectedClearedFixtureId = leavingWorkshop ? (current.engaged_fixture_id ?? null) : null;
      if (payload.clearedFixtureId !== expectedClearedFixtureId) throw new Error('Movement fixture clearing is not exact.');
      next = { ...current, room_node_id: payload.toRoomId, inspected_source: null, engaged_fixture_id: leavingWorkshop ? null : current.engaged_fixture_id, revision: event.aggregate_revision, updated_at: event.occurred_at, ...pointer(event) };
    } else if (event.event_kind === 'source.inspected/v1') {
      exactKeys(causation, ['action'], 'inspection causation');
      if (causation.action !== 'inspect_source') throw new Error('Inspection causation action is invalid.');
      exactKeys(payload, ['source'], 'inspection payload');
      if (payload.source !== null) requiredString(payload.source, 'inspected source');
      next = { ...current, inspected_source: payload.source, revision: event.aggregate_revision, updated_at: event.occurred_at, ...pointer(event) };
    } else if (event.event_kind === 'fixture.engaged/v1') {
      exactKeys(causation, ['action'], 'fixture engagement causation');
      if (causation.action !== 'engage_fixture') throw new Error('Fixture engagement causation action is invalid.');
      exactKeys(payload, ['fixtureId', 'previousFixtureId'], 'fixture engagement payload');
      requiredString(payload.fixtureId, 'fixture identity');
      if ((payload.previousFixtureId ?? null) !== (current.engaged_fixture_id ?? null)) throw new Error('Prior fixture engagement does not match.');
      if (current.room_node_id !== 'room.workshop') throw new Error('Fixture engagement is outside the Workshop.');
      const fixture = findBy(state.nodes, 'id', payload.fixtureId);
      const fixtureState = fixture ? JSON.parse(fixture.state_json) : null;
      const contains = state.edges.some(row => row.edge_type === 'contains' && row.from_node_id === current.room_node_id && row.to_node_id === payload.fixtureId);
      if (!fixture || fixture.node_type !== 'fixture' || fixture.lifecycle !== 'standing' || !fixtureState?.engageable || !contains) throw new Error('Fixture is not lawfully engageable.');
      next = { ...current, engaged_fixture_id: payload.fixtureId, revision: event.aggregate_revision, updated_at: event.occurred_at, ...pointer(event) };
    } else if (event.event_kind === 'fixture.disengaged/v1') {
      exactKeys(causation, ['action'], 'fixture disengagement causation');
      if (causation.action !== 'disengage_fixture') throw new Error('Fixture disengagement causation action is invalid.');
      exactKeys(payload, ['fixtureId'], 'fixture disengagement payload');
      requiredString(payload.fixtureId, 'fixture identity');
      if (current.room_node_id !== 'room.workshop' || current.engaged_fixture_id !== payload.fixtureId) throw new Error('Fixture disengagement does not match current state.');
      next = { ...current, engaged_fixture_id: null, revision: event.aggregate_revision, updated_at: event.occurred_at, ...pointer(event) };
    }
    state.locations = replaceBy(state.locations, 'session_id', event.session_id, next);
  } else if (event.event_kind === 'location.crossed/v1') {
    exactKeys(causation, ['action', 'passageId'], 'passage crossing causation');
    if (causation.action !== 'move_through_passage') throw new Error('Passage crossing causation action is invalid.');
    exactKeys(payload, ['fromLocationId', 'toLocationId', 'edgeId', 'passageId', 'passageKind', 'governedObjectId', 'clearedFixtureId'], 'passage crossing payload');
    requiredString(event.session_id, 'passage crossing session'); requiredString(payload.fromLocationId, 'passage source'); requiredString(payload.toLocationId, 'passage target'); requiredString(payload.edgeId, 'passage edge'); requiredString(payload.passageId, 'passage identity'); requiredString(payload.passageKind, 'passage kind');
    if (payload.governedObjectId !== null) requiredString(payload.governedObjectId, 'passage governed object');
    if (event.aggregate_kind !== 'lifespan' || event.aggregate_id !== event.session_id || causation.passageId !== payload.passageId || event.command_id === null || event.actor !== 'resident_tool') throw new Error('Passage crossing aggregate, causation, or command envelope is invalid.');
    const current = findBy(state.locations, 'session_id', event.session_id);
    if (!current || current.revision + 1 !== event.aggregate_revision || current.room_node_id !== payload.fromLocationId) throw new Error('Passage crossing does not continue the current lifespan location.');
    const occupiable = node => node?.lifecycle === 'standing' && (node.node_type === 'room' || node.node_type === 'place' && JSON.parse(node.state_json).occupiable === true);
    if (!occupiable(findBy(state.nodes, 'id', payload.fromLocationId)) || !occupiable(findBy(state.nodes, 'id', payload.toLocationId))) throw new Error('Passage crossing endpoints are not occupiable installed locations.');
    const passage = findBy(state.passages, 'edge_id', payload.edgeId);
    if (!passage || passage.passage_id !== payload.passageId || passage.passage_kind !== payload.passageKind || passage.from_node_id !== payload.fromLocationId || passage.to_node_id !== payload.toLocationId || passage.governed_object_id !== payload.governedObjectId) throw new Error('Passage crossing does not follow an installed route.');
    if (passage.passage_kind === 'door') {
      const objectState = findBy(state.objectStates, 'object_id', passage.governed_object_id);
      if (!objectState || JSON.parse(objectState.state_json).open !== true) throw new Error('Passage door is not open.');
    }
    const leavingWorkshop = current.room_node_id === 'room.workshop' && payload.toLocationId !== 'room.workshop';
    const expectedCleared = leavingWorkshop ? (current.engaged_fixture_id ?? null) : null;
    if (payload.clearedFixtureId !== expectedCleared) throw new Error('Passage crossing fixture clearing is not exact.');
    state.locations = replaceBy(state.locations, 'session_id', event.session_id, { ...current, room_node_id: payload.toLocationId, inspected_source: null, engaged_fixture_id: leavingWorkshop ? null : current.engaged_fixture_id, revision: event.aggregate_revision, updated_at: event.occurred_at, ...pointer(event) });
  } else if (event.event_kind === 'passage.operated/v1') {
    exactKeys(causation, ['action', 'passageId'], 'passage operation causation');
    if (causation.action !== 'operate_passage') throw new Error('Passage operation causation action is invalid.');
    exactKeys(payload, ['passageId', 'objectId', 'fromLocationId', 'operation', 'priorState', 'nextState'], 'passage operation payload');
    requiredString(event.session_id, 'passage operation session'); requiredString(payload.passageId, 'passage identity'); requiredString(payload.objectId, 'passage object'); requiredString(payload.fromLocationId, 'passage operation location'); requiredString(payload.operation, 'passage operation');
    canonicalObject(payload.priorState, 'prior passage state'); canonicalObject(payload.nextState, 'next passage state');
    if (event.aggregate_kind !== 'world_object' || event.aggregate_id !== payload.objectId || causation.passageId !== payload.passageId || event.command_id === null || event.actor !== 'resident_tool') throw new Error('Passage operation aggregate, causation, or command envelope is invalid.');
    const location = findBy(state.locations, 'session_id', event.session_id);
    if (!location || location.room_node_id !== payload.fromLocationId) throw new Error('Passage operation location is not current.');
    const routes = state.passages.filter(row => row.passage_id === payload.passageId && row.governed_object_id === payload.objectId);
    if (!routes.some(row => row.from_node_id === payload.fromLocationId) || payload.objectId !== 'object.front_door') throw new Error('Passage operation is not available from this side.');
    const current = findBy(state.objectStates, 'object_id', payload.objectId);
    if (!current || current.revision + 1 !== event.aggregate_revision || canonicalize(payload.priorState) !== current.state_json) throw new Error('Passage operation prior state or revision is invalid.');
    exactKeys(payload.priorState, ['locked', 'open'], 'front door prior state'); exactKeys(payload.nextState, ['locked', 'open'], 'front door next state');
    if (typeof payload.priorState.locked !== 'boolean' || typeof payload.priorState.open !== 'boolean' || typeof payload.nextState.locked !== 'boolean' || typeof payload.nextState.open !== 'boolean') throw new Error('Front door state is invalid.');
    const transitions = {
      open: { allowed: !payload.priorState.open && !payload.priorState.locked, next: { locked: false, open: true } },
      close: { allowed: payload.priorState.open, next: { locked: false, open: false } },
      lock: { allowed: payload.fromLocationId === 'place.house' && !payload.priorState.open && !payload.priorState.locked, next: { locked: true, open: false } },
      unlock: { allowed: payload.fromLocationId === 'place.house' && !payload.priorState.open && payload.priorState.locked, next: { locked: false, open: false } },
    }[payload.operation];
    if (!transitions || !transitions.allowed || canonicalize(payload.nextState) !== canonicalize(transitions.next)) throw new Error('Front door transition is not installed.');
    state.objectStates = replaceBy(state.objectStates, 'object_id', payload.objectId, { object_id: payload.objectId, state_json: canonicalize(payload.nextState), revision: event.aggregate_revision, updated_at: event.occurred_at, ...pointer(event) });
  } else if (event.event_kind === 'fixture.turned/v1') {
    exactKeys(causation, ['action'], 'fixture turn causation'); if (causation.action !== 'turn_fixture') throw new Error('Fixture turn causation action is invalid.');
    exactKeys(payload, ['fixtureId', 'fromLocationId', 'priorTurnCount', 'nextTurnCount'], 'fixture turn payload');
    requiredString(event.session_id, 'fixture turn session'); requiredString(payload.fixtureId, 'turned fixture'); requiredString(payload.fromLocationId, 'fixture turn location');
    if (event.aggregate_kind !== 'world_object' || event.aggregate_id !== payload.fixtureId || payload.fixtureId !== 'fixture.garden_turning_stone' || payload.fromLocationId !== 'place.garden' || event.command_id === null || event.actor !== 'resident_tool') throw new Error('Fixture turn aggregate, target, or command envelope is invalid.');
    const location = findBy(state.locations, 'session_id', event.session_id); const current = findBy(state.objectStates, 'object_id', payload.fixtureId);
    if (!location || location.room_node_id !== payload.fromLocationId || !current || current.revision + 1 !== event.aggregate_revision) throw new Error('Fixture turn location or revision is invalid.');
    const prior = JSON.parse(current.state_json); exactKeys(prior, ['turnCount'], 'turning stone state');
    if (!Number.isInteger(payload.priorTurnCount) || payload.priorTurnCount < 0 || payload.priorTurnCount !== prior.turnCount || payload.nextTurnCount !== payload.priorTurnCount + 1) throw new Error('Fixture turn count is not an exact increment.');
    state.objectStates = replaceBy(state.objectStates, 'object_id', payload.fixtureId, { object_id: payload.fixtureId, state_json: canonicalize({ turnCount: payload.nextTurnCount }), revision: event.aggregate_revision, updated_at: event.occurred_at, ...pointer(event) });
  } else if (event.event_kind === 'fixture_runtime.replaced/v1') {
    exactKeys(causation, ['action'], 'fixture runtime causation'); requiredString(causation.action, 'fixture runtime action');
    exactKeys(payload, ['fixtureId', 'state'], 'fixture runtime payload'); requiredString(payload.fixtureId, 'fixture runtime identity'); validateRuntimeState(payload.state);
    if (event.aggregate_kind !== 'fixture_runtime' || event.aggregate_id !== payload.fixtureId) throw new Error('Fixture runtime aggregate envelope is invalid.');
    const transition = {
      recipe_started: { from: ['absent', 'settled', 'failed', 'cancelled'], to: 'running', origin: 'command_or_internal' },
      recipe_completed: { from: ['running', 'stopping'], to: 'settled', origin: 'system' },
      recipe_failed: { from: ['running', 'stopping'], to: 'failed', origin: 'system' },
      recipe_timeout: { from: ['running', 'stopping'], to: 'cancelled', origin: 'system' },
      recipe_runtime_cancelled: { from: ['running', 'stopping'], to: 'cancelled', origin: 'system' },
      recipe_cancelled: { from: ['running'], to: 'cancelled', origin: 'command_or_internal' },
      hub_close_requested: { from: ['running'], to: 'stopping', origin: 'system' },
      hub_closed: { from: ['running', 'stopping'], to: 'cancelled', origin: 'system' },
      restart_reconciled: { from: ['running', 'stopping'], to: 'cancelled', origin: 'system' },
    }[causation.action];
    if (!transition) throw new Error('Fixture runtime causation action is not installed.');
    const fixture = findBy(state.nodes, 'id', payload.fixtureId); if (!fixture || fixture.node_type !== 'fixture' || fixture.lifecycle !== 'standing') throw new Error('Fixture runtime target is unavailable.');
    const current = findBy(state.fixtureRuntimes, 'fixture_id', payload.fixtureId);
    if (current && current.revision + 1 !== event.aggregate_revision) throw new Error('Fixture runtime aggregate revision is not contiguous.');
    const currentState = current ? JSON.parse(current.state_json) : null; const fromStatus = currentState?.status || 'absent';
    if (!transition.from.includes(fromStatus) || transition.to !== payload.state.status) throw new Error('Fixture runtime transition is not installed.');
    const legacyRunningReconciliation = causation.action === 'restart_reconciled' && fromStatus === 'running' && currentState?.runId == null && current?.last_event_sequence === state.operationalBoundary?.sequence;
    const expectedRunId = legacyRunningReconciliation ? legacyBoundaryRunId(payload.fixtureId, current) : currentState?.runId;
    if (causation.action !== 'recipe_started' && (expectedRunId !== payload.state.runId || currentState?.recipe !== payload.state.recipe)) {
      throw Object.assign(new Error('Fixture runtime transition changed run or recipe identity.'), {
        code: 'world_runtime_identity_mismatch', expectedRunId, actualRunId: payload.state.runId,
        expectedRecipe: currentState?.recipe ?? null, actualRecipe: payload.state.recipe,
      });
    }
    if (transition.origin === 'system' && (event.command_id !== null || event.actor !== 'world_runtime')) throw new Error('Fixture runtime system transition envelope is invalid.');
    if (transition.origin === 'command_or_internal' && !((event.command_id !== null && event.actor === 'resident_tool') || (event.command_id === null && event.actor === 'world_internal'))) throw new Error('Fixture runtime command transition envelope is invalid.');
    const next = { fixture_id: payload.fixtureId, state_json: canonicalize(payload.state), revision: event.aggregate_revision, updated_at: event.occurred_at, ...pointer(event) };
    state.fixtureRuntimes = current ? replaceBy(state.fixtureRuntimes, 'fixture_id', payload.fixtureId, next) : [...state.fixtureRuntimes, next];
  } else if (event.event_kind === 'timer.set/v1') {
    exactKeys(causation, ['action'], 'timer set causation'); if (causation.action !== 'timer_set') throw new Error('Timer set causation is invalid.');
    exactKeys(payload, ['seconds', 'dueAt', 'createdAt'], 'timer set payload');
    if (event.aggregate_kind !== 'timer' || event.aggregate_id !== event.session_id) throw new Error('Timer aggregate envelope is invalid.');
    requiredString(event.session_id, 'timer session'); if (!findBy(state.locations, 'session_id', event.session_id)) throw new Error('Timer lifespan is unavailable.');
    if (!Number.isInteger(payload.seconds) || payload.seconds < 1 || payload.seconds > 3600) throw new Error('Timer seconds are invalid.'); validIso(payload.createdAt, 'timer created time'); validIso(payload.dueAt, 'timer due time');
    const createdMs = Date.parse(payload.createdAt); const dueMs = Date.parse(payload.dueAt);
    if (payload.createdAt !== event.occurred_at || !Number.isInteger(createdMs) || !Number.isInteger(dueMs) || dueMs - createdMs !== payload.seconds * 1000) throw new Error('Timer timing is invalid.');
    const current = findBy(state.timers, 'session_id', event.session_id); if (current && current.revision + 1 !== event.aggregate_revision) throw new Error('Timer aggregate revision is not contiguous.');
    const next = { session_id: event.session_id, seconds: payload.seconds, due_at: payload.dueAt, created_at: payload.createdAt, revision: event.aggregate_revision, ...pointer(event) };
    state.timers = current ? replaceBy(state.timers, 'session_id', event.session_id, next) : [...state.timers, next];
  } else if (event.event_kind === 'timer.cleared/v1') {
    exactKeys(causation, ['action'], 'timer clear causation'); if (causation.action !== 'timer_cleared') throw new Error('Timer clear causation is invalid.');
    exactKeys(payload, ['priorDueAt', 'reason'], 'timer clear payload'); requiredString(payload.priorDueAt, 'prior timer due time'); requiredString(payload.reason, 'timer clear reason');
    if (event.aggregate_kind !== 'timer' || event.aggregate_id !== event.session_id) throw new Error('Timer aggregate envelope is invalid.');
    const current = findBy(state.timers, 'session_id', event.session_id); if (!current || current.due_at !== payload.priorDueAt || current.revision + 1 !== event.aggregate_revision) throw new Error('Timer clear does not match current state.');
    state.timers = state.timers.filter(row => row.session_id !== event.session_id);
  } else if (event.event_kind === 'brief.revised/v1') {
    exactKeys(causation, ['action'], 'brief causation'); if (causation.action !== 'brief_revised') throw new Error('Brief causation is invalid.');
    exactKeys(payload, ['briefId', 'objective', 'scopePaths', 'acceptance', 'nonGoals', 'fieldHashes', 'createdAt'], 'brief payload');
    if (event.aggregate_kind !== 'brief' || event.aggregate_id !== event.session_id) throw new Error('Brief aggregate envelope is invalid.'); requiredString(event.session_id, 'brief session'); requiredString(payload.briefId, 'brief identity'); requiredString(payload.objective, 'brief objective');
    for (const key of ['scopePaths', 'acceptance', 'nonGoals']) if (!Array.isArray(payload[key]) || payload[key].some(item => typeof item !== 'string')) throw new Error(`Brief ${key} is invalid.`);
    canonicalObject(payload.fieldHashes, 'brief field hashes'); exactKeys(payload.fieldHashes, ['objective', 'scopePaths', 'acceptance', 'nonGoals'], 'brief field hashes');
    for (const value of Object.values(payload.fieldHashes)) if (!/^[0-9a-f]{64}$/.test(value)) throw new Error('Brief field hash is invalid.'); validIso(payload.createdAt, 'brief created time');
    const expectedFieldHashes = { objective: sha256(payload.objective), scopePaths: sha256(canonicalize(payload.scopePaths)), acceptance: sha256(canonicalize(payload.acceptance)), nonGoals: sha256(canonicalize(payload.nonGoals)) };
    if (canonicalize(payload.fieldHashes) !== canonicalize(expectedFieldHashes)) throw new Error('Brief field hashes do not match the revision.');
    const prior = state.briefs.filter(row => row.session_id === event.session_id).sort((a, b) => b.revision - a.revision)[0];
    if (prior && (prior.brief_id !== payload.briefId || prior.revision + 1 !== event.aggregate_revision || prior.created_at !== payload.createdAt)) throw new Error('Brief revision does not continue current state.');
    if (!prior && event.aggregate_revision !== 1) throw new Error('Brief first revision is invalid.');
    state.briefs.push({ brief_id: payload.briefId, session_id: event.session_id, revision: event.aggregate_revision, objective: payload.objective, scope_paths_json: canonicalize(payload.scopePaths), acceptance_json: canonicalize(payload.acceptance), non_goals_json: canonicalize(payload.nonGoals), field_hashes_json: canonicalize(payload.fieldHashes), created_at: payload.createdAt, updated_at: event.occurred_at, ...pointer(event) });
  } else if (event.event_kind === 'approval.opened/v1') {
    exactKeys(causation, ['action'], 'approval open causation'); if (causation.action !== 'approval_opened') throw new Error('Approval open causation is invalid.');
    exactKeys(payload, ['approvalId', 'kind', 'payload', 'preview'], 'approval open payload'); requiredString(payload.approvalId, 'approval identity'); requiredString(payload.kind, 'approval kind'); canonicalObject(payload.payload, 'approval payload'); canonicalObject(payload.preview, 'approval preview');
    if (!APPROVAL_KINDS.has(payload.kind)) throw new Error('Approval kind is not installed.');
    if (event.aggregate_kind !== 'approval' || event.aggregate_id !== payload.approvalId || event.aggregate_revision !== 1) throw new Error('Approval open aggregate envelope is invalid.'); requiredString(event.session_id, 'approval session');
    if (findBy(state.approvals, 'approval_id', payload.approvalId)) throw new Error('Approval is already open.');
    state.approvals.push({ approval_id: payload.approvalId, session_id: event.session_id, wake_id: event.wake_id, kind: payload.kind, status: 'pending', payload_json: canonicalize(payload.payload), preview_json: canonicalize(payload.preview), application_json: null, outcome_json: null, created_at: event.occurred_at, decided_at: null, revision: 1, ...pointer(event) });
  } else if (event.event_kind === 'approval.applying/v1') {
    exactKeys(causation, ['action'], 'approval applying causation'); if (causation.action !== 'approval_applying') throw new Error('Approval applying causation is invalid.');
    exactKeys(payload, ['attemptId', 'evidence'], 'approval applying payload'); requiredString(payload.attemptId, 'approval attempt identity'); canonicalObject(payload.evidence, 'approval application evidence'); exactKeys(payload.evidence, ['preimage', 'postcondition'], 'approval application evidence');
    if (event.aggregate_kind !== 'approval' || event.command_id === null || event.actor !== 'builder') throw new Error('Approval applying aggregate envelope is invalid.');
    const current = findBy(state.approvals, 'approval_id', event.aggregate_id); if (!current || current.status !== 'pending' || current.revision + 1 !== event.aggregate_revision || current.session_id !== event.session_id) throw new Error('Approval application does not match pending state.');
    const next = { ...current, status: 'applying', application_json: canonicalize({ attemptId: payload.attemptId, evidence: payload.evidence }), revision: event.aggregate_revision, ...pointer(event) };
    state.approvals = replaceBy(state.approvals, 'approval_id', event.aggregate_id, next);
  } else if (event.event_kind === 'approval.resolved/v1') {
    exactKeys(causation, ['action'], 'approval resolve causation'); if (!['approval_confirmed', 'approval_rejected'].includes(causation.action)) throw new Error('Approval resolve causation is invalid.');
    exactKeys(payload, ['status', 'attemptId', 'outcome'], 'approval resolve payload'); if (!['confirmed', 'rejected'].includes(payload.status) || (payload.status === 'confirmed') !== (causation.action === 'approval_confirmed')) throw new Error('Approval resolution status is invalid.');
    if (payload.outcome !== null) canonicalObject(payload.outcome, 'approval outcome');
    if (event.aggregate_kind !== 'approval') throw new Error('Approval resolve aggregate envelope is invalid.');
    const current = findBy(state.approvals, 'approval_id', event.aggregate_id); const application = current?.application_json ? JSON.parse(current.application_json) : null;
    const expectedPriorStatus = payload.status === 'confirmed' ? 'applying' : 'pending';
    if (!current || current.status !== expectedPriorStatus || current.revision + 1 !== event.aggregate_revision || current.session_id !== event.session_id) throw new Error('Approval resolution does not match current state.');
    if (payload.status === 'confirmed' ? payload.attemptId !== application?.attemptId : payload.attemptId !== null) throw new Error('Approval resolution attempt identity is invalid.');
    const next = { ...current, status: payload.status, outcome_json: payload.outcome === null ? null : canonicalize(payload.outcome), decided_at: event.occurred_at, revision: event.aggregate_revision, ...pointer(event) };
    state.approvals = replaceBy(state.approvals, 'approval_id', event.aggregate_id, next);
  } else if (event.event_kind === 'approval.cancelled/v1') {
    exactKeys(causation, ['action'], 'approval cancellation causation'); if (causation.action !== 'approval_cancelled') throw new Error('Approval cancellation causation is invalid.');
    exactKeys(payload, ['reason'], 'approval cancellation payload'); requiredString(payload.reason, 'approval cancellation reason');
    if (event.aggregate_kind !== 'approval') throw new Error('Approval cancellation aggregate envelope is invalid.');
    const current = findBy(state.approvals, 'approval_id', event.aggregate_id); if (!current || current.status !== 'pending' || current.revision + 1 !== event.aggregate_revision || current.session_id !== event.session_id) throw new Error('Approval cancellation does not match current state.');
    const next = { ...current, status: 'cancelled', outcome_json: canonicalize({ reason: payload.reason }), decided_at: event.occurred_at, revision: event.aggregate_revision, ...pointer(event) };
    state.approvals = replaceBy(state.approvals, 'approval_id', event.aggregate_id, next);
  } else if (event.event_kind === 'approval.reconciliation_required/v1') {
    exactKeys(causation, ['action'], 'approval reconciliation causation'); if (causation.action !== 'approval_reconciliation_required') throw new Error('Approval reconciliation causation is invalid.');
    exactKeys(payload, ['attemptId', 'reason'], 'approval reconciliation payload'); requiredString(payload.attemptId, 'approval attempt identity'); requiredString(payload.reason, 'approval reconciliation reason');
    if (event.aggregate_kind !== 'approval' || event.command_id !== null || event.actor !== 'world_runtime') throw new Error('Approval reconciliation aggregate envelope is invalid.');
    const current = findBy(state.approvals, 'approval_id', event.aggregate_id); const application = current?.application_json ? JSON.parse(current.application_json) : null;
    if (!current || current.status !== 'applying' || current.revision + 1 !== event.aggregate_revision || current.session_id !== event.session_id || application?.attemptId !== payload.attemptId) throw new Error('Approval reconciliation does not match applying state.');
    const next = { ...current, status: 'reconciliation_required', outcome_json: canonicalize({ reason: payload.reason }), decided_at: event.occurred_at, revision: event.aggregate_revision, ...pointer(event) };
    state.approvals = replaceBy(state.approvals, 'approval_id', event.aggregate_id, next);
  }
  state.locations.sort((a, b) => a.session_id.localeCompare(b.session_id));
  state.fixtureRuntimes.sort((a, b) => a.fixture_id.localeCompare(b.fixture_id)); state.timers.sort((a, b) => a.session_id.localeCompare(b.session_id));
  state.briefs.sort((a, b) => a.session_id.localeCompare(b.session_id) || a.revision - b.revision); state.approvals.sort((a, b) => a.approval_id.localeCompare(b.approval_id));
  state.nodes.sort((a, b) => a.id.localeCompare(b.id)); state.edges.sort((a, b) => a.id.localeCompare(b.id)); state.passages.sort((a, b) => a.edge_id.localeCompare(b.edge_id)); state.objectStates.sort((a, b) => a.object_id.localeCompare(b.object_id));
  return state;
}

export function eventHashInput(event) {
  return {
    sequence: event.sequence, eventId: event.event_id, eventSchemaVersion: event.event_schema_version,
    eventKind: event.event_kind, aggregateKind: event.aggregate_kind, aggregateId: event.aggregate_id,
    aggregateRevision: event.aggregate_revision, sessionId: event.session_id ?? null, wakeId: event.wake_id ?? null,
    actor: event.actor, commandId: event.command_id ?? null, causation: JSON.parse(event.causation_json),
    payload: JSON.parse(event.payload_json), payloadSha256: event.payload_sha256,
    previousEventHash: event.previous_event_hash, occurredAt: event.occurred_at,
  };
}

export function computeWorldEventHash(event) { return sha256(canonicalize(eventHashInput(event))); }

export function createWorldEvent({ head = null, eventKind, aggregateKind, aggregateId, aggregateRevision, sessionId = null, wakeId = null, actor, commandId = null, causation = {}, payload, occurredAt }) {
  const registration = WORLD_EVENT_KINDS[eventKind];
  if (!registration || registration.installed === false) throw Object.assign(new Error(`World event kind is not installed: ${eventKind}`), { code: 'world_event_kind_unknown' });
  const payloadJson = canonicalize(canonicalObject(payload, 'payload'));
  const event = {
    sequence: (head?.sequence || 0) + 1, event_id: id('world_event'), event_schema_version: registration.schemaVersion,
    event_kind: eventKind, aggregate_kind: aggregateKind, aggregate_id: aggregateId, aggregate_revision: aggregateRevision,
    session_id: sessionId, wake_id: wakeId, actor, command_id: commandId, causation_json: canonicalize(canonicalObject(causation, 'causation')),
    payload_json: payloadJson, payload_sha256: sha256(payloadJson), previous_event_hash: head?.event_hash || WORLD_EVENT_GENESIS_HASH,
    event_hash: '', occurred_at: occurredAt,
  };
  event.event_hash = computeWorldEventHash(event);
  return event;
}

export function insertWorldEvent(sqlite, event) {
  sqlite.prepare(`INSERT INTO world_event_journal(sequence,event_id,event_schema_version,event_kind,aggregate_kind,aggregate_id,aggregate_revision,session_id,wake_id,actor,command_id,causation_json,payload_json,payload_sha256,previous_event_hash,event_hash,occurred_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(...[
    event.sequence, event.event_id, event.event_schema_version, event.event_kind, event.aggregate_kind, event.aggregate_id,
    event.aggregate_revision, event.session_id, event.wake_id, event.actor, event.command_id, event.causation_json,
    event.payload_json, event.payload_sha256, event.previous_event_hash, event.event_hash, event.occurred_at,
  ]);
}

export function readWorldPhysicalProjection(sqlite) {
  return {
    nodes: sqlite.prepare(`SELECT ${NODE_COLUMNS.join(',')} FROM world_nodes ORDER BY id`).all(),
    edges: sqlite.prepare(`SELECT ${EDGE_COLUMNS.join(',')} FROM world_edges ORDER BY id`).all(),
    locations: sqlite.prepare(`SELECT ${LOCATION_COLUMNS.join(',')} FROM world_locations ORDER BY session_id`).all(),
  };
}

export function readWorldA2Projection(sqlite) {
  const operationalBoundary = sqlite.prepare("SELECT sequence,event_hash FROM world_event_journal WHERE event_kind='operational_snapshot.imported/v1' ORDER BY sequence LIMIT 1").get();
  return {
    ...readWorldPhysicalProjection(sqlite),
    fixtureRuntimes: sqlite.prepare(`SELECT ${FIXTURE_RUNTIME_COLUMNS.join(',')} FROM world_fixture_runtime ORDER BY fixture_id`).all(),
    timers: sqlite.prepare(`SELECT ${TIMER_COLUMNS.join(',')} FROM world_timers ORDER BY session_id`).all(),
    briefs: sqlite.prepare(`SELECT ${BRIEF_COLUMNS.join(',')} FROM world_work_briefs ORDER BY session_id,revision`).all(),
    approvals: sqlite.prepare(`SELECT ${APPROVAL_COLUMNS.join(',')} FROM world_approvals ORDER BY approval_id`).all(),
    passages: [], objectStates: [],
    legacyCustody: { actionReceipts: [], approvalReceipts: [] },
    operationalBoundary: operationalBoundary ? { sequence: operationalBoundary.sequence, eventHash: operationalBoundary.event_hash } : null,
    topologyExtension: null,
  };
}

export function readWorldProjection(sqlite) {
  const projection = readWorldA2Projection(sqlite);
  const topologyExtension = sqlite.prepare("SELECT sequence,event_hash FROM world_event_journal WHERE event_kind='topology.extended/v1' ORDER BY sequence LIMIT 1").get();
  const forestExtension = sqlite.prepare("SELECT sequence,event_hash FROM world_event_journal WHERE event_kind='topology.forest_installed/v1' ORDER BY sequence LIMIT 1").get();
  const binderWindowExtension = sqlite.prepare("SELECT sequence,event_hash FROM world_event_journal WHERE event_kind='topology.binder_window_installed/v1' ORDER BY sequence LIMIT 1").get();
  const spotlightExtension = sqlite.prepare("SELECT sequence,event_hash FROM world_event_journal WHERE event_kind='topology.spotlight_installed/v1' ORDER BY sequence LIMIT 1").get();
  return {
    ...projection,
    passages: sqlite.prepare(`SELECT ${PASSAGE_COLUMNS.join(',')} FROM world_passages ORDER BY edge_id`).all(),
    objectStates: sqlite.prepare(`SELECT ${OBJECT_STATE_COLUMNS.join(',')} FROM world_object_states ORDER BY object_id`).all(),
    topologyExtension: topologyExtension ? { sequence: topologyExtension.sequence, eventHash: topologyExtension.event_hash } : null,
    forestExtension: forestExtension ? { sequence: forestExtension.sequence, eventHash: forestExtension.event_hash } : null,
    binderWindowExtension: binderWindowExtension ? { sequence: binderWindowExtension.sequence, eventHash: binderWindowExtension.event_hash } : null,
    spotlightExtension: spotlightExtension ? { sequence: spotlightExtension.sequence, eventHash: spotlightExtension.event_hash } : null,
  };
}

export function custodyRowHash(row, kind) {
  const columns = kind === 'action'
    ? ACTION_RECEIPT_COLUMNS.filter(column => !column.startsWith('world_event_'))
    : APPROVAL_RECEIPT_COLUMNS.filter(column => !column.startsWith('world_event_'));
  return sha256(canonicalize(Object.fromEntries(columns.map(column => [column, row[column] ?? null]))));
}

function tableExists(sqlite, name) { return Boolean(sqlite.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=?").get(name)); }
function boundedDiagnostic(value, depth = 0) {
  if (typeof value === 'string') return value.length <= 512 ? value : `${value.slice(0, 160)}…[${value.length} chars; sha256:${sha256(value)}]`;
  if (!value || typeof value !== 'object' || depth >= 3) return value;
  if (Array.isArray(value)) return value.slice(0, 20).map(item => boundedDiagnostic(item, depth + 1));
  return Object.fromEntries(Object.entries(value).slice(0, 30).map(([key, nested]) => [key, boundedDiagnostic(nested, depth + 1)]));
}
function addMismatch(mismatches, limit, mismatch) { if (mismatches.length < limit) mismatches.push(boundedDiagnostic(mismatch)); }
function normalizeTriggerSql(sql) {
  return String(sql || '').toLowerCase().replace(/create\s+trigger\s+if\s+not\s+exists/, 'create trigger').replace(/\s+/g, '').replace(/;+$/g, '');
}
function normalizeTableSql(sql) {
  return String(sql || '').toLowerCase().replace(/create\s+table\s+if\s+not\s+exists/, 'create table').replace(/["`\[\]]/g, '').replace(/\s+/g, '').replace(/;+$/g, '');
}
function compareRows(actual, expected, columns, table, mismatches, limit, identityColumns = [columns[0]]) {
  const identityOf = row => identityColumns.map(column => String(row[column])).join(':');
  const actualByKey = new Map(actual.map(row => [identityOf(row), row])); const expectedByKey = new Map(expected.map(row => [identityOf(row), row]));
  const counts = new Map();
  for (const row of actual) { const identity = identityOf(row); counts.set(identity, (counts.get(identity) || 0) + 1); }
  for (const [identity, count] of counts) if (count > 1) addMismatch(mismatches, limit, { code: 'projection_duplicate_row', table, identity, count });
  for (const [identity, row] of expectedByKey) {
    const found = actualByKey.get(identity);
    if (!found) { addMismatch(mismatches, limit, { code: 'projection_missing_row', table, identity }); continue; }
    for (const column of columns) if (found[column] !== row[column]) addMismatch(mismatches, limit, { code: column.startsWith('last_event_') ? 'projection_pointer_mismatch' : 'projection_column_mismatch', table, identity, column, expected: row[column], actual: found[column] });
  }
  for (const identity of actualByKey.keys()) if (!expectedByKey.has(identity)) addMismatch(mismatches, limit, { code: 'projection_extra_row', table, identity });
}

const ACTION_EVENT_COMPATIBILITY = Object.freeze({
  move_through_door: ['location.moved/v1'], engage_fixture: ['fixture.engaged/v1'], disengage_fixture: ['fixture.disengaged/v1'],
  move_through_passage: ['location.crossed/v1'], operate_passage: ['passage.operated/v1'], turn_fixture: ['fixture.turned/v1'],
  workshop_read: ['source.inspected/v1'], workshop_search: ['source.inspected/v1'], workshop_search_regex: ['source.inspected/v1'],
  workshop_timer_set: ['timer.set/v1'], workshop_timer_cancel: ['timer.cleared/v1'], workshop_brief_upsert: ['brief.revised/v1'],
  workshop_run_recipe: ['fixture_runtime.replaced/v1'], workshop_recipe_cancel: ['fixture_runtime.replaced/v1'],
  workshop_apply_patch: ['approval.opened/v1', 'approval.applying/v1', 'approval.resolved/v1'], workshop_apply_unified_diff: ['approval.opened/v1', 'approval.applying/v1', 'approval.resolved/v1'],
  workshop_write_file: ['approval.opened/v1', 'approval.applying/v1', 'approval.resolved/v1'], workshop_create_path: ['approval.opened/v1', 'approval.applying/v1', 'approval.resolved/v1'],
  workshop_delete_path: ['approval.opened/v1', 'approval.applying/v1', 'approval.resolved/v1'], workshop_rename_path: ['approval.opened/v1', 'approval.applying/v1', 'approval.resolved/v1'],
  workshop_git_add: ['approval.opened/v1', 'approval.applying/v1', 'approval.resolved/v1'], workshop_git_commit: ['approval.opened/v1', 'approval.applying/v1', 'approval.resolved/v1'], workshop_git_checkout: ['approval.opened/v1', 'approval.applying/v1', 'approval.resolved/v1'],
  workshop_sandbox_promote: ['approval.opened/v1', 'approval.applying/v1', 'approval.resolved/v1'], workshop_approval_confirm: ['approval.applying/v1', 'approval.resolved/v1'], workshop_approval_reject: ['approval.resolved/v1'], workshop_approval_cancel: ['approval.cancelled/v1'],
});

function linkedEventForReceipt(row, eventBySequence, type, mismatches, limit) {
  const hasSequence = row.world_event_sequence !== null; const hasHash = row.world_event_hash !== null;
  if (hasSequence !== hasHash) { addMismatch(mismatches, limit, { code: 'custody_event_pointer_partial', table: type, receiptId: row.receipt_id }); return null; }
  if (!hasSequence) return null;
  const event = eventBySequence.get(row.world_event_sequence);
  if (!event || event.event_hash !== row.world_event_hash) { addMismatch(mismatches, limit, { code: 'custody_event_pointer_mismatch', table: type, receiptId: row.receipt_id, sequence: row.world_event_sequence }); return null; }
  return event;
}

function actionEventSemanticsMatch(row, event, args, result) {
  let payload; try { payload = JSON.parse(event.payload_json); } catch { return false; }
  if (row.tool_name === 'move_through_door') return payload.doorIdentity === args?.door_id && result?.edgeId === payload.edgeId;
  if (row.tool_name === 'move_through_passage') return row.room_node_id === payload.toLocationId && payload.passageId === args?.passage_id && result?.edgeId === payload.edgeId && result?.toLocationId === payload.toLocationId;
  if (row.tool_name === 'operate_passage') return row.room_node_id === payload.fromLocationId && payload.passageId === args?.passage_id && payload.operation === args?.action && canonicalize(result?.state) === canonicalize(payload.nextState);
  if (row.tool_name === 'turn_fixture') return row.room_node_id === payload.fromLocationId && payload.fixtureId === args?.fixture_id && result?.turnCount === payload.nextTurnCount;
  if (row.tool_name === 'engage_fixture') return payload.fixtureId === args?.fixture_id;
  if (row.tool_name === 'disengage_fixture') return result?.previousFixtureId === payload.fixtureId;
  if (['workshop_read', 'workshop_search', 'workshop_search_regex'].includes(row.tool_name)) return (result?.source?.path || result?.path || null) === payload.source;
  if (row.tool_name === 'workshop_timer_set') return payload.seconds === args?.seconds;
  if (row.tool_name === 'workshop_brief_upsert') return payload.objective === args?.objective;
  if (row.tool_name === 'workshop_run_recipe') return payload.state?.status === 'running' && payload.state?.recipe === args?.recipe;
  if (row.tool_name === 'workshop_recipe_cancel') return payload.state?.status === 'cancelled';
  if (event.event_kind.startsWith('approval.')) {
    const approvalId = result?.approvalId || result?.approval?.approvalId || args?.approval_id || null;
    if (approvalId !== event.aggregate_id) return false;
    if (row.tool_name === 'workshop_approval_confirm') return event.event_kind === 'approval.applying/v1' || event.event_kind === 'approval.resolved/v1' && payload.status === 'confirmed';
    if (row.tool_name === 'workshop_approval_reject') return event.event_kind === 'approval.resolved/v1' && payload.status === 'rejected';
    return row.tool_name !== 'workshop_approval_cancel' || event.event_kind === 'approval.cancelled/v1';
  }
  return true;
}

function verifyCustody(sqlite, events, state, mismatches, limit) {
  const actionRows = sqlite.prepare(`SELECT ${ACTION_RECEIPT_COLUMNS.join(',')} FROM world_action_receipts ORDER BY receipt_id`).all();
  const approvalRows = sqlite.prepare(`SELECT ${APPROVAL_RECEIPT_COLUMNS.join(',')} FROM world_approval_receipts ORDER BY receipt_id`).all();
  const eventBySequence = new Map(events.map(event => [event.sequence, event])); const actionById = new Map(actionRows.map(row => [row.receipt_id, row]));
  const legacyActions = new Map(state.legacyCustody.actionReceipts.map(row => [row.receiptId, row.rowSha256]));
  const legacyApprovals = new Map(state.legacyCustody.approvalReceipts.map(row => [row.receiptId, row.rowSha256]));
  const actionLinks = new Map(); const approvalLinks = new Map();
  for (const row of actionRows) {
    const event = linkedEventForReceipt(row, eventBySequence, 'world_action_receipts', mismatches, limit);
    if (event) actionLinks.set(event.sequence, [...(actionLinks.get(event.sequence) || []), row]);
    const legacy = legacyActions.get(row.receipt_id) === custodyRowHash(row, 'action');
    if (row.outcome === 'refused' && event) addMismatch(mismatches, limit, { code: 'refusal_event_linked', receiptId: row.receipt_id });
    if (!event && legacyActions.has(row.receipt_id) && !legacy) addMismatch(mismatches, limit, { code: 'legacy_custody_hash_mismatch', table: 'world_action_receipts', receiptId: row.receipt_id });
    let result = null; let args = null;
    try { result = JSON.parse(row.result_json); } catch { addMismatch(mismatches, limit, { code: 'custody_json_invalid', table: 'world_action_receipts', receiptId: row.receipt_id }); }
    try { args = JSON.parse(row.arguments_json); } catch { addMismatch(mismatches, limit, { code: 'custody_json_invalid', table: 'world_action_receipts', receiptId: row.receipt_id }); }
    const compatible = ACTION_EVENT_COMPATIBILITY[row.tool_name];
    const conditionalNoEvent = row.tool_name === 'workshop_recipe_cancel' && !result?.cancelled || row.tool_name === 'workshop_timer_cancel' && result?.cancelled === false;
    if (row.outcome === 'committed' && compatible && !conditionalNoEvent && !event && !legacy) addMismatch(mismatches, limit, { code: 'state_action_event_missing', receiptId: row.receipt_id, toolName: row.tool_name });
    if (event && (!compatible || !compatible.includes(event.event_kind) || event.session_id !== row.session_id || (event.wake_id || null) !== (row.wake_id || null))) addMismatch(mismatches, limit, { code: 'state_action_event_incompatible', receiptId: row.receipt_id, toolName: row.tool_name, eventKind: event.event_kind });
    else if (event && !actionEventSemanticsMatch(row, event, args, result)) addMismatch(mismatches, limit, { code: 'state_action_event_semantics_mismatch', receiptId: row.receipt_id, toolName: row.tool_name, eventKind: event.event_kind });
    if (event && legacyActions.has(row.receipt_id)) addMismatch(mismatches, limit, { code: 'legacy_custody_event_linked', table: 'world_action_receipts', receiptId: row.receipt_id });
  }
  for (const row of approvalRows) {
    const event = linkedEventForReceipt(row, eventBySequence, 'world_approval_receipts', mismatches, limit); const legacy = legacyApprovals.get(row.receipt_id) === custodyRowHash(row, 'approval');
    if (event) approvalLinks.set(event.sequence, [...(approvalLinks.get(event.sequence) || []), row]);
    if (!event && legacyApprovals.has(row.receipt_id) && !legacy) addMismatch(mismatches, limit, { code: 'legacy_custody_hash_mismatch', table: 'world_approval_receipts', receiptId: row.receipt_id });
    if (!event && !legacy) addMismatch(mismatches, limit, { code: 'approval_receipt_event_missing', receiptId: row.receipt_id, phase: row.phase });
    if (event) {
      const expectedKind = row.phase === 'pending' ? 'approval.opened/v1' : row.phase === 'applying' ? 'approval.applying/v1' : row.phase === 'cancelled' ? 'approval.cancelled/v1' : row.phase === 'reconciliation_required' ? 'approval.reconciliation_required/v1' : 'approval.resolved/v1';
      const action = actionById.get(row.action_receipt_id);
      if (event.event_kind !== expectedKind || event.aggregate_id !== row.approval_id || event.session_id !== row.session_id || (event.wake_id || null) !== (row.wake_id || null)) addMismatch(mismatches, limit, { code: 'approval_receipt_event_incompatible', receiptId: row.receipt_id, phase: row.phase, eventKind: event.event_kind });
      if (!action || action.world_event_sequence !== row.world_event_sequence || action.world_event_hash !== row.world_event_hash) addMismatch(mismatches, limit, { code: 'approval_action_event_link_mismatch', receiptId: row.receipt_id, actionReceiptId: row.action_receipt_id });
      let payload = null; try { payload = JSON.parse(event.payload_json); } catch {}
      if (row.phase === 'confirmed' && payload?.status !== 'confirmed' || row.phase === 'rejected' && payload?.status !== 'rejected') addMismatch(mismatches, limit, { code: 'approval_receipt_event_semantics_mismatch', receiptId: row.receipt_id, phase: row.phase });
      if (legacyApprovals.has(row.receipt_id)) addMismatch(mismatches, limit, { code: 'legacy_custody_event_linked', table: 'world_approval_receipts', receiptId: row.receipt_id });
    }
  }
  for (const [receiptId] of legacyActions) if (!actionById.has(receiptId)) addMismatch(mismatches, limit, { code: 'legacy_custody_row_missing', table: 'world_action_receipts', receiptId });
  const approvalIds = new Set(approvalRows.map(row => row.receipt_id)); for (const [receiptId] of legacyApprovals) if (!approvalIds.has(receiptId)) addMismatch(mismatches, limit, { code: 'legacy_custody_row_missing', table: 'world_approval_receipts', receiptId });
  const custodyBoundary = state.operationalBoundary?.sequence || 0;
  const commandActors = new Set(['resident_tool', 'builder']);
  for (const event of events) {
    if (event.sequence <= custodyBoundary) continue;
    if (event.command_id === null) {
      if (commandActors.has(event.actor)) addMismatch(mismatches, limit, { code: 'resident_event_command_missing', sequence: event.sequence, eventKind: event.event_kind, actor: event.actor });
      continue;
    }
    if (!commandActors.has(event.actor)) addMismatch(mismatches, limit, { code: 'command_event_actor_invalid', sequence: event.sequence, eventKind: event.event_kind, actor: event.actor });
    const linkedActions = actionLinks.get(event.sequence) || [];
    if (linkedActions.length !== 1) addMismatch(mismatches, limit, { code: linkedActions.length ? 'command_event_action_receipt_duplicate' : 'command_event_action_receipt_missing', sequence: event.sequence, eventKind: event.event_kind, count: linkedActions.length });
    if (event.event_kind.startsWith('approval.')) {
      const linkedApprovals = approvalLinks.get(event.sequence) || [];
      if (linkedApprovals.length !== 1) addMismatch(mismatches, limit, { code: linkedApprovals.length ? 'command_event_approval_receipt_duplicate' : 'command_event_approval_receipt_missing', sequence: event.sequence, eventKind: event.event_kind, count: linkedApprovals.length });
    }
  }
}

export function verifyWorldSqlite(sqlite, { mismatchLimit = 50, scope = 'b1', requireHearth = true, requireForest = false, requireBinderWindow = false, requireSpotlight = false } = {}) {
  if (scope === 'b1' && requireForest && tableExists(sqlite, 'world_event_journal')) {
    let forest = null;
    try { forest = sqlite.prepare("SELECT sequence FROM world_event_journal WHERE event_kind='topology.forest_installed/v1' LIMIT 1").get(); } catch {}
    if (!forest) {
      const hearth = verifyWorldSqlite(sqlite, { mismatchLimit, scope, requireHearth: true, requireForest: false });
      if (hearth.verified) return { ...hearth, verified: false, status: 'upgrade_required', upgradeRequired: true, projectorVersion: WORLD_PROJECTOR_VERSION, mismatches: [{ code: 'forest_upgrade_required', message: 'The exact Hearth World requires the explicit backup-confirmed Forest-place migration.' }] };
    }
  }
  if (scope === 'b1' && requireHearth && tableExists(sqlite, 'world_event_journal')) {
    let hearth = null;
    try { hearth = sqlite.prepare("SELECT sequence FROM world_event_journal WHERE event_kind='topology.hearth_installed/v1' LIMIT 1").get(); } catch {}
    if (!hearth) {
      const b1 = verifyWorldSqlite(sqlite, { mismatchLimit, scope, requireHearth: false });
      if (b1.verified) return {
        ...b1, verified: false, status: 'upgrade_required', upgradeRequired: true, projectorVersion: WORLD_PROJECTOR_VERSION,
        mismatches: [{ code: 'hearth_upgrade_required', message: 'The exact B1 World requires the explicit backup-confirmed House Hearth migration.' }],
      };
    }
  }
  if (scope === 'b1' && requireBinderWindow && tableExists(sqlite, 'world_event_journal')) {
    let binderWindow = null;
    try { binderWindow = sqlite.prepare("SELECT sequence FROM world_event_journal WHERE event_kind='topology.binder_window_installed/v1' LIMIT 1").get(); } catch {}
    if (!binderWindow) {
      const forest = verifyWorldSqlite(sqlite, { mismatchLimit, scope, requireHearth: true, requireForest: true, requireBinderWindow: false });
      if (forest.verified) return { ...forest, verified: false, status: 'upgrade_required', upgradeRequired: true, projectorVersion: WORLD_PROJECTOR_VERSION, mismatches: [{ code: 'binder_window_upgrade_required', message: 'The exact Forest World requires the explicit backup-confirmed Binder Window migration.' }] };
    }
  }
  if (scope === 'b1' && requireSpotlight && tableExists(sqlite, 'world_event_journal')) {
    let spotlight = null;
    try { spotlight = sqlite.prepare("SELECT sequence FROM world_event_journal WHERE event_kind='topology.spotlight_installed/v1' LIMIT 1").get(); } catch {}
    if (!spotlight) {
      const binderWindow = verifyWorldSqlite(sqlite, { mismatchLimit, scope, requireHearth: true, requireForest: true, requireBinderWindow: true, requireSpotlight: false });
      if (binderWindow.verified) return { ...binderWindow, verified: false, status: 'upgrade_required', upgradeRequired: true, projectorVersion: WORLD_PROJECTOR_VERSION, mismatches: [{ code: 'spotlight_upgrade_required', message: 'The exact Binder Window World requires the explicit backup-confirmed Spotlight Observatory migration.' }] };
    }
  }
  if (scope === 'b1' && tableExists(sqlite, 'world_event_journal')) {
    let extension = null;
    try { extension = sqlite.prepare("SELECT sequence FROM world_event_journal WHERE event_kind='topology.extended/v1' LIMIT 1").get(); } catch {}
    if (!extension) {
      const a2 = verifyWorldSqlite(sqlite, { mismatchLimit, scope: 'a2' });
      const b1Artifacts = ['world_passages', 'world_object_states', 'world_passages_append_only_update', 'world_passages_append_only_delete']
        .filter(name => sqlite.prepare("SELECT 1 AS ok FROM sqlite_master WHERE name=? AND type IN ('table','trigger')").get(name));
      if (a2.verified && !b1Artifacts.length) return {
        ...a2, verified: false, status: 'upgrade_required', upgradeRequired: true, projectorVersion: WORLD_PROJECTOR_VERSION,
        mismatches: [{ code: 'b1_upgrade_required', message: 'The exact A2 World requires the explicit backup-confirmed B1 topology migration.' }],
      };
    }
  }
  const mismatches = [];
  const a1ProjectionTables = ['world_nodes', 'world_edges', 'world_locations'];
  const a2ProjectionTables = ['world_fixture_runtime', 'world_timers', 'world_work_briefs', 'world_approvals'];
  const b1ProjectionTables = ['world_passages', 'world_object_states'];
  const requiredTables = ['world_event_journal', ...a1ProjectionTables, ...(['a2', 'b1'].includes(scope) ? [...a2ProjectionTables, ...Object.keys(WORLD_CUSTODY_TABLE_SQL)] : []), ...(scope === 'b1' ? b1ProjectionTables : [])];
  for (const table of requiredTables) if (!tableExists(sqlite, table)) addMismatch(mismatches, mismatchLimit, { code: 'schema_missing', table });
  if (mismatches.length) return { verified: false, eventCount: 0, journalHead: null, projectorVersion: WORLD_PROJECTOR_VERSION, mismatches };
  const journalTable = sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='world_event_journal'").get();
  const actualJournalSchema = normalizeTableSql(journalTable?.sql); const expectedJournalSchema = normalizeTableSql(WORLD_EVENT_JOURNAL_TABLE_SQL);
  if (actualJournalSchema !== expectedJournalSchema) {
    addMismatch(mismatches, mismatchLimit, { code: 'schema_definition_invalid', table: 'world_event_journal', expectedSha256: sha256(expectedJournalSchema), actualSha256: sha256(actualJournalSchema) });
    let eventCount = 0; try { eventCount = sqlite.prepare('SELECT COUNT(*) AS count FROM world_event_journal').get().count; } catch {}
    return { verified: false, eventCount, journalHead: null, projectorVersion: WORLD_PROJECTOR_VERSION, mismatches };
  }
  const expectedProjectionDefinitions = scope === 'b1' ? WORLD_PROJECTION_TABLE_SQL : WORLD_A2_PROJECTION_TABLE_SQL;
  for (const [table, expectedDefinition] of Object.entries(expectedProjectionDefinitions).filter(([table]) => scope !== 'a1' || a1ProjectionTables.includes(table))) {
    const row = sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table);
    const actual = normalizeTableSql(row?.sql); const expected = normalizeTableSql(expectedDefinition);
    if (actual !== expected) addMismatch(mismatches, mismatchLimit, { code: 'schema_definition_invalid', table, expectedSha256: sha256(expected), actualSha256: sha256(actual) });
  }
  if (['a2', 'b1'].includes(scope)) for (const [table, expectedDefinition] of Object.entries(WORLD_CUSTODY_TABLE_SQL)) {
    const row = sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table);
    const actual = normalizeTableSql(row?.sql); const expected = normalizeTableSql(expectedDefinition);
    if (actual !== expected) addMismatch(mismatches, mismatchLimit, { code: 'schema_definition_invalid', table, expectedSha256: sha256(expected), actualSha256: sha256(actual) });
  }
  for (const [trigger, expectedDefinition] of Object.entries(WORLD_INTEGRITY_TRIGGER_SQL).filter(([trigger]) => {
    if (scope !== 'b1' && trigger.startsWith('world_passages_')) return false;
    return ['a2', 'b1'].includes(scope) || !trigger.includes('_receipts_');
  })) {
    const row = sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?").get(trigger);
    if (!row) addMismatch(mismatches, mismatchLimit, { code: trigger.startsWith('world_event_journal_') ? 'journal_trigger_missing' : 'projection_trigger_missing', trigger });
    else {
      const actual = normalizeTriggerSql(row.sql); const expected = normalizeTriggerSql(expectedDefinition);
      if (actual !== expected) addMismatch(mismatches, mismatchLimit, { code: 'trigger_definition_invalid', trigger, expectedSha256: sha256(expected), actualSha256: sha256(actual) });
    }
  }
  const events = sqlite.prepare('SELECT * FROM world_event_journal ORDER BY sequence').all();
  const rootKinds = new Set(['topology.installed/v1', 'legacy_snapshot.imported/v1']);
  if (!events.length) addMismatch(mismatches, mismatchLimit, { code: 'journal_root_missing' });
  else if (events[0].sequence !== 1 || !rootKinds.has(events[0].event_kind)) addMismatch(mismatches, mismatchLimit, { code: 'journal_root_invalid', sequence: events[0].sequence, eventKind: events[0].event_kind });
  for (const event of events.slice(1)) if (rootKinds.has(event.event_kind)) addMismatch(mismatches, mismatchLimit, { code: 'journal_root_invalid', sequence: event.sequence, eventKind: event.event_kind });
  let state = emptyWorldState(); let previousHash = WORLD_EVENT_GENESIS_HASH;
  const aggregateRevisions = new Map();
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]; const expectedSequence = index + 1;
    if (event.sequence !== expectedSequence) addMismatch(mismatches, mismatchLimit, { code: 'sequence_gap', sequence: event.sequence, expected: expectedSequence });
    if (event.previous_event_hash !== previousHash) addMismatch(mismatches, mismatchLimit, { code: 'previous_event_hash_mismatch', sequence: event.sequence });
    let payload = null; let causation = null;
    try { payload = JSON.parse(event.payload_json); } catch { addMismatch(mismatches, mismatchLimit, { code: 'payload_json_invalid', sequence: event.sequence }); }
    try { causation = JSON.parse(event.causation_json); } catch { addMismatch(mismatches, mismatchLimit, { code: 'causation_json_invalid', sequence: event.sequence }); }
    if (payload !== null && (!payload || typeof payload !== 'object' || Array.isArray(payload))) addMismatch(mismatches, mismatchLimit, { code: 'payload_schema_invalid', sequence: event.sequence });
    if (causation !== null && (!causation || typeof causation !== 'object' || Array.isArray(causation))) addMismatch(mismatches, mismatchLimit, { code: 'causation_schema_invalid', sequence: event.sequence });
    if (payload && canonicalize(payload) !== event.payload_json) addMismatch(mismatches, mismatchLimit, { code: 'payload_not_canonical', sequence: event.sequence });
    if (causation && canonicalize(causation) !== event.causation_json) addMismatch(mismatches, mismatchLimit, { code: 'causation_not_canonical', sequence: event.sequence });
    if (sha256(event.payload_json) !== event.payload_sha256) addMismatch(mismatches, mismatchLimit, { code: 'payload_hash_mismatch', sequence: event.sequence });
    try { if (computeWorldEventHash(event) !== event.event_hash) addMismatch(mismatches, mismatchLimit, { code: 'event_hash_mismatch', sequence: event.sequence }); }
    catch { addMismatch(mismatches, mismatchLimit, { code: 'event_hash_input_invalid', sequence: event.sequence }); }
    const registration = WORLD_EVENT_KINDS[event.event_kind];
    if (!registration || registration.installed === false) addMismatch(mismatches, mismatchLimit, { code: 'event_kind_unknown', sequence: event.sequence, eventKind: event.event_kind });
    else if (scope === 'a1' && registration.stretch !== 'A1') addMismatch(mismatches, mismatchLimit, { code: 'later_event_present', sequence: event.sequence, eventKind: event.event_kind });
    else if (scope === 'a2' && registration.stretch === 'B1') addMismatch(mismatches, mismatchLimit, { code: 'b1_event_present', sequence: event.sequence, eventKind: event.event_kind });
    else if (!requireHearth && registration.stretch === 'H1') addMismatch(mismatches, mismatchLimit, { code: 'hearth_event_present', sequence: event.sequence, eventKind: event.event_kind });
    else if (!requireForest && registration.stretch === 'F1') addMismatch(mismatches, mismatchLimit, { code: 'forest_event_present', sequence: event.sequence, eventKind: event.event_kind });
    else if (!requireBinderWindow && registration.stretch === 'BW1') addMismatch(mismatches, mismatchLimit, { code: 'binder_window_event_present', sequence: event.sequence, eventKind: event.event_kind });
    else if (!requireSpotlight && registration.stretch === 'SP1') addMismatch(mismatches, mismatchLimit, { code: 'spotlight_event_present', sequence: event.sequence, eventKind: event.event_kind });
    else if (registration.schemaVersion !== event.event_schema_version) addMismatch(mismatches, mismatchLimit, { code: 'event_schema_version_unknown', sequence: event.sequence, eventKind: event.event_kind, version: event.event_schema_version });
    const aggregateKey = `${event.aggregate_kind}:${event.aggregate_id}`;
    const expectedRevision = (aggregateRevisions.get(aggregateKey) || 0) + 1;
    if (event.aggregate_revision !== expectedRevision) addMismatch(mismatches, mismatchLimit, { code: 'aggregate_revision_gap', sequence: event.sequence, aggregateKind: event.aggregate_kind, aggregateId: event.aggregate_id, expected: expectedRevision, actual: event.aggregate_revision });
    aggregateRevisions.set(aggregateKey, event.aggregate_revision);
    try {
      state = reduceWorldEvent(state, event);
      if (event.event_kind === 'legacy_snapshot.imported/v1') for (const row of state.locations) aggregateRevisions.set(`lifespan:${row.session_id}`, row.revision);
      if (event.event_kind === 'operational_snapshot.imported/v1') {
        for (const row of state.fixtureRuntimes) aggregateRevisions.set(`fixture_runtime:${row.fixture_id}`, row.revision);
        for (const row of state.timers) aggregateRevisions.set(`timer:${row.session_id}`, row.revision);
        for (const row of state.briefs) aggregateRevisions.set(`brief:${row.session_id}`, Math.max(aggregateRevisions.get(`brief:${row.session_id}`) || 0, row.revision));
        for (const row of state.approvals) aggregateRevisions.set(`approval:${row.approval_id}`, row.revision);
      }
      if (event.event_kind === 'topology.extended/v1') for (const row of state.objectStates) aggregateRevisions.set(`world_object:${row.object_id}`, row.revision);
    } catch (error) { addMismatch(mismatches, mismatchLimit, { code: 'replay_error', sequence: event.sequence, message: error.message }); }
    previousHash = event.event_hash;
  }
  let actual = emptyWorldState();
  try { actual = scope === 'b1' ? readWorldProjection(sqlite) : scope === 'a2' ? readWorldA2Projection(sqlite) : { ...emptyWorldState(), ...readWorldPhysicalProjection(sqlite) }; }
  catch (error) { addMismatch(mismatches, mismatchLimit, { code: 'projection_schema_invalid', message: error.message }); }
  compareRows(actual.nodes, state.nodes, NODE_COLUMNS, 'world_nodes', mismatches, mismatchLimit);
  compareRows(actual.edges, state.edges, EDGE_COLUMNS, 'world_edges', mismatches, mismatchLimit);
  compareRows(actual.locations, state.locations, LOCATION_COLUMNS, 'world_locations', mismatches, mismatchLimit);
  if (['a2', 'b1'].includes(scope)) {
    compareRows(actual.fixtureRuntimes, state.fixtureRuntimes, FIXTURE_RUNTIME_COLUMNS, 'world_fixture_runtime', mismatches, mismatchLimit);
    compareRows(actual.timers, state.timers, TIMER_COLUMNS, 'world_timers', mismatches, mismatchLimit);
    compareRows(actual.briefs, state.briefs, BRIEF_COLUMNS, 'world_work_briefs', mismatches, mismatchLimit, ['session_id', 'revision']);
    compareRows(actual.approvals, state.approvals, APPROVAL_COLUMNS, 'world_approvals', mismatches, mismatchLimit);
    const custodySchemasValid = Object.entries(WORLD_CUSTODY_TABLE_SQL).every(([table, expected]) => normalizeTableSql(sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table)?.sql) === normalizeTableSql(expected));
    if (custodySchemasValid) verifyCustody(sqlite, events, state, mismatches, mismatchLimit);
  }
  if (scope === 'b1') {
    const extensionEvents = events.filter(event => event.event_kind === 'topology.extended/v1');
    if (extensionEvents.length !== 1) addMismatch(mismatches, mismatchLimit, { code: extensionEvents.length ? 'b1_extension_duplicate' : 'b1_extension_missing', count: extensionEvents.length });
    compareRows(actual.passages, state.passages, PASSAGE_COLUMNS, 'world_passages', mismatches, mismatchLimit);
    compareRows(actual.objectStates, state.objectStates, OBJECT_STATE_COLUMNS, 'world_object_states', mismatches, mismatchLimit);
    if (requireBinderWindow) {
      const binderWindowEvents = events.filter(event => event.event_kind === 'topology.binder_window_installed/v1');
      if (binderWindowEvents.length !== 1) addMismatch(mismatches, mismatchLimit, { code: binderWindowEvents.length ? 'binder_window_extension_duplicate' : 'binder_window_extension_missing', count: binderWindowEvents.length });
    }
    if (requireSpotlight) {
      const spotlightEvents = events.filter(event => event.event_kind === 'topology.spotlight_installed/v1');
      if (spotlightEvents.length !== 1) addMismatch(mismatches, mismatchLimit, { code: spotlightEvents.length ? 'spotlight_extension_duplicate' : 'spotlight_extension_missing', count: spotlightEvents.length });
    }
  }
  const head = events.at(-1) || null;
  return {
    verified: mismatches.length === 0, eventCount: events.length,
    journalHead: head ? { sequence: head.sequence, eventId: boundedDiagnostic(head.event_id), eventHash: boundedDiagnostic(head.event_hash), occurredAt: boundedDiagnostic(head.occurred_at) } : null,
    projectorVersion: scope === 'a1' ? 1 : scope === 'a2' ? 2 : WORLD_PROJECTOR_VERSION, mismatches,
  };
}

export function verifyWorldA1Sqlite(sqlite, options = {}) { return verifyWorldSqlite(sqlite, { ...options, scope: 'a1' }); }
export function verifyWorldA2Sqlite(sqlite, options = {}) { return verifyWorldSqlite(sqlite, { ...options, scope: 'a2' }); }

export function replayWorldEvents(sqlite) {
  let state = emptyWorldState();
  for (const event of sqlite.prepare('SELECT * FROM world_event_journal ORDER BY sequence').all()) state = reduceWorldEvent(state, event);
  return state;
}

export function verifyWorldDatabase(path, options) {
  let sqlite;
  try { sqlite = new DatabaseSync(path, { readOnly: true }); return verifyWorldSqlite(sqlite, options); }
  catch (error) { return { verified: false, eventCount: 0, journalHead: null, projectorVersion: WORLD_PROJECTOR_VERSION, mismatches: [{ code: 'database_open_failed', message: error.message }] }; }
  finally { sqlite?.close(); }
}

export function inspectWorldA2UpgradeDatabase(path, { mismatchLimit = 50 } = {}) {
  let sqlite;
  try {
    sqlite = new DatabaseSync(path, { readOnly: true });
    if (!tableExists(sqlite, 'world_event_journal')) return {
      status: 'legacy_journal_migration_required', upgradeRequired: false,
      backupExpectation: 'Keep a verified byte-for-byte backup. Journal-less legacy migration is performed only by the normal explicit World legacy boundary path.',
    };
    const b1 = verifyWorldSqlite(sqlite, { mismatchLimit });
    if (b1.verified) return { status: 'current', upgradeRequired: false, verification: b1, supersededBy: 'B1' };
    const current = verifyWorldA2Sqlite(sqlite, { mismatchLimit });
    if (current.verified) return { status: 'current', upgradeRequired: false, verification: current };
    const boundary = sqlite.prepare("SELECT sequence,event_hash FROM world_event_journal WHERE event_kind='operational_snapshot.imported/v1' ORDER BY sequence LIMIT 1").get();
    const a1 = verifyWorldA1Sqlite(sqlite, { mismatchLimit });
    if (boundary) return { status: 'corrupt_or_incomplete_a2', upgradeRequired: false, boundary, verification: current };
    if (!a1.verified) return { status: 'corrupt_a1', upgradeRequired: false, verification: a1 };
    return {
      status: 'upgrade_required', upgradeRequired: true, verification: a1,
      backupExpectation: 'Create and verify a byte-for-byte backup of the World database before applying the A2 migration.',
    };
  } catch (error) {
    return { status: 'database_open_failed', upgradeRequired: false, verification: { verified: false, mismatches: [{ code: 'database_open_failed', message: error.message }] } };
  } finally { sqlite?.close(); }
}

export function inspectWorldB1UpgradeDatabase(path, { mismatchLimit = 50 } = {}) {
  let sqlite;
  try {
    sqlite = new DatabaseSync(path, { readOnly: true });
    if (!tableExists(sqlite, 'world_event_journal')) return {
      status: 'legacy_journal_migration_required', upgradeRequired: false,
      backupExpectation: 'Keep a verified byte-for-byte backup. Journal-less legacy admission occurs only on a disposable or intentionally maintained World database.',
    };
    const current = verifyWorldSqlite(sqlite, { mismatchLimit, requireHearth: false });
    if (current.verified) return { status: 'current', upgradeRequired: false, verification: current };
    const extension = sqlite.prepare("SELECT sequence,event_hash FROM world_event_journal WHERE event_kind='topology.extended/v1' ORDER BY sequence LIMIT 1").get();
    const partialArtifacts = ['world_passages', 'world_object_states', 'world_passages_append_only_update', 'world_passages_append_only_delete']
      .filter(name => sqlite.prepare("SELECT 1 AS ok FROM sqlite_master WHERE name=? AND type IN ('table','trigger')").get(name));
    if (extension || partialArtifacts.length) return { status: 'corrupt_or_incomplete_b1', upgradeRequired: false, extension: extension || null, partialArtifacts, verification: current };
    const a2 = verifyWorldA2Sqlite(sqlite, { mismatchLimit });
    if (!a2.verified) return { status: 'corrupt_a2', upgradeRequired: false, verification: a2 };
    return {
      status: 'upgrade_required', upgradeRequired: true, verification: a2,
      backupExpectation: 'Create and verify a byte-for-byte backup of the World database before applying the B1 migration.',
    };
  } catch (error) {
    return { status: 'database_open_failed', upgradeRequired: false, verification: { verified: false, mismatches: [{ code: 'database_open_failed', message: error.message }] } };
  } finally { sqlite?.close(); }
}

export function assertWorldVerified(sqlite, options = {}) {
  const verification = verifyWorldSqlite(sqlite, options);
  if (!verification.verified) {
    const upgrade = verification.status === 'upgrade_required';
    const hearth = verification.mismatches?.some(item => item.code === 'hearth_upgrade_required');
    const binderWindow = verification.mismatches?.some(item => item.code === 'binder_window_upgrade_required');
    const spotlight = verification.mismatches?.some(item => item.code === 'spotlight_upgrade_required');
    throw Object.assign(new Error(upgrade ? (spotlight ? 'Spotlight Observatory World migration is required.' : binderWindow ? 'Binder Window World migration is required.' : hearth ? 'House Hearth World migration is required.' : 'World B1 topology migration is required.') : 'World event journal and physical projection have drifted.'), { code: upgrade ? (spotlight ? 'world_spotlight_upgrade_required' : binderWindow ? 'world_binder_window_upgrade_required' : hearth ? 'world_hearth_upgrade_required' : 'world_b1_upgrade_required') : 'world_projection_drift', verification });
  }
  return verification;
}
