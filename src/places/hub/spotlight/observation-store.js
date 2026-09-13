import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { admitSpotlightObservation } from './observation.js';
import { canonicalStringify, deepFreeze, isPlainObject, sha256 } from './canonical.js';

export const SPOTLIGHT_OBSERVATION_STORE_API = 'spotlight-observation-store.v1';
export const SPOTLIGHT_OBSERVATION_STORE_SCHEMA = 'spotlight_live_read';

const MAX_PATH_BYTES = 4_096;
const HASH = /^[a-f0-9]{64}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/#-]{0,255}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:?\d{2})$/;
const SAFE_CODE = /^[a-z][a-z0-9_.:-]{0,79}$/;
const TABLES = Object.freeze([
  'spotlight_metadata', 'spotlight_events', 'spotlight_attempts',
  'spotlight_settlements', 'spotlight_observations',
]);
const TRIGGERS = Object.freeze([
  'spotlight_events_append_only_update', 'spotlight_events_append_only_delete',
  'spotlight_attempts_append_only_update', 'spotlight_attempts_append_only_delete',
  'spotlight_settlements_append_only_update', 'spotlight_settlements_append_only_delete',
  'spotlight_observations_append_only_update', 'spotlight_observations_append_only_delete',
]);
const COLUMN_SHAPES = Object.freeze({
  spotlight_metadata: Object.freeze(['singleton', 'schema_name', 'schema_version', 'created_at']),
  spotlight_events: Object.freeze(['sequence', 'event_id', 'event_type', 'entity_id', 'payload_json', 'payload_hash', 'previous_event_hash', 'event_hash', 'created_at']),
  spotlight_attempts: Object.freeze(['attempt_id', 'request_key', 'session_id', 'wake_id', 'command_id', 'tool_name', 'operation', 'instrument_id', 'request_json', 'request_hash', 'event_sequence', 'created_at']),
  spotlight_observations: Object.freeze(['observation_id', 'instrument_id', 'observation_json', 'payload_hash', 'source_receipt_hash', 'event_sequence', 'created_at']),
  spotlight_settlements: Object.freeze(['settlement_id', 'attempt_id', 'status', 'observation_id', 'settlement_json', 'settlement_hash', 'event_sequence', 'created_at']),
});
const SCHEMA_SQL = `
CREATE TABLE spotlight_metadata (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1),
  schema_name TEXT NOT NULL,
  schema_version INTEGER NOT NULL CHECK(schema_version=1),
  created_at TEXT NOT NULL
);
CREATE TABLE spotlight_events (
  sequence INTEGER PRIMARY KEY CHECK(sequence>0),
  event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL CHECK(event_type IN ('attempt','observation','settlement')),
  entity_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  payload_hash TEXT NOT NULL CHECK(length(payload_hash)=64),
  previous_event_hash TEXT,
  event_hash TEXT NOT NULL CHECK(length(event_hash)=64),
  created_at TEXT NOT NULL
);
CREATE TABLE spotlight_attempts (
  attempt_id TEXT PRIMARY KEY,
  request_key TEXT NOT NULL UNIQUE,
  session_id TEXT NOT NULL,
  wake_id TEXT NOT NULL,
  command_id TEXT NOT NULL,
  tool_name TEXT NOT NULL CHECK(tool_name='spotlight_observe'),
  operation TEXT NOT NULL CHECK(operation IN ('accounts','portfolio','equity_positions','crypto_positions','equity_quote','crypto_quote')),
  instrument_id TEXT NOT NULL,
  request_json TEXT NOT NULL,
  request_hash TEXT NOT NULL CHECK(length(request_hash)=64),
  event_sequence INTEGER NOT NULL UNIQUE REFERENCES spotlight_events(sequence),
  created_at TEXT NOT NULL
);
CREATE TABLE spotlight_observations (
  observation_id TEXT PRIMARY KEY,
  instrument_id TEXT NOT NULL,
  observation_json TEXT NOT NULL,
  payload_hash TEXT NOT NULL CHECK(length(payload_hash)=64),
  source_receipt_hash TEXT NOT NULL CHECK(length(source_receipt_hash)=64),
  event_sequence INTEGER NOT NULL UNIQUE REFERENCES spotlight_events(sequence),
  created_at TEXT NOT NULL
);
CREATE TABLE spotlight_settlements (
  settlement_id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL UNIQUE REFERENCES spotlight_attempts(attempt_id),
  status TEXT NOT NULL CHECK(status IN ('succeeded','failed')),
  observation_id TEXT REFERENCES spotlight_observations(observation_id),
  settlement_json TEXT NOT NULL,
  settlement_hash TEXT NOT NULL CHECK(length(settlement_hash)=64),
  event_sequence INTEGER NOT NULL UNIQUE REFERENCES spotlight_events(sequence),
  created_at TEXT NOT NULL
);
${[...TRIGGERS].map(name => {
  const table = name.replace('spotlight_', '').replace('_append_only_update', '').replace('_append_only_delete', '');
  const actual = table === 'events' ? 'spotlight_events' : `spotlight_${table}`;
  const operation = name.endsWith('_update') ? 'UPDATE' : 'DELETE';
  return `CREATE TRIGGER ${name} BEFORE ${operation} ON ${actual} BEGIN SELECT RAISE(ABORT, 'append-only table'); END;`;
}).join('\n')}
`;
const EVENT_TYPES = new Set(['attempt', 'observation', 'settlement']);
const OPERATIONS = new Set(['accounts', 'portfolio', 'equity_positions', 'crypto_positions', 'equity_quote', 'crypto_quote']);

