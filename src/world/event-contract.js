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
  'topology.spotlight_door_installed/v1': { schemaVersion: 1, stretch: 'SP2' },
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
