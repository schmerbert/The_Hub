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
import { canonicalize, id, sha256 } from '../core/hash.js';
import { SESSION_ZERO_ID, SESSION_ZERO_LABEL, buildClinicalBootstrap } from '../session/lifespan.js';
import { assertScrubbedProviderReturn } from '../scrub/provider-return.js';
import { assertScrubbedHostReturn } from '../scrub/host-return.js';
import { STABLE_GLASS_TEXT } from '../context/glass-cast.js';
import { WakeStreamJournal } from './wake-stream.js';
import { ROOTS_SCHEMA, RootsLedger } from './roots.js';
import { ScrollTraceLedger } from './scroll-trace.js';
import { GlassTraceLedger } from './glass-trace.js';
import { LEDGER_SCHEMA } from './schema.js';

function now() { return new Date().toISOString(); }
function rowToObject(row) { return row ? { ...row } : null; }

export class HubDatabase {
  constructor(path, { openSession = true } = {}) {
    mkdirSync(dirname(path), { recursive: true });
    this.sqlite = new DatabaseSync(path);
    const existingSource = Boolean(this.sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='session_history'").get());
    this.sqlite.exec('PRAGMA foreign_keys = ON;');
    this.sqlite.exec(`${LEDGER_SCHEMA}\n${ROOTS_SCHEMA}`);
    this.migrateContextItems();
    this.migrateCustodyFailureColumns();
    this.migrateSessionColumns();
    this.migrateCirculationColumns();
    this.wakeStream = new WakeStreamJournal(this.sqlite);
    this.roots = new RootsLedger(this.sqlite);
    this.scrollTrace = new ScrollTraceLedger(this.sqlite);
    this.glassTrace = new GlassTraceLedger(this.sqlite);
    this.threadId = this.ensureThread();
    this.session = openSession ? this.openSession() : null;
    if (!existingSource) { this.establishTraceEpoch(); this.establishGlassTraceEpoch(); this.establishRootsEpoch(); }
    this.backfillReasoningRoots();
  }

  getRootsEpoch() { return this.roots.epoch(); }
  establishRootsEpoch() { return this.roots.establishEpoch(); }
  verifyRoots(options) { return this.roots.verify(options); }

  getGlassTraceEpoch() { return this.glassTrace.epoch(); }
  establishGlassTraceEpoch() { return this.glassTrace.establishEpoch(); }
  verifyGlassTrace(options) { return this.glassTrace.verify(options); }
  getTraceEpoch() { return this.scrollTrace.epoch(); }
  establishTraceEpoch() { return this.scrollTrace.establishEpoch(); }
  appendScrollTraceManifest(input) { return this.scrollTrace.appendManifest(input); }

  migrateSessionColumns() {
    const addColumn = (table, column, definition) => {
      const columns = this.sqlite.prepare(`PRAGMA table_info(${table})`).all().map(item => item.name);
      if (!columns.includes(column)) this.sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    };
    addColumn('wakes', 'session_id', 'TEXT REFERENCES sessions(id)');
    addColumn('wakes', 'turn_ordinal', 'INTEGER');
    addColumn('events', 'session_id', 'TEXT REFERENCES sessions(id)');
    addColumn('session_history', 'scrub_receipt_id', 'TEXT');
    addColumn('session_history', 'raw_return_record_id', 'TEXT');
    addColumn('session_history', 'source_record_hash', 'TEXT');
  }

  backfillReasoningRoots() {
    if (!this.roots.epoch()) return { rooted: 0 };
    let rooted = 0;
    const rows = this.sqlite.prepare(`SELECT h.id,h.wake_id AS wakeId,h.message_json AS messageJson,h.raw_return_record_id AS rawReturnRecordId,h.scrub_receipt_id AS scrubReceiptId
      FROM session_history h WHERE h.role='assistant' AND NOT EXISTS (
        SELECT 1 FROM root_edges e WHERE e.relation='produced_scroll_row' AND e.target_authority='session_history' AND e.target_id=h.id
      )`).all();
    this.transaction(() => {
      for (const item of rows) {
        let message; try { message = JSON.parse(item.messageJson); } catch { continue; }
        if (typeof message?.reasoning_content !== 'string') continue;
        const artifact = this.roots.recordReasoning(message.reasoning_content);
        this.roots.linkReasoning({ artifactId: artifact.artifactId, relation: 'produced_scroll_row', targetAuthority: 'session_history', targetId: item.id, targetHash: sha256(item.messageJson) });
        this.roots.linkReasoning({ artifactId: artifact.artifactId, relation: 'produced_during_wake', targetAuthority: 'wake', targetId: item.wakeId });
        if (item.rawReturnRecordId) this.roots.linkReasoning({ artifactId: artifact.artifactId, relation: 'selected_from_return', targetAuthority: 'spine_record', targetId: item.rawReturnRecordId });
        const request = item.scrubReceiptId ? this.sqlite.prepare('SELECT provider_request_id AS providerRequestId FROM return_scrub_receipts WHERE id=?').get(item.scrubReceiptId) : null;
        if (request) this.roots.linkReasoning({ artifactId: artifact.artifactId, relation: 'produced_by_request', targetAuthority: 'provider_request', targetId: request.providerRequestId });
        rooted += 1;
      }
    });
    return { rooted };
  }

  migrateCirculationColumns() {
    const addColumn = (table, column, definition) => {
      const columns = this.sqlite.prepare(`PRAGMA table_info(${table})`).all().map(item => item.name);
      if (!columns.includes(column)) this.sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    };
    for (const [column, definition] of [['raw_return_record_id', 'TEXT'], ['raw_return_byte_length', 'INTEGER'], ['raw_return_sha256', 'TEXT'], ['return_scrub_receipt_id', 'TEXT'], ['return_scrub_receipt_json', 'TEXT'], ['attention_json', 'TEXT']]) addColumn('provider_requests', column, definition);
    addColumn('hearth_receipts', 'scroll_markdown', 'TEXT');
    addColumn('hearth_receipts', 'scroll_hash', 'TEXT');
    this.sqlite.exec(`CREATE TABLE IF NOT EXISTS return_scrub_receipts (
      id TEXT PRIMARY KEY, provider_request_id TEXT NOT NULL UNIQUE REFERENCES provider_requests(id), spine_record_id TEXT NOT NULL,
      receipt_json TEXT NOT NULL, message_json TEXT NOT NULL, created_at TEXT NOT NULL
    )`);
    this.sqlite.exec(`CREATE TABLE IF NOT EXISTS attention_receipts (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), wake_id TEXT NOT NULL REFERENCES wakes(id), phase TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('ok','warn','refuse')), receipt_json TEXT NOT NULL, receipt_hash TEXT NOT NULL, created_at TEXT NOT NULL
    )`);
    this.sqlite.exec('CREATE INDEX IF NOT EXISTS attention_receipts_wake_order ON attention_receipts(wake_id, created_at, id)');
    this.sqlite.exec("CREATE TRIGGER IF NOT EXISTS attention_receipts_append_only_update BEFORE UPDATE ON attention_receipts BEGIN SELECT RAISE(ABORT, 'append-only table'); END;");
    this.sqlite.exec("CREATE TRIGGER IF NOT EXISTS attention_receipts_append_only_delete BEFORE DELETE ON attention_receipts BEGIN SELECT RAISE(ABORT, 'append-only table'); END;");
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

  appendWakeStreamEvent(input) { return this.wakeStream.appendWakeStreamEvent(input); }
  wakeStreamEventFromRow(row) { return this.wakeStream.wakeStreamEventFromRow(row); }
  wakeStreamLimit(limit) { return this.wakeStream.wakeStreamLimit(limit); }
  getWakeStreamEvent(eventId) { return this.wakeStream.getWakeStreamEvent(eventId); }
  getLatestWakeStreamSequence() { return this.wakeStream.getLatestWakeStreamSequence(); }
  listWakeStreamEvents(options) { return this.wakeStream.listWakeStreamEvents(options); }
  listWakeStreamEventsAfter(afterSequence, options) { return this.wakeStream.listWakeStreamEventsAfter(afterSequence, options); }
  listWakeStreamEventsByWake(wakeId, options) { return this.wakeStream.listWakeStreamEventsByWake(wakeId, options); }
  listRecentWakeStreamEvents(options) { return this.wakeStream.listRecentWakeStreamEvents(options); }

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

  listSessionUtterances(sessionId, { committedOnly = false } = {}) {
    const where = sessionId === SESSION_ZERO_ID ? 'e.session_id IS NULL' : 'e.session_id=?';
    const args = sessionId === SESSION_ZERO_ID ? [this.threadId] : [this.threadId, sessionId];
    return this.sqlite.prepare(`SELECT e.id, e.thread_id AS threadId, e.wake_id AS wakeId, e.actor_kind AS actorKind,
      e.authority, e.content, e.created_at AS createdAt
      FROM events e LEFT JOIN wakes w ON w.id=e.wake_id
      WHERE e.thread_id=? AND ${where} AND e.event_kind='utterance' AND e.actor_kind IN ('user','resident')
      ${committedOnly ? "AND (e.wake_id IS NULL OR w.status='committed')" : ''}
      ORDER BY e.created_at, e.id`).all(...args);
  }

  priorSessionTail({ sessionId = this.session.id, ceiling }) {
    const active = this.sqlite.prepare('SELECT predecessor_session_id AS predecessorSessionId FROM sessions WHERE id=?').get(sessionId);
    let priorId = active?.predecessorSessionId || SESSION_ZERO_ID;
    let priorSession = this.sqlite.prepare('SELECT id, label, kind, predecessor_session_id AS predecessorSessionId FROM sessions WHERE id=?').get(priorId);
    let utterances = this.listSessionUtterances(priorId, { committedOnly: true });
    const visited = new Set([sessionId]);
    while (priorId !== SESSION_ZERO_ID && utterances.length === 0) {
      if (visited.has(priorId)) throw new Error('Session predecessor ancestry contains a cycle.');
      visited.add(priorId);
      priorId = priorSession?.predecessorSessionId || SESSION_ZERO_ID;
      priorSession = this.sqlite.prepare('SELECT id, label, kind, predecessor_session_id AS predecessorSessionId FROM sessions WHERE id=?').get(priorId);
      utterances = this.listSessionUtterances(priorId, { committedOnly: true });
    }
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
      this.appendScrollTraceManifest({ historyId, sessionId: session.id, wakeId, ordinal: historyOrdinal, messageKind: 'user', sourceEventId: eventId, scrubReceipt: null });
      this.sqlite.prepare('UPDATE sessions SET wake_status=? WHERE id=?').run('orienting', session.id);
      for (const item of [
        { ordinal: 1, itemKind: 'clinical_anchor', actorRole: 'system', content: STABLE_GLASS_TEXT, sourceDescription: 'Stable Glass v2', authority: 'host_receipt', included: true },
        { ordinal: 2, itemKind: 'utterance', actorRole: 'user', content, sourceEventId: eventId, sourceDescription: 'Current session human message', authority: 'ground', included: true },
      ]) {
        this.sqlite.prepare(`INSERT INTO wake_context_items
          (id, wake_id, ordinal, item_kind, actor_role, content, source_event_id, source_description, authority, included, omission_reason, content_hash)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(id('ctx'), wakeId, item.ordinal, item.itemKind, item.actorRole, item.content,
          item.sourceEventId || null, item.sourceDescription, item.authority, 1, null, sha256(item.content));
      }
    });
    return { wakeId, eventId, sessionId: session.id, turnOrdinal, context: [{ role: 'system', content: STABLE_GLASS_TEXT }, message] };
  }

  getSessionHistory(sessionId = this.session.id) {
    return this.sqlite.prepare(`SELECT id, session_id AS sessionId, wake_id AS wakeId, ordinal, message_json AS messageJson,
      role, message_kind AS messageKind, source_event_id AS sourceEventId, content_hash AS contentHash, scrub_receipt_id AS scrubReceiptId,
      raw_return_record_id AS rawReturnRecordId, source_record_hash AS sourceRecordHash, created_at AS createdAt
      FROM session_history WHERE session_id=? ORDER BY ordinal`).all(sessionId);
  }

  projectSessionHistoryMessage(row, { activeWakeId = null, materializeActiveToolReasoning = false, materializeMissingAsEmpty = false } = {}) {
    const message = JSON.parse(row.messageJson);
    if (message?.role !== 'assistant') return message;
    const rooted = this.roots.reasoningForHistory(row.id);
    delete message.reasoning_content;
    delete message.reasoning_ref;
    if (materializeActiveToolReasoning && row.wakeId === activeWakeId && row.messageKind === 'assistant_tool_call') {
      // DeepSeek requires the field on continued tool-call messages, but the
      // exact private deliberation is already retained once in Roots. An empty
      // carrier preserves protocol continuity without making the Resident
      // recursively reconsider every prior thought in the active chain.
      if (rooted || materializeMissingAsEmpty) message.reasoning_content = '';
    }
    return message;
  }

  appendSessionHistory({ sessionId = this.session.id, wakeId, message, messageKind, sourceEventId = null, traceSourceEventId = sourceEventId, returnScrub = null, hostReturnScrub = null }) {
    const history = this.getSessionHistory(sessionId);
    const ordinal = history.length + 1;
    let scrollMessage = structuredClone(message);
    if (['assistant_tool_call', 'resident'].includes(messageKind)) {
      if (!returnScrub) throw new Error('Provider assistant history requires a validated return Scrub result.');
      assertScrubbedProviderReturn(returnScrub);
      const reasoning = typeof message.reasoning_content === 'string' ? this.roots.recordReasoning(message.reasoning_content) : null;
      if (reasoning) {
        delete scrollMessage.reasoning_content;
        scrollMessage.reasoning_ref = { authority: 'Roots', artifactId: reasoning.artifactId, sha256: reasoning.reasoningHash, byteLength: reasoning.byteLength };
      }
    }
    if (messageKind === 'tool_result') {
      if (!hostReturnScrub) throw new Error('Host tool history requires a validated host-return Scrub result.');
      assertScrubbedHostReturn(hostReturnScrub);
    }
    const scrubReceipt = messageKind === 'tool_result' ? hostReturnScrub : returnScrub;
    const historyId = id('history');
    const raw = JSON.stringify(scrollMessage);
    const content = typeof scrollMessage.content === 'string' ? scrollMessage.content : raw;
    this.sqlite.prepare(`INSERT INTO session_history(id, session_id, wake_id, ordinal, message_json, role, message_kind, source_event_id, content_hash, created_at, scrub_receipt_id, raw_return_record_id, source_record_hash)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(historyId, sessionId, wakeId, ordinal, raw, scrollMessage.role, messageKind, sourceEventId, sha256(content), now(), scrubReceipt?.receipt?.receiptId || null, returnScrub?.receipt?.source?.spineRecordId || null, returnScrub?.receipt?.source?.recordHash || null);
    const reasoning = scrollMessage.reasoning_ref;
    if (reasoning) {
      this.roots.linkReasoning({ artifactId: reasoning.artifactId, relation: 'produced_scroll_row', targetAuthority: 'session_history', targetId: historyId, targetHash: sha256(raw) });
      this.roots.linkReasoning({ artifactId: reasoning.artifactId, relation: 'produced_during_wake', targetAuthority: 'wake', targetId: wakeId });
      this.roots.linkReasoning({ artifactId: reasoning.artifactId, relation: 'selected_from_return', targetAuthority: 'spine_record', targetId: returnScrub.receipt.source.spineRecordId, targetHash: returnScrub.receipt.source.recordHash || null });
      const request = this.sqlite.prepare('SELECT provider_request_id AS providerRequestId FROM return_scrub_receipts WHERE id=?').get(returnScrub.receipt.receiptId);
      if (request) this.roots.linkReasoning({ artifactId: reasoning.artifactId, relation: 'produced_by_request', targetAuthority: 'provider_request', targetId: request.providerRequestId });
    }
    this.appendScrollTraceManifest({ historyId, sessionId, wakeId, ordinal, messageKind, sourceEventId: traceSourceEventId, scrubReceipt, reasoningRoot: reasoning || null });
    return ordinal;
  }

  persistHostReturnScrub({ sessionId, wakeId, toolName, hostReturnScrub }) {
    assertScrubbedHostReturn(hostReturnScrub);
    if (hostReturnScrub.receipt.toolName !== toolName) throw new Error('Host return Scrub tool identity does not match its persistence boundary.');
    const receiptId = hostReturnScrub.receipt.receiptId;
    const receiptJson = JSON.stringify(hostReturnScrub.receipt);
    const resultJson = JSON.stringify(hostReturnScrub.result);
    const existing = this.sqlite.prepare('SELECT * FROM host_return_scrub_receipts WHERE id=?').get(receiptId);
    if (existing) {
      if (existing.session_id !== sessionId || existing.wake_id !== wakeId || existing.tool_name !== toolName || existing.receipt_json !== receiptJson || existing.result_json !== resultJson) throw new Error('Host return Scrub receipt identity conflicts with existing custody.');
      return existing;
    }
    this.sqlite.prepare(`INSERT INTO host_return_scrub_receipts(id, session_id, wake_id, tool_name, receipt_json, result_json, created_at)
      VALUES(?,?,?,?,?,?,?)`).run(receiptId, sessionId, wakeId, toolName, receiptJson, resultJson, now());
    return this.sqlite.prepare('SELECT * FROM host_return_scrub_receipts WHERE id=?').get(receiptId);
  }

  recordProviderRequest({ sessionId, wakeId, phase, requestBody, messageSources, spineRecordId, attention = null }) {
    const ordinal = this.sqlite.prepare('SELECT COUNT(*) AS count FROM provider_requests WHERE wake_id=?').get(wakeId).count + 1;
    const requestId = id('provider_request');
    this.sqlite.prepare(`INSERT INTO provider_requests(id, session_id, wake_id, phase, ordinal, request_body, message_sources_json, spine_record_id, attention_json, created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run(requestId, sessionId, wakeId, phase, ordinal, requestBody, JSON.stringify(messageSources), spineRecordId || null, attention ? JSON.stringify(attention) : null, now());
    return requestId;
  }

  recordAttentionReceipt({ sessionId, wakeId, phase, attention }) {
    if (!attention || !['ok', 'warn', 'refuse'].includes(attention.status)) throw new Error('Attention receipt status is invalid.');
    const receiptJson = JSON.stringify(attention);
    const receiptId = id('attention');
    this.sqlite.prepare('INSERT INTO attention_receipts(id,session_id,wake_id,phase,status,receipt_json,receipt_hash,created_at) VALUES(?,?,?,?,?,?,?,?)')
      .run(receiptId, sessionId, wakeId, phase, attention.status, receiptJson, sha256(receiptJson), now());
    return { receiptId, receiptHash: sha256(receiptJson), status: attention.status };
  }

  recordGlassCastReceipt({ sessionId, wakeId, providerRequestId, receipt }) {
    const request = this.sqlite.prepare(`SELECT p.session_id AS sessionId, p.wake_id AS wakeId, p.phase, p.request_body AS requestBody, p.spine_record_id AS spineRecordId,
      w.provider, w.requested_model AS requestedModel FROM provider_requests p JOIN wakes w ON w.id=p.wake_id WHERE p.id=?`).get(providerRequestId);
    let presentedMessagesJson = null;
    try { presentedMessagesJson = JSON.stringify(JSON.parse(request?.requestBody).messages); } catch {}
    if (!request || request.sessionId !== sessionId || request.wakeId !== wakeId || request.phase !== receipt?.phase || receipt?.schemaVersion !== 1 ||
      receipt.crossing?.sessionId !== sessionId || receipt.crossing?.wakeId !== wakeId || receipt.crossing?.provider !== request.provider || receipt.crossing?.requestedModel !== request.requestedModel ||
      request.spineRecordId !== receipt.spineRecordId || typeof receipt.spineRecordHash !== 'string' || !receipt.spineRecordHash ||
      Buffer.byteLength(request.requestBody, 'utf8') !== receipt.requestBodyUtf8Bytes || sha256(request.requestBody) !== receipt.requestBodySha256 ||
      !receipt.cast || receipt.cast.schemaVersion !== 1 || !Array.isArray(receipt.cast.bandOrder) || receipt.cast.bandOrder.join('|') !== 'glass|continuity_anchors|prior_horizon|capped_rolling_fold|living_edge' ||
      receipt.castSha256 !== sha256(canonicalize(receipt.cast)) || receipt.presentationScrubSha256 !== sha256(canonicalize(receipt.presentationScrub)) ||
      typeof presentedMessagesJson !== 'string' || Buffer.byteLength(presentedMessagesJson, 'utf8') !== receipt.presentedMessagesUtf8Bytes || sha256(presentedMessagesJson) !== receipt.presentedMessagesSha256) {
      throw Object.assign(new Error('Glass cast receipt does not match its provider request boundary.'), { code: 'glass_cast_invalid' });
    }
    const receiptJson = JSON.stringify(receipt);
    const receiptId = id('glass_cast');
    const receiptHash = sha256(receiptJson);
    this.sqlite.prepare(`INSERT INTO glass_cast_receipts(id,provider_request_id,session_id,wake_id,phase,schema_version,receipt_json,receipt_hash,cast_hash,presentation_scrub_hash,presented_messages_utf8_bytes,presented_messages_sha256,request_body_utf8_bytes,request_body_sha256,spine_record_id,spine_record_hash,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(receiptId, providerRequestId, sessionId, wakeId, receipt.phase, receipt.schemaVersion, receiptJson, receiptHash,
      receipt.castSha256, receipt.presentationScrubSha256, receipt.presentedMessagesUtf8Bytes, receipt.presentedMessagesSha256,
      receipt.requestBodyUtf8Bytes, receipt.requestBodySha256, receipt.spineRecordId, receipt.spineRecordHash, now());
    return { receiptId, receiptHash };
  }

  recordGlassGroundReceipts({ providerRequestId, witnesses }) {
    const epoch = this.getGlassTraceEpoch();
    if (!epoch) return {};
    const request = this.sqlite.prepare('SELECT session_id AS sessionId,wake_id AS wakeId,phase FROM provider_requests WHERE id=?').get(providerRequestId);
    if (!request || !witnesses || typeof witnesses !== 'object') throw Object.assign(new Error('Glass ground witnesses are invalid.'), { code: 'glass_trace_invalid' });
    const required = ['crossing_ground', 'world_current_ground', 'tool_mount', 'attention', 'continuity_ground'];
    const result = {};
    for (const kind of required) {
      const witness = witnesses[kind];
      if (!witness || witness.sessionId !== request.sessionId || witness.wakeId !== request.wakeId || witness.phase !== request.phase) throw Object.assign(new Error(`Glass ${kind} witness is missing or crosses another request.`), { code: 'glass_trace_invalid' });
      const receipt = { schemaVersion: 1, kind, providerRequestId, ...witness };
      const receiptJson = canonicalize(receipt); const receiptId = id('glass_ground'); const receiptHash = sha256(receiptJson);
      this.sqlite.prepare(`INSERT INTO glass_ground_receipts(id,epoch_id,provider_request_id,kind,schema_version,receipt_json,receipt_hash,created_at)
        VALUES(?,?,?,?,1,?,?,?)`).run(receiptId, epoch.id, providerRequestId, kind, receiptJson, receiptHash, now());
      result[kind] = { receiptId, receiptHash, receipt };
    }
    return result;
  }

  recordGlassTraceManifest({ providerRequestId, glassCastReceiptId, sourceRefs, presentationReceipt, groundReceipts }) {
    const epoch = this.getGlassTraceEpoch();
    if (!epoch) return null;
    const request = this.sqlite.prepare('SELECT session_id AS sessionId,wake_id AS wakeId,phase,request_body AS requestBody FROM provider_requests WHERE id=?').get(providerRequestId);
    const cast = this.sqlite.prepare('SELECT receipt_hash AS receiptHash FROM glass_cast_receipts WHERE id=? AND provider_request_id=?').get(glassCastReceiptId, providerRequestId);
    if (!request || !cast || !Array.isArray(sourceRefs) || !presentationReceipt || !groundReceipts) throw Object.assign(new Error('Glass trace inputs are incomplete.'), { code: 'glass_trace_invalid' });
    const omitted = new Map((presentationReceipt.omissions || []).filter(item => item.omitMessage).map(item => [item.sourceIndex, item]));
    let presentedOrdinal = 0;
    const groundKind = kind => kind === 'crossing_ground' ? 'crossing_ground' : kind === 'world_current_ground' ? 'world_current_ground' : kind === 'tool_current_ground' ? 'tool_mount' : kind === 'attention_current_ground' ? 'attention' : null;
    const items = sourceRefs.map((ref, sourceIndex) => {
      const omission = omitted.get(sourceIndex);
      if (!omission) presentedOrdinal += 1;
      let source;
      if (ref.kind === 'stable_glass') source = { authority: 'code_owned_glass', version: 2, contentHash: sha256(ref.message.content) };
      else if (ref.historyId) source = { authority: 'Session Scroll', historyId: ref.historyId, sessionId: ref.historySessionId, ordinal: ref.historyOrdinal, sourceEventId: ref.sourceEventId || null, messageHash: ref.historyMessageHash };
      else if (ref.sourceEventId || ref.glassSourceEventId) source = { authority: 'Source', eventId: ref.sourceEventId || ref.glassSourceEventId, contentHash: ref.sourceContentHash || null };
      else {
        const receipt = groundReceipts[groundKind(ref.kind) || (['clinical_wake_anchor', 'prior_horizon'].includes(ref.kind) ? 'continuity_ground' : 'attention')];
        if (!receipt) throw Object.assign(new Error(`Glass source ${sourceIndex} has no resolvable witness.`), { code: 'glass_trace_invalid' });
        source = { authority: 'glass_ground_receipt', kind: receipt.receipt.kind, receiptId: receipt.receiptId, receiptHash: receipt.receiptHash };
      }
      return {
        sourceIndex, sourceOrdinal: sourceIndex + 1, kind: ref.kind, authority: ref.authority,
        messageRole: ref.message.role, messageHash: sha256(JSON.stringify(ref.message)), source,
        disposition: omission ? { kind: 'omitted', reason: omission.reason } : { kind: 'presented', presentedOrdinal },
      };
    });
    let requestMessages;
    try { requestMessages = JSON.parse(request.requestBody).messages; } catch {}
    if (!Array.isArray(requestMessages) || requestMessages.length !== items.filter(item => item.disposition.kind === 'presented').length) throw Object.assign(new Error('Glass trace does not close over the exact provider messages.'), { code: 'glass_trace_invalid' });
    const manifest = { schemaVersion: 1, epochId: epoch.id, providerRequestId, glassCastReceiptId, glassCastReceiptHash: cast.receiptHash,
      crossing: { sessionId: request.sessionId, wakeId: request.wakeId, phase: request.phase }, items,
      terminal: { authority: 'Spine provider request', requestBodyHash: sha256(request.requestBody) } };
    const manifestJson = canonicalize(manifest); const manifestId = id('glass_trace'); const manifestHash = sha256(manifestJson);
    this.sqlite.prepare(`INSERT INTO glass_trace_manifests(id,epoch_id,glass_cast_receipt_id,provider_request_id,schema_version,manifest_json,manifest_hash,created_at)
      VALUES(?,?,?,?,1,?,?,?)`).run(manifestId, epoch.id, glassCastReceiptId, providerRequestId, manifestJson, manifestHash, now());
    if (sourceRefs.some(ref => ref.kind === 'hearth_return')) this.roots.linkWakePacketToGlass({ wakeId: request.wakeId, glassCastReceiptId, glassCastReceiptHash: cast.receiptHash });
    return { manifestId, manifestHash, manifest };
  }

  getSessionGlassInheritance(sessionId = this.session.id) {
    const row = this.sqlite.prepare(`SELECT return_json AS returnJson FROM hearth_receipts WHERE session_id=? ORDER BY created_at,id LIMIT 1`).get(sessionId);
    if (!row) return null;
    let receipt;
    try { receipt = JSON.parse(row.returnJson); } catch { return null; }
    if (receipt?.kind !== 'glass_wake_inheritance' || receipt?.schemaVersion !== 1 || receipt?.wakeAnchor?.text === undefined || !Array.isArray(receipt.atoms) || !receipt.priorHorizon) return null;
    return { wakeAnchor: receipt.wakeAnchor, atoms: receipt.atoms, priorHorizon: receipt.priorHorizon };
  }

  completeProviderRequest(requestId, result, outcome = null, returnScrub = null) {
    if (returnScrub) assertScrubbedProviderReturn(returnScrub);
    const receiptId = returnScrub?.receipt?.receiptId || null;
    this.transaction(() => {
      this.sqlite.prepare(`UPDATE provider_requests SET response_message_json=?, response_id=?, finish_reason=?, outcome_json=?, raw_return_record_id=?, raw_return_byte_length=?, raw_return_sha256=?, return_scrub_receipt_id=?, return_scrub_receipt_json=?, completed_at=? WHERE id=?`).run(
        result?.message ? JSON.stringify(result.message) : null, result?.responseId || null, result?.finishReason || null, outcome ? JSON.stringify(outcome) : null,
        returnScrub?.receipt?.source?.spineRecordId || result?.rawReturnFrame?.record_id || null, returnScrub?.receipt?.source?.byteLength || result?.rawReturnFrame?.body_byte_length || null,
        returnScrub?.receipt?.source?.sha256 || result?.rawReturnFrame?.body_sha256 || null, receiptId, returnScrub ? JSON.stringify(returnScrub.receipt) : null, now(), requestId);
      if (returnScrub) this.sqlite.prepare(`INSERT INTO return_scrub_receipts(id, provider_request_id, spine_record_id, receipt_json, message_json, created_at) VALUES(?,?,?,?,?,?)`).run(receiptId, requestId, returnScrub.receipt.source.spineRecordId, JSON.stringify(returnScrub.receipt), JSON.stringify(returnScrub.message), now());
    });
  }

  recordHearthAction({ wakeId, sessionId, message, returnScrub }) {
    const eventId = id('event');
    const raw = JSON.stringify(message);
    this.transaction(() => {
      this.sqlite.prepare(`INSERT INTO events(id, thread_id, session_id, wake_id, actor_kind, event_kind, content, authority, provider, model, created_at)
        SELECT ?, thread_id, ?, ?, 'resident', 'state', ?, 'model_signed', provider, requested_model, ? FROM wakes WHERE id=?`).run(eventId, sessionId, wakeId, raw, now(), wakeId);
      this.appendSessionHistory({ sessionId, wakeId, message, messageKind: 'assistant_tool_call', sourceEventId: null, returnScrub });
    });
    return eventId;
  }

  recordHearthReturn({ wakeId, sessionId, toolCallId, returnValue, scrollMarkdown, scrollHash, actionEventId, returnHash, hostReturnScrub = null }) {
    const eventId = id('event');
    const message = { role: 'tool', tool_call_id: toolCallId, content: scrollMarkdown };
    if (!hostReturnScrub) throw new Error('Hearth return requires a validated host-return Scrub result.');
    if (JSON.stringify(hostReturnScrub.message) !== JSON.stringify(message)) throw new Error('Hearth host-return Scrub does not match the exact resident-facing tool result.');
    const hearthReceiptId = id('hearth'); let rootArtifactId = null;
    this.transaction(() => {
      this.sqlite.prepare(`INSERT INTO events(id, thread_id, session_id, wake_id, actor_kind, event_kind, content, authority, provider, model, created_at)
        SELECT ?, thread_id, ?, ?, 'host', 'state', ?, 'host_receipt', provider, requested_model, ? FROM wakes WHERE id=?`).run(eventId, sessionId, wakeId, message.content, now(), wakeId);
      this.appendSessionHistory({ sessionId, wakeId, message, messageKind: 'tool_result', traceSourceEventId: eventId, hostReturnScrub });
      this.persistHostReturnScrub({ sessionId, wakeId, toolName: 'tend_hearth', hostReturnScrub });
      this.sqlite.prepare(`INSERT INTO hearth_receipts(id, session_id, wake_id, tool_call_id, return_json, return_hash, scroll_markdown, scroll_hash, action_event_id, return_event_id, created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(hearthReceiptId, sessionId, wakeId, toolCallId, JSON.stringify(returnValue), returnHash, scrollMarkdown, scrollHash, actionEventId, eventId, now());
      rootArtifactId = this.roots.recordWakePacket({ sessionId, wakeId, hearthReceiptId, packet: returnValue, markdown: scrollMarkdown, markdownHash: scrollHash }).artifactId;
    });
    return { eventId, message, hearthReceiptId, rootArtifactId };
  }

  recordToolCall({ wakeId, sessionId, message, returnScrub }) {
    const eventId = id('event');
    this.transaction(() => {
      this.sqlite.prepare(`INSERT INTO events(id, thread_id, session_id, wake_id, actor_kind, event_kind, content, authority, provider, model, created_at)
        SELECT ?, thread_id, ?, ?, 'resident', 'state', ?, 'model_signed', provider, requested_model, ? FROM wakes WHERE id=?`).run(eventId, sessionId, wakeId, JSON.stringify(message), now(), wakeId);
      this.appendSessionHistory({ sessionId, wakeId, message, messageKind: 'assistant_tool_call', returnScrub });
    });
    return eventId;
  }

  recordToolResult({ wakeId, sessionId, toolName, result, hostReturnScrub }) {
    assertScrubbedHostReturn(hostReturnScrub);
    const eventId = id('event'); const message = hostReturnScrub.message;
    this.transaction(() => {
      this.sqlite.prepare(`INSERT INTO events(id, thread_id, session_id, wake_id, actor_kind, event_kind, content, authority, provider, model, created_at)
        SELECT ?, thread_id, ?, ?, 'host', 'state', ?, 'host_receipt', provider, requested_model, ? FROM wakes WHERE id=?`).run(eventId, sessionId, wakeId, message.content, now(), wakeId);
      this.appendSessionHistory({ sessionId, wakeId, message, messageKind: 'tool_result', traceSourceEventId: eventId, hostReturnScrub });
      this.persistHostReturnScrub({ sessionId, wakeId, toolName, hostReturnScrub });
    });
    return eventId;
  }

  commitSessionWake(wakeId, response) {
    const eventId = id('event');
    const wake = this.sqlite.prepare('SELECT thread_id AS threadId, session_id AS sessionId, provider, requested_model AS requestedModel FROM wakes WHERE id=?').get(wakeId);
    this.transaction(() => {
      this.sqlite.prepare(`INSERT INTO events(id, thread_id, session_id, wake_id, actor_kind, event_kind, content, authority, provider, model, created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(eventId, wake.threadId, wake.sessionId, wakeId, 'resident', 'utterance', response.content, 'model_signed', wake.provider, response.resolvedModel || wake.requestedModel, now());
      this.appendSessionHistory({ sessionId: wake.sessionId, wakeId, message: response.message || { role: 'assistant', content: response.content }, messageKind: 'resident', sourceEventId: eventId, returnScrub: response.returnScrub });
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
    normalized.phases = this.sqlite.prepare(`SELECT id, phase, ordinal, request_body AS requestBody, message_sources_json AS messageSources, attention_json AS attention,
      spine_record_id AS spineRecordId, raw_return_record_id AS rawReturnRecordId, raw_return_byte_length AS rawReturnByteLength, raw_return_sha256 AS rawReturnSha256,
      return_scrub_receipt_id AS returnScrubReceiptId, return_scrub_receipt_json AS returnScrubReceiptJson, response_message_json AS responseMessage, response_id AS responseId, finish_reason AS finishReason,
      outcome_json AS outcome, created_at AS createdAt, completed_at AS completedAt FROM provider_requests WHERE wake_id=? ORDER BY ordinal`).all(wakeId).map(phase => ({
      ...phase,
      messageSources: JSON.parse(phase.messageSources),
      attention: phase.attention ? JSON.parse(phase.attention) : null,
      responseMessage: phase.responseMessage ? JSON.parse(phase.responseMessage) : null,
      outcome: phase.outcome ? JSON.parse(phase.outcome) : null,
      returnScrubReceipt: phase.returnScrubReceiptJson ? JSON.parse(phase.returnScrubReceiptJson) : null,
    }));
    const glassCasts = this.sqlite.prepare(`SELECT id AS receiptId, provider_request_id AS providerRequestId, phase, receipt_json AS receiptJson, receipt_hash AS receiptHash, created_at AS createdAt
      FROM glass_cast_receipts WHERE wake_id=? ORDER BY created_at,id`).all(wakeId).map(row => ({ ...row, receipt: JSON.parse(row.receiptJson) }));
    const glassByRequest = new Map(glassCasts.map(item => [item.providerRequestId, item]));
    const glassTraces = this.sqlite.prepare(`SELECT provider_request_id AS providerRequestId,id AS manifestId,manifest_json AS manifestJson,manifest_hash AS manifestHash,created_at AS createdAt
      FROM glass_trace_manifests WHERE provider_request_id IN (SELECT id FROM provider_requests WHERE wake_id=?) ORDER BY created_at,id`).all(wakeId)
      .map(row => ({ ...row, manifest: JSON.parse(row.manifestJson) }));
    const traceByRequest = new Map(glassTraces.map(item => [item.providerRequestId, item]));
    const groundReceipts = this.sqlite.prepare(`SELECT provider_request_id AS providerRequestId,id AS receiptId,kind,receipt_json AS receiptJson,receipt_hash AS receiptHash,created_at AS createdAt
      FROM glass_ground_receipts WHERE provider_request_id IN (SELECT id FROM provider_requests WHERE wake_id=?) ORDER BY created_at,id`).all(wakeId)
      .map(row => ({ ...row, receipt: JSON.parse(row.receiptJson) }));
    normalized.phases = normalized.phases.map(phase => ({ ...phase, glassCast: glassByRequest.get(phase.id) || null, glassTrace: traceByRequest.get(phase.id) || null,
      glassGroundReceipts: groundReceipts.filter(item => item.providerRequestId === phase.id) }));
    normalized.glassCasts = glassCasts;
    normalized.glassTraces = glassTraces;
    normalized.attentionReceipts = this.sqlite.prepare('SELECT id, phase, status, receipt_json AS receiptJson, receipt_hash AS receiptHash, created_at AS createdAt FROM attention_receipts WHERE wake_id=? ORDER BY created_at,id').all(wakeId)
      .map(receipt => ({ ...receipt, receipt: JSON.parse(receipt.receiptJson) }));
    normalized.hearth = this.sqlite.prepare(`SELECT tool_call_id AS toolCallId, return_json AS returnJson, return_hash AS returnHash, scroll_markdown AS scrollMarkdown, scroll_hash AS scrollHash,
      action_event_id AS actionEventId, return_event_id AS returnEventId FROM hearth_receipts WHERE wake_id=?`).get(wakeId) || null;
    normalized.roots = this.roots.inspectWake(wakeId);
    return normalized;
  }

  getWakeSlipSource(wakeId) {
    const wake = this.sqlite.prepare(`SELECT id,status,session_id AS sessionId,started_at AS startedAt,completed_at AS completedAt
      FROM wakes WHERE id=?`).get(wakeId);
    if (!wake) return null;
    const phases = this.sqlite.prepare(`SELECT id,phase,response_message_json AS responseMessage,created_at AS createdAt,completed_at AS completedAt
      FROM provider_requests WHERE wake_id=? ORDER BY ordinal`).all(wakeId).map(phase => ({
        ...phase,
        responseMessage: phase.responseMessage ? JSON.parse(phase.responseMessage) : null,
      }));
    return { ...wake, phases };
  }

  getWakeCompletion(wakeId) {
    return rowToObject(this.sqlite.prepare(`SELECT id,status,session_id AS sessionId,turn_ordinal AS turnOrdinal,
      failure_code AS failureCode,failure_message AS failureMessage,custody_failure_code AS custodyFailureCode,
      custody_failure_message AS custodyFailureMessage,started_at AS startedAt,completed_at AS completedAt
      FROM wakes WHERE id=?`).get(wakeId));
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

  getActiveThreadProjection() {
    const thread = this.sqlite.prepare('SELECT id, created_at AS createdAt, label FROM threads WHERE id=?').get(this.threadId);
    const session = this.getActiveSession();
    const events = this.sqlite.prepare('SELECT id, session_id AS sessionId, wake_id AS wakeId, actor_kind AS actorKind, event_kind AS eventKind, content, authority, provider, model, created_at AS createdAt FROM events WHERE thread_id=? AND session_id=? ORDER BY created_at, id').all(this.threadId, session.id);
    const wakes = this.sqlite.prepare('SELECT id, session_id AS sessionId, turn_ordinal AS turnOrdinal, status, provider, requested_model AS requestedModel, resolved_model AS resolvedModel, failure_code AS failureCode, failure_message AS failureMessage, custody_failure_code AS custodyFailureCode, custody_failure_message AS custodyFailureMessage, started_at AS startedAt, completed_at AS completedAt FROM wakes WHERE thread_id=? AND session_id=? ORDER BY started_at, id').all(this.threadId, session.id);
    return { thread: rowToObject(thread), session, sessions: this.listSessions(), events, wakes, projectionScope: 'active_session' };
  }

  close() { this.sqlite.close(); }
}
