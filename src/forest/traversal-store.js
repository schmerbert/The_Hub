import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { canonicalize, id, sha256 } from '../core/hash.js';

const TABLES = ['forest_walk_journeys', 'forest_walk_junctions', 'forest_walk_offers', 'forest_walk_events', 'forest_walk_refusals', 'forest_walk_junction_frames', 'forest_walked_edges', 'forest_walk_wear_events', 'forest_feather_landings'];
const SCHEMA = `
CREATE TABLE IF NOT EXISTS forest_walk_metadata (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1), schema_version INTEGER NOT NULL CHECK(schema_version=3), created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS forest_walk_journeys (
  journey_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, entrance_wake_id TEXT NOT NULL,
  entrance_register TEXT NOT NULL CHECK(entrance_register IN ('physical','inquiry','recovery')),
  departure_place_id TEXT NOT NULL, departure_focus_id TEXT, return_pointer_json TEXT,
  tether_source_event_id TEXT NOT NULL,
  query_text TEXT NOT NULL, query_hash TEXT NOT NULL CHECK(length(query_hash)=64), initial_junction_id TEXT NOT NULL UNIQUE,
  generation_id TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS forest_walk_junctions (
  junction_id TEXT PRIMARY KEY, journey_id TEXT NOT NULL REFERENCES forest_walk_journeys(journey_id), ordinal INTEGER NOT NULL CHECK(ordinal>0),
  current_entry_id TEXT, current_body_hash TEXT, generation_id TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(journey_id,ordinal)
);
CREATE TABLE IF NOT EXISTS forest_walk_offers (
  offer_id TEXT PRIMARY KEY, junction_id TEXT NOT NULL REFERENCES forest_walk_junctions(junction_id), slot INTEGER NOT NULL CHECK(slot BETWEEN 1 AND 5),
  direction TEXT NOT NULL CHECK(direction IN ('branch','older','deeper','newer','conversation_older','conversation_newer','conversation_straight','semantic_left','semantic_straight','semantic_right')), entry_id TEXT NOT NULL, source_event_id TEXT NOT NULL,
  body_hash TEXT NOT NULL CHECK(length(body_hash)=64), score REAL, preview TEXT NOT NULL, preview_hash TEXT NOT NULL CHECK(length(preview_hash)=64),
  actor_kind TEXT NOT NULL CHECK(actor_kind IN ('user','resident')), source_timestamp TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(junction_id,slot), UNIQUE(junction_id,entry_id)
);
CREATE TABLE IF NOT EXISTS forest_walk_events (
  event_id TEXT PRIMARY KEY, journey_id TEXT NOT NULL REFERENCES forest_walk_journeys(journey_id), ordinal INTEGER NOT NULL CHECK(ordinal>0),
  event_kind TEXT NOT NULL CHECK(event_kind IN ('entered','stepped','read','backtracked','returned')),
  wake_id TEXT NOT NULL, tool_call_id TEXT NOT NULL, junction_id TEXT, offer_id TEXT, entry_id TEXT,
  payload_json TEXT NOT NULL, payload_hash TEXT NOT NULL CHECK(length(payload_hash)=64), created_at TEXT NOT NULL, UNIQUE(journey_id,ordinal), UNIQUE(journey_id,tool_call_id)
);
CREATE TABLE IF NOT EXISTS forest_walk_refusals (
  refusal_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, wake_id TEXT NOT NULL, tool_call_id TEXT NOT NULL,
  tool_name TEXT NOT NULL, arguments_json TEXT NOT NULL, error_code TEXT NOT NULL, message TEXT NOT NULL, created_at TEXT NOT NULL
  , UNIQUE(session_id,tool_call_id)
);
CREATE TABLE IF NOT EXISTS forest_walk_junction_frames (
  junction_id TEXT PRIMARY KEY REFERENCES forest_walk_junctions(junction_id), protocol_version TEXT NOT NULL CHECK(protocol_version IN ('legacy_flat/v2','directional/v3')),
  arrival_kind TEXT NOT NULL, chronology_heading TEXT, pole_axis_json TEXT, selector_receipt_json TEXT NOT NULL,
  selector_receipt_hash TEXT NOT NULL CHECK(length(selector_receipt_hash)=64), created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS forest_walked_edges (
  edge_id TEXT PRIMARY KEY, from_entry_id TEXT NOT NULL, to_entry_id TEXT NOT NULL, generation_id TEXT NOT NULL,
  first_journey_id TEXT NOT NULL, first_event_id TEXT NOT NULL, created_at TEXT NOT NULL,
  UNIQUE(from_entry_id,to_entry_id,generation_id)
);
CREATE TABLE IF NOT EXISTS forest_walk_wear_events (
  wear_id TEXT PRIMARY KEY, edge_id TEXT NOT NULL REFERENCES forest_walked_edges(edge_id), journey_id TEXT NOT NULL,
  walk_event_id TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(edge_id,walk_event_id)
);
CREATE TABLE IF NOT EXISTS forest_feather_landings (
  landing_id TEXT PRIMARY KEY, journey_id TEXT NOT NULL REFERENCES forest_walk_journeys(journey_id),
  junction_id TEXT NOT NULL REFERENCES forest_walk_junctions(junction_id), wake_id TEXT NOT NULL,
  entry_id TEXT NOT NULL, source_event_id TEXT NOT NULL, body_hash TEXT NOT NULL CHECK(length(body_hash)=64),
  preview TEXT NOT NULL, preview_hash TEXT NOT NULL CHECK(length(preview_hash)=64), actor_kind TEXT NOT NULL,
  source_timestamp TEXT NOT NULL, generation_id TEXT NOT NULL, roots_artifact_id TEXT NOT NULL, created_at TEXT NOT NULL,
  UNIQUE(journey_id,junction_id,wake_id,entry_id)
);
${TABLES.map(table => `CREATE TRIGGER IF NOT EXISTS ${table}_append_only_update BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TRIGGER IF NOT EXISTS ${table}_append_only_delete BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT, 'append-only table'); END;`).join('\n')}
`;

