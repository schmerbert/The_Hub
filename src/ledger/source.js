import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  BLESSING_SOURCE_EVENT_ID,
  BLESSING_V1,
  BLESSING_V1_HASH,
  CONTINUITY_NAME,
  buildClinicalAnchor,
  wrapBlessingV1,
} from '../resident/charter.js';
import { validateBlessingSourceEvent } from '../context/assemble.js';
import { id, sha256 } from '../core/hash.js';
import { SESSION_ZERO_ID, SESSION_ZERO_LABEL, buildClinicalBootstrap } from '../session/lifespan.js';

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
  created_at TEXT NOT NULL,
  UNIQUE(session_id, ordinal)
);
CREATE INDEX IF NOT EXISTS session_history_order ON session_history(session_id, ordinal);
CREATE TABLE IF NOT EXISTS provider_requests (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  wake_id TEXT NOT NULL REFERENCES wakes(id),
  phase TEXT NOT NULL CHECK(phase IN ('orientation','response','ordinary')),
  ordinal INTEGER NOT NULL,
  request_body TEXT NOT NULL,
  message_sources_json TEXT NOT NULL,
  spine_record_id TEXT,
  response_message_json TEXT,
  response_id TEXT,
  finish_reason TEXT,
  outcome_json TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE(wake_id, ordinal)
);
CREATE INDEX IF NOT EXISTS provider_requests_wake_order ON provider_requests(wake_id, ordinal);
CREATE TABLE IF NOT EXISTS hearth_receipts (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  wake_id TEXT NOT NULL REFERENCES wakes(id),
  tool_call_id TEXT NOT NULL,
  return_json TEXT NOT NULL,
  return_hash TEXT NOT NULL,
  action_event_id TEXT NOT NULL REFERENCES events(id),
  return_event_id TEXT NOT NULL REFERENCES events(id),
  created_at TEXT NOT NULL,
  UNIQUE(wake_id)
);
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
    this.migrateSessionColumns();
    this.threadId = this.ensureThread();
    this.session = this.openSession();
  }

  migrateSessionColumns() {
    const addColumn = (table, column, definition) => {
      const columns = this.sqlite.prepare(`PRAGMA table_info(${table})`).all().map(item => item.name);
      if (!columns.includes(column)) this.sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    };
    addColumn('wakes', 'session_id', 'TEXT REFERENCES sessions(id)');
    addColumn('wakes', 'turn_ordinal', 'INTEGER');
    addColumn('events', 'session_id', 'TEXT REFERENCES sessions(id)');
  }

  openSession() {
    const timestamp = now();
    return this.transaction(() => {
      let zero = this.sqlite.prepare('SELECT id FROM sessions WHERE id=?').get(SESSION_ZERO_ID);
      if (!zero) {
        this.sqlite.prepare(`INSERT INTO sessions(id, thread_id, kind, label, status, opened_at, closed_at, close_reason, predecessor_session_id, wake_status)
          VALUES(?,?,?,?,?,?,?,?,?,?)`).run(SESSION_ZERO_ID, this.threadId, 'ancestry', SESSION_ZERO_LABEL, 'closed', timestamp, null, 'historical_ancestry', null, 'complete');
      }
      const previous = this.sqlite.prepare(`SELECT * FROM sessions WHERE thread_id=? AND kind='lifespan' AND status='open' ORDER BY opened_at DESC, id DESC LIMIT 1`).get(this.threadId);
      this.sqlite.prepare("UPDATE sessions SET status='closed', closed_at=?, close_reason='server_restart' WHERE thread_id=? AND kind='lifespan' AND status='open'").run(timestamp, this.threadId);
      const predecessor = previous?.id || SESSION_ZERO_ID;
      const sessionId = id('session');
      this.sqlite.prepare(`INSERT INTO sessions(id, thread_id, kind, label, status, opened_at, predecessor_session_id, wake_status)
        VALUES(?,?,?,?,?,?,?,?)`).run(sessionId, this.threadId, 'lifespan', 'Active Session', 'open', timestamp, predecessor, 'pending');
      return this.sqlite.prepare('SELECT * FROM sessions WHERE id=?').get(sessionId);
    });
  }

  migrateCustodyFailureColumns() {
    const columns = this.sqlite.prepare('PRAGMA table_info(wakes)').all().map(column => column.name);
    if (!columns.includes('custody_failure_code')) this.sqlite.exec('ALTER TABLE wakes ADD COLUMN custody_failure_code TEXT');
    if (!columns.includes('custody_failure_message')) this.sqlite.exec('ALTER TABLE wakes ADD COLUMN custody_failure_message TEXT');
  }

  migrateContextItems() {
    const table = this.sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='wake_context_items'").get();
    if (!table) return;
    const needsRebuild = !table.sql.includes("'clinical_anchor'") || !table.sql.includes("'resident_blessing'");
    this.transaction(() => {
      if (needsRebuild) {
        this.sqlite.exec('ALTER TABLE wake_context_items RENAME TO wake_context_items_legacy');
        this.sqlite.exec(`CREATE TABLE wake_context_items (
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
      )`);
        this.sqlite.exec(`INSERT INTO wake_context_items
        (id, wake_id, ordinal, item_kind, actor_role, content, source_event_id, source_description, authority, included, omission_reason, content_hash)
        SELECT id, wake_id, ordinal, item_kind, actor_role, content, source_event_id, source_description, authority, included, omission_reason, content_hash
        FROM wake_context_items_legacy`);
        this.sqlite.exec('DROP TABLE wake_context_items_legacy');
      }
      const currentColumns = this.sqlite.prepare('PRAGMA table_info(wake_context_items)').all().map(column => column.name);
      if (!currentColumns.includes('source_event_hash')) this.sqlite.exec('ALTER TABLE wake_context_items ADD COLUMN source_event_hash TEXT');
      if (!currentColumns.includes('blessing_text')) this.sqlite.exec('ALTER TABLE wake_context_items ADD COLUMN blessing_text TEXT');
      if (!currentColumns.includes('blessing_hash')) this.sqlite.exec('ALTER TABLE wake_context_items ADD COLUMN blessing_hash TEXT');
      if (!currentColumns.includes('trust')) this.sqlite.exec('ALTER TABLE wake_context_items ADD COLUMN trust TEXT');
      if (!currentColumns.includes('continuity')) this.sqlite.exec('ALTER TABLE wake_context_items ADD COLUMN continuity TEXT');
      if (!currentColumns.includes('version')) this.sqlite.exec('ALTER TABLE wake_context_items ADD COLUMN version INTEGER');
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

  createWake({ provider, model, content, contextItems, contextBuilder, ritualMode = false }) {
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
      this.validateContextItems(finalContextItems, { ritualMode, provider, model, wakeId, timestamp });
      const manifestPrefix = 'Host environment manifest:\n';
      const manifestContent = finalContextItems.find(item => item.itemKind === 'environment_manifest').content;
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
        (id, wake_id, ordinal, item_kind, actor_role, content, source_event_id, source_event_hash, blessing_text, blessing_hash, source_description, authority, trust, continuity, version, included, omission_reason, content_hash)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
      for (const item of finalContextItems) {
        insert.run(id('ctx'), wakeId, item.ordinal, item.itemKind, item.actorRole, item.content,
          item.sourceEventId || (item.itemKind === 'utterance' && item.actorRole === 'user' && item.content === content ? eventId : null), item.sourceEventHash || null,
          item.blessingText || null, item.blessingHash || null, item.sourceDescription, item.authority, item.trust || null, item.continuity || null, item.version || null, item.included ? 1 : 0,
          item.omissionReason || null, item.contentHash);
      }
    });
    return { wakeId, eventId, contextItems: finalContextItems };
  }

  validateContextItems(items, { ritualMode, provider, model }) {
    const kinds = items.map(item => item?.itemKind);
    if (items.some((item, index) => item?.ordinal !== index + 1)) throw Object.assign(new Error('Wake ritual ordering is invalid.'), { code: 'wake_ritual_invalid' });
    const manifests = items.filter(item => item.itemKind === 'environment_manifest');
    if (manifests.length !== 1) throw ritualMode ? Object.assign(new Error('Wake ritual requires one environment manifest.'), { code: 'wake_ritual_invalid' }) : new Error('Every new wake must include one environment manifest after the arrival charter.');
    const required = ritualMode ? ['clinical_anchor', 'environment_manifest', 'resident_blessing'] : ['charter', 'environment_manifest'];
    if (kinds[0] !== required[0] || kinds[1] !== required[1] || (ritualMode && kinds[2] !== required[2])) {
      throw Object.assign(new Error(ritualMode ? 'Wake ritual ordering is invalid.' : 'Every new wake must include one environment manifest after the arrival charter.'), { code: ritualMode ? 'wake_ritual_invalid' : undefined });
    }
    if (ritualMode) {
      const blessings = items.filter(item => item.itemKind === 'resident_blessing');
      if (blessings.length !== 1 || items.filter(item => item.itemKind === 'clinical_anchor').length !== 1) throw Object.assign(new Error('Wake ritual must contain one clinical anchor and one active blessing.'), { code: 'wake_ritual_invalid' });
      const anchor = items[0];
      if (anchor.content !== buildClinicalAnchor({ provider, model }) || anchor.actorRole !== 'system' || anchor.authority !== 'host_receipt' ||
        anchor.sourceDescription !== 'Host clinical anchor v1' || anchor.continuity !== CONTINUITY_NAME || anchor.version !== 1 || !anchor.included ||
        anchor.contentHash !== sha256(anchor.content)) {
        throw Object.assign(new Error('Wake ritual clinical anchor is invalid.'), { code: 'wake_ritual_invalid' });
      }
      const blessing = blessings[0];
      const source = this.getEvent(blessing.sourceEventId);
      try { validateBlessingSourceEvent(source, this.threadId); } catch { throw Object.assign(new Error('Wake ritual blessing provenance is invalid.'), { code: 'wake_ritual_invalid' }); }
      if (blessing.actorRole !== 'system' || blessing.authority !== 'model_signed' || blessing.trust !== 'scent' || blessing.continuity !== CONTINUITY_NAME || blessing.version !== 1 || blessing.content !== wrapBlessingV1() || blessing.blessingText !== BLESSING_V1 || blessing.blessingHash !== sha256(blessing.blessingText) || blessing.contentHash !== sha256(blessing.content) || blessing.sourceEventId !== BLESSING_SOURCE_EVENT_ID || blessing.sourceEventHash !== sha256(source.content) || blessing.sourceEventHash === blessing.blessingHash || blessing.sourceEventHash === blessing.contentHash || blessing.blessingHash === blessing.contentHash) {
        throw Object.assign(new Error('Wake ritual blessing provenance is invalid.'), { code: 'wake_ritual_invalid' });
      }
      if (items.some(item => item.itemKind === 'charter') || items.filter(item => item.itemKind === 'disclosure').length > 1 || items.some((item, index) => index >= 3 && item.itemKind !== 'disclosure' && item.itemKind !== 'utterance')) throw Object.assign(new Error('Wake ritual ordering is invalid.'), { code: 'wake_ritual_invalid' });
      const disclosureIndex = items.findIndex(item => item.itemKind === 'disclosure');
      const firstUtteranceIndex = items.findIndex(item => item.itemKind === 'utterance');
      if ((disclosureIndex !== -1 && disclosureIndex !== 3) || (disclosureIndex !== -1 && firstUtteranceIndex !== -1 && disclosureIndex > firstUtteranceIndex)) throw Object.assign(new Error('Wake ritual ordering is invalid.'), { code: 'wake_ritual_invalid' });
      for (const item of items.slice(0, 3)) if (!item.included || item.authority === 'instruction') throw Object.assign(new Error('Wake ritual layer is not included or is mislabeled.'), { code: 'wake_ritual_invalid' });
      if (items[0].actorRole !== 'system' || items[0].authority !== 'host_receipt' || items[1].actorRole !== 'system' || items[1].authority !== 'host_receipt') throw Object.assign(new Error('Wake ritual host provenance is invalid.'), { code: 'wake_ritual_invalid' });
      for (const item of items.filter(item => item.itemKind === 'utterance')) {
        const validConversationRole = (item.actorRole === 'user' && item.authority === 'ground') ||
          (item.actorRole === 'assistant' && item.authority === 'model_signed');
        if (!validConversationRole) throw Object.assign(new Error('Conversation provenance is invalid.'), { code: 'wake_ritual_invalid' });
      }
      for (const item of items) if (item.contentHash !== sha256(item.content)) throw Object.assign(new Error('Wake context content hash is invalid.'), { code: 'wake_ritual_invalid' });
    } else if (kinds.some(kind => kind === 'clinical_anchor' || kind === 'resident_blessing')) {
      throw new Error('Inactive wake cannot contain live ritual layers.');
    }
    const manifest = manifests[0];
    if (!manifest.content.startsWith('Host environment manifest:\n')) throw new Error(ritualMode ? 'Wake ritual manifest is invalid.' : 'Every new wake must include a parseable environment manifest.');
  }

  getActiveSession() {
    return rowToObject(this.sqlite.prepare(`SELECT id, thread_id AS threadId, kind, label, status, opened_at AS openedAt,
      closed_at AS closedAt, close_reason AS closeReason, predecessor_session_id AS predecessorSessionId, wake_status AS wakeStatus
      FROM sessions WHERE id=?`).get(this.session.id));
  }

  listSessions() {
    return this.sqlite.prepare(`SELECT id, thread_id AS threadId, kind, label, status, opened_at AS openedAt,
      closed_at AS closedAt, close_reason AS closeReason, predecessor_session_id AS predecessorSessionId, wake_status AS wakeStatus
      FROM sessions WHERE thread_id=? ORDER BY opened_at, id`).all(this.threadId);
  }

  sessionHasOrientation(sessionId = this.session.id) {
    return Boolean(this.sqlite.prepare('SELECT 1 FROM hearth_receipts WHERE session_id=? LIMIT 1').get(sessionId));
  }

  listSessionUtterances(sessionId) {
    const where = sessionId === SESSION_ZERO_ID ? 'e.session_id IS NULL' : 'e.session_id=?';
    const args = sessionId === SESSION_ZERO_ID ? [this.threadId] : [this.threadId, sessionId];
    return this.sqlite.prepare(`SELECT e.id, e.thread_id AS threadId, e.wake_id AS wakeId, e.actor_kind AS actorKind,
      e.authority, e.content, e.created_at AS createdAt
      FROM events e WHERE e.thread_id=? AND ${where} AND e.event_kind='utterance' AND e.actor_kind IN ('user','resident')
      ORDER BY e.created_at, e.id`).all(...args);
  }

  priorSessionTail({ sessionId = this.session.id, ceiling }) {
    const active = this.sqlite.prepare('SELECT predecessor_session_id AS predecessorSessionId FROM sessions WHERE id=?').get(sessionId);
    const priorId = active?.predecessorSessionId || SESSION_ZERO_ID;
    const priorSession = this.sqlite.prepare('SELECT id, label, kind FROM sessions WHERE id=?').get(priorId);
    const utterances = this.listSessionUtterances(priorId);
    const tail = utterances.slice(-ceiling);
    return {
      sessionId: priorId,
      label: priorSession?.label || SESSION_ZERO_LABEL,
      source: priorId === SESSION_ZERO_ID ? 'session_zero' : 'prior_session',
      total: utterances.length,
      omitted: utterances.length - tail.length,
      ceiling,
      tail,
    };
  }

  createSessionWake({ provider, model, content }) {
    const wakeId = id('wake');
    const eventId = id('event');
    const historyId = id('history');
    const timestamp = now();
    const session = this.getActiveSession();
    if (!session || session.status !== 'open') throw new Error('No open session is available.');
    const turnOrdinal = this.sqlite.prepare('SELECT COUNT(*) AS count FROM wakes WHERE session_id=?').get(session.id).count + 1;
    const message = { role: 'user', content };
    const historyOrdinal = this.getSessionHistory(session.id).length + 1;
    this.transaction(() => {
      this.sqlite.prepare(`INSERT INTO wakes(id, thread_id, session_id, turn_ordinal, status, provider, requested_model, started_at)
        VALUES(?,?,?,?,?,?,?,?)`).run(wakeId, this.threadId, session.id, turnOrdinal, 'assembling', provider, model, timestamp);
      this.sqlite.prepare(`INSERT INTO events(id, thread_id, session_id, wake_id, actor_kind, event_kind, content, authority, provider, model, created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(eventId, this.threadId, session.id, wakeId, 'user', 'utterance', content, 'ground', null, null, timestamp);
      this.sqlite.prepare(`INSERT INTO session_history(id, session_id, wake_id, ordinal, message_json, role, message_kind, source_event_id, content_hash, created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?)`).run(historyId, session.id, wakeId, historyOrdinal, JSON.stringify(message), 'user', 'user', eventId, sha256(content), timestamp);
      this.sqlite.prepare('UPDATE sessions SET wake_status=? WHERE id=?').run('orienting', session.id);
      const bootstrap = buildClinicalBootstrap({ provider, model });
      for (const item of [
        { ordinal: 1, itemKind: 'clinical_anchor', actorRole: 'system', content: bootstrap, sourceDescription: 'Minimal clinical bootstrap v1', authority: 'host_receipt', included: true },
        { ordinal: 2, itemKind: 'utterance', actorRole: 'user', content, sourceEventId: eventId, sourceDescription: 'Current session human message', authority: 'ground', included: true },
      ]) {
        this.sqlite.prepare(`INSERT INTO wake_context_items
          (id, wake_id, ordinal, item_kind, actor_role, content, source_event_id, source_description, authority, included, omission_reason, content_hash)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(id('ctx'), wakeId, item.ordinal, item.itemKind, item.actorRole, item.content,
          item.sourceEventId || null, item.sourceDescription, item.authority, 1, null, sha256(item.content));
      }
    });
    return { wakeId, eventId, sessionId: session.id, turnOrdinal, context: [{ role: 'system', content: buildClinicalBootstrap({ provider, model }) }, message] };
  }

  getSessionHistory(sessionId = this.session.id) {
    return this.sqlite.prepare(`SELECT id, session_id AS sessionId, wake_id AS wakeId, ordinal, message_json AS messageJson,
      role, message_kind AS messageKind, source_event_id AS sourceEventId, content_hash AS contentHash, created_at AS createdAt
      FROM session_history WHERE session_id=? ORDER BY ordinal`).all(sessionId);
  }

  appendSessionHistory({ sessionId = this.session.id, wakeId, message, messageKind, sourceEventId = null }) {
    const history = this.getSessionHistory(sessionId);
    const ordinal = history.length + 1;
    const raw = JSON.stringify(message);
    const content = typeof message.content === 'string' ? message.content : raw;
    this.sqlite.prepare(`INSERT INTO session_history(id, session_id, wake_id, ordinal, message_json, role, message_kind, source_event_id, content_hash, created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run(id('history'), sessionId, wakeId, ordinal, raw, message.role, messageKind, sourceEventId, sha256(content), now());
    return ordinal;
  }

  recordProviderRequest({ sessionId, wakeId, phase, requestBody, messageSources, spineRecordId }) {
    const ordinal = this.sqlite.prepare('SELECT COUNT(*) AS count FROM provider_requests WHERE wake_id=?').get(wakeId).count + 1;
    const requestId = id('provider_request');
    this.sqlite.prepare(`INSERT INTO provider_requests(id, session_id, wake_id, phase, ordinal, request_body, message_sources_json, spine_record_id, created_at)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(requestId, sessionId, wakeId, phase, ordinal, requestBody, JSON.stringify(messageSources), spineRecordId || null, now());
    return requestId;
  }

  completeProviderRequest(requestId, result, outcome = null) {
    this.sqlite.prepare(`UPDATE provider_requests SET response_message_json=?, response_id=?, finish_reason=?, outcome_json=?, completed_at=? WHERE id=?`).run(
      result?.message ? JSON.stringify(result.message) : null, result?.responseId || null, result?.finishReason || null, outcome ? JSON.stringify(outcome) : null, now(), requestId);
  }

  recordHearthAction({ wakeId, sessionId, message }) {
    const eventId = id('event');
    const raw = JSON.stringify(message);
    this.transaction(() => {
      this.sqlite.prepare(`INSERT INTO events(id, thread_id, session_id, wake_id, actor_kind, event_kind, content, authority, provider, model, created_at)
        SELECT ?, thread_id, ?, ?, 'resident', 'state', ?, 'model_signed', provider, requested_model, ? FROM wakes WHERE id=?`).run(eventId, sessionId, wakeId, raw, now(), wakeId);
      this.appendSessionHistory({ sessionId, wakeId, message, messageKind: 'assistant_tool_call', sourceEventId: null });
    });
    return eventId;
  }

  recordHearthReturn({ wakeId, sessionId, toolCallId, returnValue, actionEventId, returnHash }) {
    const eventId = id('event');
    const message = { role: 'tool', tool_call_id: toolCallId, content: JSON.stringify(returnValue) };
    this.transaction(() => {
      this.sqlite.prepare(`INSERT INTO events(id, thread_id, session_id, wake_id, actor_kind, event_kind, content, authority, provider, model, created_at)
        SELECT ?, thread_id, ?, ?, 'host', 'state', ?, 'host_receipt', provider, requested_model, ? FROM wakes WHERE id=?`).run(eventId, sessionId, wakeId, message.content, now(), wakeId);
      this.appendSessionHistory({ sessionId, wakeId, message, messageKind: 'tool_result' });
      this.sqlite.prepare(`INSERT INTO hearth_receipts(id, session_id, wake_id, tool_call_id, return_json, return_hash, action_event_id, return_event_id, created_at)
        VALUES(?,?,?,?,?,?,?,?,?)`).run(id('hearth'), sessionId, wakeId, toolCallId, JSON.stringify(returnValue), returnHash, actionEventId, eventId, now());
    });
    return { eventId, message };
  }

  commitSessionWake(wakeId, response) {
    const eventId = id('event');
    const wake = this.sqlite.prepare('SELECT thread_id AS threadId, session_id AS sessionId, provider, requested_model AS requestedModel FROM wakes WHERE id=?').get(wakeId);
    this.transaction(() => {
      this.sqlite.prepare(`INSERT INTO events(id, thread_id, session_id, wake_id, actor_kind, event_kind, content, authority, provider, model, created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(eventId, wake.threadId, wake.sessionId, wakeId, 'resident', 'utterance', response.content, 'model_signed', wake.provider, response.resolvedModel || wake.requestedModel, now());
      this.appendSessionHistory({ sessionId: wake.sessionId, wakeId, message: response.message || { role: 'assistant', content: response.content }, messageKind: 'resident', sourceEventId: eventId });
      this.sqlite.prepare(`UPDATE wakes SET status='committed', resolved_model=?, provider_response_id=?, finish_reason=?, system_fingerprint=?, usage_json=?, completed_at=? WHERE id=?`).run(
        response.resolvedModel || null, response.responseId || null, response.finishReason || null, response.systemFingerprint || null,
        response.usage ? JSON.stringify(response.usage) : null, now(), wakeId);
      this.sqlite.prepare('UPDATE sessions SET wake_status=? WHERE id=?').run('complete', wake.sessionId);
    });
    return eventId;
  }

  failSessionWake(wakeId, failure) {
    const eventId = id('event');
    const wake = this.sqlite.prepare('SELECT thread_id AS threadId, session_id AS sessionId, provider, requested_model AS requestedModel FROM wakes WHERE id=?').get(wakeId);
    this.transaction(() => {
      this.sqlite.prepare(`INSERT INTO events(id, thread_id, session_id, wake_id, actor_kind, event_kind, content, authority, provider, model, created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(eventId, wake.threadId, wake.sessionId, wakeId, 'host', 'failure', failure.message, 'host_receipt', wake.provider, wake.requestedModel, now());
      this.sqlite.prepare(`UPDATE wakes SET status='failed', failure_code=?, failure_message=?, completed_at=? WHERE id=?`).run(failure.code, failure.message, now(), wakeId);
      this.sqlite.prepare('UPDATE sessions SET wake_status=? WHERE id=?').run('failed', wake.sessionId);
    });
    return eventId;
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
      sessionId: wake.session_id || null, turnOrdinal: wake.turn_ordinal || null,
      requestedModel: wake.requested_model, resolvedModel: wake.resolved_model,
      providerResponseId: wake.provider_response_id, finishReason: wake.finish_reason,
      systemFingerprint: wake.system_fingerprint, usage: wake.usage_json ? JSON.parse(wake.usage_json) : null,
      failureCode: wake.failure_code, failureMessage: wake.failure_message,
      custodyFailureCode: wake.custody_failure_code, custodyFailureMessage: wake.custody_failure_message,
      startedAt: wake.started_at, completedAt: wake.completed_at,
    };
    normalized.context = this.sqlite.prepare('SELECT ordinal, item_kind AS itemKind, actor_role AS actorRole, content, source_event_id AS sourceEventId, source_event_hash AS sourceEventHash, blessing_text AS blessingText, blessing_hash AS blessingHash, source_description AS sourceDescription, authority, trust, continuity, version, included, omission_reason AS omissionReason, content_hash AS contentHash FROM wake_context_items WHERE wake_id=? ORDER BY ordinal').all(wakeId).map(item => {
      const normalizedItem = { ...item, included: Boolean(item.included) };
      for (const key of ['sourceEventHash', 'blessingText', 'blessingHash', 'trust', 'continuity', 'version']) if (normalizedItem[key] === null) delete normalizedItem[key];
      return normalizedItem;
    });
    normalized.events = this.sqlite.prepare('SELECT id, session_id AS sessionId, actor_kind AS actorKind, event_kind AS eventKind, content, authority, provider, model, created_at AS createdAt FROM events WHERE wake_id=? ORDER BY created_at, id').all(wakeId).map(event => ({ ...event, sessionId: event.sessionId || SESSION_ZERO_ID }));
    normalized.phases = this.sqlite.prepare(`SELECT id, phase, ordinal, request_body AS requestBody, message_sources_json AS messageSources,
      spine_record_id AS spineRecordId, response_message_json AS responseMessage, response_id AS responseId, finish_reason AS finishReason,
      outcome_json AS outcome, created_at AS createdAt, completed_at AS completedAt FROM provider_requests WHERE wake_id=? ORDER BY ordinal`).all(wakeId).map(phase => ({
      ...phase,
      messageSources: JSON.parse(phase.messageSources),
      responseMessage: phase.responseMessage ? JSON.parse(phase.responseMessage) : null,
      outcome: phase.outcome ? JSON.parse(phase.outcome) : null,
    }));
    normalized.hearth = this.sqlite.prepare(`SELECT tool_call_id AS toolCallId, return_json AS returnJson, return_hash AS returnHash,
      action_event_id AS actionEventId, return_event_id AS returnEventId FROM hearth_receipts WHERE wake_id=?`).get(wakeId) || null;
    return normalized;
  }

  getEvent(eventId) {
    const event = this.sqlite.prepare(`SELECT id, thread_id AS threadId, session_id AS sessionId, wake_id AS wakeId,
      actor_kind AS actorKind, event_kind AS eventKind, content, authority,
      provider, model, created_at AS createdAt FROM events WHERE id=?`).get(eventId);
    const normalized = rowToObject(event);
    return normalized ? { ...normalized, sessionId: normalized.sessionId || SESSION_ZERO_ID, fullHash: sha256(normalized.content) } : null;
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
    const events = this.sqlite.prepare('SELECT id, session_id AS sessionId, wake_id AS wakeId, actor_kind AS actorKind, event_kind AS eventKind, content, authority, provider, model, created_at AS createdAt FROM events WHERE thread_id=? ORDER BY created_at, id').all(this.threadId).map(event => ({ ...event, sessionId: event.sessionId || SESSION_ZERO_ID }));
    const wakes = this.sqlite.prepare('SELECT id, session_id AS sessionId, turn_ordinal AS turnOrdinal, status, provider, requested_model AS requestedModel, resolved_model AS resolvedModel, failure_code AS failureCode, failure_message AS failureMessage, custody_failure_code AS custodyFailureCode, custody_failure_message AS custodyFailureMessage, started_at AS startedAt, completed_at AS completedAt FROM wakes WHERE thread_id=? ORDER BY started_at, id').all(this.threadId);
    const sessions = this.listSessions();
    return { thread: rowToObject(thread), session: this.getActiveSession(), sessions, events, wakes };
  }

  close() { this.sqlite.close(); }
}