function now() { return new Date().toISOString(); }
function fail(code, message) { throw Object.assign(new Error(message), { code }); }
function safeText(value, name, max = 256) {
  if (typeof value !== 'string' || !value || Buffer.byteLength(value, 'utf8') > max) fail('spotlight_store_invalid_argument', `${name} is invalid.`);
  return value;
}
function safeId(value, name) {
  const text = safeText(value, name);
  if (!SAFE_ID.test(text)) fail('spotlight_store_invalid_argument', `${name} is invalid.`);
  return text;
}
function safeCode(value) {
  return typeof value === 'string' && SAFE_CODE.test(value) ? value : 'spotlight_source_failed';
}
function safeMessage(value) {
  if (typeof value !== 'string' || !value || Buffer.byteLength(value, 'utf8') > 256) return 'Spotlight source read failed.';
  return 'Spotlight source read failed.';
}
function countOf(value, name, fallback) {
  const selected = value === undefined ? fallback : value;
  if (!Number.isSafeInteger(selected) || selected < 1) fail('spotlight_store_invalid_limit', `${name} is invalid.`);
  return selected;
}
function transaction(sqlite, fn) {
  sqlite.exec('BEGIN IMMEDIATE');
  try {
    const value = fn();
    sqlite.exec('COMMIT');
    return value;
  } catch (error) {
    try { sqlite.exec('ROLLBACK'); } catch {}
    throw error;
  }
}
function withoutSourceReceipt(observation) {
  const value = structuredClone(observation);
  delete value.sourceReceipt;
  delete value.apiVersion;
  return value;
}
function observationPayloadHash(observation) { return sha256(observation); }
function sourceReceiptOf(observation) {
  const receipt = observation?.sourceReceipt;
  if (!isPlainObject(receipt) || Object.keys(receipt).length !== 3 || typeof receipt.hash !== 'string' || !HASH.test(receipt.hash)
    || !['canonical_payload', 'exact_source_bytes'].includes(receipt.hashBasis)
    || !Number.isSafeInteger(receipt.byteLength) || receipt.byteLength < 1 || receipt.byteLength > 256_000) {
    fail('spotlight_store_source_receipt_invalid', 'Observation source receipt is invalid.');
  }
  if (receipt.hashBasis === 'canonical_payload') {
    const expected = sha256(withoutSourceReceipt(observation));
    if (receipt.hash !== expected || receipt.byteLength !== Buffer.byteLength(canonicalStringify(withoutSourceReceipt(observation)), 'utf8')) {
      fail('spotlight_store_source_receipt_invalid', 'Observation source receipt does not match its payload.');
    }
  }
  return receipt;
}
function normalizeStoredObservation(input) {
  if (!isPlainObject(input)) fail('spotlight_store_observation_invalid', 'Observation is invalid.');
  const receipt = sourceReceiptOf(input);
  const admitted = admitSpotlightObservation(withoutSourceReceipt(input));
  if (receipt.hashBasis === 'canonical_payload' && receipt.hash !== admitted.sourceReceipt.hash) {
    fail('spotlight_store_source_receipt_invalid', 'Observation source receipt does not match its payload.');
  }
  return deepFreeze({ ...admitted, sourceReceipt: { ...receipt } });
}
function eventHash(row) {
  return sha256({
    sequence: row.sequence, eventId: row.eventId, eventType: row.eventType,
    entityId: row.entityId, payloadHash: row.payloadHash,
    previousEventHash: row.previousEventHash, createdAt: row.createdAt,
  });
}
function eventPayload(eventType, entityId, payload) {
  const payloadJson = canonicalStringify(payload);
  return { eventType, entityId, payloadJson, payloadHash: sha256(payload) };
}
function validateRequest(request) {
  if (!isPlainObject(request)) fail('spotlight_store_invalid_argument', 'Observation request is invalid.');
  const keys = Object.keys(request);
  if (keys.some(key => !['accountAlias', 'symbol', 'observationRef'].includes(key))) fail('spotlight_store_invalid_argument', 'Observation request contains an unknown field.');
  const normalized = {};
  for (const key of keys) normalized[key] = safeId(request[key], `request.${key}`);
  return normalized;
}

