import { canonicalize, id, sha256 } from '../core/hash.js';

export const WAKE_STREAM_SCHEMA_VERSION = 1;
export const WAKE_STREAM_SCHEMA = `
CREATE TABLE IF NOT EXISTS wake_stream_events (
  sequence INTEGER PRIMARY KEY CHECK(sequence>0),
  event_id TEXT NOT NULL UNIQUE,
  schema_version INTEGER NOT NULL CHECK(schema_version=1),
  kind TEXT NOT NULL,
  session_id TEXT,
  wake_id TEXT,
  phase TEXT,
  authority TEXT NOT NULL,
  committed INTEGER NOT NULL CHECK(committed IN (0,1)),
  payload_json TEXT NOT NULL,
  source_json TEXT NOT NULL,
  previous_event_hash TEXT,
  event_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS wake_stream_events_wake_sequence ON wake_stream_events(wake_id, sequence);
CREATE INDEX IF NOT EXISTS wake_stream_events_session_sequence ON wake_stream_events(session_id, sequence);
CREATE INDEX IF NOT EXISTS wake_stream_events_text_delta_lookup ON wake_stream_events(
  wake_id, phase, json_extract(source_json, '$.providerRequestId'), kind, sequence DESC
) WHERE authority='provider_provisional' AND committed=0
  AND json_type(payload_json, '$.delta')='text' AND json_extract(payload_json, '$.delta') <> '';
CREATE INDEX IF NOT EXISTS wake_stream_events_tool_name_delta_lookup ON wake_stream_events(
  wake_id, phase, json_extract(source_json, '$.providerRequestId'), kind,
  CASE WHEN json_type(payload_json, '$.index')='integer' THEN json_extract(payload_json, '$.index') ELSE NULL END,
  sequence DESC
) WHERE authority='provider_provisional' AND committed=0
  AND json_type(payload_json, '$.function.name')='text' AND json_extract(payload_json, '$.function.name') <> '';
CREATE INDEX IF NOT EXISTS wake_stream_events_tool_arguments_delta_lookup ON wake_stream_events(
  wake_id, phase, json_extract(source_json, '$.providerRequestId'), kind,
  CASE WHEN json_type(payload_json, '$.index')='integer' THEN json_extract(payload_json, '$.index') ELSE NULL END,
  sequence DESC
) WHERE authority='provider_provisional' AND committed=0
  AND json_type(payload_json, '$.function.arguments')='text' AND json_extract(payload_json, '$.function.arguments') <> '';
CREATE TRIGGER IF NOT EXISTS wake_stream_events_append_only_update BEFORE UPDATE ON wake_stream_events BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TRIGGER IF NOT EXISTS wake_stream_events_append_only_delete BEFORE DELETE ON wake_stream_events BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
`;

const STREAM_KIND = /^(wake|phase|provider|tool|tool_call|approval|card|message)\.[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*$/;
const STREAM_LABEL = /^[a-z][a-z0-9_.-]*$/;
const STREAM_SECRET_KEY = /(?:authorization|api[_-]?key|credential|password|secret|access[_-]?token|refresh[_-]?token|provider[_-]?key|^token$)/i;
const STREAM_SECRET_VALUE = /(?:\bBearer\s+\S+|\b(?:sk|dsk)-[A-Za-z0-9_-]{8,})/i;
const STREAM_DELTA_SECRET_VALUE = /(?:\bBearer\s+\S+|\b(?:sk|dsk)-[A-Za-z0-9_-]{8,}|\b(?:access[_-]?token|refresh[_-]?token|api[_-]?key|token|password)\s*[:=]\s*["']?(?!(?:null|none|redacted)\b)[^\s"',;]{4,})/i;
const STREAM_DELTA_KINDS = new Set(['provider.thinking.delta', 'provider.content.delta', 'provider.tool_call.delta']);
const STREAM_DELTA_WINDOW = 1024;

function now() { return new Date().toISOString(); }
function streamFail(code, message) { throw Object.assign(new Error(message), { code }); }

function streamString(value, label, { nullable = false, pattern = null, max = 240 } = {}) {
  if (nullable && (value === null || value === undefined)) return null;
  if (typeof value !== 'string' || !value || value.length > max || (pattern && !pattern.test(value))) streamFail('wake_stream_invalid_argument', `${label} is invalid.`);
  return value;
}

function validateStreamJson(value, path = '$', seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    if (typeof value === 'string' && STREAM_SECRET_VALUE.test(value)) streamFail('wake_stream_secret_refused', `Wake stream data at ${path} resembles a credential.`);
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) streamFail('wake_stream_invalid_json', `Wake stream data at ${path} contains a non-finite number.`);
    return;
  }
  if (typeof value !== 'object' || Buffer.isBuffer(value) || value instanceof Uint8Array) streamFail('wake_stream_invalid_json', `Wake stream data at ${path} is not JSON-safe.`);
  if (seen.has(value)) streamFail('wake_stream_invalid_json', `Wake stream data at ${path} contains a cycle.`);
  seen.add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) streamFail('wake_stream_invalid_json', `Wake stream data at ${path} contains a sparse array.`);
      validateStreamJson(value[index], `${path}[${index}]`, seen);
    }
    if (Reflect.ownKeys(value).some(key => key !== 'length' && (typeof key !== 'string' || !/^\d+$/.test(key)))) streamFail('wake_stream_invalid_json', `Wake stream data at ${path} contains non-JSON array properties.`);
  } else {
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) streamFail('wake_stream_invalid_json', `Wake stream data at ${path} must use plain objects.`);
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') streamFail('wake_stream_invalid_json', `Wake stream data at ${path} contains a symbol key.`);
      if (STREAM_SECRET_KEY.test(key)) streamFail('wake_stream_secret_refused', `Wake stream data at ${path}.${key} uses a protected credential field.`);
      validateStreamJson(value[key], `${path}.${key}`, seen);
    }
  }
  seen.delete(value);
}

