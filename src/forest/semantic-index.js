import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { canonicalize, sha256 } from '../core/hash.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS semantic_generations (
  generation_id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL CHECK(schema_version=1),
  identity_json TEXT NOT NULL,
  projection_policy TEXT NOT NULL CHECK(projection_policy='home_utterance_exact/v1'),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS semantic_vectors (
  generation_id TEXT NOT NULL REFERENCES semantic_generations(generation_id),
  entry_id TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  body_hash TEXT NOT NULL CHECK(length(body_hash)=64),
  projection_hash TEXT NOT NULL CHECK(length(projection_hash)=64),
  dimensions INTEGER NOT NULL CHECK(dimensions>0),
  vector_blob BLOB NOT NULL,
  indexed_at TEXT NOT NULL,
  PRIMARY KEY(generation_id,entry_id)
);
CREATE INDEX IF NOT EXISTS semantic_vectors_generation ON semantic_vectors(generation_id,entry_id);`;

function now() { return new Date().toISOString(); }
function asBuffer(vector) { return Buffer.from(new Float32Array(vector).buffer); }
function fromBuffer(buffer, dimensions) {
  const bytes = Buffer.from(buffer);
  if (bytes.byteLength !== dimensions * 4) throw new Error('Semantic vector byte length is invalid.');
  return new Float32Array(bytes.buffer, bytes.byteOffset, dimensions);
}
function dot(a, b) { let value = 0; for (let index = 0; index < a.length; index++) value += a[index] * b[index]; return value; }

export class SemanticIndexStore {
  constructor(path) {
    this.path = path;
    if (!existsSync(path)) mkdirSync(dirname(path), { recursive: true });
    this.sqlite = new DatabaseSync(path);
    this.sqlite.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;');
    this.sqlite.exec(SCHEMA);
  }

  ensureGeneration(identity) {
    const identityJson = canonicalize(identity);
    const generationId = `semantic_${sha256(canonicalize({ schemaVersion: 1, identity, projectionPolicy: 'home_utterance_exact/v1' }))}`;
    const existing = this.sqlite.prepare('SELECT identity_json AS identityJson FROM semantic_generations WHERE generation_id=?').get(generationId);
    if (existing && existing.identityJson !== identityJson) throw new Error('Semantic generation identity conflicts with stored projection custody.');
    if (!existing) this.sqlite.prepare(`INSERT INTO semantic_generations(generation_id,schema_version,identity_json,projection_policy,created_at)
      VALUES(?,1,?,'home_utterance_exact/v1',?)`).run(generationId, identityJson, now());
    return generationId;
  }

  missing(generationId, entries) {
    const present = new Map(this.sqlite.prepare('SELECT entry_id AS entryId,body_hash AS bodyHash FROM semantic_vectors WHERE generation_id=?').all(generationId).map(row => [row.entryId, row.bodyHash]));
    return entries.filter(entry => present.get(entry.entryId) !== entry.bodyHash);
  }

  put(generationId, entry, vector) {
    const existing = this.sqlite.prepare('SELECT body_hash AS bodyHash,projection_hash AS projectionHash FROM semantic_vectors WHERE generation_id=? AND entry_id=?').get(generationId, entry.entryId);
    const projectionHash = sha256(entry.body);
    if (existing) {
      if (existing.bodyHash !== entry.bodyHash || existing.projectionHash !== projectionHash) throw new Error('Semantic vector source custody conflicts with the Forest entry.');
      return false;
    }
    this.sqlite.prepare(`INSERT INTO semantic_vectors(generation_id,entry_id,source_event_id,body_hash,projection_hash,dimensions,vector_blob,indexed_at)
      VALUES(?,?,?,?,?,?,?,?)`).run(generationId, entry.entryId, entry.sourceEventId, entry.bodyHash, projectionHash, vector.length, asBuffer(vector), now());
    return true;
  }

  search(generationId, queryVector, { excludeEntryIds = [], limit = 48, includeVectors = false } = {}) {
    const excluded = new Set(excludeEntryIds);
    return this.sqlite.prepare(`SELECT entry_id AS entryId,source_event_id AS sourceEventId,body_hash AS bodyHash,dimensions,vector_blob AS vectorBlob
      FROM semantic_vectors WHERE generation_id=? ORDER BY entry_id`).all(generationId)
      .filter(row => !excluded.has(row.entryId))
      .map(row => {
        const vector = fromBuffer(row.vectorBlob, row.dimensions);
        return { entryId: row.entryId, sourceEventId: row.sourceEventId, bodyHash: row.bodyHash, score: dot(queryVector, vector), ...(includeVectors ? { vector: [...vector] } : {}) };
      })
      .sort((left, right) => right.score - left.score || left.entryId.localeCompare(right.entryId)).slice(0, limit);
  }

  count(generationId) { return this.sqlite.prepare('SELECT COUNT(*) AS count FROM semantic_vectors WHERE generation_id=?').get(generationId).count; }
  close() { this.sqlite.close(); }
}
