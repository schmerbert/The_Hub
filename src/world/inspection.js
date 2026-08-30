import { ceilingCatalog } from './ceiling.js';
import { presentationCatalog } from '../context/resident-presentation.js';
import { schemasForSession } from './tools.js';
import { workshopInstallationWitness } from '../rooms/workshop-witness.js';
import { spotlightInstallationWitness } from '../rooms/spotlight-witness.js';
import { installedRoomReceipts } from '../rooms/installation-runtime.js';

const COLLECTION_LIMIT = 100;
const CELL_CHARACTER_LIMIT = 2048;

function emptyCollection() {
  return { rows: [], total: 0, totalAtLeast: 0, returned: 0, truncated: false, available: false };
}

function safeCollection(world, table, sql, parameters = []) {
  if (!world.sqlite.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=?").get(table)) return emptyCollection();
  try {
    const sampled = world.sqlite.prepare(sql).all(...parameters, COLLECTION_LIMIT + 1);
    const truncated = sampled.length > COLLECTION_LIMIT;
    const rows = sampled.slice(0, COLLECTION_LIMIT);
    return { rows, total: truncated ? null : rows.length, totalAtLeast: sampled.length, returned: rows.length, truncated, available: true };
  } catch {
    return emptyCollection();
  }
}

function diagnosticText(value) {
  return value === null ? null : {
    value: value.slice(0, CELL_CHARACTER_LIMIT),
    truncated: value.length > CELL_CHARACTER_LIMIT,
    charactersObserved: value.length,
  };
}

function diagnosticRow(row) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, typeof value === 'string' ? diagnosticText(value) : value]));
}

function boundedVerifiedRow(row) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, typeof value === 'string' && value.length > CELL_CHARACTER_LIMIT ? diagnosticText(value) : value]));
}

function collectionBounds(collection) {
  return {
    total: collection.total,
    totalAtLeast: collection.totalAtLeast,
    returned: collection.returned,
    truncated: collection.truncated,
    available: collection.available,
  };
}

export function projectWorldBuilderInspection(world, sessionId) {
  const verification = world.verification({ mismatchLimit: 50 });
  const cap = column => `substr(${column},1,${CELL_CHARACTER_LIMIT + 1}) AS ${column}`;
  const nodes = safeCollection(world, 'world_nodes', verification.verified
    ? 'SELECT * FROM world_nodes ORDER BY id LIMIT ?'
    : `SELECT ${['id', 'node_type', 'resident_text', 'state_json', 'lifecycle'].map(cap).join(',')},revision,${cap('created_at')},last_event_sequence,${cap('last_event_hash')} FROM world_nodes ORDER BY id LIMIT ?`);
  const edges = safeCollection(world, 'world_edges', verification.verified
    ? 'SELECT * FROM world_edges ORDER BY id LIMIT ?'
    : `SELECT ${['id', 'edge_type', 'from_node_id', 'to_node_id', 'door_identity', 'label', 'created_at'].map(cap).join(',')},last_event_sequence,${cap('last_event_hash')} FROM world_edges ORDER BY id LIMIT ?`);
  const passages = safeCollection(world, 'world_passages',
    `SELECT ${['edge_id', 'passage_id', 'passage_kind', 'from_node_id', 'to_node_id', 'governed_object_id'].map(cap).join(',')},last_event_sequence,${cap('last_event_hash')} FROM world_passages ORDER BY edge_id LIMIT ?`);
  const objectStates = safeCollection(world, 'world_object_states',
    `SELECT ${cap('object_id')},${cap('state_json')},revision,${cap('updated_at')},last_event_sequence,${cap('last_event_hash')} FROM world_object_states ORDER BY object_id LIMIT ?`);
  const approvalRows = safeCollection(world, 'world_approvals',
    `SELECT ${['approval_id', 'session_id', 'wake_id', 'kind', 'status', 'payload_json', 'preview_json', 'application_json', 'outcome_json', 'created_at', 'decided_at'].map(cap).join(',')},revision,last_event_sequence,${cap('last_event_hash')} FROM world_approvals WHERE session_id=? ORDER BY created_at,approval_id LIMIT ?`, [sessionId]);

  if (!verification.verified) {
    nodes.rows = nodes.rows.map(diagnosticRow);
    edges.rows = edges.rows.map(diagnosticRow);
    passages.rows = passages.rows.map(diagnosticRow);
    objectStates.rows = objectStates.rows.map(diagnosticRow);
    approvalRows.rows = approvalRows.rows.map(diagnosticRow);
  } else {
    passages.rows = passages.rows.map(boundedVerifiedRow);
    objectStates.rows = objectStates.rows.map(boundedVerifiedRow);
  }

  const approvals = approvalRows.rows.map(row => {
    if (!verification.verified) return row;
    const boundedString = value => typeof value === 'string' && value.length > CELL_CHARACTER_LIMIT ? diagnosticText(value) : value;
    const parsedField = value => {
      if (value === null) return null;
      if (value.length > CELL_CHARACTER_LIMIT) return { bounded: true, truncated: true, charactersAtLeast: value.length, prefix: value.slice(0, CELL_CHARACTER_LIMIT) };
      return JSON.parse(value);
    };
    try {
      return {
        approvalId: boundedString(row.approval_id),
        sessionId: boundedString(row.session_id),
        wakeId: boundedString(row.wake_id),
        kind: boundedString(row.kind),
        status: boundedString(row.status),
        payload: parsedField(row.payload_json),
        preview: parsedField(row.preview_json),
        application: parsedField(row.application_json),
        outcome: parsedField(row.outcome_json),
        createdAt: boundedString(row.created_at),
        decidedAt: boundedString(row.decided_at),
        revision: row.revision,
        worldEventSequence: row.last_event_sequence,
        worldEventHash: boundedString(row.last_event_hash),
      };
    } catch {
      return { approvalId: row.approval_id ?? null, status: row.status ?? null, malformed: true };
    }
  });

  const builder = {
    graph: { nodes: nodes.rows, edges: edges.rows, passages: passages.rows, objectStates: objectStates.rows },
    verification,
    ceiling: ceilingCatalog(),
    residentPresentation: presentationCatalog(),
    installations: [workshopInstallationWitness(), spotlightInstallationWitness()],
    installationReceipts: installedRoomReceipts(world),
    approvals,
    collectionBounds: {
      limit: COLLECTION_LIMIT,
      diagnosticCellCharacterLimit: CELL_CHARACTER_LIMIT,
      approvalFieldCharacterLimit: CELL_CHARACTER_LIMIT,
      nodes: collectionBounds(nodes),
      edges: collectionBounds(edges),
      passages: collectionBounds(passages),
      objectStates: collectionBounds(objectStates),
      approvals: collectionBounds(approvalRows),
    },
  };
  if (!verification.verified) return { ...builder, location: null, projection: null, tools: [] };
  try {
    return { ...builder, location: world.current(sessionId), projection: world.projection(sessionId), tools: schemasForSession(world, sessionId) };
  } catch (error) {
    return { ...builder, location: null, projection: null, tools: [], builderReadError: { code: error?.code || 'world_builder_read_failed', message: error?.message || 'World builder projection is unavailable.' } };
  }
}