function canonicalStreamObject(value, label) {
  if (!value || Array.isArray(value) || typeof value !== 'object') streamFail('wake_stream_invalid_json', `${label} must be a JSON object.`);
  validateStreamJson(value, label);
  return canonicalize(value);
}

function streamDeltaFragments(kind, payload) {
  if (kind === 'provider.thinking.delta' || kind === 'provider.content.delta') {
    return [{ channel: kind, text: typeof payload?.delta === 'string' ? payload.delta : '', jsonPath: '$.delta', toolIndex: null }];
  }
  if (kind === 'provider.tool_call.delta') {
    const index = Number.isInteger(payload?.index) ? payload.index : null;
    const channelIndex = index ?? 'unknown';
    return [
      { channel: `${kind}:${channelIndex}:name`, text: typeof payload?.function?.name === 'string' ? payload.function.name : '', jsonPath: '$.function.name', toolIndex: index },
      { channel: `${kind}:${channelIndex}:arguments`, text: typeof payload?.function?.arguments === 'string' ? payload.function.arguments : '', jsonPath: '$.function.arguments', toolIndex: index },
    ];
  }
  return [];
}

function utf8Suffix(value, maxBytes) {
  if (!value || maxBytes <= 0) return '';
  const bytes = Buffer.from(value, 'utf8');
  if (bytes.length <= maxBytes) return value;
  let start = bytes.length - maxBytes;
  while (start < bytes.length && (bytes[start] & 0xc0) === 0x80) start += 1;
  return bytes.subarray(start).toString('utf8');
}

function deltaSecretFail() {
  streamFail('wake_stream_delta_secret_refused', 'A provisional provider fragment would reconstruct credential-shaped text.');
}

function validateCurrentDeltaSecrets(kind, payload) {
  if (!STREAM_DELTA_KINDS.has(kind)) return;
  try { validateStreamJson(payload, 'payload'); }
  catch (error) {
    if (error?.code === 'wake_stream_secret_refused') deltaSecretFail();
    throw error;
  }
  for (const fragment of streamDeltaFragments(kind, payload)) {
    if (STREAM_DELTA_SECRET_VALUE.test(fragment.text)) deltaSecretFail();
  }
}

export function wakeStreamHashInput(event) {
  return {
    sequence: event.sequence,
    eventId: event.eventId,
    schemaVersion: event.schemaVersion,
    kind: event.kind,
    sessionId: event.sessionId,
    wakeId: event.wakeId,
    phase: event.phase,
    authority: event.authority,
    committed: event.committed,
    payload: event.payload,
    source: event.source,
    previousEventHash: event.previousEventHash,
    createdAt: event.createdAt,
  };
}

export class WakeStreamJournal {
  constructor(sqlite) {
    if (!sqlite || typeof sqlite.prepare !== 'function' || typeof sqlite.exec !== 'function') streamFail('wake_stream_invalid_journal', 'Wake stream journal requires a SQLite database.');
    this.sqlite = sqlite;
    this.install();
  }

  install() {
    this.sqlite.exec(WAKE_STREAM_SCHEMA);
  }

