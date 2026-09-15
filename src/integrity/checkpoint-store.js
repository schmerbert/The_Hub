import { existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { id } from '../core/hash.js';
import {
  VERIFIED_ANCESTRY_FORMAT_VERSION,
  canonicalJson,
  canonicalCheckpointEnvelope,
  hashCheckpointEnvelope,
  hashJson,
  isSha256,
  normalizeDependencies,
  normalizeName,
  normalizeVersion,
  buildCheckpointEnvelope,
} from './checkpoint-format.js';

const CHECKPOINT_SCHEMA_VERSION = 1;
const MAX_STATUS_LIMIT = 32;
const NOW = () => new Date().toISOString();

const SCHEMA = `
CREATE TABLE IF NOT EXISTS verified_ancestry_metadata (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1),
  schema_version INTEGER NOT NULL,
  format_version TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS verified_ancestry_generations (
  generation_number INTEGER PRIMARY KEY AUTOINCREMENT,
  generation_id TEXT NOT NULL UNIQUE,
  domain TEXT NOT NULL,
  format_version TEXT NOT NULL,
  verifier_version TEXT NOT NULL,
  schema_version TEXT,
  projector_version TEXT,
  topology_version TEXT,
  store_identity_json TEXT NOT NULL,
  store_generation_json TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  manifest_sha256 TEXT NOT NULL CHECK(length(manifest_sha256)=64),
  dependencies_json TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256)=64),
  envelope_json TEXT NOT NULL,
  checkpoint_sha256 TEXT NOT NULL UNIQUE CHECK(length(checkpoint_sha256)=64),
  predecessor_checkpoint_sha256 TEXT CHECK(predecessor_checkpoint_sha256 IS NULL OR length(predecessor_checkpoint_sha256)=64),
  completed_at TEXT NOT NULL,
  publication_state TEXT NOT NULL CHECK(publication_state IN ('publishing','complete'))
);
CREATE TABLE IF NOT EXISTS verified_ancestry_payloads (
  generation_id TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256)=64)
);
CREATE TABLE IF NOT EXISTS verified_ancestry_indexes (
  generation_id TEXT NOT NULL,
  index_name TEXT NOT NULL,
  index_json TEXT NOT NULL,
  index_sha256 TEXT NOT NULL CHECK(length(index_sha256)=64),
  PRIMARY KEY(generation_id,index_name)
);
CREATE TRIGGER IF NOT EXISTS verified_ancestry_metadata_update BEFORE UPDATE ON verified_ancestry_metadata BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TRIGGER IF NOT EXISTS verified_ancestry_metadata_delete BEFORE DELETE ON verified_ancestry_metadata BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TRIGGER IF NOT EXISTS verified_ancestry_generations_update BEFORE UPDATE ON verified_ancestry_generations BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TRIGGER IF NOT EXISTS verified_ancestry_generations_delete BEFORE DELETE ON verified_ancestry_generations BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TRIGGER IF NOT EXISTS verified_ancestry_payloads_update BEFORE UPDATE ON verified_ancestry_payloads BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TRIGGER IF NOT EXISTS verified_ancestry_payloads_delete BEFORE DELETE ON verified_ancestry_payloads BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TRIGGER IF NOT EXISTS verified_ancestry_indexes_update BEFORE UPDATE ON verified_ancestry_indexes BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TRIGGER IF NOT EXISTS verified_ancestry_indexes_delete BEFORE DELETE ON verified_ancestry_indexes BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
`;

const EXPECTED_COLUMNS = {
  verified_ancestry_metadata: ['singleton', 'schema_version', 'format_version', 'created_at'],
  verified_ancestry_generations: ['generation_number', 'generation_id', 'domain', 'format_version', 'verifier_version', 'schema_version', 'projector_version', 'topology_version', 'store_identity_json', 'store_generation_json', 'manifest_json', 'manifest_sha256', 'dependencies_json', 'payload_sha256', 'envelope_json', 'checkpoint_sha256', 'predecessor_checkpoint_sha256', 'completed_at', 'publication_state'],
  verified_ancestry_payloads: ['generation_id', 'payload_json', 'payload_sha256'],
  verified_ancestry_indexes: ['generation_id', 'index_name', 'index_json', 'index_sha256'],
};

const REQUIRED_TRIGGERS = [
  'verified_ancestry_metadata_update', 'verified_ancestry_metadata_delete',
  'verified_ancestry_generations_update', 'verified_ancestry_generations_delete',
  'verified_ancestry_payloads_update', 'verified_ancestry_payloads_delete',
  'verified_ancestry_indexes_update', 'verified_ancestry_indexes_delete',
];

function error(code, message, details = undefined) {
  const result = Object.assign(new Error(message), { code });
  if (details !== undefined) result.details = details;
  return result;
}

function fail(code, message, details) { throw error(code, message, details); }

function parseJson(json, label) {
  try { return JSON.parse(json); }
  catch { fail('verified_ancestry_corrupt', `${label} is not valid JSON.`); }
}

function safeCanonical(value, label) {
  try { return canonicalJson(value, label); }
  catch (cause) { fail('verified_ancestry_corrupt', `${label} is not canonically serializable.`, { cause: cause.message }); }
}

function sameJson(left, right, label) {
  return safeCanonical(left, label) === safeCanonical(right, label);
}

function boundedLimit(limit) {
  if (limit === undefined) return MAX_STATUS_LIMIT;
  if (!Number.isSafeInteger(limit) || limit < 0) fail('verified_ancestry_invalid_argument', 'limit must be a non-negative safe integer.');
  return Math.min(limit, MAX_STATUS_LIMIT);
}

function dependencyCompatibility(dependencies) {
  return dependencies === undefined ? undefined : normalizeDependencies(dependencies);
}

export class VerifiedAncestryStore {
  constructor(path, { formatVersion = VERIFIED_ANCESTRY_FORMAT_VERSION, busyTimeoutMs = 5000 } = {}) {
    if (typeof path !== 'string' || !path) fail('verified_ancestry_invalid_argument', 'A checkpoint store path is required.');
    normalizeName(formatVersion, 'formatVersion');
    this.path = path;
    this.formatVersion = formatVersion;
    this.busyTimeoutMs = busyTimeoutMs;
    this.sqlite = null;
    this.schemaStanding = { status: 'ready', code: null };
    mkdirSync(dirname(path), { recursive: true });
    this._open();
  }

  _open() {
    try {
      this.sqlite = new DatabaseSync(this.path);
      this.sqlite.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=${Number.isSafeInteger(this.busyTimeoutMs) && this.busyTimeoutMs >= 0 ? this.busyTimeoutMs : 5000};`);
      const tableExists = this.sqlite.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='verified_ancestry_metadata'").get();
      if (tableExists) {
        const metadata = this.sqlite.prepare('SELECT schema_version AS schemaVersion, format_version AS formatVersion FROM verified_ancestry_metadata WHERE singleton=1').get();
        if (!metadata || metadata.schemaVersion !== CHECKPOINT_SCHEMA_VERSION || metadata.formatVersion !== this.formatVersion) {
          this.schemaStanding = { status: 'refused', code: 'verified_ancestry_schema_unsupported' };
          return;
        }
      }
      this.sqlite.exec(SCHEMA);
      this.sqlite.prepare('INSERT OR IGNORE INTO verified_ancestry_metadata(singleton,schema_version,format_version,created_at) VALUES(1,?,?,?)').run(CHECKPOINT_SCHEMA_VERSION, this.formatVersion, NOW());
      this._schemaCheck();
    } catch (cause) {
      this.schemaStanding = { status: 'refused', code: cause.code || 'verified_ancestry_schema_unsupported', message: cause.message };
    }
  }

  _schemaCheck() {
    for (const [table, expected] of Object.entries(EXPECTED_COLUMNS)) {
      const rows = this.sqlite.prepare(`PRAGMA table_info(${table})`).all();
      const actual = rows.map(row => row.name);
      if (!expected.every(column => actual.includes(column))) fail('verified_ancestry_schema_unsupported', `Checkpoint table ${table} has an incompatible schema.`);
    }
    const triggerRows = this.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='trigger'").all();
    const triggers = new Set(triggerRows.map(row => row.name));
    if (!REQUIRED_TRIGGERS.every(name => triggers.has(name))) fail('verified_ancestry_schema_unsupported', 'Checkpoint append-only triggers are incomplete.');
    const metadata = this.sqlite.prepare('SELECT schema_version AS schemaVersion, format_version AS formatVersion FROM verified_ancestry_metadata WHERE singleton=1').get();
    if (!metadata || metadata.schemaVersion !== CHECKPOINT_SCHEMA_VERSION || metadata.formatVersion !== this.formatVersion) fail('verified_ancestry_schema_unsupported', 'Checkpoint metadata is incompatible.');
    return true;
  }

  _assertReady() {
    if (!this.sqlite || this.schemaStanding.status !== 'ready') fail(this.schemaStanding.code || 'verified_ancestry_checkpoint_miss', this.schemaStanding.message || 'Verified ancestry checkpoint store is unavailable.');
    try { this._schemaCheck(); }
    catch (cause) { this.schemaStanding = { status: 'refused', code: cause.code || 'verified_ancestry_schema_unsupported', message: cause.message }; throw cause; }
  }

  transaction(fn) {
    this._assertReady();
    this.sqlite.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.sqlite.exec('COMMIT'); return result; }
    catch (cause) { try { this.sqlite.exec('ROLLBACK'); } catch {} throw cause; }
  }

  _rowByGenerationId(generationId) { return this.sqlite.prepare('SELECT * FROM verified_ancestry_generations WHERE generation_id=?').get(generationId); }
  _rowByCheckpointHash(checkpointHash) { return this.sqlite.prepare('SELECT * FROM verified_ancestry_generations WHERE checkpoint_sha256=?').get(checkpointHash); }

  publish({
    domain,
    generationId = id('verified_ancestry_generation'),
    predecessorCheckpointHash = null,
    verifierVersion,
    schemaVersion = null,
    projectorVersion = null,
    topologyVersion = null,
    storeIdentity,
    storeGeneration = null,
    manifest,
    dependencies = [],
    payload,
    indexes = {},
    completedAt = NOW(),
  }) {
    this._assertReady();
    normalizeName(domain, 'domain');
    normalizeName(generationId, 'generationId');
    if (!indexes || typeof indexes !== 'object' || Array.isArray(indexes)) fail('verified_ancestry_invalid_argument', 'indexes must be an object keyed by index name.');
    const payloadJson = canonicalJson(payload, 'payload');
    const payloadHash = hashJson(payload, 'payload');
    const normalizedDependencies = normalizeDependencies(dependencies);
    const envelope = buildCheckpointEnvelope({ formatVersion: this.formatVersion, domain, generationId, predecessorCheckpointHash, verifierVersion, schemaVersion, projectorVersion, topologyVersion, storeIdentity, storeGeneration, manifest, dependencies: normalizedDependencies, payloadHash, completedAt });
    const envelopeJson = canonicalCheckpointEnvelope(envelope);
    const checkpointHash = hashCheckpointEnvelope(envelope);
    const indexRows = Object.entries(indexes).sort(([a], [b]) => a.localeCompare(b)).map(([name, value]) => {
      normalizeName(name, 'index name');
      const indexJson = canonicalJson(value, `index ${name}`);
      return { name, indexJson, indexHash: hashJson(value, `index ${name}`) };
    });
    return this.transaction(() => {
      if (this._rowByGenerationId(generationId)) fail('verified_ancestry_generation_exists', `Checkpoint generation ${generationId} already exists.`);
      const latest = this.sqlite.prepare('SELECT * FROM verified_ancestry_generations WHERE domain=? ORDER BY generation_number DESC LIMIT 1').get(domain);
      if (latest && latest.publication_state !== 'complete') fail('verified_ancestry_incomplete', `The latest ${domain} checkpoint generation is incomplete.`);
      if (latest && predecessorCheckpointHash !== latest.checkpoint_sha256) fail('verified_ancestry_predecessor_mismatch', `Checkpoint generation ${generationId} must name the latest ${domain} checkpoint as its predecessor.`);
      if (!latest && predecessorCheckpointHash !== null) {
        const predecessor = this._rowByCheckpointHash(predecessorCheckpointHash);
        if (!predecessor || predecessor.domain !== domain) fail('verified_ancestry_predecessor_mismatch', 'Checkpoint predecessor does not resolve to the same domain.');
      }
      if (predecessorCheckpointHash !== null) {
        const predecessor = this._rowByCheckpointHash(predecessorCheckpointHash);
        if (!predecessor || predecessor.domain !== domain || predecessor.publication_state !== 'complete') fail('verified_ancestry_predecessor_mismatch', 'Checkpoint predecessor does not resolve to a complete same-domain generation.');
      }
      this.sqlite.prepare(`INSERT INTO verified_ancestry_generations(
        generation_id,domain,format_version,verifier_version,schema_version,projector_version,topology_version,
        store_identity_json,store_generation_json,manifest_json,manifest_sha256,dependencies_json,payload_sha256,
        envelope_json,checkpoint_sha256,predecessor_checkpoint_sha256,completed_at,publication_state
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        generationId, domain, this.formatVersion, envelope.verifierVersion, envelope.schemaVersion, envelope.projectorVersion, envelope.topologyVersion,
        canonicalJson(storeIdentity, 'storeIdentity'), canonicalJson(storeGeneration, 'storeGeneration'), canonicalJson(manifest, 'manifest'), envelope.manifestHash,
        canonicalJson(normalizedDependencies, 'dependencies'), payloadHash, envelopeJson, checkpointHash, predecessorCheckpointHash, completedAt, 'complete',
      );
      // The envelope and payload/index rows are committed as one SQLite unit.
      this.sqlite.prepare('INSERT INTO verified_ancestry_payloads(generation_id,payload_json,payload_sha256) VALUES(?,?,?)').run(generationId, payloadJson, payloadHash);
      const insertIndex = this.sqlite.prepare('INSERT INTO verified_ancestry_indexes(generation_id,index_name,index_json,index_sha256) VALUES(?,?,?,?)');
      for (const row of indexRows) insertIndex.run(generationId, row.name, row.indexJson, row.indexHash);
      return this._materialize(this._rowByGenerationId(generationId), { includePayload: true });
    });
  }

  _materialize(row, { includePayload = true } = {}) {
    if (!row) return null;
    const envelope = parseJson(row.envelope_json, 'checkpoint envelope');
    const result = {
      formatVersion: row.format_version,
      domain: row.domain,
      generationId: row.generation_id,
      generationNumber: row.generation_number,
      predecessorCheckpointHash: row.predecessor_checkpoint_sha256,
      verifierVersion: row.verifier_version,
      schemaVersion: row.schema_version,
      projectorVersion: row.projector_version,
      topologyVersion: row.topology_version,
      storeIdentity: parseJson(row.store_identity_json, 'store identity'),
      storeGeneration: parseJson(row.store_generation_json, 'store generation'),
      manifest: parseJson(row.manifest_json, 'manifest'),
      manifestHash: row.manifest_sha256,
      manifestSha256: row.manifest_sha256,
      dependencies: parseJson(row.dependencies_json, 'dependencies'),
      payloadHash: row.payload_sha256,
      payloadSha256: row.payload_sha256,
      checkpointHash: row.checkpoint_sha256,
      checkpointSha256: row.checkpoint_sha256,
      completedAt: row.completed_at,
      publicationState: row.publication_state,
      envelope,
    };
    if (includePayload) {
      const payload = this.sqlite.prepare('SELECT payload_json,payload_sha256 FROM verified_ancestry_payloads WHERE generation_id=?').get(row.generation_id);
      if (payload) { result.payload = parseJson(payload.payload_json, 'checkpoint payload'); result.payloadHash = payload.payload_sha256; }
      const indexes = this.sqlite.prepare('SELECT index_name,index_json,index_sha256 FROM verified_ancestry_indexes WHERE generation_id=? ORDER BY index_name').all(row.generation_id);
      result.indexes = Object.fromEntries(indexes.map(index => [index.index_name, parseJson(index.index_json, `checkpoint index ${index.index_name}`)]));
    }
    return result;
  }

  _verifyRow(row, { includePayload = true } = {}) {
    if (!row) fail('verified_ancestry_not_found', 'Checkpoint generation was not found.');
    if (row.publication_state !== 'complete') fail('verified_ancestry_incomplete', `Checkpoint generation ${row.generation_id} is incomplete.`);
    const material = this._materialize(row, { includePayload });
    const expectedEnvelope = buildCheckpointEnvelope({
      formatVersion: row.format_version, domain: row.domain, generationId: row.generation_id,
      predecessorCheckpointHash: row.predecessor_checkpoint_sha256, verifierVersion: row.verifier_version,
      schemaVersion: row.schema_version, projectorVersion: row.projector_version, topologyVersion: row.topology_version,
      storeIdentity: material.storeIdentity, storeGeneration: material.storeGeneration, manifest: material.manifest,
      dependencies: material.dependencies, payloadHash: row.payload_sha256, completedAt: row.completed_at,
    });
    if (row.envelope_json !== canonicalCheckpointEnvelope(expectedEnvelope) || row.checkpoint_sha256 !== hashCheckpointEnvelope(expectedEnvelope)) fail('verified_ancestry_corrupt', `Checkpoint envelope ${row.generation_id} has drifted.`);
    if (row.manifest_sha256 !== hashJson(material.manifest, 'manifest')) fail('verified_ancestry_corrupt', `Checkpoint manifest ${row.generation_id} has drifted.`);
    if (!isSha256(row.payload_sha256)) fail('verified_ancestry_corrupt', `Checkpoint payload hash ${row.generation_id} is invalid.`);
    const payload = this.sqlite.prepare('SELECT payload_json,payload_sha256 FROM verified_ancestry_payloads WHERE generation_id=?').get(row.generation_id);
    if (!payload) fail('verified_ancestry_incomplete', `Checkpoint payload ${row.generation_id} is incomplete.`);
    const payloadValue = parseJson(payload.payload_json, 'checkpoint payload');
    if (payload.payload_json !== canonicalJson(payloadValue, 'checkpoint payload') || payload.payload_sha256 !== hashJson(payloadValue, 'checkpoint payload') || payload.payload_sha256 !== row.payload_sha256) fail('verified_ancestry_corrupt', `Checkpoint payload ${row.generation_id} has drifted.`);
    const indexes = this.sqlite.prepare('SELECT index_name,index_json,index_sha256 FROM verified_ancestry_indexes WHERE generation_id=? ORDER BY index_name').all(row.generation_id);
    for (const index of indexes) {
      const value = parseJson(index.index_json, `checkpoint index ${index.index_name}`);
      if (index.index_json !== canonicalJson(value, `checkpoint index ${index.index_name}`) || index.index_sha256 !== hashJson(value, `checkpoint index ${index.index_name}`)) fail('verified_ancestry_corrupt', `Checkpoint index ${index.index_name} has drifted.`);
    }
    const orphanPayload = this.sqlite.prepare('SELECT generation_id FROM verified_ancestry_payloads WHERE generation_id NOT IN (SELECT generation_id FROM verified_ancestry_generations) LIMIT 1').get();
    const orphanIndex = this.sqlite.prepare('SELECT generation_id FROM verified_ancestry_indexes WHERE generation_id NOT IN (SELECT generation_id FROM verified_ancestry_generations) LIMIT 1').get();
    if (orphanPayload || orphanIndex) fail('verified_ancestry_incomplete', 'Checkpoint payload rows are not atomically paired with an envelope.');
    return material;
  }

  _verifyLineage(row) {
    const visited = new Set();
    let current = row;
    while (current) {
      if (visited.has(current.generation_id)) fail('verified_ancestry_corrupt', 'Checkpoint predecessor cycle detected.');
      visited.add(current.generation_id);
      this._verifyRow(current, { includePayload: false });
      const prior = this.sqlite.prepare('SELECT * FROM verified_ancestry_generations WHERE domain=? AND generation_number<? ORDER BY generation_number DESC LIMIT 1').get(current.domain, current.generation_number);
      if (current.predecessor_checkpoint_sha256 === null) {
        if (prior) fail('verified_ancestry_predecessor_mismatch', `Checkpoint root ${current.generation_id} unexpectedly has an earlier generation.`);
        return;
      }
      if (!prior || prior.checkpoint_sha256 !== current.predecessor_checkpoint_sha256) fail('verified_ancestry_predecessor_mismatch', `Checkpoint predecessor for ${current.generation_id} is not the immediately prior generation.`);
      current = prior;
    }
  }

  getGeneration(generationId, { verify = true, includePayload = true } = {}) {
    this._assertReady();
    const row = this._rowByGenerationId(generationId);
    if (!row) return null;
    if (verify) this._verifyLineage(row);
    return this._materialize(row, { includePayload });
  }

  getByCheckpointHash(checkpointHash, options = {}) {
    this._assertReady();
    if (!isSha256(checkpointHash)) return null;
    const row = this._rowByCheckpointHash(checkpointHash);
    if (!row) return null;
    if (options.verify !== false) this._verifyLineage(row);
    return this._materialize(row, options);
  }

  selectCompatible(options = {}) {
    this._assertReady();
    const compatibility = options.compatibility ? { ...options, ...options.compatibility } : options;
    if (!compatibility.domain) fail('verified_ancestry_invalid_argument', 'domain is required for compatibility selection.');
    normalizeName(compatibility.domain, 'domain');
    const requested = {
      formatVersion: compatibility.formatVersion || this.formatVersion,
      verifierVersion: compatibility.verifierVersion === undefined ? undefined : normalizeVersion(compatibility.verifierVersion, 'verifierVersion'),
      schemaVersion: compatibility.schemaVersion === undefined ? undefined : normalizeVersion(compatibility.schemaVersion, 'schemaVersion'),
      projectorVersion: compatibility.projectorVersion === undefined ? undefined : normalizeVersion(compatibility.projectorVersion, 'projectorVersion'),
      topologyVersion: compatibility.topologyVersion === undefined ? undefined : normalizeVersion(compatibility.topologyVersion, 'topologyVersion'),
      storeIdentity: compatibility.storeIdentity,
      storeGeneration: compatibility.storeGeneration,
      dependencies: dependencyCompatibility(compatibility.dependencies),
    };
    const rows = this.sqlite.prepare('SELECT * FROM verified_ancestry_generations WHERE domain=? ORDER BY generation_number DESC').all(compatibility.domain);
    for (const row of rows) {
      if (row.publication_state !== 'complete') fail('verified_ancestry_incomplete', `Checkpoint generation ${row.generation_id} is incomplete.`);
      const material = this._verifyLineage(row) || this._materialize(row, { includePayload: true });
      const matches = row.format_version === requested.formatVersion
        && (requested.verifierVersion === undefined || row.verifier_version === requested.verifierVersion)
        && (requested.schemaVersion === undefined || row.schema_version === requested.schemaVersion)
        && (requested.projectorVersion === undefined || row.projector_version === requested.projectorVersion)
        && (requested.topologyVersion === undefined || row.topology_version === requested.topologyVersion)
        && (requested.storeIdentity === undefined || sameJson(material.storeIdentity, requested.storeIdentity, 'storeIdentity'))
        && (requested.storeGeneration === undefined || sameJson(material.storeGeneration, requested.storeGeneration, 'storeGeneration'))
        && (requested.dependencies === undefined || sameJson(material.dependencies, requested.dependencies, 'dependencies'));
      if (matches) {
        const generation = this._materialize(row, { includePayload: true });
        return { ...generation, standing: 'compatible', mode: 'checkpoint_suffix', generation };
      }
    }
    return { standing: 'miss', mode: 'full', code: 'verified_ancestry_checkpoint_miss', generation: null };
  }

  findCompatible(options = {}) {
    return this.selectCompatible(options).generation || null;
  }

  listGenerations({ domain, limit = MAX_STATUS_LIMIT, verify = false } = {}) {
    this._assertReady();
    const bounded = boundedLimit(limit);
    const rows = domain ? this.sqlite.prepare('SELECT * FROM verified_ancestry_generations WHERE domain=? ORDER BY generation_number DESC LIMIT ?').all(domain, bounded) : this.sqlite.prepare('SELECT * FROM verified_ancestry_generations ORDER BY generation_number DESC LIMIT ?').all(bounded);
    return rows.map(row => {
      if (verify) this._verifyLineage(row);
      return this._summary(row);
    });
  }

  _summary(row) {
    return { generationId: row.generation_id, generationNumber: row.generation_number, domain: row.domain, formatVersion: row.format_version, verifierVersion: row.verifier_version, schemaVersion: row.schema_version, projectorVersion: row.projector_version, topologyVersion: row.topology_version, predecessorCheckpointHash: row.predecessor_checkpoint_sha256, checkpointHash: row.checkpoint_sha256, completedAt: row.completed_at, publicationState: row.publication_state };
  }

  status({ domain, limit = MAX_STATUS_LIMIT, verify = false } = {}) {
    const bounded = boundedLimit(limit);
    if (this.schemaStanding.status !== 'ready') return { standing: 'refused', code: this.schemaStanding.code || 'verified_ancestry_checkpoint_miss', mode: 'full', generationCount: 0, truncated: false, generations: [] };
    try {
      this._assertReady();
      const rows = domain ? this.sqlite.prepare('SELECT * FROM verified_ancestry_generations WHERE domain=? ORDER BY generation_number DESC LIMIT ?').all(domain, bounded + 1) : this.sqlite.prepare('SELECT * FROM verified_ancestry_generations ORDER BY generation_number DESC LIMIT ?').all(bounded + 1);
      if (verify) for (const row of rows) this._verifyLineage(row);
      const generations = rows.map(row => this._summary(row)).map(generation => ({ generationId: generation.generationId, generationNumber: generation.generationNumber, domain: generation.domain, formatVersion: generation.formatVersion, verifierVersion: generation.verifierVersion, checkpointHash: generation.checkpointHash, predecessorCheckpointHash: generation.predecessorCheckpointHash, completedAt: generation.completedAt, publicationState: generation.publicationState }));
      const truncated = generations.length > bounded;
      const visible = truncated ? generations.slice(0, bounded) : generations;
      return { standing: visible.length ? 'available' : 'empty', code: null, mode: 'checkpoint_suffix', generationCount: visible.length, truncated, generations: visible };
    } catch (cause) {
      return { standing: 'refused', code: cause.code || 'verified_ancestry_checkpoint_miss', mode: 'full', generationCount: 0, truncated: false, generations: [] };
    }
  }

  getBoundedStatus(options = {}) { return this.status(options); }

  /** Remove only the rebuildable checkpoint projection; canonical stores are untouched. */
  rebuild() {
    this.close();
    if (this.path !== ':memory:') {
      for (const suffix of ['', '-wal', '-shm']) {
        const candidate = `${this.path}${suffix}`;
        try { if (existsSync(candidate)) unlinkSync(candidate); } catch (cause) { throw error('verified_ancestry_rebuild_failed', `Could not remove checkpoint file ${candidate}.`, { cause: cause.message }); }
      }
    }
    this.schemaStanding = { status: 'ready', code: null };
    this._open();
    if (this.schemaStanding.status !== 'ready') fail(this.schemaStanding.code || 'verified_ancestry_rebuild_failed', 'Checkpoint store could not be rebuilt.');
    return this.status();
  }

  clear() { return this.rebuild(); }
  deleteAll() { return this.rebuild(); }
  delete() { return this.rebuild(); }

  close() {
    if (this.sqlite) {
      try { this.sqlite.close(); } finally { this.sqlite = null; }
    }
  }
}

export { CHECKPOINT_SCHEMA_VERSION, SCHEMA as VERIFIED_ANCESTRY_SCHEMA };
export const CheckpointStore = VerifiedAncestryStore;
export const VerifiedAncestryCheckpointStore = VerifiedAncestryStore;
