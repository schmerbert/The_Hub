import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { byteLength, canonicalize, id, sha256 } from '../core/hash.js';
import { identityScrubV1, metadataForEvent, normalizeAdmissionEvent, verifyAdmissionScrub } from './admission.js';

export const APPEND_ONLY_TABLES = ['forest_metadata', 'scrub_receipts', 'forest_entries', 'forest_edges', 'presentation_links', 'emission_links', 'forest_intake_offers', 'forest_intake_decisions', 'forest_journal_entries', 'forest_journal_custody'];
export const WILD_TABLES = ['wild_entries'];
export const JOURNAL_MAX_CHARS = 4000;
export const JOURNAL_MAX_BYTES = 16 * 1024;

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
CREATE TABLE IF NOT EXISTS forest_intake_offers (
  offer_id TEXT PRIMARY KEY CHECK(length(offer_id)>0),
  source_kind TEXT NOT NULL CHECK(source_kind IN ('source_event','world_action_span')),
  source_id TEXT NOT NULL CHECK(length(source_id)>0),
  source_locator_json TEXT NOT NULL CHECK(length(source_locator_json)>0),
  source_hash TEXT NOT NULL CHECK(length(source_hash)=64),
  intended_jurisdiction TEXT NOT NULL CHECK(intended_jurisdiction IN ('home','wild','vault')),
  intended_bucket TEXT NOT NULL CHECK(length(intended_bucket)>0),
  predecessor_source_id TEXT,
  source_timestamp TEXT,
  scrub_policy TEXT NOT NULL CHECK(length(scrub_policy)>0),
  scrub_version TEXT NOT NULL CHECK(length(scrub_version)>0),
  offered_at TEXT NOT NULL,
  UNIQUE(source_kind,source_id,source_locator_json)
);
CREATE TABLE IF NOT EXISTS forest_intake_decisions (
  decision_id TEXT PRIMARY KEY CHECK(length(decision_id)>0),
  offer_id TEXT NOT NULL REFERENCES forest_intake_offers(offer_id),
  revision INTEGER NOT NULL CHECK(revision>0),
  state TEXT NOT NULL CHECK(state IN ('admitted','held','routed','superseded','permanently_refused')),
  reason_code TEXT,
  reason_detail TEXT,
  predecessor_source_id TEXT,
  destination_entry_id TEXT,
  decided_at TEXT NOT NULL,
  UNIQUE(offer_id,revision)
);
CREATE INDEX IF NOT EXISTS forest_entries_thread_order ON forest_entries(thread_id, source_timestamp, source_event_id);
CREATE INDEX IF NOT EXISTS forest_intake_decisions_offer_order ON forest_intake_decisions(offer_id,revision);
${APPEND_ONLY_TABLES.map(table => `
${['forest_journal_entries', 'forest_journal_custody'].includes(table) ? '' : `
CREATE TRIGGER IF NOT EXISTS ${table}_append_only_update BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TRIGGER IF NOT EXISTS ${table}_append_only_delete BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT, 'append-only table'); END;`}`).join('\n')}`;

const JOURNAL_SCHEMA = `
CREATE TABLE IF NOT EXISTS forest_journal_entries (
  entry_id TEXT PRIMARY KEY CHECK(length(entry_id)>0),
  source_event_id TEXT NOT NULL CHECK(length(source_event_id)>0),
  source_event_hash TEXT NOT NULL CHECK(length(source_event_hash)=64),
  source_timestamp TEXT NOT NULL,
  thread_id TEXT NOT NULL CHECK(length(thread_id)>0),
  session_id TEXT NOT NULL CHECK(length(session_id)>0),
  wake_id TEXT NOT NULL CHECK(length(wake_id)>0),
  tool_call_id TEXT NOT NULL CHECK(length(tool_call_id)>0),
  tool_name TEXT NOT NULL CHECK(tool_name='write_journal'),
  arguments_json TEXT NOT NULL CHECK(length(arguments_json)>0),
  actor_kind TEXT NOT NULL CHECK(actor_kind='resident'),
  signature TEXT NOT NULL CHECK(signature='actor:resident'),
  source_authority TEXT NOT NULL CHECK(source_authority='model_signed'),
  jurisdiction TEXT NOT NULL CHECK(jurisdiction='home'),
  bucket TEXT NOT NULL CHECK(bucket='journal'),
  body TEXT NOT NULL CHECK(length(body)>0),
  body_hash TEXT NOT NULL CHECK(length(body_hash)=64),
  body_byte_length INTEGER NOT NULL CHECK(body_byte_length>0),
  scrub_policy TEXT NOT NULL CHECK(scrub_policy='journal_identity'),
  scrub_version TEXT NOT NULL CHECK(scrub_version='v1'),
  action_receipt_id TEXT NOT NULL UNIQUE CHECK(length(action_receipt_id)>0),
  host_return_receipt_id TEXT NOT NULL CHECK(length(host_return_receipt_id)>0),
  request_record_id TEXT NOT NULL CHECK(length(request_record_id)>0),
  spine_record_id TEXT NOT NULL CHECK(length(spine_record_id)>0),
  metadata_json TEXT NOT NULL CHECK(length(metadata_json)>0),
  created_at TEXT NOT NULL,
  UNIQUE(source_event_id,tool_call_id)
);
CREATE TABLE IF NOT EXISTS forest_journal_custody (
  custody_id TEXT PRIMARY KEY CHECK(length(custody_id)>0),
  entry_id TEXT NOT NULL REFERENCES forest_journal_entries(entry_id),
  revision INTEGER NOT NULL CHECK(revision>0),
  action_receipt_id TEXT NOT NULL CHECK(length(action_receipt_id)>0),
  host_return_receipt_id TEXT NOT NULL CHECK(length(host_return_receipt_id)>0),
  result_rack_job_id TEXT,
  result_rack_projection_id TEXT,
  result_rack_source_hash TEXT,
  bound_at TEXT NOT NULL,
  UNIQUE(entry_id,revision)
);
CREATE INDEX IF NOT EXISTS forest_journal_entries_order ON forest_journal_entries(session_id,source_timestamp,source_event_id);
CREATE TRIGGER IF NOT EXISTS forest_journal_entries_append_only_update BEFORE UPDATE ON forest_journal_entries BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TRIGGER IF NOT EXISTS forest_journal_entries_append_only_delete BEFORE DELETE ON forest_journal_entries BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TRIGGER IF NOT EXISTS forest_journal_custody_append_only_update BEFORE UPDATE ON forest_journal_custody BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TRIGGER IF NOT EXISTS forest_journal_custody_append_only_delete BEFORE DELETE ON forest_journal_custody BEGIN SELECT RAISE(ABORT, 'append-only table'); END;`;

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
CREATE UNIQUE INDEX IF NOT EXISTS wild_entries_source_identity ON wild_entries(action_receipt_id,repository_path,start_line,end_line);
CREATE TRIGGER IF NOT EXISTS wild_metadata_append_only_update BEFORE UPDATE ON wild_metadata BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TRIGGER IF NOT EXISTS wild_metadata_append_only_delete BEFORE DELETE ON wild_metadata BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TRIGGER IF NOT EXISTS wild_entries_append_only_update BEFORE UPDATE ON wild_entries BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TRIGGER IF NOT EXISTS wild_entries_append_only_delete BEFORE DELETE ON wild_entries BEGIN SELECT RAISE(ABORT, 'append-only table'); END;`;