function now() { return new Date().toISOString(); }

export function migrateForestTraversalV3({ path, backupPath }) {
  if (!backupPath) throw Object.assign(new Error('A traversal-store backup destination is required before v3 migration.'), { code:'forest_walk_backup_required' });
  const db = new DatabaseSync(path);
  try {
    const version = db.prepare('SELECT schema_version AS version FROM forest_walk_metadata WHERE singleton=1').get()?.version;
    if (version === 3) return { migrated:false, schemaVersion:3 };
    if (version !== 2) throw Object.assign(new Error('Only traversal schema v2 can migrate to v3.'), { code:'forest_walk_schema_unsupported' });
    db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  } finally { db.close(); }
  mkdirSync(dirname(backupPath), { recursive:true });
  copyFileSync(path, backupPath, 1);
  const sqlite = new DatabaseSync(path);
  try {
    sqlite.exec('PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE;');
    sqlite.exec(`ALTER TABLE forest_walk_metadata RENAME TO forest_walk_metadata_v2_ancestry;
      ALTER TABLE forest_walk_offers RENAME TO forest_walk_offers_v2_ancestry;
      DROP TRIGGER IF EXISTS forest_walk_offers_append_only_update;
      DROP TRIGGER IF EXISTS forest_walk_offers_append_only_delete;`);
    sqlite.exec(SCHEMA);
    sqlite.exec(`INSERT INTO forest_walk_offers SELECT * FROM forest_walk_offers_v2_ancestry;
      INSERT OR IGNORE INTO forest_walk_junction_frames(junction_id,protocol_version,arrival_kind,chronology_heading,pole_axis_json,selector_receipt_json,selector_receipt_hash,created_at)
      SELECT junction_id,'legacy_flat/v2','legacy',NULL,NULL,'{}','${sha256('{}')}',created_at FROM forest_walk_junctions;
      CREATE TRIGGER forest_walk_offers_v2_ancestry_append_only_update BEFORE UPDATE ON forest_walk_offers_v2_ancestry BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
      CREATE TRIGGER forest_walk_offers_v2_ancestry_append_only_delete BEFORE DELETE ON forest_walk_offers_v2_ancestry BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
      INSERT INTO forest_walk_metadata(singleton,schema_version,created_at) VALUES(1,3,'${now()}');
      COMMIT; PRAGMA foreign_keys=ON;`);
    return { migrated:true, schemaVersion:3, backupPath };
  } catch (error) { try { sqlite.exec('ROLLBACK'); } catch {} throw error; }
  finally { sqlite.close(); }
}