export class SpotlightObservationStore {
  constructor(path, { readOnly = false, maxObservations = 2_000, maxAttempts = 4_000, maxSettlements = 4_000 } = {}) {
    if (typeof path !== 'string' || !path || Buffer.byteLength(path, 'utf8') > MAX_PATH_BYTES) fail('spotlight_store_invalid_path', 'Observation store path is invalid.');
    this.path = path;
    this.readOnly = readOnly === true;
    this.maxObservations = countOf(maxObservations, 'maxObservations', 2_000);
    this.maxAttempts = countOf(maxAttempts, 'maxAttempts', 4_000);
    this.maxSettlements = countOf(maxSettlements, 'maxSettlements', 4_000);
    this.closed = false;
    if (!readOnly && path !== ':memory:' && !existsSync(path)) mkdirSync(dirname(path), { recursive: true });
    if (readOnly && path !== ':memory:' && !existsSync(path)) fail('spotlight_store_missing', 'Observation store is unavailable.');
    this.sqlite = new DatabaseSync(path, this.readOnly ? { readOnly: true } : {});
    try {
      if (!readOnly) this.sqlite.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;');
      const tables = this.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row => row.name);
      if (!tables.length) {
        if (readOnly) fail('spotlight_store_missing', 'Observation store is unavailable.');
        this.sqlite.exec(SCHEMA_SQL);
        this.sqlite.prepare('INSERT INTO spotlight_metadata(singleton,schema_name,schema_version,created_at) VALUES(1,?,?,?)').run(SPOTLIGHT_OBSERVATION_STORE_SCHEMA, 1, now());
      } else {
        const metadata = tables.includes('spotlight_metadata') ? this.sqlite.prepare('SELECT schema_name AS schemaName,schema_version AS schemaVersion FROM spotlight_metadata WHERE singleton=1').get() : null;
        if (!metadata || metadata.schemaName !== SPOTLIGHT_OBSERVATION_STORE_SCHEMA || metadata.schemaVersion !== 1) fail('spotlight_store_schema_unsupported', 'Observation store schema is unsupported.');
        if (JSON.stringify(tables) !== JSON.stringify([...TABLES].sort())) fail('spotlight_store_schema_unknown', 'Observation store contains an unknown schema object.');
        if (!readOnly) this.sqlite.exec('PRAGMA foreign_keys=ON;');
      }
      const report = this.verify();
      if (!report.verified) fail(report.code || 'spotlight_store_drift', 'Observation store verification failed.');
      this.pendingAtStartup = new Set(this.sqlite.prepare(`SELECT a.attempt_id AS attemptId FROM spotlight_attempts a LEFT JOIN spotlight_settlements s ON s.attempt_id=a.attempt_id WHERE s.attempt_id IS NULL`).all().map(row => row.attemptId));
    } catch (error) {
      try { this.sqlite.close(); } catch {}
      throw error;
    }
  }

  isOpen() { return !this.closed; }
  _assertVerified() {
    const report = this.verify();
    if (!report.verified) fail(report.code || 'spotlight_store_drift', 'Observation store verification failed.');
  }
  verify() {
    if (this.closed) return { verified: false, apiVersion: SPOTLIGHT_OBSERVATION_STORE_API, schemaVersion: 1, code: 'spotlight_store_closed', errors: ['Observation store is closed.'] };
    try {
      const tables = this.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row => row.name);
      if (JSON.stringify(tables) !== JSON.stringify([...TABLES].sort())) return { verified: false, apiVersion: SPOTLIGHT_OBSERVATION_STORE_API, schemaVersion: 1, code: 'spotlight_store_schema_unknown', errors: ['Observation store schema objects are not exact.'] };
      const metadata = this.sqlite.prepare('SELECT schema_name AS schemaName,schema_version AS schemaVersion FROM spotlight_metadata WHERE singleton=1').get();
      if (!metadata || metadata.schemaName !== SPOTLIGHT_OBSERVATION_STORE_SCHEMA || metadata.schemaVersion !== 1) return { verified: false, apiVersion: SPOTLIGHT_OBSERVATION_STORE_API, schemaVersion: 1, code: 'spotlight_store_schema_unsupported', errors: ['Observation store schema version is unsupported.'] };
      const triggers = this.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'spotlight_%' ORDER BY name").all().map(row => row.name);
      if (JSON.stringify(triggers) !== JSON.stringify([...TRIGGERS].sort())) return { verified: false, apiVersion: SPOTLIGHT_OBSERVATION_STORE_API, schemaVersion: 1, code: 'spotlight_store_schema_drift', errors: ['Observation store append-only triggers are not exact.'] };
      for (const table of TABLES) {
        const columns = this.sqlite.prepare(`PRAGMA table_info(${table})`).all().map(column => column.name);
        if (JSON.stringify(columns) !== JSON.stringify(COLUMN_SHAPES[table])) return { verified: false, apiVersion: SPOTLIGHT_OBSERVATION_STORE_API, schemaVersion: 1, code: 'spotlight_store_schema_drift', errors: ['Observation store columns are not exact.'] };
      }
      const events = this.sqlite.prepare('SELECT sequence,event_id AS eventId,event_type AS eventType,entity_id AS entityId,payload_json AS payloadJson,payload_hash AS payloadHash,previous_event_hash AS previousEventHash,event_hash AS eventHash,created_at AS createdAt FROM spotlight_events ORDER BY sequence').all();
      let previous = null;
      for (const [index, event] of events.entries()) {
        if (event.sequence !== index + 1 || !EVENT_TYPES.has(event.eventType) || !HASH.test(event.payloadHash) || !HASH.test(event.eventHash) || event.previousEventHash !== previous) return { verified: false, apiVersion: SPOTLIGHT_OBSERVATION_STORE_API, schemaVersion: 1, code: 'spotlight_store_drift', errors: ['Observation event chain is not contiguous.'] };
        let payload; try { payload = JSON.parse(event.payloadJson); } catch { return { verified: false, apiVersion: SPOTLIGHT_OBSERVATION_STORE_API, schemaVersion: 1, code: 'spotlight_store_drift', errors: ['Observation event payload is not JSON.'] }; }
        if (sha256(payload) !== event.payloadHash || eventHash(event) !== event.eventHash) return { verified: false, apiVersion: SPOTLIGHT_OBSERVATION_STORE_API, schemaVersion: 1, code: 'spotlight_store_drift', errors: ['Observation event hash is invalid.'] };
        previous = event.eventHash;
      }
      const attempts = this.sqlite.prepare('SELECT * FROM spotlight_attempts ORDER BY event_sequence').all();
      if (attempts.length > this.maxAttempts) return { verified: false, apiVersion: SPOTLIGHT_OBSERVATION_STORE_API, schemaVersion: 1, code: 'spotlight_store_bounds', errors: ['Observation attempts exceed the configured bound.'] };
      const metadataCreatedAt = this.sqlite.prepare('SELECT created_at AS createdAt FROM spotlight_metadata WHERE singleton=1').get()?.createdAt;
      if (typeof metadataCreatedAt !== 'string' || !ISO_DATE.test(metadataCreatedAt) || !Number.isFinite(Date.parse(metadataCreatedAt))) return { verified: false, apiVersion: SPOTLIGHT_OBSERVATION_STORE_API, schemaVersion: 1, code: 'spotlight_store_drift', errors: ['Observation store metadata is invalid.'] };
      for (const row of attempts) {
        let request; try { request = JSON.parse(row.request_json); } catch { return { verified: false, apiVersion: SPOTLIGHT_OBSERVATION_STORE_API, schemaVersion: 1, code: 'spotlight_store_drift', errors: ['Observation request is not JSON.'] }; }
        let eventPayload; try { eventPayload = JSON.parse(events[row.event_sequence - 1]?.payloadJson || 'null'); } catch { eventPayload = null; }
        try { validateRequest(request); } catch { return { verified: false, apiVersion: SPOTLIGHT_OBSERVATION_STORE_API, schemaVersion: 1, code: 'spotlight_store_drift', errors: ['Observation request is invalid.'] }; }
        if (row.tool_name !== 'spotlight_observe' || !OPERATIONS.has(row.operation) || !SAFE_ID.test(row.instrument_id) || !SAFE_ID.test(row.session_id) || !SAFE_ID.test(row.wake_id) || !SAFE_ID.test(row.command_id)
          || sha256(request) !== row.request_hash || !events[row.event_sequence - 1] || events[row.event_sequence - 1].entityId !== row.attempt_id
          || row.request_key !== [row.session_id, row.wake_id, row.command_id].join('\u001f')
          || !eventPayload || eventPayload.operation !== row.operation || eventPayload.instrumentId !== row.instrument_id || eventPayload.requestHash !== row.request_hash || eventPayload.requestKey !== row.request_key) return { verified: false, apiVersion: SPOTLIGHT_OBSERVATION_STORE_API, schemaVersion: 1, code: 'spotlight_store_drift', errors: ['Observation attempt hash or link is invalid.'] };
      }
      const observations = this.sqlite.prepare('SELECT * FROM spotlight_observations ORDER BY event_sequence').all();
      if (observations.length > this.maxObservations) return { verified: false, apiVersion: SPOTLIGHT_OBSERVATION_STORE_API, schemaVersion: 1, code: 'spotlight_store_bounds', errors: ['Retained observations exceed the configured bound.'] };
      for (const row of observations) {
        let observation; try { observation = JSON.parse(row.observation_json); } catch { return { verified: false, apiVersion: SPOTLIGHT_OBSERVATION_STORE_API, schemaVersion: 1, code: 'spotlight_store_drift', errors: ['Stored observation is not JSON.'] }; }
        try { const admitted = normalizeStoredObservation(observation); safeId(row.instrument_id, 'stored instrumentId'); if (observationPayloadHash(observation) !== row.payload_hash || admitted.sourceReceipt.hash !== row.source_receipt_hash) throw new Error(); } catch { return { verified: false, apiVersion: SPOTLIGHT_OBSERVATION_STORE_API, schemaVersion: 1, code: 'spotlight_store_drift', errors: ['Stored observation validation or hash failed.'] }; }
        let eventPayload; try { eventPayload = JSON.parse(events[row.event_sequence - 1]?.payloadJson || 'null'); } catch { eventPayload = null; }
        if (!events[row.event_sequence - 1] || events[row.event_sequence - 1].entityId !== row.observation_id || !eventPayload
          || eventPayload.instrumentId !== row.instrument_id || eventPayload.payloadHash !== row.payload_hash || eventPayload.sourceReceiptHash !== row.source_receipt_hash) return { verified: false, apiVersion: SPOTLIGHT_OBSERVATION_STORE_API, schemaVersion: 1, code: 'spotlight_store_drift', errors: ['Stored observation event link is invalid.'] };
      }
      const settlements = this.sqlite.prepare('SELECT * FROM spotlight_settlements ORDER BY event_sequence').all();
      if (settlements.length > this.maxSettlements) return { verified: false, apiVersion: SPOTLIGHT_OBSERVATION_STORE_API, schemaVersion: 1, code: 'spotlight_store_bounds', errors: ['Observation settlements exceed the configured bound.'] };
      if (events.length !== attempts.length + observations.length + settlements.length) return { verified: false, apiVersion: SPOTLIGHT_OBSERVATION_STORE_API, schemaVersion: 1, code: 'spotlight_store_drift', errors: ['Observation event count is not reconciled.'] };
      for (const row of settlements) {
        let settlement; try { settlement = JSON.parse(row.settlement_json); } catch { return { verified: false, apiVersion: SPOTLIGHT_OBSERVATION_STORE_API, schemaVersion: 1, code: 'spotlight_store_drift', errors: ['Observation settlement is not JSON.'] }; }
        let eventPayload; try { eventPayload = JSON.parse(events[row.event_sequence - 1]?.payloadJson || 'null'); } catch { eventPayload = null; }
        if (!['succeeded', 'failed'].includes(row.status) || settlementHash(settlement) !== row.settlement_hash || settlement.status !== row.status || (row.status === 'succeeded') !== Boolean(row.observation_id)
          || (row.status === 'succeeded' && settlement.observationId !== row.observation_id)
          || !events[row.event_sequence - 1] || events[row.event_sequence - 1].entityId !== row.settlement_id || canonicalStringify(eventPayload) !== canonicalStringify(settlement)) return { verified: false, apiVersion: SPOTLIGHT_OBSERVATION_STORE_API, schemaVersion: 1, code: 'spotlight_store_drift', errors: ['Observation settlement hash or link is invalid.'] };
      }
      const counts = { attempts: attempts.length, observations: observations.length, settlements: settlements.length, events: events.length };
      return { verified: true, apiVersion: SPOTLIGHT_OBSERVATION_STORE_API, schemaVersion: 1, counts, chainHead: previous };
    } catch (error) {
      return { verified: false, apiVersion: SPOTLIGHT_OBSERVATION_STORE_API, schemaVersion: 1, code: 'spotlight_store_unavailable', errors: ['Observation store verification failed.'] };
    }
  }

  recordAttempt({ sessionId, wakeId, commandId, operation, instrumentId, request, toolName = 'spotlight_observe' }) {
    if (this.closed) fail('spotlight_store_closed', 'Observation store is closed.');
    if (this.readOnly) fail('spotlight_store_read_only', 'Observation store is read-only.');
    this._assertVerified();
    if (toolName !== 'spotlight_observe') fail('spotlight_store_invalid_argument', 'Only Spotlight observation attempts are admissible.');
    const identity = [sessionId, wakeId, commandId].map((value, index) => safeId(value, ['sessionId', 'wakeId', 'commandId'][index]));
    const op = safeId(operation, 'operation');
    const instrument = safeId(instrumentId, 'instrumentId');
    const normalizedRequest = validateRequest(request);
    const requestKey = identity.join('\u001f');
    const requestJson = canonicalStringify(normalizedRequest);
    const requestHash = sha256(normalizedRequest);
    return transaction(this.sqlite, () => {
      const prior = this.sqlite.prepare('SELECT * FROM spotlight_attempts WHERE request_key=?').get(requestKey);
      if (prior) {
        if (prior.operation !== op || prior.instrument_id !== instrument || prior.request_hash !== requestHash) fail('spotlight_store_duplicate_conflict', 'Observation command identity was reused with different arguments.');
        const settlement = this.sqlite.prepare('SELECT * FROM spotlight_settlements WHERE attempt_id=?').get(prior.attempt_id);
        if (settlement) return { kind: 'settled', attempt: prior, settlement: parseSettlement(settlement) };
        if (this.pendingAtStartup?.has(prior.attempt_id)) return { kind: 'pending_restart', attempt: prior };
        return { kind: 'pending', attempt: prior };
      }
      const count = this.sqlite.prepare('SELECT COUNT(*) AS count FROM spotlight_attempts').get().count;
      if (count >= this.maxAttempts) fail('spotlight_store_bounds', 'Observation attempt custody is full.');
      const attemptId = `spotlight_attempt_${randomUUID()}`;
      const createdAt = now();
      const event = appendEvent(this.sqlite, 'attempt', attemptId, { operation: op, instrumentId: instrument, requestHash, requestKey }, createdAt);
      this.sqlite.prepare(`INSERT INTO spotlight_attempts(attempt_id,request_key,session_id,wake_id,command_id,tool_name,operation,instrument_id,request_json,request_hash,event_sequence,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(attemptId, requestKey, identity[0], identity[1], identity[2], toolName, op, instrument, requestJson, requestHash, event.sequence, createdAt);
      return { kind: 'new', attempt: this.sqlite.prepare('SELECT * FROM spotlight_attempts WHERE attempt_id=?').get(attemptId) };
    });
  }

  settleSuccess({ attemptId, observation, expectedInstrumentId = null, requestedInstrumentId = null }) {
    if (this.closed) fail('spotlight_store_closed', 'Observation store is closed.');
    if (this.readOnly) fail('spotlight_store_read_only', 'Observation store is read-only.');
    this._assertVerified();
    const attempt = this.sqlite.prepare('SELECT * FROM spotlight_attempts WHERE attempt_id=?').get(safeId(attemptId, 'attemptId'));
    if (!attempt) fail('spotlight_store_attempt_missing', 'Observation attempt is not in custody.');
    const prior = this.sqlite.prepare('SELECT * FROM spotlight_settlements WHERE attempt_id=?').get(attempt.attempt_id);
    if (prior) return { ...parseSettlement(prior), observation: prior.observation_id ? this.read(prior.observation_id)?.observation : null };
    const admitted = normalizeStoredObservation(observation);
    if (expectedInstrumentId !== null && admitted.instrument.id !== expectedInstrumentId) fail('spotlight_store_instrument_mismatch', 'Observation instrument does not match the request.');
    if (expectedInstrumentId === null && admitted.instrument.id !== attempt.instrument_id) fail('spotlight_store_instrument_mismatch', 'Observation instrument does not match the request.');
    return transaction(this.sqlite, () => {
      const count = this.sqlite.prepare('SELECT COUNT(*) AS count FROM spotlight_observations').get().count;
      if (count >= this.maxObservations) fail('spotlight_store_bounds', 'Retained observation custody is full.');
      const observationId = `spotlight_observation_${randomUUID()}`;
      const createdAt = now();
      const payloadHash = observationPayloadHash(admitted);
      const sourceReceiptHash = admitted.sourceReceipt.hash;
      const observationJson = canonicalStringify(admitted);
      const storedInstrumentId = requestedInstrumentId === null ? admitted.instrument.id : safeId(requestedInstrumentId, 'requestedInstrumentId');
      const observationEvent = appendEvent(this.sqlite, 'observation', observationId, { instrumentId: storedInstrumentId, payloadHash, sourceReceiptHash }, createdAt);
      this.sqlite.prepare(`INSERT INTO spotlight_observations(observation_id,instrument_id,observation_json,payload_hash,source_receipt_hash,event_sequence,created_at) VALUES(?,?,?,?,?,?,?)`).run(observationId, storedInstrumentId, observationJson, payloadHash, sourceReceiptHash, observationEvent.sequence, createdAt);
      const settlement = { status: 'succeeded', observationId, network: true };
      const settlementId = `spotlight_settlement_${randomUUID()}`;
      const settlementEvent = appendEvent(this.sqlite, 'settlement', settlementId, settlement, createdAt);
      this.sqlite.prepare(`INSERT INTO spotlight_settlements(settlement_id,attempt_id,status,observation_id,settlement_json,settlement_hash,event_sequence,created_at) VALUES(?,?,?,?,?,?,?,?)`).run(settlementId, attempt.attempt_id, 'succeeded', observationId, canonicalStringify(settlement), settlementHash(settlement), settlementEvent.sequence, createdAt);
      this.pendingAtStartup?.delete(attempt.attempt_id);
      return { ...settlement, settlementId, attemptId: attempt.attempt_id, observationId, observation: admitted };
    });
  }

  settleFailure({ attemptId, code, message, network = false }) {
    if (this.closed) fail('spotlight_store_closed', 'Observation store is closed.');
    if (this.readOnly) fail('spotlight_store_read_only', 'Observation store is read-only.');
    this._assertVerified();
    const attempt = this.sqlite.prepare('SELECT * FROM spotlight_attempts WHERE attempt_id=?').get(safeId(attemptId, 'attemptId'));
    if (!attempt) fail('spotlight_store_attempt_missing', 'Observation attempt is not in custody.');
    const prior = this.sqlite.prepare('SELECT * FROM spotlight_settlements WHERE attempt_id=?').get(attempt.attempt_id);
    if (prior) return parseSettlement(prior);
    const count = this.sqlite.prepare('SELECT COUNT(*) AS count FROM spotlight_settlements').get().count;
    if (count >= this.maxSettlements) fail('spotlight_store_bounds', 'Observation settlement custody is full.');
    return transaction(this.sqlite, () => {
      const settlement = { status: 'failed', errorCode: safeCode(code), message: safeMessage(message), network: network === true };
      const settlementId = `spotlight_settlement_${randomUUID()}`;
      const createdAt = now();
      const event = appendEvent(this.sqlite, 'settlement', settlementId, settlement, createdAt);
      this.sqlite.prepare(`INSERT INTO spotlight_settlements(settlement_id,attempt_id,status,observation_id,settlement_json,settlement_hash,event_sequence,created_at) VALUES(?,?,?,?,?,?,?,?)`).run(settlementId, attempt.attempt_id, 'failed', null, canonicalStringify(settlement), settlementHash(settlement), event.sequence, createdAt);
      this.pendingAtStartup?.delete(attempt.attempt_id);
      return { ...settlement, settlementId, attemptId: attempt.attempt_id, observationId: null, observation: null };
    });
  }

  settlementFor({ sessionId, wakeId, commandId }) {
    if (this.closed) fail('spotlight_store_closed', 'Observation store is closed.');
    this._assertVerified();
    const key = [sessionId, wakeId, commandId].map((value, index) => safeId(value, ['sessionId', 'wakeId', 'commandId'][index])).join('\u001f');
    const attempt = this.sqlite.prepare('SELECT * FROM spotlight_attempts WHERE request_key=?').get(key);
    if (!attempt) return null;
    const settlement = this.sqlite.prepare('SELECT * FROM spotlight_settlements WHERE attempt_id=?').get(attempt.attempt_id);
    if (!settlement) return { pending: true, attemptId: attempt.attempt_id };
    const value = parseSettlement(settlement);
    if (value.observationId) value.observation = this.read(value.observationId)?.observation || null;
    return value;
  }

  read(observationId) {
    if (this.closed) fail('spotlight_store_closed', 'Observation store is closed.');
    this._assertVerified();
    const row = this.sqlite.prepare('SELECT * FROM spotlight_observations WHERE observation_id=?').get(safeId(observationId, 'observationId'));
    if (!row) return null;
    let observation; try { observation = normalizeStoredObservation(JSON.parse(row.observation_json)); } catch { fail('spotlight_store_drift', 'Stored observation failed validation.'); }
    return deepFreeze({ observationId: row.observation_id, retained: true, status: 'retained', instrumentId: row.instrument_id, observedAt: observation.observedAt, receivedAt: observation.receivedAt, observation });
  }

  list({ instrumentId = null, limit = 100 } = {}) {
    if (this.closed) fail('spotlight_store_closed', 'Observation store is closed.');
    this._assertVerified();
    if (instrumentId !== null) safeId(instrumentId, 'instrumentId');
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) fail('spotlight_store_invalid_argument', 'Observation list limit is invalid.');
    const rows = this.sqlite.prepare(`SELECT * FROM spotlight_observations ${instrumentId === null ? '' : 'WHERE instrument_id=?'} ORDER BY event_sequence DESC LIMIT ?`).all(...(instrumentId === null ? [limit] : [instrumentId, limit]));
    return deepFreeze(rows.map(row => {
      let observation; try { observation = normalizeStoredObservation(JSON.parse(row.observation_json)); } catch { fail('spotlight_store_drift', 'Stored observation failed validation.'); }
      return { observationId: row.observation_id, retained: true, status: 'retained', instrumentId: row.instrument_id, observedAt: observation.observedAt, receivedAt: observation.receivedAt, instrument: observation.instrument };
    }));
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.sqlite.close();
  }
}

function appendEvent(sqlite, eventType, entityId, payload, createdAt) {
  const previous = sqlite.prepare('SELECT event_hash AS eventHash FROM spotlight_events ORDER BY sequence DESC LIMIT 1').get()?.eventHash || null;
  const sequence = (sqlite.prepare('SELECT COALESCE(MAX(sequence),0) AS sequence FROM spotlight_events').get().sequence || 0) + 1;
  const eventId = `spotlight_event_${randomUUID()}`;
  const details = eventPayload(eventType, entityId, payload);
  const row = { sequence, eventId, eventType, entityId, payloadHash: details.payloadHash, previousEventHash: previous, createdAt };
  const hash = eventHash(row);
  sqlite.prepare(`INSERT INTO spotlight_events(sequence,event_id,event_type,entity_id,payload_json,payload_hash,previous_event_hash,event_hash,created_at) VALUES(?,?,?,?,?,?,?,?,?)`).run(sequence, eventId, eventType, entityId, details.payloadJson, details.payloadHash, previous, hash, createdAt);
  return { sequence, eventId, eventHash: hash };
}
function settlementHash(settlement) { return sha256(settlement); }
function parseSettlement(row) {
  let value; try { value = JSON.parse(row.settlement_json); } catch { fail('spotlight_store_drift', 'Stored settlement failed validation.'); }
  return { ...value, settlementId: row.settlement_id, attemptId: row.attempt_id, observationId: row.observation_id || null };
}