function custodyConflict(message) { return Object.assign(new Error(message), { code: 'forest_custody_conflict' }); }
function predecessorConflict(message) { return Object.assign(new Error(message), { code: 'forest_predecessor_conflict' }); }
function now() { return new Date().toISOString(); }
function ensureWildMetadata(sqlite) { sqlite.prepare("INSERT OR IGNORE INTO wild_metadata(metadata_id, schema_name, schema_version, created_at) VALUES(1, 'forest_wild', 1, ?)").run(now()); }
function boundedReason(error) {
  const code = typeof error?.code === 'string' && error.code ? error.code : 'forest_intake_refused';
  const detail = String(error?.message || 'Forest intake refused.').slice(0, 512);
  return { code, detail };
}

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
      this.sqlite.exec(JOURNAL_SCHEMA);
      this.sqlite.exec(WILD_SCHEMA);
      ensureWildMetadata(this.sqlite);
      this.sqlite.prepare('INSERT INTO forest_metadata(metadata_id, schema_name, schema_version, created_at) VALUES(1,?,?,?)').run('forest', 1, now());
    } else if (mode === 'requireExisting') {
      if (!existsSync(path)) throw new Error('Forest requireExisting refuses a missing database.');
      this.sqlite = new DatabaseSync(path);
      this.sqlite.exec('PRAGMA foreign_keys = ON;');
      // Journal is an additive v1 companion schema. Existing Forest ancestry
      // remains untouched; opening a writable store installs only the new
      // append-only tables and their witnesses.
      this.sqlite.exec(JOURNAL_SCHEMA);
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

  dataVersion() { return this.sqlite.prepare('PRAGMA data_version').get().data_version; }

  semanticProjectionIdentity() {
    const metadata = this.sqlite.prepare('SELECT schema_name AS schemaName,schema_version AS schemaVersion,created_at AS createdAt FROM forest_metadata WHERE metadata_id=1').get();
    if (!metadata) throw Object.assign(new Error('Forest metadata is unavailable for semantic projection.'), { code: 'forest_projection_identity_missing' });
    return metadata;
  }

  ensureIntakeOffer({ sourceKind, sourceId, sourceLocator, sourceHash, intendedJurisdiction, intendedBucket, predecessorSourceId = null, sourceTimestamp = null, scrubPolicy, scrubVersion, offeredAt = now() }) {
    const locatorJson = canonicalize(sourceLocator || {});
    const offerId = `intake_${sha256(canonicalize({ sourceKind, sourceId, sourceLocator: sourceLocator || {} }))}`;
    const existing = this.sqlite.prepare('SELECT * FROM forest_intake_offers WHERE offer_id=?').get(offerId);
    if (existing) {
      if (existing.source_kind !== sourceKind || existing.source_id !== sourceId || existing.source_locator_json !== locatorJson || existing.source_hash !== sourceHash || existing.intended_jurisdiction !== intendedJurisdiction || existing.intended_bucket !== intendedBucket || (existing.source_timestamp || null) !== (sourceTimestamp || null) || existing.scrub_policy !== scrubPolicy || existing.scrub_version !== scrubVersion) throw custodyConflict('Forest intake offer has conflicting Forest custody.');
      return { offerId, existing: true };
    }
    this.sqlite.prepare(`INSERT INTO forest_intake_offers
      (offer_id,source_kind,source_id,source_locator_json,source_hash,intended_jurisdiction,intended_bucket,predecessor_source_id,source_timestamp,scrub_policy,scrub_version,offered_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(offerId,sourceKind,sourceId,locatorJson,sourceHash,intendedJurisdiction,intendedBucket,null,sourceTimestamp,scrubPolicy,scrubVersion,offeredAt);
    return { offerId, existing: false };
  }

  intakeDecision(offerId) {
    return this.sqlite.prepare('SELECT * FROM forest_intake_decisions WHERE offer_id=? ORDER BY revision DESC LIMIT 1').get(offerId) || null;
  }

  appendIntakeDecision({ offerId, state, reasonCode = null, reasonDetail = null, predecessorSourceId = null, destinationEntryId = null, decidedAt = now() }) {
    if (!['admitted','held','routed','superseded','permanently_refused'].includes(state)) throw new Error('Forest intake decision state is invalid.');
    const current = this.intakeDecision(offerId);
    if (current?.state === 'admitted') {
      if (state === 'admitted' && current.destination_entry_id === destinationEntryId && (current.predecessor_source_id || null) === (predecessorSourceId || null)) return { ...current, existing: true };
      throw custodyConflict('An admitted Forest intake offer is terminal.');
    }
    if (current && ['routed','superseded','permanently_refused'].includes(current.state)) {
      if (current.state === state && current.destination_entry_id === destinationEntryId && (current.predecessor_source_id || null) === (predecessorSourceId || null)) return { ...current, existing: true };
      throw custodyConflict('A resolved Forest intake offer is terminal.');
    }
    const cleanDetail = reasonDetail === null ? null : String(reasonDetail).slice(0, 512);
    if (current?.state === state && current.reason_code === reasonCode && current.reason_detail === cleanDetail && (current.predecessor_source_id || null) === (predecessorSourceId || null) && (current.destination_entry_id || null) === (destinationEntryId || null)) return { ...current, existing: true };
    const revision = (current?.revision || 0) + 1;
    const decisionId = id('intake_decision');
    this.sqlite.prepare(`INSERT INTO forest_intake_decisions(decision_id,offer_id,revision,state,reason_code,reason_detail,predecessor_source_id,destination_entry_id,decided_at)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(decisionId,offerId,revision,state,reasonCode,cleanDetail,predecessorSourceId,destinationEntryId,decidedAt);
    return { decisionId, offerId, revision, state, existing: false };
  }

  holdIntake(offerId, error, predecessorSourceId = null) {
    const reason = boundedReason(error);
    return this.transaction(() => this.appendIntakeDecision({ offerId, state: 'held', reasonCode: reason.code, reasonDetail: reason.detail, predecessorSourceId }));
  }

  ingestEvent(rawEvent, { scrub = identityScrubV1, spineStatus = 'live', predecessorSourceEventId } = {}) {
    const event = normalizeAdmissionEvent(rawEvent);
    const sourceHash = sha256(event.content);
    const { offerId } = this.ensureIntakeOffer({ sourceKind: 'source_event', sourceId: event.id, sourceLocator: { threadId: event.threadId, wakeId: event.wakeId || null, actorKind: event.actorKind }, sourceHash, intendedJurisdiction: 'home', intendedBucket: 'utterance', predecessorSourceId: predecessorSourceEventId || null, sourceTimestamp: event.createdAt, scrubPolicy: 'utterance_identity', scrubVersion: 'v1' });
    try {
      const scrubbed = scrub(event.content);
      const { inputHash, outputHash } = verifyAdmissionScrub(event, scrubbed);
      const predecessor = expectedPredecessor(this, event, predecessorSourceEventId);
      const existing = this.sqlite.prepare('SELECT * FROM forest_entries WHERE source_event_id=?').get(event.id);
      if (existing) {
        if (!eventMatches(existing, event, inputHash, outputHash)) throw custodyConflict(`Source event ${event.id} has conflicting Forest custody.`);
        verifyExistingEdge(this, existing.entry_id, predecessorSourceEventId);
        this.transaction(() => this.appendIntakeDecision({ offerId, state: 'admitted', predecessorSourceId: predecessorSourceEventId || null, destinationEntryId: existing.entry_id, decidedAt: existing.ingested_at }));
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
        this.appendIntakeDecision({ offerId, state: 'admitted', predecessorSourceId: predecessorSourceEventId || null, destinationEntryId: entryId, decidedAt: timestamp });
        return { entryId, sourceEventId: event.id, offerId, existing: false };
      });
    } catch (error) {
      try { this.holdIntake(offerId, error, predecessorSourceEventId || null); } catch {}
      throw error;
    }
  }

  ingestUtterance(event, options) { return this.ingestEvent(event, options); }

  /**
   * Admit one exact Resident-authored journal body. Journal custody is kept in
   * its own additive table because the original utterance table deliberately
   * has a one-bucket CHECK constraint and its chronology must remain intact.
   * The tool-call Source event, provider request, Spine request, and host
   * return receipt are all retained as provenance; no Wild material is read.
   */
  writeJournal({ sourceEvent, toolCallId, argumentsJson, body, requestRecordId, spineRecordId, hostReturnReceiptId, toolName = 'write_journal', actionReceiptId = null }) {
    if (!sourceEvent || sourceEvent.actorKind !== 'resident' || sourceEvent.eventKind !== 'state' || sourceEvent.authority !== 'model_signed') throw Object.assign(new Error('Journal admission requires a model-signed Resident tool-call Source event.'), { code: 'forest_journal_source_invalid' });
    if (typeof toolCallId !== 'string' || !toolCallId.trim() || typeof argumentsJson !== 'string' || !argumentsJson.trim()) throw Object.assign(new Error('Journal admission requires exact tool-call identity.'), { code: 'forest_journal_provenance_invalid' });
    if (toolName !== 'write_journal' || typeof body !== 'string' || !body.trim() || body.length > JOURNAL_MAX_CHARS || byteLength(body) > JOURNAL_MAX_BYTES) throw Object.assign(new Error('Journal entry must be nonempty and bounded.'), { code: 'forest_journal_invalid_argument' });
    if (typeof requestRecordId !== 'string' || !requestRecordId.trim() || typeof spineRecordId !== 'string' || !spineRecordId.trim() || typeof hostReturnReceiptId !== 'string' || !hostReturnReceiptId.trim()) throw Object.assign(new Error('Journal admission requires request, Spine, and host-return custody.'), { code: 'forest_journal_provenance_invalid' });
    let parsedArguments;
    try { parsedArguments = JSON.parse(argumentsJson); } catch { throw Object.assign(new Error('Journal tool arguments are not valid JSON.'), { code: 'forest_journal_provenance_invalid' }); }
    if (!parsedArguments || Array.isArray(parsedArguments) || parsedArguments.entry !== body || Object.keys(parsedArguments).some(key => key !== 'entry')) throw Object.assign(new Error('Journal body does not match the exact write_journal arguments.'), { code: 'forest_journal_provenance_invalid' });
    const sourceEventHash = sourceEvent.fullHash || sha256(sourceEvent.content);
    if (sourceEventHash !== sha256(sourceEvent.content) || !sourceEvent.id || !sourceEvent.threadId || !sourceEvent.sessionId || !sourceEvent.wakeId) throw Object.assign(new Error('Journal Source event custody is incomplete.'), { code: 'forest_journal_provenance_invalid' });
    const bodyHash = sha256(body);
    const entryId = `journal_${sha256(canonicalize({ sourceEventId: sourceEvent.id, toolCallId, bodyHash }))}`;
    const receiptId = actionReceiptId || entryId;
    const metadataJson = canonicalize({ exact: true, sourceEventHash, toolCallId, toolName, bodyHash, bodyByteLength: byteLength(body), requestRecordId, spineRecordId });
    const sourceLocator = { threadId: sourceEvent.threadId, sessionId: sourceEvent.sessionId, wakeId: sourceEvent.wakeId, actorKind: sourceEvent.actorKind, toolCallId, toolName };
    const { offerId } = this.ensureIntakeOffer({ sourceKind: 'source_event', sourceId: sourceEvent.id, sourceLocator, sourceHash: sourceEventHash, intendedJurisdiction: 'home', intendedBucket: 'journal', sourceTimestamp: sourceEvent.createdAt, scrubPolicy: 'journal_identity', scrubVersion: 'v1' });
    const existing = this.sqlite.prepare('SELECT * FROM forest_journal_entries WHERE entry_id=?').get(entryId);
    if (existing) {
      if (existing.source_event_id !== sourceEvent.id || existing.source_event_hash !== sourceEventHash || existing.body !== body || existing.body_hash !== bodyHash || existing.arguments_json !== argumentsJson || existing.request_record_id !== requestRecordId || existing.spine_record_id !== spineRecordId || existing.host_return_receipt_id !== hostReturnReceiptId) throw Object.assign(new Error('Journal entry identity conflicts with existing custody.'), { code: 'forest_custody_conflict' });
      return { entryId, sourceEventId: sourceEvent.id, offerId, actionReceiptId: existing.action_receipt_id, bodyHash, body, existing: true };
    }
    const createdAt = now();
    return this.transaction(() => {
      this.sqlite.prepare(`INSERT INTO forest_journal_entries
        (entry_id,source_event_id,source_event_hash,source_timestamp,thread_id,session_id,wake_id,tool_call_id,tool_name,arguments_json,actor_kind,signature,source_authority,jurisdiction,bucket,body,body_hash,body_byte_length,scrub_policy,scrub_version,action_receipt_id,host_return_receipt_id,request_record_id,spine_record_id,metadata_json,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(entryId,sourceEvent.id,sourceEventHash,sourceEvent.createdAt,sourceEvent.threadId,sourceEvent.sessionId,sourceEvent.wakeId,toolCallId,toolName,argumentsJson,'resident','actor:resident','model_signed','home','journal',body,bodyHash,byteLength(body),'journal_identity','v1',receiptId,hostReturnReceiptId,requestRecordId,spineRecordId,metadataJson,createdAt);
      this.appendIntakeDecision({ offerId, state: 'admitted', destinationEntryId: entryId, decidedAt: createdAt });
      this.appendJournalCustody({ entryId, actionReceiptId: receiptId, hostReturnReceiptId, resultRack: null, boundAt: createdAt });
      return { entryId, sourceEventId: sourceEvent.id, offerId, actionReceiptId: receiptId, bodyHash, body, existing: false };
    });
  }

  appendJournalCustody({ entryId, actionReceiptId, hostReturnReceiptId, resultRack = null, boundAt = now() }) {
    const entry = this.sqlite.prepare('SELECT entry_id,action_receipt_id,host_return_receipt_id FROM forest_journal_entries WHERE entry_id=?').get(entryId);
    if (!entry) throw Object.assign(new Error('Journal custody references an unknown entry.'), { code: 'forest_journal_custody_invalid' });
    if (entry.action_receipt_id !== actionReceiptId || entry.host_return_receipt_id !== hostReturnReceiptId) throw Object.assign(new Error('Journal custody receipt identity conflicts.'), { code: 'forest_journal_custody_invalid' });
    const rack = resultRack ? { jobId: resultRack.jobId || null, projectionId: resultRack.projection?.projectionId || null, sourceHash: resultRack.projection?.sourceHash || null } : { jobId: null, projectionId: null, sourceHash: null };
    if ((rack.jobId && (!rack.projectionId || !rack.sourceHash)) || (!rack.jobId && (rack.projectionId || rack.sourceHash))) throw Object.assign(new Error('Journal Result Rack custody is incomplete.'), { code: 'forest_journal_custody_invalid' });
    const current = this.sqlite.prepare('SELECT * FROM forest_journal_custody WHERE entry_id=? ORDER BY revision DESC LIMIT 1').get(entryId);
    if (current && current.action_receipt_id === actionReceiptId && current.host_return_receipt_id === hostReturnReceiptId && (current.result_rack_job_id || null) === rack.jobId && (current.result_rack_projection_id || null) === rack.projectionId && (current.result_rack_source_hash || null) === rack.sourceHash) return { ...current, existing: true };
    const revision = (current?.revision || 0) + 1;
    const custodyId = id('journal_custody');
    this.sqlite.prepare(`INSERT INTO forest_journal_custody(custody_id,entry_id,revision,action_receipt_id,host_return_receipt_id,result_rack_job_id,result_rack_projection_id,result_rack_source_hash,bound_at) VALUES(?,?,?,?,?,?,?,?,?)`).run(custodyId,entryId,revision,actionReceiptId,hostReturnReceiptId,rack.jobId,rack.projectionId,rack.sourceHash,boundAt);
    return { custodyId, entryId, revision, actionReceiptId, hostReturnReceiptId, resultRack: rack, existing: false };
  }

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
    const checked = rows.map(item => {
      if (!item.path || !Number.isInteger(item.startLine) || !Number.isInteger(item.endLine) || typeof item.text !== 'string') throw new Error('Workshop Wild source lacks a stable locator.');
      const sourceHash = sha256(item.text);
      const { offerId } = this.ensureIntakeOffer({ sourceKind: 'world_action_span', sourceId: actionReceiptId, sourceLocator: { path: item.path, startLine: item.startLine, endLine: item.endLine }, sourceHash, intendedJurisdiction: 'wild', intendedBucket: 'workshop_source', sourceTimestamp: null, scrubPolicy: 'workshop_exact_source', scrubVersion: 'v1' });
      if (item.hash !== sourceHash) {
        const error = new Error('Workshop Wild source is not an exact span.');
        try { this.holdIntake(offerId, error); } catch {}
        throw error;
      }
      const existing = this.sqlite.prepare(`SELECT * FROM wild_entries
        WHERE action_receipt_id=? AND repository_path=? AND start_line=? AND end_line=?`).get(actionReceiptId,item.path,item.startLine,item.endLine);
      if (existing && (existing.source_kind !== sourceKind || existing.body !== item.text || existing.body_hash !== item.hash || existing.spine_record_id !== spineRecordId || existing.request_record_id !== requestRecordId)) {
        const error = custodyConflict('Workshop Wild source identity conflicts with existing custody.');
        try { this.holdIntake(offerId, error); } catch {}
        throw error;
      }
      return { item, existing, offerId };
    });
    return this.transaction(() => checked.map(({ item, existing, offerId }) => {
      if (existing) {
        this.appendIntakeDecision({ offerId, state: 'admitted', destinationEntryId: existing.entry_id, decidedAt: existing.created_at });
        return { entryId: existing.entry_id, offerId, path: existing.repository_path, startLine: existing.start_line, endLine: existing.end_line, bodyHash: existing.body_hash, existing: true };
      }
      const entryId = `wild_${sha256(canonicalize({ actionReceiptId, path: item.path, startLine: item.startLine, endLine: item.endLine }))}`;
      const timestamp = now();
      this.sqlite.prepare(`INSERT INTO wild_entries(entry_id,jurisdiction,bucket,source_kind,repository_path,start_line,end_line,body,body_hash,action_receipt_id,spine_record_id,request_record_id,metadata_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(entryId,'wild','workshop_source',sourceKind,item.path,item.startLine,item.endLine,item.text,item.hash,actionReceiptId,spineRecordId,requestRecordId,JSON.stringify({ exact: true, sourceHash: item.hash, byteLength: item.byteLength }),timestamp);
      this.appendIntakeDecision({ offerId, state: 'admitted', destinationEntryId: entryId, decidedAt: timestamp });
      return { entryId, offerId, path: item.path, startLine: item.startLine, endLine: item.endLine, bodyHash: item.hash, existing: false };
    }));
  }

  listWildEntries() { return this.sqlite.prepare('SELECT * FROM wild_entries ORDER BY created_at,entry_id').all(); }

  // Rebuildable semantic projections may enumerate exact Home terrain. This is
  // not a request-time candidate surface and grants no presentation authority.
  listSemanticProjectionAtoms() {
    return this.sqlite.prepare(`SELECT entry_id AS entryId,source_event_id AS sourceEventId,source_event_hash AS sourceEventHash,
      source_timestamp AS sourceTimestamp,actor_kind AS actorKind,bucket,body,body_hash AS bodyHash
      FROM forest_entries WHERE jurisdiction='home' AND bucket='utterance'
      UNION ALL
      SELECT entry_id AS entryId,source_event_id AS sourceEventId,source_event_hash AS sourceEventHash,
      source_timestamp AS sourceTimestamp,actor_kind AS actorKind,bucket,body,body_hash AS bodyHash
      FROM forest_journal_entries WHERE jurisdiction='home' AND bucket='journal'
      ORDER BY source_timestamp,sourceEventId`).all().map(entry => {
      if (sha256(entry.body) !== entry.bodyHash) throw Object.assign(new Error('Forest semantic projection source integrity failed.'), { code: 'forest_projection_integrity' });
      return entry;
    });
  }

  homeAtom(entryId) {
    const entry = this.sqlite.prepare(`SELECT entry_id AS entryId,source_event_id AS sourceEventId,source_event_hash AS sourceEventHash,
      source_timestamp AS sourceTimestamp,thread_id AS threadId,wake_id AS wakeId,actor_kind AS actorKind,bucket,body,body_hash AS bodyHash
      FROM forest_entries WHERE entry_id=? AND jurisdiction='home' AND bucket='utterance'`).get(entryId);
    const journal = entry || this.sqlite.prepare(`SELECT entry_id AS entryId,source_event_id AS sourceEventId,source_event_hash AS sourceEventHash,
      source_timestamp AS sourceTimestamp,thread_id AS threadId,wake_id AS wakeId,actor_kind AS actorKind,bucket,body,body_hash AS bodyHash
      FROM forest_journal_entries WHERE entry_id=? AND jurisdiction='home' AND bucket='journal'`).get(entryId);
    if (!journal || sha256(journal.body) !== journal.bodyHash) throw Object.assign(new Error('Exact Forest Home terrain is unavailable.'), { code: 'forest_walk_entry_unavailable' });
    return journal;
  }

  homeAtomForSourceEvent(sourceEventId) {
    const row = this.sqlite.prepare('SELECT entry_id AS entryId FROM forest_entries WHERE source_event_id=?').get(sourceEventId);
    const journal = row || this.sqlite.prepare('SELECT entry_id AS entryId FROM forest_journal_entries WHERE source_event_id=?').get(sourceEventId);
    return journal ? this.homeAtom(journal.entryId) : null;
  }

  homeAtomWithChronology(entryId) {
    const entry = this.homeAtom(entryId);
    const predecessor = this.sqlite.prepare(`SELECT prior.entry_id AS entryId FROM forest_edges edge JOIN forest_entries prior ON prior.entry_id=edge.to_entry_id
      WHERE edge.edge_type='responds_to' AND edge.from_entry_id=?`).get(entryId) || null;
    const successor = this.sqlite.prepare(`SELECT later.entry_id AS entryId FROM forest_edges edge JOIN forest_entries later ON later.entry_id=edge.from_entry_id
      WHERE edge.edge_type='responds_to' AND edge.to_entry_id=? ORDER BY later.source_timestamp,later.source_event_id LIMIT 1`).get(entryId) || null;
    return { ...entry, chronology: { predecessor, successor } };
  }

  // This is the only candidate surface semantic Forest selection may use.
  // Wild, intake, and presentation custody never crosses into this contract.
  listEligibleHomeAtoms({ excludeSourceEventIds = [], excludeEntryIds = [], includeExclusions = false, maxEntries = 512 } = {}) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > 2048) throw Object.assign(new Error('Forest Home candidate bound is invalid.'), { code: 'forest_candidate_bound_invalid' });
    const excludedSources = new Set(excludeSourceEventIds.filter(Boolean));
    const excludedEntries = new Set(excludeEntryIds.filter(Boolean));
    const entries = []; const exclusions = [];
    const totalEligibleCount = this.sqlite.prepare("SELECT (SELECT COUNT(*) FROM forest_entries WHERE jurisdiction='home' AND bucket='utterance') + (SELECT COUNT(*) FROM forest_journal_entries WHERE jurisdiction='home' AND bucket='journal') AS count").get().count;
    const rows = this.sqlite.prepare(`SELECT entry_id AS entryId, source_event_id AS sourceEventId, source_event_hash AS sourceEventHash,
      source_timestamp AS sourceTimestamp, thread_id AS threadId, wake_id AS wakeId, actor_kind AS actorKind,
      jurisdiction, bucket, body, body_hash AS bodyHash, spine_status AS spineStatus
      FROM forest_entries WHERE jurisdiction='home' AND bucket='utterance'
      UNION ALL
      SELECT entry_id AS entryId, source_event_id AS sourceEventId, source_event_hash AS sourceEventHash,
      source_timestamp AS sourceTimestamp, thread_id AS threadId, wake_id AS wakeId, actor_kind AS actorKind,
      jurisdiction, bucket, body, body_hash AS bodyHash, 'live' AS spineStatus
      FROM forest_journal_entries WHERE jurisdiction='home' AND bucket='journal'
      ORDER BY source_timestamp DESC, source_event_id DESC LIMIT ?`).all(maxEntries);
    const atomRef = row => row ? {
      entryId: row.entryId, sourceEventId: row.sourceEventId, sourceEventHash: row.sourceEventHash,
      bodyHash: row.bodyHash, sourceTimestamp: row.sourceTimestamp, actorKind: row.actorKind,
    } : null;
    for (const entry of rows) {
      if (excludedSources.has(entry.sourceEventId) || excludedEntries.has(entry.entryId)) {
        exclusions.push({ entryId: entry.entryId, sourceEventId: entry.sourceEventId, sourceEventHash: entry.sourceEventHash, bodyHash: entry.bodyHash, reason: 'active_context' });
        continue;
      }
      if (sha256(entry.body) !== entry.bodyHash) {
        exclusions.push({ entryId: entry.entryId, sourceEventId: entry.sourceEventId, sourceEventHash: entry.sourceEventHash, bodyHash: entry.bodyHash, reason: 'body_integrity' });
        continue;
      }
      if (!['live', 'pre_spine'].includes(entry.spineStatus)) {
        exclusions.push({ entryId: entry.entryId, sourceEventId: entry.sourceEventId, sourceEventHash: entry.sourceEventHash, bodyHash: entry.bodyHash, reason: 'spine_status_invalid' });
        continue;
      }
      const predecessor = entry.bucket === 'utterance' ? this.sqlite.prepare(`SELECT prior.entry_id AS entryId,prior.source_event_id AS sourceEventId,
        prior.source_event_hash AS sourceEventHash,prior.body_hash AS bodyHash,prior.source_timestamp AS sourceTimestamp,prior.actor_kind AS actorKind
        FROM forest_edges edge JOIN forest_entries prior ON prior.entry_id=edge.to_entry_id
        WHERE edge.edge_type='responds_to' AND edge.from_entry_id=?`).get(entry.entryId) : null;
      const successor = entry.bucket === 'utterance' ? this.sqlite.prepare(`SELECT later.entry_id AS entryId,later.source_event_id AS sourceEventId,
        later.source_event_hash AS sourceEventHash,later.body_hash AS bodyHash,later.source_timestamp AS sourceTimestamp,later.actor_kind AS actorKind
        FROM forest_edges edge JOIN forest_entries later ON later.entry_id=edge.from_entry_id
        WHERE edge.edge_type='responds_to' AND edge.to_entry_id=? ORDER BY later.source_timestamp,later.source_event_id LIMIT 1`).get(entry.entryId) : null;
      entries.push({ ...entry, chronology: { relation: 'responds_to', predecessor: atomRef(predecessor), successor: atomRef(successor) }, supersession: { supported: false } });
    }
    const boundary = { order: 'newest_first', maxEntries, totalEligibleCount, examinedCount: rows.length, complete: rows.length === totalEligibleCount };
    return includeExclusions ? { contractVersion: 'forest_home_candidates/v1', jurisdiction: 'home', entries, exclusions, boundary } : entries;
  }
  searchEligibleHomeAtoms({ queryTerms = [], excludeSourceEventIds = [], excludeEntryIds = [], includeExclusions = false, maxEntries = 512, perTermLimit = 96 } = {}) {
    if (!Array.isArray(queryTerms) || !queryTerms.length || queryTerms.some(term => typeof term !== 'string' || !term.trim())) throw Object.assign(new Error('Forest Home lexical query is invalid.'), { code: 'forest_candidate_query_invalid' });
    if (!Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > 2048 || !Number.isInteger(perTermLimit) || perTermLimit < 1 || perTermLimit > 256) throw Object.assign(new Error('Forest Home lexical candidate bound is invalid.'), { code: 'forest_candidate_bound_invalid' });
    const terms = [...new Set(queryTerms.map(term => term.normalize('NFKC').toLocaleLowerCase('en-US')).filter(Boolean))];
    const totalEligibleCount = this.sqlite.prepare("SELECT (SELECT COUNT(*) FROM forest_entries WHERE jurisdiction='home' AND bucket='utterance') + (SELECT COUNT(*) FROM forest_journal_entries WHERE jurisdiction='home' AND bucket='journal') AS count").get().count;
    const frequency = new Map(terms.map(term => [term, this.sqlite.prepare("SELECT (SELECT COUNT(*) FROM forest_entries WHERE jurisdiction='home' AND bucket='utterance' AND instr(lower(body),?)>0) + (SELECT COUNT(*) FROM forest_journal_entries WHERE jurisdiction='home' AND bucket='journal' AND instr(lower(body),?)>0) AS count").get(term, term).count]));
    const orderedTerms = [...terms].sort((left, right) => frequency.get(left) - frequency.get(right) || left.localeCompare(right));
    const byId = new Map();
    for (const term of orderedTerms) {
      const rows = this.sqlite.prepare(`SELECT entry_id AS entryId, source_event_id AS sourceEventId, source_event_hash AS sourceEventHash,
        source_timestamp AS sourceTimestamp, thread_id AS threadId, wake_id AS wakeId, actor_kind AS actorKind,
        jurisdiction, bucket, body, body_hash AS bodyHash, spine_status AS spineStatus
        FROM forest_entries WHERE jurisdiction='home' AND bucket='utterance' AND instr(lower(body),?)>0
        UNION ALL
        SELECT entry_id AS entryId, source_event_id AS sourceEventId, source_event_hash AS sourceEventHash,
        source_timestamp AS sourceTimestamp, thread_id AS threadId, wake_id AS wakeId, actor_kind AS actorKind,
        jurisdiction, bucket, body, body_hash AS bodyHash, 'live' AS spineStatus
        FROM forest_journal_entries WHERE jurisdiction='home' AND bucket='journal' AND instr(lower(body),?)>0
        ORDER BY source_timestamp DESC, source_event_id DESC LIMIT ?`).all(term, term, perTermLimit);
      for (const row of rows) if (!byId.has(row.entryId) && byId.size < maxEntries) byId.set(row.entryId, row);
    }
    const excludedSources = new Set(excludeSourceEventIds.filter(Boolean));
    const excludedEntries = new Set(excludeEntryIds.filter(Boolean));
    const entries = []; const exclusions = [];
    const atomRef = row => row ? {
      entryId: row.entryId, sourceEventId: row.sourceEventId, sourceEventHash: row.sourceEventHash,
      bodyHash: row.bodyHash, sourceTimestamp: row.sourceTimestamp, actorKind: row.actorKind,
    } : null;
    for (const entry of byId.values()) {
      if (excludedSources.has(entry.sourceEventId) || excludedEntries.has(entry.entryId)) {
        exclusions.push({ entryId: entry.entryId, sourceEventId: entry.sourceEventId, sourceEventHash: entry.sourceEventHash, bodyHash: entry.bodyHash, reason: 'active_context' });
        continue;
      }
      if (sha256(entry.body) !== entry.bodyHash) {
        exclusions.push({ entryId: entry.entryId, sourceEventId: entry.sourceEventId, sourceEventHash: entry.sourceEventHash, bodyHash: entry.bodyHash, reason: 'body_integrity' });
        continue;
      }
      if (!['live', 'pre_spine'].includes(entry.spineStatus)) {
        exclusions.push({ entryId: entry.entryId, sourceEventId: entry.sourceEventId, sourceEventHash: entry.sourceEventHash, bodyHash: entry.bodyHash, reason: 'spine_status_invalid' });
        continue;
      }
      const predecessor = this.sqlite.prepare(`SELECT prior.entry_id AS entryId,prior.source_event_id AS sourceEventId,
        prior.source_event_hash AS sourceEventHash,prior.body_hash AS bodyHash,prior.source_timestamp AS sourceTimestamp,prior.actor_kind AS actorKind
        FROM forest_edges edge JOIN forest_entries prior ON prior.entry_id=edge.to_entry_id
        WHERE edge.edge_type='responds_to' AND edge.from_entry_id=?`).get(entry.entryId);
      const successor = this.sqlite.prepare(`SELECT later.entry_id AS entryId,later.source_event_id AS sourceEventId,
        later.source_event_hash AS sourceEventHash,later.body_hash AS bodyHash,later.source_timestamp AS sourceTimestamp,later.actor_kind AS actorKind
        FROM forest_edges edge JOIN forest_entries later ON later.entry_id=edge.from_entry_id
        WHERE edge.edge_type='responds_to' AND edge.to_entry_id=? ORDER BY later.source_timestamp,later.source_event_id LIMIT 1`).get(entry.entryId);
      entries.push({ ...entry, chronology: { relation: 'responds_to', predecessor: atomRef(predecessor), successor: atomRef(successor) }, supersession: { supported: false } });
    }
    const termDocumentFrequencies = Object.fromEntries(terms.map(term => [term, frequency.get(term)]));
    const boundary = { order: 'rarest_term_then_newest', maxEntries, perTermLimit, totalEligibleCount, examinedCount: byId.size, complete: orderedTerms.every(term => frequency.get(term) <= perTermLimit), queryTerms: terms, termDocumentFrequencies };
    return includeExclusions ? { contractVersion: 'forest_home_lexical_candidates/v2', jurisdiction: 'home', entries, exclusions, boundary } : entries;
  }
  listEntries() { return this.sqlite.prepare('SELECT * FROM forest_entries ORDER BY thread_id, source_timestamp, source_event_id').all(); }
  listIntakeHolds() { return this.sqlite.prepare(`SELECT o.*,d.decision_id,d.revision,d.reason_code,d.reason_detail,d.predecessor_source_id AS decision_predecessor_source_id,d.decided_at
    FROM forest_intake_offers o JOIN forest_intake_decisions d ON d.offer_id=o.offer_id
    WHERE d.revision=(SELECT MAX(latest.revision) FROM forest_intake_decisions latest WHERE latest.offer_id=o.offer_id) AND d.state='held'
    ORDER BY o.source_timestamp,o.offer_id`).all(); }
  intakeStatus() {
    const offers = this.sqlite.prepare('SELECT COUNT(*) AS count FROM forest_intake_offers').get().count;
    const held = this.listIntakeHolds().length;
    const unresolved = this.sqlite.prepare(`SELECT COUNT(*) AS count FROM forest_intake_offers o
      WHERE NOT EXISTS(SELECT 1 FROM forest_intake_decisions d WHERE d.offer_id=o.offer_id)`).get().count;
    return { offers, held, unresolved };
  }
  count() { return this.sqlite.prepare('SELECT COUNT(*) AS count FROM forest_entries').get().count; }
  countWild() { return this.sqlite.prepare('SELECT COUNT(*) AS count FROM wild_entries').get().count; }
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
export function forestSchemaSql() { return `${SCHEMA}\n${JOURNAL_SCHEMA}`; }
