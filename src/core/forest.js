import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { byteLength, id, sha256 } from './hash.js';
import { readSpineFrames } from './spine.js';

const APPEND_ONLY_TABLES = ['forest_metadata', 'scrub_receipts', 'forest_entries', 'forest_edges', 'presentation_links', 'emission_links'];

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

export function identityScrubV1(input) {
  if (typeof input !== 'string') throw new Error('Utterance body must be a string.');
  return {
    body: input,
    policyName: 'utterance_identity',
    policyVersion: 'v1',
    operations: [],
    changed: false,
  };
}

function custodyConflict(message) { return Object.assign(new Error(message), { code: 'forest_custody_conflict' }); }
function predecessorConflict(message) { return Object.assign(new Error(message), { code: 'forest_predecessor_conflict' }); }
function now() { return new Date().toISOString(); }
function normalizeEvent(event) {
  if (!event || event.eventKind !== 'utterance' || !['user', 'resident'].includes(event.actorKind)) throw new Error('Only user and resident utterance events may enter the Forest.');
  return event;
}

function verifyScrub(event, scrubbed) {
  if (!scrubbed || scrubbed.policyName !== 'utterance_identity' || scrubbed.policyVersion !== 'v1' || scrubbed.body !== event.content || scrubbed.changed !== false || !Array.isArray(scrubbed.operations) || scrubbed.operations.length !== 0) {
    throw custodyConflict('Identity scrub receipt does not prove unchanged content.');
  }
  const inputHash = sha256(event.content);
  if (sha256(scrubbed.body) !== inputHash || byteLength(scrubbed.body) !== byteLength(event.content)) throw custodyConflict('Identity scrub output hash or length mismatch.');
  return { inputHash, outputHash: inputHash };
}

function eventMatches(row, event, sourceHash, bodyHash) {
  return row.source_event_hash === sourceHash && row.body_hash === bodyHash && row.source_timestamp === event.createdAt && row.actor_kind === event.actorKind && row.signature === `actor:${event.actorKind}` && row.thread_id === event.threadId && (row.wake_id || null) === (event.wakeId || null) && row.source_authority === event.authority && row.scrub_policy === 'utterance_identity' && row.scrub_version === 'v1' && row.metadata_json === metadataForEvent(event);
}

function metadataForEvent(event) {
  return JSON.stringify({ provider: event.provider || null, model: event.model || null });
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
      this.sqlite.prepare('INSERT INTO forest_metadata(metadata_id, schema_name, schema_version, created_at) VALUES(1,?,?,?)').run('forest', 1, now());
    } else if (mode === 'requireExisting') {
      if (!existsSync(path)) throw new Error('Forest requireExisting refuses a missing database.');
      this.sqlite = new DatabaseSync(path);
      this.sqlite.exec('PRAGMA foreign_keys = ON;');
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
    const event = normalizeEvent(rawEvent);
    const scrubbed = scrub(event.content);
    const { inputHash, outputHash } = verifyScrub(event, scrubbed);
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

  listEntries() { return this.sqlite.prepare('SELECT * FROM forest_entries ORDER BY thread_id, source_timestamp, source_event_id').all(); }
  count() { return this.sqlite.prepare('SELECT COUNT(*) AS count FROM forest_entries').get().count; }
  verifySchema() {
    const tables = APPEND_ONLY_TABLES;
    for (const table of tables) if (!this.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table)) throw new Error(`Forest schema is missing ${table}.`);
    for (const table of tables) for (const action of ['update', 'delete']) if (!this.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name=?").get(`${table}_append_only_${action}`)) throw new Error(`Forest append-only trigger is missing for ${table}.`);
    const metadata = this.sqlite.prepare('SELECT schema_name, schema_version FROM forest_metadata WHERE metadata_id=1').get();
    if (!metadata || metadata.schema_name !== 'forest' || metadata.schema_version !== 1) throw new Error('Forest schema version is not v1.');
    return true;
  }
  close() { this.sqlite.close(); }
}

export function forestSchemaSql() { return SCHEMA; }

