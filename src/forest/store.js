import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { byteLength, id, sha256 } from '../core/hash.js';
import { identityScrubV1, metadataForEvent, normalizeAdmissionEvent, verifyAdmissionScrub } from './admission.js';

export const APPEND_ONLY_TABLES = ['forest_metadata', 'scrub_receipts', 'forest_entries', 'forest_edges', 'presentation_links', 'emission_links'];
export const WILD_TABLES = ['wild_entries'];

const SCHEMA = `
CREATE TABLE IF NOT EXISTS forest_metadata (
  metadata_id INTEGER PRIMARY KEY CHECK(metadata_id=1),
  schema_name TEXT NOT NULL CHECK(schema_name='forest'),
  schema_version INTEGER NOT NULL CHECK(schema_version=1),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS scrub_receipts (
  receipt_id TEXT PRIMARY KEY CHECK(length(receipt_id)>0),
  policy_name TEXT NOT NULL CHECK(policy_name='utterance_identity'),
  policy_version TEXT NOT NULL CHECK(policy_version='v1'),
  source_event_id TEXT NOT NULL UNIQUE CHECK(length(source_event_id)>0),
  input_hash TEXT NOT NULL CHECK(length(input_hash)=64),
  input_byte_length INTEGER NOT NULL CHECK(input_byte_length>=0),
  output_hash TEXT NOT NULL CHECK(length(output_hash)=64),
  output_byte_length INTEGER NOT NULL CHECK(output_byte_length>=0),
  operations_json TEXT NOT NULL CHECK(operations_json='[]'),
  changed INTEGER NOT NULL CHECK(changed=0),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS forest_entries (
  entry_id TEXT PRIMARY KEY CHECK(length(entry_id)>0),
  source_event_id TEXT NOT NULL UNIQUE CHECK(length(source_event_id)>0),
  source_event_hash TEXT NOT NULL CHECK(length(source_event_hash)=64),
  source_timestamp TEXT NOT NULL,
  thread_id TEXT NOT NULL CHECK(length(thread_id)>0),
  wake_id TEXT,
  actor_kind TEXT NOT NULL CHECK(actor_kind IN ('user','resident')),
  signature TEXT NOT NULL CHECK(signature IN ('actor:user','actor:resident')),
  source_authority TEXT NOT NULL,
  jurisdiction TEXT NOT NULL CHECK(jurisdiction='home'),
  bucket TEXT NOT NULL CHECK(bucket='utterance'),
  body TEXT NOT NULL CHECK(length(body)>0),
  body_hash TEXT NOT NULL CHECK(length(body_hash)=64),
  scrub_policy TEXT NOT NULL CHECK(scrub_policy='utterance_identity'),
  scrub_version TEXT NOT NULL CHECK(scrub_version='v1'),
  scrub_receipt_id TEXT NOT NULL REFERENCES scrub_receipts(receipt_id),
  ingested_at TEXT NOT NULL,
  spine_status TEXT NOT NULL CHECK(spine_status IN ('live','pre_spine')),
  metadata_json TEXT NOT NULL CHECK(length(metadata_json)>0)
);
CREATE TABLE IF NOT EXISTS forest_edges (
  edge_id TEXT PRIMARY KEY CHECK(length(edge_id)>0),
  edge_type TEXT NOT NULL CHECK(edge_type='responds_to'),
  from_entry_id TEXT NOT NULL REFERENCES forest_entries(entry_id),
  to_entry_id TEXT NOT NULL REFERENCES forest_entries(entry_id),
  created_at TEXT NOT NULL,
  UNIQUE(edge_type, from_entry_id)
);
CREATE TABLE IF NOT EXISTS presentation_links (
  link_id TEXT PRIMARY KEY CHECK(length(link_id)>0),
  entry_id TEXT NOT NULL REFERENCES forest_entries(entry_id),
  request_record_id TEXT NOT NULL CHECK(length(request_record_id)>0),
  message_ordinal INTEGER NOT NULL CHECK(message_ordinal>0),
  provider_role TEXT NOT NULL CHECK(provider_role IN ('user','assistant')),
  content_hash TEXT NOT NULL CHECK(length(content_hash)=64),
  created_at TEXT NOT NULL,
  UNIQUE(entry_id, request_record_id)
);
CREATE TABLE IF NOT EXISTS emission_links (
  link_id TEXT PRIMARY KEY CHECK(length(link_id)>0),
  entry_id TEXT NOT NULL REFERENCES forest_entries(entry_id),
  request_record_id TEXT NOT NULL CHECK(length(request_record_id)>0),
  created_at TEXT NOT NULL,
  UNIQUE(entry_id)
);
CREATE INDEX IF NOT EXISTS forest_entries_thread_order ON forest_entries(thread_id, source_timestamp, source_event_id);
${APPEND_ONLY_TABLES.map(table => `
CREATE TRIGGER IF NOT EXISTS ${table}_append_only_update BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TRIGGER IF NOT EXISTS ${table}_append_only_delete BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT, 'append-only table'); END;`).join('\n')}`;