  transaction(fn) {
    this.sqlite.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.sqlite.exec('COMMIT'); return result; }
    catch (error) { try { this.sqlite.exec('ROLLBACK'); } catch {} throw error; }
  }

  validateCrossFragmentDelta({ kind, wakeId, phase, payload, source }) {
    if (!STREAM_DELTA_KINDS.has(kind)) return;
    const requestId = typeof source?.providerRequestId === 'string' ? source.providerRequestId : null;
    for (const current of streamDeltaFragments(kind, payload)) {
      if (!current.text) continue;
      const currentSuffix = utf8Suffix(current.text, STREAM_DELTA_WINDOW);
      const fragments = [currentSuffix];
      let retainedBytes = Buffer.byteLength(currentSuffix, 'utf8');
      if (retainedBytes < STREAM_DELTA_WINDOW) {
        const fragmentExpression = {
          '$.delta': "json_extract(payload_json, '$.delta')",
          '$.function.name': "json_extract(payload_json, '$.function.name')",
          '$.function.arguments': "json_extract(payload_json, '$.function.arguments')",
        }[current.jsonPath];
        const rows = this.sqlite.prepare(`SELECT ${fragmentExpression} AS fragment_text
          FROM wake_stream_events
          WHERE wake_id IS ? AND phase IS ? AND authority='provider_provisional' AND committed=0
            AND kind=?
            AND json_extract(source_json, '$.providerRequestId') IS ?
            AND (CASE WHEN json_type(payload_json, '$.index')='integer' THEN json_extract(payload_json, '$.index') ELSE NULL END) IS ?
            AND json_type(payload_json, '${current.jsonPath}')='text' AND ${fragmentExpression} <> ''
          ORDER BY sequence DESC`).iterate(wakeId, phase, kind, requestId, current.toolIndex);
        for (const row of rows) {
          if (typeof row.fragment_text !== 'string') streamFail('wake_stream_custody_mismatch', 'Prior provisional stream data is invalid.');
          const remaining = STREAM_DELTA_WINDOW - retainedBytes;
          if (remaining <= 0) break;
          const retained = utf8Suffix(row.fragment_text, remaining);
          fragments.unshift(retained);
          retainedBytes += Buffer.byteLength(retained, 'utf8');
          if (retainedBytes >= STREAM_DELTA_WINDOW) break;
        }
      }
      if (STREAM_DELTA_SECRET_VALUE.test(fragments.join(''))) deltaSecretFail();
    }
  }

  appendWakeStreamEvent({
    eventId = id('wake_stream_event'), schemaVersion = WAKE_STREAM_SCHEMA_VERSION, kind, sessionId = null, wakeId = null, phase = null,
    authority = 'host_receipt', committed = true, payload = {}, source = {}, createdAt = now(),
  } = {}) {
    streamString(eventId, 'Wake stream event id');
    if (schemaVersion !== WAKE_STREAM_SCHEMA_VERSION) streamFail('wake_stream_schema_unsupported', 'Wake stream schemaVersion must be 1.');
    streamString(kind, 'Wake stream event kind', { pattern: STREAM_KIND, max: 120 });
    streamString(sessionId, 'Wake stream session id', { nullable: true });
    streamString(wakeId, 'Wake stream wake id', { nullable: true });
    streamString(phase, 'Wake stream phase', { nullable: true, pattern: STREAM_LABEL, max: 80 });
    streamString(authority, 'Wake stream authority', { pattern: STREAM_LABEL, max: 80 });
    if (typeof committed !== 'boolean') streamFail('wake_stream_invalid_argument', 'Wake stream committed must be boolean.');
    streamString(createdAt, 'Wake stream createdAt', { max: 64 });
    if (!Number.isFinite(Date.parse(createdAt))) streamFail('wake_stream_invalid_argument', 'Wake stream createdAt is invalid.');
    validateCurrentDeltaSecrets(kind, payload);
    const payloadJson = canonicalStreamObject(payload, 'payload');
    const sourceJson = canonicalStreamObject(source, 'source');
    const safePayload = JSON.parse(payloadJson);
    const safeSource = JSON.parse(sourceJson);
    return this.transaction(() => {
      this.validateCrossFragmentDelta({ kind, wakeId, phase, payload: safePayload, source: safeSource });
      const prior = this.sqlite.prepare('SELECT sequence, event_hash FROM wake_stream_events ORDER BY sequence DESC LIMIT 1').get();
      const sequence = (prior?.sequence || 0) + 1;
      const event = {
        sequence, eventId, schemaVersion, kind, sessionId, wakeId, phase, authority, committed,
        payload: safePayload, source: safeSource, previousEventHash: prior?.event_hash || null, createdAt,
      };
      const eventHash = sha256(canonicalize(wakeStreamHashInput(event)));
      this.sqlite.prepare(`INSERT INTO wake_stream_events(
        sequence,event_id,schema_version,kind,session_id,wake_id,phase,authority,committed,payload_json,source_json,previous_event_hash,event_hash,created_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        sequence, eventId, schemaVersion, kind, sessionId, wakeId, phase, authority, committed ? 1 : 0,
        payloadJson, sourceJson, event.previousEventHash, eventHash, createdAt,
      );
      return { ...event, eventHash };
    });
  }

  wakeStreamEventFromRow(row) {
    if (!row) return null;
    let payload; let source;
    try { payload = JSON.parse(row.payload_json); source = JSON.parse(row.source_json); }
    catch { streamFail('wake_stream_custody_mismatch', 'Wake stream event JSON custody is invalid.'); }
    const event = {
      sequence: row.sequence,
      eventId: row.event_id,
      schemaVersion: row.schema_version,
      kind: row.kind,
      sessionId: row.session_id,
      wakeId: row.wake_id,
      phase: row.phase,
      authority: row.authority,
      committed: Boolean(row.committed),
      payload,
      source,
      previousEventHash: row.previous_event_hash,
      eventHash: row.event_hash,
      createdAt: row.created_at,
    };
    try { validateStreamJson(payload, 'payload'); validateStreamJson(source, 'source'); }
    catch { streamFail('wake_stream_custody_mismatch', 'Wake stream event JSON custody is invalid.'); }
    const expectedHash = sha256(canonicalize(wakeStreamHashInput(event)));
    if (expectedHash !== event.eventHash) streamFail('wake_stream_custody_mismatch', 'Wake stream event hash custody is invalid.');
    const prior = event.sequence > 1 ? this.sqlite.prepare('SELECT event_hash FROM wake_stream_events WHERE sequence=?').get(event.sequence - 1) : null;
    if ((event.sequence === 1 && event.previousEventHash !== null)
      || (event.sequence > 1 && (!prior || prior.event_hash !== event.previousEventHash))) {
      streamFail('wake_stream_custody_mismatch', 'Wake stream event hash chain is invalid.');
    }
    return event;
  }

  wakeStreamLimit(limit) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 10000) streamFail('wake_stream_invalid_argument', 'Wake stream list limit must be an integer from 1 to 10000.');
    return limit;
  }

  getWakeStreamEvent(eventId) {
    streamString(eventId, 'Wake stream event id');
    return this.wakeStreamEventFromRow(this.sqlite.prepare('SELECT * FROM wake_stream_events WHERE event_id=?').get(eventId));
  }

  getLatestWakeStreamSequence() {
    return this.sqlite.prepare('SELECT COALESCE(MAX(sequence),0) AS sequence FROM wake_stream_events').get().sequence;
  }

  listWakeStreamEvents({ afterSequence = 0, limit = 1000 } = {}) {
    if (!Number.isInteger(afterSequence) || afterSequence < 0) streamFail('wake_stream_invalid_argument', 'Wake stream afterSequence must be a non-negative integer.');
    this.wakeStreamLimit(limit);
    return this.sqlite.prepare('SELECT * FROM wake_stream_events WHERE sequence>? ORDER BY sequence LIMIT ?').all(afterSequence, limit)
      .map(row => this.wakeStreamEventFromRow(row));
  }

  listWakeStreamEventsAfter(afterSequence = 0, { limit = 1000 } = {}) {
    return this.listWakeStreamEvents({ afterSequence, limit });
  }

  listWakeStreamEventsByWake(wakeId, { afterSequence = 0, limit = 1000 } = {}) {
    streamString(wakeId, 'Wake stream wake id');
    if (!Number.isInteger(afterSequence) || afterSequence < 0) streamFail('wake_stream_invalid_argument', 'Wake stream afterSequence must be a non-negative integer.');
    this.wakeStreamLimit(limit);
    return this.sqlite.prepare('SELECT * FROM wake_stream_events WHERE wake_id=? AND sequence>? ORDER BY sequence LIMIT ?').all(wakeId, afterSequence, limit)
      .map(row => this.wakeStreamEventFromRow(row));
  }

  listRecentWakeStreamEvents({ limit = 1000 } = {}) {
    this.wakeStreamLimit(limit);
    return this.sqlite.prepare('SELECT * FROM (SELECT * FROM wake_stream_events ORDER BY sequence DESC LIMIT ?) ORDER BY sequence').all(limit)
      .map(row => this.wakeStreamEventFromRow(row));
  }
}