export class ForestTraversalStore {
  constructor(path) {
    this.path = path;
    if (!existsSync(path)) mkdirSync(dirname(path), { recursive: true });
    this.sqlite = new DatabaseSync(path);
    this.sqlite.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;');
    const metadataExists = this.sqlite.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='forest_walk_metadata'").get();
    const priorVersion = metadataExists ? this.sqlite.prepare('SELECT schema_version AS version FROM forest_walk_metadata WHERE singleton=1').get()?.version : null;
    if (priorVersion === 1) {
      const journeyCount = this.sqlite.prepare('SELECT COUNT(*) AS count FROM forest_walk_journeys').get().count;
      if (journeyCount) throw Object.assign(new Error('Forest traversal v1 contains journeys and requires an explicit ancestry-preserving migration.'), { code: 'forest_walk_migration_required' });
      this.sqlite.exec('PRAGMA foreign_keys=OFF;');
      for (const table of [...TABLES].reverse()) this.sqlite.exec(`DROP TABLE IF EXISTS ${table}`);
      this.sqlite.exec('DROP TABLE IF EXISTS forest_walk_metadata; PRAGMA foreign_keys=ON;');
    } else if (priorVersion === 2) throw Object.assign(new Error('Forest traversal v2 requires an explicit ancestry-preserving v3 migration.'), { code: 'forest_walk_migration_required' });
    else if (priorVersion !== null && priorVersion !== 3) throw Object.assign(new Error('Forest traversal schema version is unsupported.'), { code: 'forest_walk_schema_unsupported' });
    this.sqlite.exec(SCHEMA);
    this.sqlite.prepare('INSERT OR IGNORE INTO forest_walk_metadata(singleton,schema_version,created_at) VALUES(1,3,?)').run(now());
  }

  transaction(fn) {
    this.sqlite.exec('BEGIN IMMEDIATE');
    try { const value = fn(); this.sqlite.exec('COMMIT'); return value; }
    catch (error) { try { this.sqlite.exec('ROLLBACK'); } catch {} throw error; }
  }

  activeJourney(sessionId) {
    const journeys = this.sqlite.prepare('SELECT * FROM forest_walk_journeys WHERE session_id=? ORDER BY created_at DESC,journey_id DESC').all(sessionId);
    return journeys.find(journey => !this.sqlite.prepare("SELECT 1 FROM forest_walk_events WHERE journey_id=? AND event_kind='returned'").get(journey.journey_id)) || null;
  }

  projection(sessionId) {
    const journey = this.activeJourney(sessionId);
    if (!journey) return { active: false, sessionId };
    const events = this.sqlite.prepare('SELECT * FROM forest_walk_events WHERE journey_id=? ORDER BY ordinal').all(journey.journey_id);
    const stack = [];
    for (const event of events) {
      if (event.event_kind === 'stepped') stack.push(event);
      else if (event.event_kind === 'backtracked') stack.pop();
    }
    const currentJunctionId = stack.at(-1)?.payload_json ? JSON.parse(stack.at(-1).payload_json).toJunctionId : journey.initial_junction_id;
    const junction = this.sqlite.prepare('SELECT * FROM forest_walk_junctions WHERE junction_id=?').get(currentJunctionId);
    const offers = this.sqlite.prepare('SELECT * FROM forest_walk_offers WHERE junction_id=? ORDER BY slot').all(currentJunctionId);
    const frame = this.sqlite.prepare('SELECT * FROM forest_walk_junction_frames WHERE junction_id=?').get(currentJunctionId);
    return {
      active: true, sessionId, journeyId: journey.journey_id, entranceRegister: journey.entrance_register,
      departurePlaceId: journey.departure_place_id, departureFocusId: journey.departure_focus_id || null,
      returnPointer: journey.return_pointer_json ? JSON.parse(journey.return_pointer_json) : null,
      tetherSourceEventId: journey.tether_source_event_id, stepsFromEntrance: stack.length, depth: stack.length,
      currentEntryId: junction.current_entry_id || null, currentBodyHash: junction.current_body_hash || null,
      junctionId: junction.junction_id, junctionOrdinal: junction.ordinal,
      frame: frame ? { protocolVersion:frame.protocol_version, arrivalKind:frame.arrival_kind, chronologyHeading:frame.chronology_heading || null, poleAxis:frame.pole_axis_json ? JSON.parse(frame.pole_axis_json) : null } : { protocolVersion:'legacy_flat/v2', arrivalKind:'legacy' },
      offers: offers.map(row => ({
        offerId: row.offer_id, slot: row.slot, direction: row.direction, entryId: row.entry_id,
        sourceEventId: row.source_event_id, bodyHash: row.body_hash, score: row.score,
        preview: row.preview, previewHash: row.preview_hash, actorKind: row.actor_kind, sourceTimestamp: row.source_timestamp,
      })),
    };
  }