const WILD_SCHEMA = `
CREATE TABLE IF NOT EXISTS wild_metadata (
  metadata_id INTEGER PRIMARY KEY CHECK(metadata_id=1),
  schema_name TEXT NOT NULL CHECK(schema_name='forest_wild'),
  schema_version INTEGER NOT NULL CHECK(schema_version=1),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS wild_entries (
  entry_id TEXT PRIMARY KEY CHECK(length(entry_id)>0),
  jurisdiction TEXT NOT NULL CHECK(jurisdiction='wild'),
  bucket TEXT NOT NULL CHECK(bucket='workshop_source'),
  source_kind TEXT NOT NULL CHECK(source_kind IN ('workshop_read','workshop_search')),
  repository_path TEXT NOT NULL,
  start_line INTEGER NOT NULL CHECK(start_line>0),
  end_line INTEGER NOT NULL CHECK(end_line>=start_line),
  body TEXT NOT NULL,
  body_hash TEXT NOT NULL CHECK(length(body_hash)=64),
  action_receipt_id TEXT NOT NULL,
  spine_record_id TEXT,
  request_record_id TEXT,
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS wild_entries_source_order ON wild_entries(repository_path,start_line,entry_id);
CREATE TRIGGER IF NOT EXISTS wild_metadata_append_only_update BEFORE UPDATE ON wild_metadata BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TRIGGER IF NOT EXISTS wild_metadata_append_only_delete BEFORE DELETE ON wild_metadata BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TRIGGER IF NOT EXISTS wild_entries_append_only_update BEFORE UPDATE ON wild_entries BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TRIGGER IF NOT EXISTS wild_entries_append_only_delete BEFORE DELETE ON wild_entries BEGIN SELECT RAISE(ABORT, 'append-only table'); END;`;

function custodyConflict(message) { return Object.assign(new Error(message), { code: 'forest_custody_conflict' }); }
function predecessorConflict(message) { return Object.assign(new Error(message), { code: 'forest_predecessor_conflict' }); }
function now() { return new Date().toISOString(); }
function ensureWildMetadata(sqlite) { sqlite.prepare("INSERT OR IGNORE INTO wild_metadata(metadata_id, schema_name, schema_version, created_at) VALUES(1, 'forest_wild', 1, ?)").run(now()); }

function eventMatches(row, event, sourceHash, bodyHash) {
  return row.source_event_hash === sourceHash && row.body_hash === bodyHash && row.source_timestamp === event.createdAt && row.actor_kind === event.actorKind && row.signature === `actor:${event.actorKind}` && row.thread_id === event.threadId && (row.wake_id || null) === (event.wakeId || null) && row.source_authority === event.authority && row.scrub_policy === 'utterance_identity' && row.scrub_version === 'v1' && row.metadata_json === metadataForEvent(event);
}