export function verifyForest({ forestPath, operationalPath, spinePath, strictBijection = true } = {}) {
  if (!forestPath || !existsSync(forestPath)) throw new Error('Forest database is missing.');
  const forest = new DatabaseSync(forestPath, { readOnly: true });
  const op = new DatabaseSync(operationalPath, { readOnly: true });
  try {
    const required = APPEND_ONLY_TABLES;
    for (const table of required) if (!forest.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table)) throw new Error(`Forest schema is missing ${table}.`);
    for (const table of required) for (const action of ['update', 'delete']) if (!forest.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name=?").get(`${table}_append_only_${action}`)) throw new Error(`Forest append-only trigger is missing for ${table}.`);
    const metadata = forest.prepare('SELECT schema_name, schema_version FROM forest_metadata WHERE metadata_id=1').get();
    if (!metadata || metadata.schema_name !== 'forest' || metadata.schema_version !== 1) throw new Error('Forest schema version is not v1.');

    const allOperational = op.prepare(`SELECT e.id, e.thread_id AS threadId, e.wake_id AS wakeId,
      e.actor_kind AS actorKind, e.event_kind AS eventKind, e.content, e.authority, e.provider, e.model,
      e.created_at AS createdAt, COALESCE(w.provider, e.provider, '') AS effectiveProvider
      FROM events e LEFT JOIN wakes w ON w.id=e.wake_id
      WHERE e.event_kind='utterance' AND e.actor_kind IN ('user','resident')
      ORDER BY e.thread_id, e.created_at, e.id`).all();
    const eligible = allOperational.filter(event => event.effectiveProvider !== 'fake');
    const excludedFakeCount = allOperational.length - eligible.length;
    const events = new Map(eligible.map(event => [event.id, event]));
    const entries = forest.prepare('SELECT * FROM forest_entries ORDER BY thread_id, source_timestamp, source_event_id').all();
    const entryBySource = new Map(entries.map(entry => [entry.source_event_id, entry]));
    const entryIds = new Set(entries.map(entry => entry.entry_id));
    const eligibleIds = new Set(eligible.map(event => event.id));
    const missingSourceIds = eligible.filter(event => !entryBySource.has(event.id)).map(event => event.id);
    const extraSourceIds = entries.filter(entry => !eligibleIds.has(entry.source_event_id)).map(entry => entry.source_event_id);
    if (strictBijection && (missingSourceIds.length || extraSourceIds.length || entries.length !== eligible.length)) throw new Error(`Forest source bijection failed (${missingSourceIds.length} missing, ${extraSourceIds.length} extra).`);
    if (extraSourceIds.length) throw new Error(`Forest contains an ineligible or unknown source event ${extraSourceIds[0]}.`);

    const receipts = forest.prepare('SELECT * FROM scrub_receipts ORDER BY receipt_id').all();
    if (receipts.length !== entries.length) throw new Error('Forest scrub receipts are not one-to-one with entries.');
    const receiptsBySource = new Map(receipts.map(receipt => [receipt.source_event_id, receipt]));
    for (const entry of entries) {
      const event = events.get(entry.source_event_id);
      if (!event || entry.source_event_hash !== sha256(event.content) || entry.source_timestamp !== event.createdAt || entry.body !== event.content || entry.body_hash !== sha256(event.content) || entry.actor_kind !== event.actorKind || entry.signature !== `actor:${event.actorKind}` || entry.thread_id !== event.threadId || (entry.wake_id || null) !== (event.wakeId || null) || entry.source_authority !== event.authority || entry.jurisdiction !== 'home' || entry.bucket !== 'utterance' || entry.metadata_json !== metadataForEvent(event)) throw new Error(`Forest source custody mismatch for ${entry.source_event_id}.`);
      const receipt = receiptsBySource.get(entry.source_event_id);
      if (!receipt || receipt.receipt_id !== entry.scrub_receipt_id || receipt.policy_name !== 'utterance_identity' || receipt.policy_version !== 'v1' || receipt.input_hash !== receipt.output_hash || receipt.input_byte_length !== receipt.output_byte_length || receipt.operations_json !== '[]' || receipt.changed !== 0 || receipt.input_hash !== entry.body_hash) throw new Error(`Forest scrub receipt mismatch for ${entry.source_event_id}.`);
    }
    for (const receipt of receipts) if (!entryBySource.has(receipt.source_event_id)) throw new Error('Forest contains an orphan scrub receipt.');

    const edges = forest.prepare('SELECT * FROM forest_edges').all();
    for (const edge of edges) if (edge.edge_type !== 'responds_to' || !entryIds.has(edge.from_entry_id) || !entryIds.has(edge.to_entry_id)) throw new Error('Forest edge reference is invalid.');
    const edgeByFrom = new Map();
    for (const edge of edges) { if (edgeByFrom.has(edge.from_entry_id)) throw new Error('Forest has duplicate responds_to edges.'); edgeByFrom.set(edge.from_entry_id, edge); }
    const eventThreads = new Map();
    for (const event of eligible) { if (!eventThreads.has(event.threadId)) eventThreads.set(event.threadId, []); eventThreads.get(event.threadId).push(event); }
    for (const [threadId, threadEvents] of eventThreads) {
      const threadEntries = threadEvents.map(event => entryBySource.get(event.id)).filter(Boolean);
      for (let index = 0; index < threadEntries.length; index++) {
        const edge = edgeByFrom.get(threadEntries[index].entry_id);
        const expectedTarget = index === 0 ? null : threadEntries[index - 1].entry_id;
        if ((edge?.to_entry_id || null) !== expectedTarget) throw new Error(`Forest responds_to chain is invalid for ${threadId}.`);
      }
    }
    if (strictBijection && edges.length !== Math.max(0, eligible.length - eventThreads.size)) throw new Error('Forest responds_to edge count is invalid.');

    const spineFrames = spinePath && existsSync(spinePath) ? readSpineFrames(spinePath) : [];
    const preparedFrames = spineFrames.filter(frame => frame.frame_type === 'request_prepared');
    const preparedById = new Map(preparedFrames.map(frame => [frame.record_id, frame]));
    const lifecycleByRequest = new Map(preparedFrames.map(frame => [frame.record_id, { dispatched: false, outcome: null }]));
    for (const frame of spineFrames) {
      if (frame.frame_type === 'dispatch_attempted') lifecycleByRequest.get(frame.request_record_id).dispatched = true;
      if (frame.frame_type === 'provider_outcome') lifecycleByRequest.get(frame.request_record_id).outcome = frame.outcome;
    }
    const presentationRows = forest.prepare('SELECT * FROM presentation_links').all();
    const emissionRows = forest.prepare('SELECT * FROM emission_links').all();
    if ((presentationRows.length || emissionRows.length) && !preparedFrames.length) throw new Error('Forest links require a verified Spine.');
    const presentationsByRequest = new Map();
    for (const link of presentationRows) { if (!entryIds.has(link.entry_id) || !preparedById.has(link.request_record_id)) throw new Error('Presentation link reference is invalid.'); if (!presentationsByRequest.has(link.request_record_id)) presentationsByRequest.set(link.request_record_id, []); presentationsByRequest.get(link.request_record_id).push(link); }
    for (const frame of preparedFrames) {
      const wake = op.prepare('SELECT id, thread_id AS threadId, provider, requested_model AS requestedModel FROM wakes WHERE id=?').get(frame.wake_id);
      if (!wake) throw new Error('Spine request references an unknown wake.');
      const thread = op.prepare('SELECT id FROM threads WHERE id=?').get(frame.thread_id);
      if (!thread || frame.thread_id !== wake.threadId || frame.provider !== wake.provider || frame.model !== wake.requestedModel) throw new Error(`Spine request custody does not match wake ${frame.wake_id}.`);
      let request;
      try { request = JSON.parse(frame.request_body); } catch { throw new Error('Spine request body is not valid JSON.'); }
      if (request.model !== wake.requestedModel) throw new Error(`Spine request JSON model does not match wake ${frame.wake_id}.`);
      const context = op.prepare(`SELECT ordinal, item_kind AS itemKind, actor_role AS actorRole, content, source_event_id AS sourceEventId, included, content_hash AS contentHash FROM wake_context_items WHERE wake_id=? ORDER BY ordinal`).all(frame.wake_id).map(item => ({ ...item, included: Boolean(item.included) }));
      const included = context.filter(item => item.included);
      if (!Array.isArray(request.messages) || request.messages.length !== included.length) throw new Error(`Spine request messages do not match wake ${frame.wake_id}.`);
      for (let index = 0; index < included.length; index++) if (request.messages[index]?.role !== included[index].actorRole || request.messages[index]?.content !== included[index].content) throw new Error(`Spine request message mismatch for wake ${frame.wake_id}.`);
      const expected = included.map((item, index) => item.itemKind === 'utterance' && item.sourceEventId ? { item, ordinal: index + 1 } : null).filter(Boolean);
      const links = presentationsByRequest.get(frame.record_id) || [];
      const lifecycle = lifecycleByRequest.get(frame.record_id);
      if (!lifecycle.dispatched) {
        if (links.length) throw new Error(`Prepared-only request ${frame.record_id} cannot have presentation links.`);
        continue;
      }
      if (links.length !== expected.length) throw new Error(`Presentation link set is incomplete for request ${frame.record_id}.`);
      const linkByEntry = new Map(links.map(link => [link.entry_id, link]));
      for (const { item, ordinal } of expected) {
        const entry = entryBySource.get(item.sourceEventId); const link = entry && linkByEntry.get(entry.entry_id);
        if (!entry || !link || link.message_ordinal !== ordinal || link.provider_role !== request.messages[ordinal - 1].role || link.content_hash !== sha256(request.messages[ordinal - 1].content) || link.content_hash !== entry.body_hash) throw new Error(`Presentation truth failed for request ${frame.record_id}.`);
      }
      if (links.some(link => !expected.some(({ item }) => entryBySource.get(item.sourceEventId)?.entry_id === link.entry_id))) throw new Error(`Presentation link set has extras for request ${frame.record_id}.`);
    }

    const residentsByWake = new Map();
    for (const event of eligible.filter(event => event.actorKind === 'resident')) { if (!residentsByWake.has(event.wakeId)) residentsByWake.set(event.wakeId, []); residentsByWake.get(event.wakeId).push(event); }
    const emissionsByEntry = new Map();
    for (const link of emissionRows) {
      if (!entryIds.has(link.entry_id) || !preparedById.has(link.request_record_id)) throw new Error('Emission link reference is invalid.');
      const entry = entries.find(candidate => candidate.entry_id === link.entry_id); const event = entry && events.get(entry.source_event_id); const request = preparedById.get(link.request_record_id);
      const lifecycle = lifecycleByRequest.get(link.request_record_id);
      if (!event || event.actorKind !== 'resident' || event.wakeId !== request.wake_id || !lifecycle.dispatched || lifecycle.outcome?.kind !== 'success') throw new Error('Emission link wake custody is invalid.');
      emissionsByEntry.set(link.entry_id, (emissionsByEntry.get(link.entry_id) || 0) + 1);
    }
    for (const frame of preparedFrames) {
      const residents = residentsByWake.get(frame.wake_id) || [];
      if (residents.length > 1) throw new Error(`Wake ${frame.wake_id} has multiple resident emissions.`);
      const lifecycle = lifecycleByRequest.get(frame.record_id);
      if (lifecycle.outcome?.kind === 'success' && residents.length !== 1) throw new Error(`Successful provider outcome lacks exactly one resident emission for wake ${frame.wake_id}.`);
      if (residents.length && lifecycle.outcome?.kind !== 'success') throw new Error(`Resident emission lacks a successful provider outcome for wake ${frame.wake_id}.`);
      if (residents.length === 1 && emissionsByEntry.get(entryBySource.get(residents[0].id)?.entry_id) !== 1) throw new Error(`Resident emission link is missing for wake ${frame.wake_id}.`);
      if (lifecycle.outcome && lifecycle.outcome.kind !== 'success' && residents.length) throw new Error(`Failed provider outcome has a resident emission for wake ${frame.wake_id}.`);
    }
    return { ok: true, entryCount: entries.length, eligibleOperationalCount: eligible.length, excludedFakeCount, missingSourceCount: missingSourceIds.length, edgeCount: edges.length, presentationCount: presentationRows.length, emissionCount: emissionRows.length };
  } finally { forest.close(); op.close(); }
}