  walkedEntryIds(journeyId) {
    return this.sqlite.prepare("SELECT entry_id AS entryId FROM forest_walk_events WHERE journey_id=? AND event_kind='stepped' ORDER BY ordinal")
      .all(journeyId).map(row => row.entryId);
  }

  landFeathers({ sessionId, wakeId, generationId, rootsArtifactId, atoms }) {
    const projection = this.projection(sessionId);
    if (!projection.active || !Array.isArray(atoms) || !atoms.length) return [];
    return this.transaction(() => atoms.map(atom => {
      const landingId = atom?.bearing?.offerId;
      if (!landingId || atom.bearing.kind !== 'passing_feather') throw Object.assign(new Error('Passing feather coordinates are invalid.'), { code:'forest_feather_invalid' });
      const preview = atom.exactText || '';
      this.sqlite.prepare(`INSERT OR IGNORE INTO forest_feather_landings(landing_id,journey_id,junction_id,wake_id,entry_id,source_event_id,body_hash,preview,preview_hash,actor_kind,source_timestamp,generation_id,roots_artifact_id,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(landingId,projection.journeyId,projection.junctionId,wakeId,atom.entryId,atom.sourceEventId,atom.sourceBodyHash,preview,sha256(preview),atom.actorKind,atom.sourceTimestamp,generationId,rootsArtifactId,now());
      return landingId;
    }));
  }

  featherLanding({ sessionId, wakeId, landingId }) {
    const projection = this.projection(sessionId);
    if (!projection.active) return null;
    const row = this.sqlite.prepare(`SELECT * FROM forest_feather_landings WHERE landing_id=? AND journey_id=? AND junction_id=? AND wake_id=?`).get(landingId,projection.journeyId,projection.junctionId,wakeId);
    return row ? { offerId:row.landing_id, direction:'ambient_feather', entryId:row.entry_id, sourceEventId:row.source_event_id, bodyHash:row.body_hash, preview:row.preview, actorKind:row.actor_kind, sourceTimestamp:row.source_timestamp, rootsArtifactId:row.roots_artifact_id } : null;
  }

  insertJunction({ journeyId, ordinal, currentEntryId = null, currentBodyHash = null, generationId, offers, frame, createdAt }) {
    const junctionId = id('forest_junction');
    this.sqlite.prepare('INSERT INTO forest_walk_junctions(junction_id,journey_id,ordinal,current_entry_id,current_body_hash,generation_id,created_at) VALUES(?,?,?,?,?,?,?)')
      .run(junctionId, journeyId, ordinal, currentEntryId, currentBodyHash, generationId, createdAt);
    offers.forEach((offer, index) => {
      const offerId = id('forest_offer');
      this.sqlite.prepare(`INSERT INTO forest_walk_offers(offer_id,junction_id,slot,direction,entry_id,source_event_id,body_hash,score,preview,preview_hash,actor_kind,source_timestamp,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(offerId,junctionId,index + 1,offer.direction,offer.entryId,offer.sourceEventId,offer.bodyHash,offer.score ?? null,offer.preview,sha256(offer.preview),offer.actorKind,offer.sourceTimestamp,createdAt);
    });
    const receiptJson = canonicalize(frame?.receipt || {});
    this.sqlite.prepare(`INSERT INTO forest_walk_junction_frames(junction_id,protocol_version,arrival_kind,chronology_heading,pole_axis_json,selector_receipt_json,selector_receipt_hash,created_at)
      VALUES(?,?,?,?,?,?,?,?)`).run(junctionId,'directional/v3',frame?.arrivalKind || 'semantic',frame?.chronologyHeading || null,frame?.poleAxis ? canonicalize(frame.poleAxis) : null,receiptJson,sha256(receiptJson),createdAt);
    return junctionId;
  }

  appendEvent({ journeyId, kind, wakeId, toolCallId, junctionId = null, offerId = null, entryId = null, payload = {} }) {
    const ordinal = this.sqlite.prepare('SELECT COUNT(*) AS count FROM forest_walk_events WHERE journey_id=?').get(journeyId).count + 1;
    const payloadJson = canonicalize(payload); const eventId = id('forest_walk');
    this.sqlite.prepare(`INSERT INTO forest_walk_events(event_id,journey_id,ordinal,event_kind,wake_id,tool_call_id,junction_id,offer_id,entry_id,payload_json,payload_hash,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(eventId,journeyId,ordinal,kind,wakeId,toolCallId,junctionId,offerId,entryId,payloadJson,sha256(payloadJson),now());
    return eventId;
  }

  enter({ sessionId, wakeId, toolCallId, entranceRegister, departurePlaceId, departureFocusId = null, returnPointer = null, tetherSourceEventId, queryText, generationId, offers, frame }) {
    if (this.activeJourney(sessionId)) throw Object.assign(new Error('A Forest walk is already active.'), { code: 'forest_walk_already_active' });
    return this.transaction(() => {
      const journeyId = id('forest_journey'); const createdAt = now(); const initialJunctionId = id('forest_junction');
      this.sqlite.prepare(`INSERT INTO forest_walk_journeys(journey_id,session_id,entrance_wake_id,entrance_register,departure_place_id,departure_focus_id,return_pointer_json,tether_source_event_id,query_text,query_hash,initial_junction_id,generation_id,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(journeyId,sessionId,wakeId,entranceRegister,departurePlaceId,departureFocusId,returnPointer ? canonicalize(returnPointer) : null,tetherSourceEventId,queryText,sha256(queryText),initialJunctionId,generationId,createdAt);
      this.sqlite.prepare('INSERT INTO forest_walk_junctions(junction_id,journey_id,ordinal,current_entry_id,current_body_hash,generation_id,created_at) VALUES(?,?,1,NULL,NULL,?,?)').run(initialJunctionId,journeyId,generationId,createdAt);
      offers.forEach((offer, index) => this.sqlite.prepare(`INSERT INTO forest_walk_offers(offer_id,junction_id,slot,direction,entry_id,source_event_id,body_hash,score,preview,preview_hash,actor_kind,source_timestamp,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id('forest_offer'),initialJunctionId,index + 1,offer.direction,offer.entryId,offer.sourceEventId,offer.bodyHash,offer.score ?? null,offer.preview,sha256(offer.preview),offer.actorKind,offer.sourceTimestamp,createdAt));
      const receiptJson = canonicalize(frame?.receipt || {});
      this.sqlite.prepare(`INSERT INTO forest_walk_junction_frames(junction_id,protocol_version,arrival_kind,chronology_heading,pole_axis_json,selector_receipt_json,selector_receipt_hash,created_at)
        VALUES(?,?,?,?,?,?,?,?)`).run(initialJunctionId,'directional/v3','entrance',null,frame?.poleAxis ? canonicalize(frame.poleAxis) : null,receiptJson,sha256(receiptJson),createdAt);
      const eventId = this.appendEvent({ journeyId, kind: 'entered', wakeId, toolCallId, junctionId: initialJunctionId, payload: { entranceRegister, departurePlaceId, departureFocusId, returnPointer, tetherSourceEventId, queryHash: sha256(queryText) } });
      return { journeyId, junctionId: initialJunctionId, eventId };
    });
  }

  step({ sessionId, wakeId, toolCallId, offerId, generationId, offers, currentEntry, frame, selectedBearing = null }) {
    const projection = this.projection(sessionId);
    if (!projection.active) throw Object.assign(new Error('No Forest walk is active.'), { code: 'forest_walk_not_active' });
    const selected = projection.offers.find(offer => offer.offerId === offerId) || selectedBearing;
    if (!selected) throw Object.assign(new Error('That bearing does not belong to the current clearing.'), { code: 'forest_walk_offer_stale' });
    return this.transaction(() => {
      const ordinal = this.sqlite.prepare('SELECT COALESCE(MAX(ordinal),0) + 1 AS ordinal FROM forest_walk_junctions WHERE journey_id=?').get(projection.journeyId).ordinal;
      const junctionId = this.insertJunction({ journeyId: projection.journeyId, ordinal, currentEntryId: currentEntry.entryId, currentBodyHash: currentEntry.bodyHash, generationId, offers, frame, createdAt: now() });
      const eventId = this.appendEvent({ journeyId: projection.journeyId, kind: 'stepped', wakeId, toolCallId, junctionId: projection.junctionId, offerId, entryId: currentEntry.entryId, payload: { fromJunctionId: projection.junctionId, toJunctionId: junctionId, selectedBodyHash: currentEntry.bodyHash, provenance:selected.direction === 'ambient_feather' ? 'ambient_feather' : selected.direction } });
      if (projection.currentEntryId && (selected.direction.startsWith('semantic_') || selected.direction === 'ambient_feather')) {
        let edge = this.sqlite.prepare('SELECT edge_id AS edgeId FROM forest_walked_edges WHERE from_entry_id=? AND to_entry_id=? AND generation_id=?').get(projection.currentEntryId,currentEntry.entryId,generationId);
        if (!edge) { edge = { edgeId:id('forest_edge') }; this.sqlite.prepare('INSERT INTO forest_walked_edges(edge_id,from_entry_id,to_entry_id,generation_id,first_journey_id,first_event_id,created_at) VALUES(?,?,?,?,?,?,?)').run(edge.edgeId,projection.currentEntryId,currentEntry.entryId,generationId,projection.journeyId,eventId,now()); }
        this.sqlite.prepare('INSERT INTO forest_walk_wear_events(wear_id,edge_id,journey_id,walk_event_id,created_at) VALUES(?,?,?,?,?)').run(id('forest_wear'),edge.edgeId,projection.journeyId,eventId,now());
      }
      return { journeyId: projection.journeyId, junctionId, eventId, selected };
    });
  }

  appendSimple({ sessionId, wakeId, toolCallId, kind, entryId = null, payload = {} }) {
    const projection = this.projection(sessionId);
    if (!projection.active) throw Object.assign(new Error('No Forest walk is active.'), { code: 'forest_walk_not_active' });
    return this.transaction(() => ({ projection, eventId: this.appendEvent({ journeyId: projection.journeyId, kind, wakeId, toolCallId, junctionId: projection.junctionId, entryId, payload }) }));
  }

  refuse({ sessionId, wakeId, toolCallId, toolName, args, error }) {
    const refusalId = id('forest_refusal');
    this.sqlite.prepare('INSERT INTO forest_walk_refusals(refusal_id,session_id,wake_id,tool_call_id,tool_name,arguments_json,error_code,message,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(refusalId,sessionId,wakeId,toolCallId,toolName,canonicalize(args || {}),error?.code || 'forest_walk_refused',String(error?.message || 'Forest walking was refused.').slice(0,512),now());
    return refusalId;
  }

  verify() {
    const mismatches = [];
    for (const table of TABLES) for (const action of ['update','delete']) if (!this.sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='trigger' AND name=?").get(`${table}_append_only_${action}`)) mismatches.push({ code: 'forest_walk_trigger_missing', table, action });
    for (const row of this.sqlite.prepare('SELECT event_id,payload_json,payload_hash FROM forest_walk_events').all()) if (sha256(row.payload_json) !== row.payload_hash) mismatches.push({ code: 'forest_walk_event_hash_mismatch', eventId: row.event_id });
    for (const row of this.sqlite.prepare('SELECT offer_id,preview,preview_hash FROM forest_walk_offers').all()) if (sha256(row.preview) !== row.preview_hash) mismatches.push({ code: 'forest_walk_offer_hash_mismatch', offerId: row.offer_id });
    for (const row of this.sqlite.prepare('SELECT landing_id,preview,preview_hash FROM forest_feather_landings').all()) if (sha256(row.preview) !== row.preview_hash) mismatches.push({ code: 'forest_feather_preview_hash_mismatch', landingId: row.landing_id });
    return { verified: mismatches.length === 0, mismatches };
  }

  close() { this.sqlite.close(); }
}