function expectedPredecessor(store, event, predecessorSourceEventId) {
  if (predecessorSourceEventId === undefined) throw predecessorConflict('Expected predecessor source event ID is required.');
  const previous = store.sqlite.prepare(`SELECT entry_id, source_event_id AS sourceEventId, thread_id AS threadId
    FROM forest_entries WHERE thread_id=? AND (source_timestamp < ? OR (source_timestamp=? AND source_event_id < ?))
    ORDER BY source_timestamp DESC, source_event_id DESC LIMIT 1`).get(event.threadId, event.createdAt, event.createdAt, event.id);
  if ((previous?.sourceEventId || null) !== (predecessorSourceEventId || null)) throw predecessorConflict(`Expected immediate predecessor ${predecessorSourceEventId || 'root'} does not match Forest custody.`);
  return previous || null;
}

function verifyExistingEdge(store, entryId, predecessorSourceEventId) {
  const edge = store.sqlite.prepare(`SELECT to_entry_id AS toEntryId FROM forest_edges
    WHERE edge_type='responds_to' AND from_entry_id=?`).get(entryId);
  const predecessor = predecessorSourceEventId ? store.sqlite.prepare('SELECT entry_id FROM forest_entries WHERE source_event_id=?').get(predecessorSourceEventId) : null;
  if ((edge?.toEntryId || null) !== (predecessor?.entry_id || null)) throw predecessorConflict('Existing Forest entry has a conflicting immediate predecessor edge.');
}

export class ForestStore {
  constructor(path, options = {}) {
    this.path = path;
    const mode = options.mode || (options.create === false ? 'readOnly' : options.create === true ? 'createNew' : 'createNew');
    if (!['createNew', 'requireExisting', 'readOnly'].includes(mode)) throw new Error('Forest open mode must be createNew, requireExisting, or readOnly.');
    if (mode === 'createNew') {
      if (existsSync(path)) throw new Error('Forest createNew refuses an existing database.');
      mkdirSync(dirname(path), { recursive: true });
      this.sqlite = new DatabaseSync(path);
      this.sqlite.exec('PRAGMA foreign_keys = ON;');
      this.sqlite.exec(SCHEMA);
      this.sqlite.exec(WILD_SCHEMA);
      ensureWildMetadata(this.sqlite);
      this.sqlite.prepare('INSERT INTO forest_metadata(metadata_id, schema_name, schema_version, created_at) VALUES(1,?,?,?)').run('forest', 1, now());
    } else if (mode === 'requireExisting') {
      if (!existsSync(path)) throw new Error('Forest requireExisting refuses a missing database.');
      this.sqlite = new DatabaseSync(path);
      this.sqlite.exec('PRAGMA foreign_keys = ON;');
      this.sqlite.exec(WILD_SCHEMA);
      ensureWildMetadata(this.sqlite);
      this.verifySchema();
    } else {
      if (!existsSync(path)) throw new Error('Forest readOnly refuses a missing database.');
      this.sqlite = new DatabaseSync(path, { readOnly: true });
      this.verifySchema();
    }
  }

