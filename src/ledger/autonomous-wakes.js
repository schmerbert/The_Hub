import { canonicalize, id, sha256 } from '../core/hash.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS autonomous_wake_plans (
  plan_id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), created_wake_id TEXT REFERENCES wakes(id),
  origin TEXT NOT NULL CHECK(origin='self_directed'), due_at TEXT NOT NULL, intention TEXT,
  seat_json TEXT NOT NULL, seat_hash TEXT NOT NULL CHECK(length(seat_hash)=64), created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS autonomous_wake_plans_due ON autonomous_wake_plans(due_at,created_at,plan_id);
CREATE TABLE IF NOT EXISTS autonomous_wake_events (
  event_id TEXT PRIMARY KEY, plan_id TEXT NOT NULL REFERENCES autonomous_wake_plans(plan_id),
  ordinal INTEGER NOT NULL CHECK(ordinal>0), event_kind TEXT NOT NULL CHECK(event_kind IN ('scheduled','cancelled','claimed','completed','failed')),
  wake_id TEXT REFERENCES wakes(id), detail_json TEXT NOT NULL, detail_hash TEXT NOT NULL CHECK(length(detail_hash)=64), created_at TEXT NOT NULL,
  UNIQUE(plan_id,ordinal)
);
CREATE INDEX IF NOT EXISTS autonomous_wake_events_plan ON autonomous_wake_events(plan_id,ordinal);
CREATE TABLE IF NOT EXISTS wake_origin_receipts (
  wake_id TEXT PRIMARY KEY REFERENCES wakes(id), origin TEXT NOT NULL CHECK(origin IN ('human_present','self_directed')),
  plan_id TEXT REFERENCES autonomous_wake_plans(plan_id), trigger_event_id TEXT NOT NULL REFERENCES events(id),
  seat_json TEXT, seat_hash TEXT, created_at TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS autonomous_wake_plans_append_only_update BEFORE UPDATE ON autonomous_wake_plans BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TRIGGER IF NOT EXISTS autonomous_wake_plans_append_only_delete BEFORE DELETE ON autonomous_wake_plans BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TRIGGER IF NOT EXISTS autonomous_wake_events_append_only_update BEFORE UPDATE ON autonomous_wake_events BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TRIGGER IF NOT EXISTS autonomous_wake_events_append_only_delete BEFORE DELETE ON autonomous_wake_events BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TRIGGER IF NOT EXISTS wake_origin_receipts_append_only_update BEFORE UPDATE ON wake_origin_receipts BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TRIGGER IF NOT EXISTS wake_origin_receipts_append_only_delete BEFORE DELETE ON wake_origin_receipts BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
`;

function now() { return new Date().toISOString(); }
function fail(code, message) { throw Object.assign(new Error(message), { code }); }
function parse(value, fallback = null) { try { return JSON.parse(value); } catch { return fallback; } }

export class AutonomousWakeLedger {
  constructor(sqlite) { this.sqlite = sqlite; sqlite.exec(SCHEMA); }
  append(planId, eventKind, { wakeId = null, detail = {} } = {}) {
    const ordinal = this.sqlite.prepare('SELECT COUNT(*) AS count FROM autonomous_wake_events WHERE plan_id=?').get(planId).count + 1;
    const detailJson = canonicalize(detail); const eventId = id('autonomous_wake');
    this.sqlite.prepare(`INSERT INTO autonomous_wake_events(event_id,plan_id,ordinal,event_kind,wake_id,detail_json,detail_hash,created_at) VALUES(?,?,?,?,?,?,?,?)`)
      .run(eventId, planId, ordinal, eventKind, wakeId, detailJson, sha256(detailJson), now());
    return { eventId, planId, ordinal, eventKind, wakeId, detail, detailHash: sha256(detailJson) };
  }
  schedule({ sessionId, createdWakeId = null, dueAt, intention = null, seat }) {
    if (!sessionId || !/^\d{4}-\d\d-\d\dT/.test(dueAt || '') || !seat || typeof seat !== 'object') fail('autonomous_wake_invalid', 'Autonomous wake plan coordinates are invalid.');
    if (intention !== null && (typeof intention !== 'string' || intention.length > 1000)) fail('autonomous_wake_invalid', 'Autonomous wake intention must be at most 1000 characters.');
    const seatJson = canonicalize(seat); const planId = id('wake_plan'); const createdAt = now();
    this.sqlite.exec('BEGIN IMMEDIATE');
    try {
      const pending = this.pending(sessionId);
      if (pending) this.append(pending.planId, 'cancelled', { detail: { reason: 'replaced_by_later_rest' } });
      this.sqlite.prepare(`INSERT INTO autonomous_wake_plans(plan_id,session_id,created_wake_id,origin,due_at,intention,seat_json,seat_hash,created_at) VALUES(?,?,?,'self_directed',?,?,?,?,?)`)
        .run(planId, sessionId, createdWakeId, dueAt, intention, seatJson, sha256(seatJson), createdAt);
      const event = this.append(planId, 'scheduled', { detail: { dueAt } });
      this.sqlite.exec('COMMIT');
      return { planId, sessionId, origin: 'self_directed', dueAt, intention, seat: structuredClone(seat), seatHash: sha256(seatJson), eventId: event.eventId };
    } catch (error) { try { this.sqlite.exec('ROLLBACK'); } catch {} throw error; }
  }
  projection(row) {
    if (!row) return null;
    const terminal = this.sqlite.prepare('SELECT * FROM autonomous_wake_events WHERE plan_id=? ORDER BY ordinal DESC LIMIT 1').get(row.plan_id);
    return { planId: row.plan_id, sessionId: row.session_id, createdWakeId: row.created_wake_id || null, origin: row.origin, dueAt: row.due_at, intention: row.intention || null, seat: parse(row.seat_json), seatHash: row.seat_hash, createdAt: row.created_at, status: terminal?.event_kind || 'unknown', wakeId: terminal?.wake_id || null, lastEventId: terminal?.event_id || null };
  }
  pending(sessionId = null) {
    const rows = this.sqlite.prepare(`SELECT p.* FROM autonomous_wake_plans p WHERE (? IS NULL OR p.session_id=?) ORDER BY p.due_at,p.created_at,p.plan_id`).all(sessionId, sessionId);
    return rows.map(row => this.projection(row)).find(plan => plan.status === 'scheduled') || null;
  }
  recent(sessionId, limit = 10) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) fail('autonomous_wake_invalid', 'Autonomous wake history limit is invalid.');
    return this.sqlite.prepare('SELECT * FROM autonomous_wake_plans WHERE session_id=? ORDER BY created_at DESC,plan_id DESC LIMIT ?').all(sessionId, limit).map(row => this.projection(row));
  }
  claim(planId) {
    const plan = this.projection(this.sqlite.prepare('SELECT * FROM autonomous_wake_plans WHERE plan_id=?').get(planId));
    if (!plan || plan.status !== 'scheduled') return null;
    return this.append(planId, 'claimed', { detail: { dueAt: plan.dueAt } });
  }
  settle(planId, wakeId, outcome, detail = {}) {
    if (!['completed', 'failed'].includes(outcome)) fail('autonomous_wake_invalid', 'Autonomous wake settlement is invalid.');
    const current = this.projection(this.sqlite.prepare('SELECT * FROM autonomous_wake_plans WHERE plan_id=?').get(planId));
    if (!current || current.status !== 'claimed') fail('autonomous_wake_settlement_invalid', 'Only a claimed autonomous wake may settle.');
    return this.append(planId, outcome, { wakeId, detail });
  }
  recordOrigin({ wakeId, origin, planId = null, triggerEventId, seat = null }) {
    const seatJson = seat ? canonicalize(seat) : null;
    this.sqlite.prepare(`INSERT INTO wake_origin_receipts(wake_id,origin,plan_id,trigger_event_id,seat_json,seat_hash,created_at) VALUES(?,?,?,?,?,?,?)`)
      .run(wakeId, origin, planId, triggerEventId, seatJson, seatJson ? sha256(seatJson) : null, now());
  }
  origin(wakeId) {
    const row = this.sqlite.prepare('SELECT * FROM wake_origin_receipts WHERE wake_id=?').get(wakeId);
    return row ? { wakeId: row.wake_id, origin: row.origin, planId: row.plan_id || null, triggerEventId: row.trigger_event_id, seat: parse(row.seat_json), seatHash: row.seat_hash || null, createdAt: row.created_at } : null;
  }
  verify() {
    const mismatches = [];
    for (const table of ['autonomous_wake_plans','autonomous_wake_events','wake_origin_receipts']) for (const action of ['update','delete']) {
      if (!this.sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='trigger' AND name=?").get(`${table}_append_only_${action}`)) mismatches.push({ code: 'autonomous_wake_trigger_missing', table, action });
    }
    for (const row of this.sqlite.prepare('SELECT plan_id,seat_json,seat_hash FROM autonomous_wake_plans').all()) if (sha256(row.seat_json) !== row.seat_hash) mismatches.push({ code: 'autonomous_wake_seat_hash_mismatch', planId: row.plan_id });
    for (const row of this.sqlite.prepare('SELECT event_id,detail_json,detail_hash FROM autonomous_wake_events').all()) if (sha256(row.detail_json) !== row.detail_hash) mismatches.push({ code: 'autonomous_wake_event_hash_mismatch', eventId: row.event_id });
    for (const row of this.sqlite.prepare('SELECT wake_id,seat_json,seat_hash FROM wake_origin_receipts WHERE seat_json IS NOT NULL').all()) if (sha256(row.seat_json) !== row.seat_hash) mismatches.push({ code: 'autonomous_wake_origin_seat_hash_mismatch', wakeId: row.wake_id });
    return { verified: mismatches.length === 0, mismatches };
  }
}
