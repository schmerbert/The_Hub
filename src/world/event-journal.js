import { canonicalize, id, sha256 } from '../core/hash.js';
import {
  WORLD_EVENT_GENESIS_HASH,
  WORLD_EVENT_KINDS,
  NODE_COLUMNS,
  EDGE_COLUMNS,
  LOCATION_COLUMNS,
  FIXTURE_RUNTIME_COLUMNS,
  TIMER_COLUMNS,
  BRIEF_COLUMNS,
  APPROVAL_COLUMNS,
  ACTION_RECEIPT_COLUMNS,
  APPROVAL_RECEIPT_COLUMNS,
  PASSAGE_COLUMNS,
  OBJECT_STATE_COLUMNS,
} from './event-contract.js';

function canonicalObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value;
}

export function eventHashInput(event) {
  return {
    sequence: event.sequence, eventId: event.event_id, eventSchemaVersion: event.event_schema_version,
    eventKind: event.event_kind, aggregateKind: event.aggregate_kind, aggregateId: event.aggregate_id,
    aggregateRevision: event.aggregate_revision, sessionId: event.session_id ?? null, wakeId: event.wake_id ?? null,
    actor: event.actor, commandId: event.command_id ?? null, causation: JSON.parse(event.causation_json),
    payload: JSON.parse(event.payload_json), payloadSha256: event.payload_sha256,
    previousEventHash: event.previous_event_hash, occurredAt: event.occurred_at,
  };
}

export function computeWorldEventHash(event) { return sha256(canonicalize(eventHashInput(event))); }

export function createWorldEvent({ head = null, eventKind, aggregateKind, aggregateId, aggregateRevision, sessionId = null, wakeId = null, actor, commandId = null, causation = {}, payload, occurredAt }) {
  const registration = WORLD_EVENT_KINDS[eventKind];
  if (!registration || registration.installed === false) throw Object.assign(new Error(`World event kind is not installed: ${eventKind}`), { code: 'world_event_kind_unknown' });
  const payloadJson = canonicalize(canonicalObject(payload, 'payload'));
  const event = {
    sequence: (head?.sequence || 0) + 1, event_id: id('world_event'), event_schema_version: registration.schemaVersion,
    event_kind: eventKind, aggregate_kind: aggregateKind, aggregate_id: aggregateId, aggregate_revision: aggregateRevision,
    session_id: sessionId, wake_id: wakeId, actor, command_id: commandId, causation_json: canonicalize(canonicalObject(causation, 'causation')),
    payload_json: payloadJson, payload_sha256: sha256(payloadJson), previous_event_hash: head?.event_hash || WORLD_EVENT_GENESIS_HASH,
    event_hash: '', occurred_at: occurredAt,
  };
  event.event_hash = computeWorldEventHash(event);
  return event;
}

export function insertWorldEvent(sqlite, event) {
  sqlite.prepare(`INSERT INTO world_event_journal(sequence,event_id,event_schema_version,event_kind,aggregate_kind,aggregate_id,aggregate_revision,session_id,wake_id,actor,command_id,causation_json,payload_json,payload_sha256,previous_event_hash,event_hash,occurred_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(...[
    event.sequence, event.event_id, event.event_schema_version, event.event_kind, event.aggregate_kind, event.aggregate_id,
    event.aggregate_revision, event.session_id, event.wake_id, event.actor, event.command_id, event.causation_json,
    event.payload_json, event.payload_sha256, event.previous_event_hash, event.event_hash, event.occurred_at,
  ]);
}

export function readWorldPhysicalProjection(sqlite) {
  return {
    nodes: sqlite.prepare(`SELECT ${NODE_COLUMNS.join(',')} FROM world_nodes ORDER BY id`).all(),
    edges: sqlite.prepare(`SELECT ${EDGE_COLUMNS.join(',')} FROM world_edges ORDER BY id`).all(),
    locations: sqlite.prepare(`SELECT ${LOCATION_COLUMNS.join(',')} FROM world_locations ORDER BY session_id`).all(),
  };
}

export function readWorldA2Projection(sqlite) {
  const operationalBoundary = sqlite.prepare("SELECT sequence,event_hash FROM world_event_journal WHERE event_kind='operational_snapshot.imported/v1' ORDER BY sequence LIMIT 1").get();
  return {
    ...readWorldPhysicalProjection(sqlite),
    fixtureRuntimes: sqlite.prepare(`SELECT ${FIXTURE_RUNTIME_COLUMNS.join(',')} FROM world_fixture_runtime ORDER BY fixture_id`).all(),
    timers: sqlite.prepare(`SELECT ${TIMER_COLUMNS.join(',')} FROM world_timers ORDER BY session_id`).all(),
    briefs: sqlite.prepare(`SELECT ${BRIEF_COLUMNS.join(',')} FROM world_work_briefs ORDER BY session_id,revision`).all(),
    approvals: sqlite.prepare(`SELECT ${APPROVAL_COLUMNS.join(',')} FROM world_approvals ORDER BY approval_id`).all(),
    passages: [], objectStates: [], legacyCustody: { actionReceipts: [], approvalReceipts: [] },
    operationalBoundary: operationalBoundary ? { sequence: operationalBoundary.sequence, eventHash: operationalBoundary.event_hash } : null,
    topologyExtension: null,
  };
}

export function readWorldProjection(sqlite) {
  const projection = readWorldA2Projection(sqlite);
  const topologyExtension = sqlite.prepare("SELECT sequence,event_hash FROM world_event_journal WHERE event_kind='topology.extended/v1' ORDER BY sequence LIMIT 1").get();
  const forestExtension = sqlite.prepare("SELECT sequence,event_hash FROM world_event_journal WHERE event_kind='topology.forest_installed/v1' ORDER BY sequence LIMIT 1").get();
  const binderWindowExtension = sqlite.prepare("SELECT sequence,event_hash FROM world_event_journal WHERE event_kind='topology.binder_window_installed/v1' ORDER BY sequence LIMIT 1").get();
  const spotlightExtension = sqlite.prepare("SELECT sequence,event_hash FROM world_event_journal WHERE event_kind='topology.spotlight_installed/v1' ORDER BY sequence LIMIT 1").get();
  return {
    ...projection,
    passages: sqlite.prepare(`SELECT ${PASSAGE_COLUMNS.join(',')} FROM world_passages ORDER BY edge_id`).all(),
    objectStates: sqlite.prepare(`SELECT ${OBJECT_STATE_COLUMNS.join(',')} FROM world_object_states ORDER BY object_id`).all(),
    topologyExtension: topologyExtension ? { sequence: topologyExtension.sequence, eventHash: topologyExtension.event_hash } : null,
    forestExtension: forestExtension ? { sequence: forestExtension.sequence, eventHash: forestExtension.event_hash } : null,
    binderWindowExtension: binderWindowExtension ? { sequence: binderWindowExtension.sequence, eventHash: binderWindowExtension.event_hash } : null,
    spotlightExtension: spotlightExtension ? { sequence: spotlightExtension.sequence, eventHash: spotlightExtension.event_hash } : null,
  };
}

export function custodyRowHash(row, kind) {
  const columns = kind === 'action' ? ACTION_RECEIPT_COLUMNS.filter(column => !column.startsWith('world_event_')) : APPROVAL_RECEIPT_COLUMNS.filter(column => !column.startsWith('world_event_'));
  return sha256(canonicalize(Object.fromEntries(columns.map(column => [column, row[column] ?? null]))));
}