  transaction(fn) {
    this.sqlite.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.sqlite.exec('COMMIT'); return result; }
    catch (error) { try { this.sqlite.exec('ROLLBACK'); } catch {} throw error; }
  }

  ingestEvent(rawEvent, { scrub = identityScrubV1, spineStatus = 'live', predecessorSourceEventId } = {}) {
    const event = normalizeAdmissionEvent(rawEvent);
    const scrubbed = scrub(event.content);
    const { inputHash, outputHash } = verifyAdmissionScrub(event, scrubbed);
    const predecessor = expectedPredecessor(this, event, predecessorSourceEventId);
    const existing = this.sqlite.prepare('SELECT * FROM forest_entries WHERE source_event_id=?').get(event.id);
    if (existing) {
      if (!eventMatches(existing, event, inputHash, outputHash)) throw custodyConflict(`Source event ${event.id} has conflicting Forest custody.`);
      verifyExistingEdge(this, existing.entry_id, predecessorSourceEventId);
      return { ...existing, entryId: existing.entry_id, existing: true };
    }
    const receiptId = id('scrub');
    const entryId = id('forest');
    const timestamp = now();
    const metadataJson = metadataForEvent(event);
    const sourceStatus = spineStatus === 'pre_spine' ? 'pre_spine' : 'live';
    return this.transaction(() => {
      this.sqlite.prepare(`INSERT INTO scrub_receipts
        (receipt_id, policy_name, policy_version, source_event_id, input_hash, input_byte_length, output_hash, output_byte_length, operations_json, changed, created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(receiptId, scrubbed.policyName, scrubbed.policyVersion, event.id, inputHash, byteLength(event.content), outputHash, byteLength(scrubbed.body), JSON.stringify(scrubbed.operations), 0, timestamp);
      this.sqlite.prepare(`INSERT INTO forest_entries
        (entry_id, source_event_id, source_event_hash, source_timestamp, thread_id, wake_id, actor_kind, signature, source_authority, jurisdiction, bucket, body, body_hash, scrub_policy, scrub_version, scrub_receipt_id, ingested_at, spine_status, metadata_json)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(entryId, event.id, inputHash, event.createdAt, event.threadId, event.wakeId || null, event.actorKind, `actor:${event.actorKind}`, event.authority, 'home', 'utterance', scrubbed.body, outputHash, scrubbed.policyName, scrubbed.policyVersion, receiptId, timestamp, sourceStatus, metadataJson);
      if (predecessor) this.sqlite.prepare(`INSERT INTO forest_edges(edge_id, edge_type, from_entry_id, to_entry_id, created_at) VALUES(?,?,?,?,?)`).run(id('edge'), 'responds_to', entryId, predecessor.entry_id, timestamp);
      return { entryId, sourceEventId: event.id, existing: false };
    });
  }

  ingestUtterance(event, options) { return this.ingestEvent(event, options); }

  linkPresentation({ entryId, requestRecordId, messageOrdinal, providerRole, contentHash }) {
    return this.linkPresentations([{ entryId, requestRecordId, messageOrdinal, providerRole, contentHash }])[0];
  }

  linkPresentations(links) {
    const checked = links.map(link => {
      const entry = this.sqlite.prepare('SELECT entry_id, body_hash FROM forest_entries WHERE entry_id=?').get(link.entryId);
      if (!entry) throw new Error('Presentation link references an unknown Forest entry.');
      if (entry.body_hash !== link.contentHash) throw custodyConflict('Presentation content hash conflicts with the Forest entry.');
      const existing = this.sqlite.prepare('SELECT * FROM presentation_links WHERE entry_id=? AND request_record_id=?').get(link.entryId, link.requestRecordId);
      if (existing && (existing.message_ordinal !== link.messageOrdinal || existing.provider_role !== link.providerRole || existing.content_hash !== link.contentHash)) throw custodyConflict('Presentation link identity conflicts.');
      return { ...link, existing };
    });
    return this.transaction(() => checked.map(link => {
      if (link.existing) return { ...link.existing, existing: true };
      const linkId = id('presentation');
      this.sqlite.prepare(`INSERT INTO presentation_links(link_id, entry_id, request_record_id, message_ordinal, provider_role, content_hash, created_at) VALUES(?,?,?,?,?,?,?)`).run(linkId, link.entryId, link.requestRecordId, link.messageOrdinal, link.providerRole, link.contentHash, now());
      return { linkId, existing: false };
    }));
  }

  linkEmission({ entryId, requestRecordId }) {
    if (!this.sqlite.prepare('SELECT entry_id FROM forest_entries WHERE entry_id=?').get(entryId)) throw new Error('Emission link references an unknown Forest entry.');
    const existing = this.sqlite.prepare('SELECT * FROM emission_links WHERE entry_id=?').get(entryId);
    if (existing) {
      if (existing.request_record_id !== requestRecordId) throw custodyConflict('Emission link identity conflicts.');
      return { ...existing, existing: true };
    }
    return this.transaction(() => {
      const linkId = id('emission');
      this.sqlite.prepare('INSERT INTO emission_links(link_id, entry_id, request_record_id, created_at) VALUES(?,?,?,?)').run(linkId, entryId, requestRecordId, now());
      return { linkId, existing: false };
    });
  }

  ingestWorkshopSource({ source, sourceKind, actionReceiptId, spineRecordId = null, requestRecordId = null }) {
    if (!source || !['workshop_read', 'workshop_search'].includes(sourceKind) || typeof actionReceiptId !== 'string') throw new Error('Workshop Wild admission requires exact source custody.');
    const rows = sourceKind === 'workshop_read' ? [source] : (source.matches || []).map(match => ({ path: match.path, startLine: match.line, endLine: match.line, text: match.text, hash: match.hash, byteLength: Buffer.byteLength(match.text, 'utf8') }));
    if (!rows.length) return [];
    return this.transaction(() => rows.map(item => {
      if (!item.path || !Number.isInteger(item.startLine) || !Number.isInteger(item.endLine) || typeof item.text !== 'string' || item.hash !== sha256(item.text)) throw new Error('Workshop Wild source is not an exact span.');
      const entryId = id('wild');
      this.sqlite.prepare(`INSERT INTO wild_entries(entry_id,jurisdiction,bucket,source_kind,repository_path,start_line,end_line,body,body_hash,action_receipt_id,spine_record_id,request_record_id,metadata_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(entryId,'wild','workshop_source',sourceKind,item.path,item.startLine,item.endLine,item.text,item.hash,actionReceiptId,spineRecordId,requestRecordId,JSON.stringify({ exact: true, sourceHash: item.hash, byteLength: item.byteLength }),now());
      return { entryId, path: item.path, startLine: item.startLine, endLine: item.endLine, bodyHash: item.hash };
    }));
  }

  listWildEntries() { return this.sqlite.prepare('SELECT * FROM wild_entries ORDER BY created_at,entry_id').all(); }

  listEntries() { return this.sqlite.prepare('SELECT * FROM forest_entries ORDER BY thread_id, source_timestamp, source_event_id').all(); }
  count() { return this.sqlite.prepare('SELECT COUNT(*) AS count FROM forest_entries').get().count; }
  verifySchema() {
    const tables = APPEND_ONLY_TABLES;
    for (const table of tables) if (!this.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table)) throw new Error(`Forest schema is missing ${table}.`);
    for (const table of tables) for (const action of ['update', 'delete']) if (!this.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name=?").get(`${table}_append_only_${action}`)) throw new Error(`Forest append-only trigger is missing for ${table}.`);
    const metadata = this.sqlite.prepare('SELECT schema_name, schema_version FROM forest_metadata WHERE metadata_id=1').get();
    if (!metadata || metadata.schema_name !== 'forest' || metadata.schema_version !== 1) throw new Error('Forest schema version is not v1.');
    const wildTable = this.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='wild_entries'").get();
    if (wildTable) {
      const wildMetadata = this.sqlite.prepare('SELECT schema_name, schema_version FROM wild_metadata WHERE metadata_id=1').get();
      if (!wildMetadata || wildMetadata.schema_name !== 'forest_wild' || wildMetadata.schema_version !== 1) throw new Error('Forest Wild schema version is not forest_wild v1.');
    }
    return true;
  }
  close() { this.sqlite.close(); }
}

export function forestSchemaSql() { return SCHEMA; }
