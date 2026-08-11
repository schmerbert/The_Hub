export const RESULT_RACK_SCHEMA = `
CREATE TABLE IF NOT EXISTS result_jobs (
  job_id TEXT PRIMARY KEY,
  session_id TEXT,
  wake_id TEXT,
  tool_name TEXT NOT NULL,
  job_kind TEXT NOT NULL,
  status TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  metadata_sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS result_output_chunks (
  chunk_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES result_jobs(job_id),
  ordinal INTEGER NOT NULL,
  stream TEXT NOT NULL CHECK(stream IN ('stdout','stderr','output')),
  byte_start INTEGER NOT NULL CHECK(byte_start>=0),
  byte_end INTEGER NOT NULL CHECK(byte_end>=byte_start),
  byte_length INTEGER NOT NULL CHECK(byte_length>=0),
  body BLOB NOT NULL,
  body_sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(job_id, ordinal)
);
CREATE TABLE IF NOT EXISTS result_job_status_events (
  event_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES result_jobs(job_id),
  ordinal INTEGER NOT NULL,
  status TEXT NOT NULL,
  detail_json TEXT NOT NULL,
  detail_sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(job_id, ordinal)
);
CREATE TABLE IF NOT EXISTS result_artifacts (
  artifact_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES result_jobs(job_id),
  name TEXT NOT NULL,
  media_type TEXT NOT NULL,
  byte_length INTEGER NOT NULL CHECK(byte_length>=0),
  body BLOB NOT NULL,
  body_sha256 TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(job_id, name)
);
CREATE TABLE IF NOT EXISTS result_projections (
  projection_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES result_jobs(job_id),
  fitter_version TEXT NOT NULL,
  policy TEXT NOT NULL,
  source_kind TEXT NOT NULL CHECK(source_kind IN ('output','artifact')),
  source_id TEXT,
  source_sha256 TEXT NOT NULL,
  content_text TEXT NOT NULL,
  content_sha256 TEXT NOT NULL,
  byte_length INTEGER NOT NULL CHECK(byte_length>=0),
  line_count INTEGER NOT NULL CHECK(line_count>=0),
  max_bytes INTEGER NOT NULL CHECK(max_bytes>0),
  max_lines INTEGER NOT NULL CHECK(max_lines>0),
  truncated INTEGER NOT NULL CHECK(truncated IN (0,1)),
  omitted_bytes INTEGER NOT NULL CHECK(omitted_bytes>=0),
  omitted_lines INTEGER NOT NULL CHECK(omitted_lines>=0),
  exact_pointer TEXT NOT NULL,
  source_ranges_json TEXT NOT NULL,
  source_manifest_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS result_chunks_job_order ON result_output_chunks(job_id, ordinal);
CREATE INDEX IF NOT EXISTS result_job_status_order ON result_job_status_events(job_id, ordinal);
CREATE INDEX IF NOT EXISTS result_artifacts_job_name ON result_artifacts(job_id, name);
CREATE INDEX IF NOT EXISTS result_projections_job_policy ON result_projections(job_id, policy, created_at);
CREATE TRIGGER IF NOT EXISTS result_jobs_append_only_update BEFORE UPDATE ON result_jobs BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TRIGGER IF NOT EXISTS result_jobs_append_only_delete BEFORE DELETE ON result_jobs BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TRIGGER IF NOT EXISTS result_output_chunks_append_only_update BEFORE UPDATE ON result_output_chunks BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TRIGGER IF NOT EXISTS result_output_chunks_append_only_delete BEFORE DELETE ON result_output_chunks BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TRIGGER IF NOT EXISTS result_job_status_events_append_only_update BEFORE UPDATE ON result_job_status_events BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TRIGGER IF NOT EXISTS result_job_status_events_append_only_delete BEFORE DELETE ON result_job_status_events BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TRIGGER IF NOT EXISTS result_artifacts_append_only_update BEFORE UPDATE ON result_artifacts BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TRIGGER IF NOT EXISTS result_artifacts_append_only_delete BEFORE DELETE ON result_artifacts BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TRIGGER IF NOT EXISTS result_projections_append_only_update BEFORE UPDATE ON result_projections BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TRIGGER IF NOT EXISTS result_projections_append_only_delete BEFORE DELETE ON result_projections BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
`;
