export const LEDGER_SCHEMA = `
CREATE TABLE IF NOT EXISTS threads (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  label TEXT
);
CREATE TABLE IF NOT EXISTS wakes (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES threads(id),
  status TEXT NOT NULL CHECK(status IN ('assembling','calling_provider','committed','failed')),
  provider TEXT NOT NULL,
  requested_model TEXT NOT NULL,
  resolved_model TEXT,
  provider_response_id TEXT,
  finish_reason TEXT,
  system_fingerprint TEXT,
  usage_json TEXT,
  failure_code TEXT,
  failure_message TEXT,
  custody_failure_code TEXT,
  custody_failure_message TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES threads(id),
  wake_id TEXT REFERENCES wakes(id),
  actor_kind TEXT NOT NULL CHECK(actor_kind IN ('user','resident','host')),
  event_kind TEXT NOT NULL CHECK(event_kind IN ('utterance','failure','state')),
  content TEXT NOT NULL,
  authority TEXT NOT NULL CHECK(authority IN ('ground','model_signed','host_receipt')),
  provider TEXT,
  model TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS wake_context_items (
  id TEXT PRIMARY KEY,
  wake_id TEXT NOT NULL REFERENCES wakes(id),
  ordinal INTEGER NOT NULL,
  item_kind TEXT NOT NULL CHECK(item_kind IN ('charter','clinical_anchor','environment_manifest','resident_blessing','utterance','disclosure')),
  actor_role TEXT NOT NULL,
  content TEXT NOT NULL,
  source_event_id TEXT,
  source_event_hash TEXT,
  blessing_text TEXT,
  blessing_hash TEXT,
  source_description TEXT NOT NULL,
  authority TEXT NOT NULL,
  trust TEXT,
  continuity TEXT,
  version INTEGER,
  included INTEGER NOT NULL CHECK(included IN (0,1)),
  omission_reason TEXT,
  content_hash TEXT NOT NULL,
  UNIQUE(wake_id, ordinal)
);
CREATE INDEX IF NOT EXISTS events_thread_created ON events(thread_id, created_at);
CREATE INDEX IF NOT EXISTS context_wake_ordinal ON wake_context_items(wake_id, ordinal);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES threads(id),
  kind TEXT NOT NULL CHECK(kind IN ('ancestry','lifespan')),
  label TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('open','closed')),
  opened_at TEXT NOT NULL,
  closed_at TEXT,
  close_reason TEXT,
  predecessor_session_id TEXT REFERENCES sessions(id),
  wake_status TEXT NOT NULL DEFAULT 'pending' CHECK(wake_status IN ('pending','orienting','complete','failed'))
);
CREATE INDEX IF NOT EXISTS sessions_thread_opened ON sessions(thread_id, opened_at, id);
CREATE TABLE IF NOT EXISTS session_history (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  wake_id TEXT NOT NULL REFERENCES wakes(id),
  ordinal INTEGER NOT NULL,
  message_json TEXT NOT NULL,
  role TEXT NOT NULL,
  message_kind TEXT NOT NULL CHECK(message_kind IN ('user','assistant_tool_call','tool_result','resident')),
  source_event_id TEXT,
  content_hash TEXT NOT NULL,
  scrub_receipt_id TEXT,
  raw_return_record_id TEXT,
  source_record_hash TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(session_id, ordinal)
);
CREATE INDEX IF NOT EXISTS session_history_order ON session_history(session_id, ordinal);
CREATE TABLE IF NOT EXISTS trace_epochs (
  id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL CHECK(schema_version=1),
  boundary_kind TEXT NOT NULL UNIQUE CHECK(boundary_kind='scroll_trace_boundary/v1'),
  pre_boundary_head_json TEXT NOT NULL,
  pre_boundary_head_hash TEXT NOT NULL,
  law_json TEXT NOT NULL,
  law_hash TEXT NOT NULL,
  established_at TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS trace_epochs_append_only_update BEFORE UPDATE ON trace_epochs BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TRIGGER IF NOT EXISTS trace_epochs_append_only_delete BEFORE DELETE ON trace_epochs BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TABLE IF NOT EXISTS scroll_trace_manifests (
  id TEXT PRIMARY KEY,
  epoch_id TEXT NOT NULL REFERENCES trace_epochs(id),
  history_id TEXT NOT NULL UNIQUE REFERENCES session_history(id),
  schema_version INTEGER NOT NULL CHECK(schema_version=1),
  manifest_json TEXT NOT NULL,
  manifest_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS scroll_trace_manifests_epoch ON scroll_trace_manifests(epoch_id, created_at, id);
CREATE TRIGGER IF NOT EXISTS scroll_trace_manifests_append_only_update BEFORE UPDATE ON scroll_trace_manifests BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TRIGGER IF NOT EXISTS scroll_trace_manifests_append_only_delete BEFORE DELETE ON scroll_trace_manifests BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TABLE IF NOT EXISTS provider_requests (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  wake_id TEXT NOT NULL REFERENCES wakes(id),
  phase TEXT NOT NULL CHECK(phase IN ('orientation','response','ordinary')),
  ordinal INTEGER NOT NULL,
  request_body TEXT NOT NULL,
  message_sources_json TEXT NOT NULL,
  attention_json TEXT,
  spine_record_id TEXT,
  raw_return_record_id TEXT,
  raw_return_byte_length INTEGER,
  raw_return_sha256 TEXT,
  return_scrub_receipt_id TEXT,
  return_scrub_receipt_json TEXT,
  response_message_json TEXT,
  response_id TEXT,
  finish_reason TEXT,
  outcome_json TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE(wake_id, ordinal)
);
CREATE INDEX IF NOT EXISTS provider_requests_wake_order ON provider_requests(wake_id, ordinal);
CREATE TABLE IF NOT EXISTS glass_cast_receipts (
  id TEXT PRIMARY KEY,
  provider_request_id TEXT NOT NULL UNIQUE REFERENCES provider_requests(id),
  session_id TEXT NOT NULL REFERENCES sessions(id),
  wake_id TEXT NOT NULL REFERENCES wakes(id),
  phase TEXT NOT NULL CHECK(phase IN ('orientation','response','ordinary')),
  schema_version INTEGER NOT NULL CHECK(schema_version=1),
  receipt_json TEXT NOT NULL,
  receipt_hash TEXT NOT NULL,
  cast_hash TEXT NOT NULL,
  presentation_scrub_hash TEXT NOT NULL,
  presented_messages_utf8_bytes INTEGER NOT NULL,
  presented_messages_sha256 TEXT NOT NULL,
  request_body_utf8_bytes INTEGER NOT NULL,
  request_body_sha256 TEXT NOT NULL,
  spine_record_id TEXT NOT NULL,
  spine_record_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS glass_cast_receipts_wake_order ON glass_cast_receipts(wake_id, created_at, id);
CREATE TRIGGER IF NOT EXISTS glass_cast_receipts_append_only_update BEFORE UPDATE ON glass_cast_receipts BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TRIGGER IF NOT EXISTS glass_cast_receipts_append_only_delete BEFORE DELETE ON glass_cast_receipts BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TABLE IF NOT EXISTS glass_trace_epochs (
  id TEXT PRIMARY KEY, schema_version INTEGER NOT NULL CHECK(schema_version=1),
  boundary_kind TEXT NOT NULL UNIQUE CHECK(boundary_kind='glass_trace_boundary/v1'),
  pre_boundary_head_json TEXT NOT NULL, pre_boundary_head_hash TEXT NOT NULL,
  law_json TEXT NOT NULL, law_hash TEXT NOT NULL, established_at TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS glass_trace_epochs_append_only_update BEFORE UPDATE ON glass_trace_epochs BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TRIGGER IF NOT EXISTS glass_trace_epochs_append_only_delete BEFORE DELETE ON glass_trace_epochs BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TABLE IF NOT EXISTS glass_ground_receipts (
  id TEXT PRIMARY KEY, epoch_id TEXT NOT NULL REFERENCES glass_trace_epochs(id),
  provider_request_id TEXT NOT NULL REFERENCES provider_requests(id), kind TEXT NOT NULL,
  schema_version INTEGER NOT NULL CHECK(schema_version=1), receipt_json TEXT NOT NULL,
  receipt_hash TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(provider_request_id,kind)
);
CREATE TRIGGER IF NOT EXISTS glass_ground_receipts_append_only_update BEFORE UPDATE ON glass_ground_receipts BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TRIGGER IF NOT EXISTS glass_ground_receipts_append_only_delete BEFORE DELETE ON glass_ground_receipts BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TABLE IF NOT EXISTS glass_trace_manifests (
  id TEXT PRIMARY KEY, epoch_id TEXT NOT NULL REFERENCES glass_trace_epochs(id),
  glass_cast_receipt_id TEXT NOT NULL UNIQUE REFERENCES glass_cast_receipts(id),
  provider_request_id TEXT NOT NULL UNIQUE REFERENCES provider_requests(id),
  schema_version INTEGER NOT NULL CHECK(schema_version=1), manifest_json TEXT NOT NULL,
  manifest_hash TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS glass_trace_manifests_append_only_update BEFORE UPDATE ON glass_trace_manifests BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TRIGGER IF NOT EXISTS glass_trace_manifests_append_only_delete BEFORE DELETE ON glass_trace_manifests BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TABLE IF NOT EXISTS attention_receipts (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  wake_id TEXT NOT NULL REFERENCES wakes(id),
  phase TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('ok','warn','refuse')),
  receipt_json TEXT NOT NULL,
  receipt_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS attention_receipts_wake_order ON attention_receipts(wake_id, created_at, id);
CREATE TRIGGER IF NOT EXISTS attention_receipts_append_only_update BEFORE UPDATE ON attention_receipts BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TRIGGER IF NOT EXISTS attention_receipts_append_only_delete BEFORE DELETE ON attention_receipts BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TABLE IF NOT EXISTS return_scrub_receipts (
  id TEXT PRIMARY KEY,
  provider_request_id TEXT NOT NULL UNIQUE REFERENCES provider_requests(id),
  spine_record_id TEXT NOT NULL,
  receipt_json TEXT NOT NULL,
  message_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS hearth_receipts (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  wake_id TEXT NOT NULL REFERENCES wakes(id),
  tool_call_id TEXT NOT NULL,
  return_json TEXT NOT NULL,
  return_hash TEXT NOT NULL,
  scroll_markdown TEXT,
  scroll_hash TEXT,
  action_event_id TEXT NOT NULL REFERENCES events(id),
  return_event_id TEXT NOT NULL REFERENCES events(id),
  created_at TEXT NOT NULL,
  UNIQUE(wake_id)
);
CREATE TABLE IF NOT EXISTS host_return_scrub_receipts (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  wake_id TEXT NOT NULL REFERENCES wakes(id),
  tool_name TEXT NOT NULL,
  receipt_json TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`;

