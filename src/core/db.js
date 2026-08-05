import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { id } from './hash.js';

const SCHEMA = `
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
  item_kind TEXT NOT NULL CHECK(item_kind IN ('charter','environment_manifest','utterance','disclosure')),
  actor_role TEXT NOT NULL,
  content TEXT NOT NULL,
  source_event_id TEXT,
  source_description TEXT NOT NULL,
  authority TEXT NOT NULL,
  included INTEGER NOT NULL CHECK(included IN (0,1)),
  omission_reason TEXT,
  content_hash TEXT NOT NULL,
  UNIQUE(wake_id, ordinal)
);
CREATE INDEX IF NOT EXISTS events_thread_created ON events(thread_id, created_at);
CREATE INDEX IF NOT EXISTS context_wake_ordinal ON wake_context_items(wake_id, ordinal);
`;

function now() { return new Date().toISOString(); }
function rowToObject(row) { return row ? { ...row } : null; }

export class HubDatabase {
  constructor(path) {
    mkdirSync(dirname(path), { recursive: true });
    this.sqlite = new DatabaseSync(path);
    this.sqlite.exec('PRAGMA foreign_keys = ON;');
    this.sqlite.exec(SCHEMA);
    this.migrateContextItems();
    this.migrateCustodyFailureColumns();
    this.threadId = this.ensureThread();
  }

  migrateCustodyFailureColumns() {
    const columns = this.sqlite.prepare('PRAGMA table_info(wakes)').all().map(column => column.name);
    if (!columns.includes('custody_failure_code')) this.sqlite.exec('ALTER TABLE wakes ADD COLUMN custody_failure_code TEXT');
    if (!columns.includes('custody_failure_message')) this.sqlite.exec('ALTER TABLE wakes ADD COLUMN custody_failure_message TEXT');
  }

  migrateContextItems() {
    const table = this.sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='wake_context_items'").get();
    if (!table || table.sql.includes("'environment_manifest'")) return;
    this.transaction(() => {
      this.sqlite.exec('ALTER TABLE wake_context_items RENAME TO wake_context_items_legacy');
      this.sqlite.exec(`CREATE TABLE wake_context_items (
        id TEXT PRIMARY KEY,
        wake_id TEXT NOT NULL REFERENCES wakes(id),
        ordinal INTEGER NOT NULL,
        item_kind TEXT NOT NULL CHECK(item_kind IN ('charter','environment_manifest','utterance','disclosure')),
        actor_role TEXT NOT NULL,
        content TEXT NOT NULL,
        source_event_id TEXT,
        source_description TEXT NOT NULL,
        authority TEXT NOT NULL,
        included INTEGER NOT NULL CHECK(included IN (0,1)),
        omission_reason TEXT,
        content_hash TEXT NOT NULL,
        UNIQUE(wake_id, ordinal)
      )`);
      this.sqlite.exec(`INSERT INTO wake_context_items
        (id, wake_id, ordinal, item_kind, actor_role, content, source_event_id, source_description, authority, included, omission_reason, content_hash)
        SELECT id, wake_id, ordinal, item_kind, actor_role, content, source_event_id, source_description, authority, included, omission_reason, content_hash
        FROM wake_context_items_legacy`);
      this.sqlite.exec('DROP TABLE wake_context_items_legacy');
      this.sqlite.exec('CREATE INDEX IF NOT EXISTS context_wake_ordinal ON wake_context_items(wake_id, ordinal)');
    });
  }

