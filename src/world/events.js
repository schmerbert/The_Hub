import { DatabaseSync } from 'node:sqlite';
import { canonicalize, id, sha256 } from '../core/hash.js';
import { installedTopologyHash, installedTopologyManifest } from './topology.js';

export const WORLD_PROJECTOR_VERSION = 1;
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
  'fixture_runtime.replaced/v1': { schemaVersion: 1, stretch: 'A2', installed: false },
  'timer.set/v1': { schemaVersion: 1, stretch: 'A2', installed: false },
  'timer.cleared/v1': { schemaVersion: 1, stretch: 'A2', installed: false },
  'brief.revised/v1': { schemaVersion: 1, stretch: 'A2', installed: false },
  'approval.opened/v1': { schemaVersion: 1, stretch: 'A2', installed: false },
  'approval.resolved/v1': { schemaVersion: 1, stretch: 'A2', installed: false },
  'approval.cancelled/v1': { schemaVersion: 1, stretch: 'A2', installed: false },
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
});

export const WORLD_PROJECTION_TABLE_SQL = Object.freeze({
  world_nodes: "CREATE TABLE IF NOT EXISTS world_nodes (id TEXT PRIMARY KEY, node_type TEXT NOT NULL CHECK(node_type IN ('room','fixture','object','station')), resident_text TEXT NOT NULL, state_json TEXT NOT NULL, lifecycle TEXT NOT NULL CHECK(lifecycle IN ('standing','retired')), revision INTEGER NOT NULL CHECK(revision>0), created_at TEXT NOT NULL, last_event_sequence INTEGER, last_event_hash TEXT);",
  world_edges: "CREATE TABLE IF NOT EXISTS world_edges (id TEXT PRIMARY KEY, edge_type TEXT NOT NULL CHECK(edge_type IN ('door','contains')), from_node_id TEXT NOT NULL REFERENCES world_nodes(id), to_node_id TEXT NOT NULL REFERENCES world_nodes(id), door_identity TEXT, label TEXT, created_at TEXT NOT NULL, last_event_sequence INTEGER, last_event_hash TEXT, UNIQUE(edge_type, from_node_id, to_node_id));",
  world_locations: "CREATE TABLE IF NOT EXISTS world_locations (session_id TEXT PRIMARY KEY, room_node_id TEXT NOT NULL REFERENCES world_nodes(id), inspected_source TEXT, engaged_fixture_id TEXT REFERENCES world_nodes(id), revision INTEGER NOT NULL CHECK(revision>0), started_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_event_sequence INTEGER, last_event_hash TEXT);",
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

function emptyState() { return { nodes: [], edges: [], locations: [] }; }
function copyState(state) { return { nodes: state.nodes.map(row => ({ ...row })), edges: state.edges.map(row => ({ ...row })), locations: state.locations.map(row => ({ ...row })) }; }
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
    return { ...topologyRows(payload, event), locations: [] };
  }
  if (event.event_kind === 'legacy_snapshot.imported/v1') {
    exactKeys(causation, ['boundary'], 'legacy causation');
    if (causation.boundary !== 'pre_journal_projection') throw new Error('Legacy causation boundary is invalid.');
    if (event.aggregate_kind !== 'world_snapshot' || event.aggregate_id !== 'legacy_boundary' || event.aggregate_revision !== 1 || event.session_id !== null) throw new Error('Legacy boundary aggregate envelope is invalid.');
    if (priorState.nodes.length || priorState.edges.length || priorState.locations.length) throw new Error('A legacy boundary can only be imported into an empty replay.');
    return legacyRows(payload, event);
  }
  const state = copyState(priorState);
  if (event.event_kind === 'lifespan.started/v1') {
    exactKeys(causation, ['reason'], 'lifespan causation');
    if (causation.reason !== 'lifespan_initialized') throw new Error('Lifespan causation reason is invalid.');
    exactKeys(payload, ['roomNodeId'], 'lifespan payload');
    if (event.aggregate_kind !== 'lifespan' || event.aggregate_id !== event.session_id || event.aggregate_revision !== 1) throw new Error('Lifespan event aggregate envelope is invalid.');
    requiredString(event.session_id, 'lifespan session'); requiredString(payload.roomNodeId, 'starting room');
    if (findBy(state.locations, 'session_id', event.session_id)) throw new Error('Lifespan is already initialized.');
    const startingRoom = findBy(state.nodes, 'id', payload.roomNodeId);
    if (!startingRoom || startingRoom.node_type !== 'room' || startingRoom.lifecycle !== 'standing') throw new Error('Starting room is not an installed standing room.');
    state.locations.push({ session_id: event.session_id, room_node_id: payload.roomNodeId, inspected_source: null, engaged_fixture_id: null, revision: event.aggregate_revision, started_at: event.occurred_at, updated_at: event.occurred_at, ...pointer(event) });
  } else {
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
  }
  state.locations.sort((a, b) => a.session_id.localeCompare(b.session_id));
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

export function readWorldProjection(sqlite) {
  return {
    nodes: sqlite.prepare(`SELECT ${NODE_COLUMNS.join(',')} FROM world_nodes ORDER BY id`).all(),
    edges: sqlite.prepare(`SELECT ${EDGE_COLUMNS.join(',')} FROM world_edges ORDER BY id`).all(),
    locations: sqlite.prepare(`SELECT ${LOCATION_COLUMNS.join(',')} FROM world_locations ORDER BY session_id`).all(),
  };
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
function compareRows(actual, expected, columns, table, mismatches, limit) {
  const key = columns[0]; const actualByKey = new Map(actual.map(row => [row[key], row])); const expectedByKey = new Map(expected.map(row => [row[key], row]));
  const counts = new Map();
  for (const row of actual) counts.set(row[key], (counts.get(row[key]) || 0) + 1);
  for (const [identity, count] of counts) if (count > 1) addMismatch(mismatches, limit, { code: 'projection_duplicate_row', table, identity, count });
  for (const [identity, row] of expectedByKey) {
    const found = actualByKey.get(identity);
    if (!found) { addMismatch(mismatches, limit, { code: 'projection_missing_row', table, identity }); continue; }
    for (const column of columns) if (found[column] !== row[column]) addMismatch(mismatches, limit, { code: column.startsWith('last_event_') ? 'projection_pointer_mismatch' : 'projection_column_mismatch', table, identity, column, expected: row[column], actual: found[column] });
  }
  for (const identity of actualByKey.keys()) if (!expectedByKey.has(identity)) addMismatch(mismatches, limit, { code: 'projection_extra_row', table, identity });
}

export function verifyWorldSqlite(sqlite, { mismatchLimit = 50 } = {}) {
  const mismatches = [];
  const requiredTables = ['world_event_journal', 'world_nodes', 'world_edges', 'world_locations'];
  for (const table of requiredTables) if (!tableExists(sqlite, table)) addMismatch(mismatches, mismatchLimit, { code: 'schema_missing', table });
  if (mismatches.length) return { verified: false, eventCount: 0, journalHead: null, projectorVersion: WORLD_PROJECTOR_VERSION, mismatches };
  const journalTable = sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='world_event_journal'").get();
  const actualJournalSchema = normalizeTableSql(journalTable?.sql); const expectedJournalSchema = normalizeTableSql(WORLD_EVENT_JOURNAL_TABLE_SQL);
  if (actualJournalSchema !== expectedJournalSchema) {
    addMismatch(mismatches, mismatchLimit, { code: 'schema_definition_invalid', table: 'world_event_journal', expectedSha256: sha256(expectedJournalSchema), actualSha256: sha256(actualJournalSchema) });
    let eventCount = 0; try { eventCount = sqlite.prepare('SELECT COUNT(*) AS count FROM world_event_journal').get().count; } catch {}
    return { verified: false, eventCount, journalHead: null, projectorVersion: WORLD_PROJECTOR_VERSION, mismatches };
  }
  for (const [table, expectedDefinition] of Object.entries(WORLD_PROJECTION_TABLE_SQL)) {
    const row = sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table);
    const actual = normalizeTableSql(row?.sql); const expected = normalizeTableSql(expectedDefinition);
    if (actual !== expected) addMismatch(mismatches, mismatchLimit, { code: 'schema_definition_invalid', table, expectedSha256: sha256(expected), actualSha256: sha256(actual) });
  }
  for (const [trigger, expectedDefinition] of Object.entries(WORLD_INTEGRITY_TRIGGER_SQL)) {
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
  let state = emptyState(); let previousHash = WORLD_EVENT_GENESIS_HASH;
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
    else if (registration.schemaVersion !== event.event_schema_version) addMismatch(mismatches, mismatchLimit, { code: 'event_schema_version_unknown', sequence: event.sequence, eventKind: event.event_kind, version: event.event_schema_version });
    const aggregateKey = `${event.aggregate_kind}:${event.aggregate_id}`;
    const expectedRevision = (aggregateRevisions.get(aggregateKey) || 0) + 1;
    if (event.aggregate_revision !== expectedRevision) addMismatch(mismatches, mismatchLimit, { code: 'aggregate_revision_gap', sequence: event.sequence, aggregateKind: event.aggregate_kind, aggregateId: event.aggregate_id, expected: expectedRevision, actual: event.aggregate_revision });
    aggregateRevisions.set(aggregateKey, event.aggregate_revision);
    try {
      state = reduceWorldEvent(state, event);
      if (event.event_kind === 'legacy_snapshot.imported/v1') for (const row of state.locations) aggregateRevisions.set(`lifespan:${row.session_id}`, row.revision);
    } catch (error) { addMismatch(mismatches, mismatchLimit, { code: 'replay_error', sequence: event.sequence, message: error.message }); }
    previousHash = event.event_hash;
  }
  let actual = emptyState();
  try { actual = readWorldProjection(sqlite); }
  catch (error) { addMismatch(mismatches, mismatchLimit, { code: 'projection_schema_invalid', message: error.message }); }
  compareRows(actual.nodes, state.nodes, NODE_COLUMNS, 'world_nodes', mismatches, mismatchLimit);
  compareRows(actual.edges, state.edges, EDGE_COLUMNS, 'world_edges', mismatches, mismatchLimit);
  compareRows(actual.locations, state.locations, LOCATION_COLUMNS, 'world_locations', mismatches, mismatchLimit);
  const head = events.at(-1) || null;
  return {
    verified: mismatches.length === 0, eventCount: events.length,
    journalHead: head ? { sequence: head.sequence, eventId: boundedDiagnostic(head.event_id), eventHash: boundedDiagnostic(head.event_hash), occurredAt: boundedDiagnostic(head.occurred_at) } : null,
    projectorVersion: WORLD_PROJECTOR_VERSION, mismatches,
  };
}

export function verifyWorldDatabase(path, options) {
  let sqlite;
  try { sqlite = new DatabaseSync(path, { readOnly: true }); return verifyWorldSqlite(sqlite, options); }
  catch (error) { return { verified: false, eventCount: 0, journalHead: null, projectorVersion: WORLD_PROJECTOR_VERSION, mismatches: [{ code: 'database_open_failed', message: error.message }] }; }
  finally { sqlite?.close(); }
}

export function assertWorldVerified(sqlite) {
  const verification = verifyWorldSqlite(sqlite);
  if (!verification.verified) throw Object.assign(new Error('World event journal and physical projection have drifted.'), { code: 'world_projection_drift', verification });
  return verification;
}