  transaction(fn) {
    this.sqlite.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.sqlite.exec('COMMIT'); return result; }
    catch (error) { try { this.sqlite.exec('ROLLBACK'); } catch {} throw error; }
  }

  ensureThread() {
    const found = this.sqlite.prepare('SELECT id FROM threads ORDER BY created_at LIMIT 1').get();
    if (found) return found.id;
    const threadId = id('thread');
    this.sqlite.prepare('INSERT INTO threads(id, created_at, label) VALUES(?,?,?)').run(threadId, now(), null);
    return threadId;
  }

  createWake({ provider, model, content, contextItems, contextBuilder }) {
    const wakeId = id('wake');
    const eventId = id('event');
    const timestamp = now();
    let finalContextItems = contextItems;
    this.transaction(() => {
      this.sqlite.prepare(`INSERT INTO wakes(id, thread_id, status, provider, requested_model, started_at)
        VALUES(?,?,?,?,?,?)`).run(wakeId, this.threadId, 'assembling', provider, model, timestamp);
      this.sqlite.prepare(`INSERT INTO events(id, thread_id, wake_id, actor_kind, event_kind, content, authority, provider, model, created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?)`).run(eventId, this.threadId, wakeId, 'user', 'utterance', content, 'ground', null, null, timestamp);
      if (contextBuilder) finalContextItems = contextBuilder({ threadId: this.threadId, wakeId, eventId, startedAt: timestamp });
      if (!Array.isArray(finalContextItems)) throw new Error('Wake context must be an array.');
      const manifests = finalContextItems.filter(item => item.itemKind === 'environment_manifest');
      if (manifests.length !== 1 || finalContextItems[0]?.itemKind !== 'charter' || finalContextItems[1]?.itemKind !== 'environment_manifest') {
        throw new Error('Every new wake must include one environment manifest after the arrival charter.');
      }
      const manifestPrefix = 'Host environment manifest:\n';
      const manifestContent = finalContextItems[1].content;
      let manifest;
      try {
        manifest = JSON.parse(manifestContent.startsWith(manifestPrefix) ? manifestContent.slice(manifestPrefix.length) : '');
      } catch {
        throw new Error('Every new wake must include a parseable environment manifest.');
      }
      if (manifest.thread_id !== this.threadId || manifest.wake_id !== wakeId ||
        manifest.wake_started_at_utc !== timestamp || manifest.wake_started_at_unix_ms !== Date.parse(timestamp)) {
        throw new Error('Environment manifest identity must match its persisted wake.');
      }
      const insert = this.sqlite.prepare(`INSERT INTO wake_context_items
        (id, wake_id, ordinal, item_kind, actor_role, content, source_event_id, source_description, authority, included, omission_reason, content_hash)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`);
      for (const item of finalContextItems) {
        insert.run(id('ctx'), wakeId, item.ordinal, item.itemKind, item.actorRole, item.content,
          item.sourceEventId || (item.itemKind === 'utterance' && item.actorRole === 'user' && item.content === content ? eventId : null), item.sourceDescription, item.authority, item.included ? 1 : 0,
          item.omissionReason || null, item.contentHash);
      }
    });
    return { wakeId, eventId, contextItems: finalContextItems };
  }

  markCalling(wakeId) { this.sqlite.prepare('UPDATE wakes SET status=? WHERE id=?').run('calling_provider', wakeId); }

  commitWake(wakeId, response, eventContent) {
    const eventId = id('event');
    this.transaction(() => {
      this.sqlite.prepare(`INSERT INTO events(id, thread_id, wake_id, actor_kind, event_kind, content, authority, provider, model, created_at)
        SELECT ?, thread_id, ?, 'resident', 'utterance', ?, 'model_signed', provider, ?, ? FROM wakes WHERE id=?`).run(
        eventId, wakeId, eventContent, response.resolvedModel || response.requestedModel || null, now(), wakeId);
      this.sqlite.prepare(`UPDATE wakes SET status='committed', resolved_model=?, provider_response_id=?, finish_reason=?,
        system_fingerprint=?, usage_json=?, completed_at=? WHERE id=?`).run(
        response.resolvedModel || null, response.responseId || null, response.finishReason || null,
        response.systemFingerprint || null, response.usage ? JSON.stringify(response.usage) : null, now(), wakeId);
    });
    return eventId;
  }

  failWake(wakeId, failure) {
    const eventId = id('event');
    this.transaction(() => {
      this.sqlite.prepare(`INSERT INTO events(id, thread_id, wake_id, actor_kind, event_kind, content, authority, provider, model, created_at)
        SELECT ?, thread_id, ?, 'host', 'failure', ?, 'host_receipt', provider, requested_model, ? FROM wakes WHERE id=?`).run(
        eventId, wakeId, failure.message, now(), wakeId);
      this.sqlite.prepare(`UPDATE wakes SET status='failed', failure_code=?, failure_message=?, completed_at=? WHERE id=?`).run(
        failure.code, failure.message, now(), wakeId);
    });
    return eventId;
  }

  recordHostFailure(wakeId, failure) {
    const eventId = id('event');
    this.transaction(() => {
      this.sqlite.prepare(`INSERT INTO events(id, thread_id, wake_id, actor_kind, event_kind, content, authority, provider, model, created_at)
        SELECT ?, thread_id, ?, 'host', 'failure', ?, 'host_receipt', provider, requested_model, ? FROM wakes WHERE id=?`).run(
        eventId, wakeId, failure.message, now(), wakeId);
      this.sqlite.prepare('UPDATE wakes SET custody_failure_code=?, custody_failure_message=? WHERE id=?').run(failure.code || 'forest_intake_failed', failure.message, wakeId);
    });
    return eventId;
  }

  getWake(wakeId) {
    const wake = rowToObject(this.sqlite.prepare('SELECT * FROM wakes WHERE id=?').get(wakeId));
    if (!wake) return null;
    const normalized = {
      id: wake.id, threadId: wake.thread_id, status: wake.status, provider: wake.provider,
      requestedModel: wake.requested_model, resolvedModel: wake.resolved_model,
      providerResponseId: wake.provider_response_id, finishReason: wake.finish_reason,
      systemFingerprint: wake.system_fingerprint, usage: wake.usage_json ? JSON.parse(wake.usage_json) : null,
      failureCode: wake.failure_code, failureMessage: wake.failure_message,
      custodyFailureCode: wake.custody_failure_code, custodyFailureMessage: wake.custody_failure_message,
      startedAt: wake.started_at, completedAt: wake.completed_at,
    };
    normalized.context = this.sqlite.prepare('SELECT ordinal, item_kind AS itemKind, actor_role AS actorRole, content, source_event_id AS sourceEventId, source_description AS sourceDescription, authority, included, omission_reason AS omissionReason, content_hash AS contentHash FROM wake_context_items WHERE wake_id=? ORDER BY ordinal').all(wakeId).map(item => ({ ...item, included: Boolean(item.included) }));
    normalized.events = this.sqlite.prepare('SELECT id, actor_kind AS actorKind, event_kind AS eventKind, content, authority, provider, model, created_at AS createdAt FROM events WHERE wake_id=? ORDER BY created_at, id').all(wakeId);
    return normalized;
  }

  getEvent(eventId) {
    const event = this.sqlite.prepare(`SELECT id, thread_id AS threadId, wake_id AS wakeId,
      actor_kind AS actorKind, event_kind AS eventKind, content, authority,
      provider, model, created_at AS createdAt FROM events WHERE id=?`).get(eventId);
    return rowToObject(event);
  }

  listUtteranceEvents() {
    return this.sqlite.prepare(`SELECT id, thread_id AS threadId, wake_id AS wakeId,
      actor_kind AS actorKind, event_kind AS eventKind, content, authority,
      provider, model, created_at AS createdAt FROM events
      WHERE event_kind='utterance' AND actor_kind IN ('user','resident')
      ORDER BY thread_id, created_at, id`).all();
  }

  listEligibleUtteranceEvents() {
    return this.sqlite.prepare(`SELECT e.id, e.thread_id AS threadId, e.wake_id AS wakeId,
      e.actor_kind AS actorKind, e.event_kind AS eventKind, e.content, e.authority,
      e.provider, e.model, e.created_at AS createdAt
      FROM events e LEFT JOIN wakes w ON w.id=e.wake_id
      WHERE e.event_kind='utterance' AND e.actor_kind IN ('user','resident')
        AND COALESCE(w.provider, e.provider, '') <> 'fake'
      ORDER BY e.thread_id, e.created_at, e.id`).all();
  }

  countExcludedFakeUtterances() {
    return this.sqlite.prepare(`SELECT COUNT(*) AS count FROM events e LEFT JOIN wakes w ON w.id=e.wake_id
      WHERE e.event_kind='utterance' AND e.actor_kind IN ('user','resident')
        AND COALESCE(w.provider, e.provider, '') = 'fake'`).get().count;
  }

  getThread() {
    const thread = this.sqlite.prepare('SELECT id, created_at AS createdAt, label FROM threads WHERE id=?').get(this.threadId);
    const events = this.sqlite.prepare('SELECT id, wake_id AS wakeId, actor_kind AS actorKind, event_kind AS eventKind, content, authority, provider, model, created_at AS createdAt FROM events WHERE thread_id=? ORDER BY created_at, id').all(this.threadId);
    const wakes = this.sqlite.prepare('SELECT id, status, provider, requested_model AS requestedModel, resolved_model AS resolvedModel, failure_code AS failureCode, failure_message AS failureMessage, custody_failure_code AS custodyFailureCode, custody_failure_message AS custodyFailureMessage, started_at AS startedAt, completed_at AS completedAt FROM wakes WHERE thread_id=? ORDER BY started_at, id').all(this.threadId);
    return { thread: rowToObject(thread), events, wakes };
  }

  close() { this.sqlite.close(); }
}
