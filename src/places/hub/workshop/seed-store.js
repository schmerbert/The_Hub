import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { canonicalSeedRepository, prepareSeedStateRoot } from './seed-custody.js';
import { WorkshopGit } from './git.js';

const SCHEMA = 1;
const MAX_TEXT = 4000;
const MAX_SOURCE = 1000;
const MAX_ITEMS = 24;

function fail(code, message) { throw Object.assign(new Error(message), { code }); }
function now() { return new Date().toISOString(); }
function id(prefix) { return `${prefix}_${randomUUID().replaceAll('-', '')}`; }
function hash(value) { return createHash('sha256').update(value).digest('hex'); }
function text(value, label, max = MAX_TEXT) {
  if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value, 'utf8') > max || value.includes('\0')) fail('seed_invalid_value', `${label} must be non-empty and bounded.`);
  return value.trim();
}
function actor(value) { return text(value, 'actor', 120); }
function provenance(value) { return text(value, 'provenance', 120); }
function source(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('seed_source_required', 'A fact requires source coordinates.');
  const kind = text(value.kind, 'source kind', 80);
  const coordinate = text(value.coordinate, 'source coordinate', MAX_SOURCE);
  return { kind, coordinate, ...(value.hash ? { hash: text(value.hash, 'source hash', 128) } : {}) };
}

export function defaultSeedStateRoot() {
  if (process.env.WORKSHOP_STATE_ROOT) return join(process.env.WORKSHOP_STATE_ROOT, 'seed');
  const base = process.platform === 'win32' ? (process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local')) : (process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state'));
  return join(base, 'TheWorkshop', 'seed');
}

const SQL = `
CREATE TABLE IF NOT EXISTS seed_meta (identity TEXT PRIMARY KEY, generation INTEGER NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS repositories (repository_id TEXT PRIMARY KEY, canonical_path TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS objectives (repository_id TEXT PRIMARY KEY REFERENCES repositories(repository_id), body TEXT NOT NULL, actor TEXT NOT NULL, provenance TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS entries (id TEXT PRIMARY KEY, repository_id TEXT NOT NULL REFERENCES repositories(repository_id), kind TEXT NOT NULL CHECK(kind IN ('fact','decision','question')), body TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('standing','open','resolved')), actor TEXT NOT NULL, provenance TEXT NOT NULL, source_json TEXT, created_at TEXT NOT NULL, resolved_at TEXT);
CREATE INDEX IF NOT EXISTS entries_repo_kind ON entries(repository_id,kind,created_at,id);
CREATE TABLE IF NOT EXISTS observations (id TEXT PRIMARY KEY, repository_id TEXT NOT NULL REFERENCES repositories(repository_id), head TEXT, status_hash TEXT NOT NULL, dirty INTEGER NOT NULL CHECK(dirty IN (0,1)), observed_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS observations_repo_time ON observations(repository_id,observed_at,id);
CREATE TABLE IF NOT EXISTS seed_events (ordinal INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, repository_id TEXT NOT NULL REFERENCES repositories(repository_id), kind TEXT NOT NULL, subject_id TEXT, actor TEXT NOT NULL, provenance TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TRIGGER IF NOT EXISTS seed_events_no_update BEFORE UPDATE ON seed_events BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TRIGGER IF NOT EXISTS seed_events_no_delete BEFORE DELETE ON seed_events BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
`;

export class ContinuitySeed {
  constructor(repositoryPath, { stateRoot = defaultSeedStateRoot(), git = null } = {}) {
    const repository = canonicalSeedRepository(repositoryPath);
    this.repositoryPath = repository.path;
    this.repositoryId = repository.repositoryId;
    this.stateRoot = prepareSeedStateRoot(stateRoot, repository.path);
    mkdirSync(this.stateRoot, { recursive: true });
    this.path = join(this.stateRoot, 'continuity.sqlite');
    this.sqlite = new DatabaseSync(this.path);
    this.sqlite.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;');
    this.sqlite.exec(SQL);
    const meta = this.sqlite.prepare('SELECT identity,generation FROM seed_meta').get();
    if (!meta) this.sqlite.prepare('INSERT INTO seed_meta VALUES(?,?,?)').run('workshop_seed', SCHEMA, now());
    else if (meta.identity !== 'workshop_seed' || meta.generation !== SCHEMA) { this.sqlite.close(); fail('seed_schema_unsupported', 'The Continuity Seed schema is unsupported.'); }
    this.sqlite.prepare('INSERT OR IGNORE INTO repositories VALUES(?,?,?)').run(this.repositoryId, this.repositoryPath, now());
    const stored = this.sqlite.prepare('SELECT canonical_path AS path FROM repositories WHERE repository_id=?').get(this.repositoryId);
    if (stored.path !== this.repositoryPath) { this.sqlite.close(); fail('seed_repository_conflict', 'Repository identity custody conflicts with its canonical path.'); }
    this.git = git || new WorkshopGit(this.repositoryPath);
  }

  close() { this.sqlite.close(); }
  _event(kind, subjectId, by, from) { this.sqlite.prepare('INSERT INTO seed_events(id,repository_id,kind,subject_id,actor,provenance,created_at) VALUES(?,?,?,?,?,?,?)').run(id('event'), this.repositoryId, kind, subjectId, actor(by), provenance(from), now()); }
  _transaction(operation) { this.sqlite.exec('BEGIN IMMEDIATE'); try { const value = operation(); this.sqlite.exec('COMMIT'); return value; } catch (error) { try { this.sqlite.exec('ROLLBACK'); } catch {} throw error; } }

  setObjective(body, { actor: by, provenance: from } = {}) {
    const value = text(body, 'objective'); const at = now();
    return this._transaction(() => { this.sqlite.prepare('INSERT INTO objectives VALUES(?,?,?,?,?) ON CONFLICT(repository_id) DO UPDATE SET body=excluded.body,actor=excluded.actor,provenance=excluded.provenance,updated_at=excluded.updated_at').run(this.repositoryId, value, actor(by), provenance(from), at); this._event('objective_set', this.repositoryId, by, from); return { kind: 'seed_objective', body: value, actor: by, provenance: from, updatedAt: at }; });
  }

  _add(kind, body, { actor: by, provenance: from, source: coordinates } = {}) {
    const entryId = id(kind); const value = text(body, kind); const at = now(); const coordinatesJson = kind === 'fact' ? JSON.stringify(source(coordinates)) : null; const state = kind === 'question' ? 'open' : 'standing';
    return this._transaction(() => { this.sqlite.prepare('INSERT INTO entries(id,repository_id,kind,body,state,actor,provenance,source_json,created_at,resolved_at) VALUES(?,?,?,?,?,?,?,?,?,NULL)').run(entryId, this.repositoryId, kind, value, state, actor(by), provenance(from), coordinatesJson, at); this._event(`${kind}_added`, entryId, by, from); return { id: entryId, kind, body: value, state, actor: by, provenance: from, source: coordinatesJson ? JSON.parse(coordinatesJson) : null, createdAt: at }; });
  }
  addFact(body, options) { return this._add('fact', body, options); }
  addDecision(body, options) { return this._add('decision', body, options); }
  addQuestion(body, options) { return this._add('question', body, options); }
  resolveQuestion(questionId, { actor: by, provenance: from } = {}) {
    text(questionId, 'question id', 100); const at = now();
    return this._transaction(() => { const row = this.sqlite.prepare("SELECT state FROM entries WHERE id=? AND repository_id=? AND kind='question'").get(questionId, this.repositoryId); if (!row) fail('seed_question_not_found', 'That question is not in this repository Seed.'); if (row.state === 'resolved') fail('seed_question_resolved', 'That question is already resolved.'); this.sqlite.prepare("UPDATE entries SET state='resolved',resolved_at=? WHERE id=?").run(at, questionId); this._event('question_resolved', questionId, by, from); return { id: questionId, state: 'resolved', resolvedAt: at }; });
  }

  _measure() {
    const headResult = this.git.log(1);
    const status = this.git.status();
    const head = headResult?.ok ? (headResult.stdout.split(/\r?\n/)[0]?.split('\t')[0] || null) : null;
    const statusJson = JSON.stringify(status);
    const statusLines = status?.stdout?.split(/\r?\n/).filter(Boolean) || [];
    return { head, statusHash: hash(statusJson), dirty: statusLines.some(line => !line.startsWith('## ')), measuredAt: now() };
  }
  observeRepository({ actor: by, provenance: from } = {}) {
    const measured = this._measure(); const observationId = id('observation');
    return this._transaction(() => { this.sqlite.prepare('INSERT INTO observations VALUES(?,?,?,?,?,?)').run(observationId, this.repositoryId, measured.head, measured.statusHash, measured.dirty ? 1 : 0, measured.measuredAt); this._event('repository_observed', observationId, by, from); return { id: observationId, ...measured, basis: 'measured' }; });
  }

  readCockpit({ kilnRuns = [], limit = MAX_ITEMS } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) fail('seed_invalid_limit', 'Cockpit limit must be from 1 to 100.');
    const objective = this.sqlite.prepare('SELECT body,actor,provenance,updated_at AS updatedAt FROM objectives WHERE repository_id=?').get(this.repositoryId) || null;
    const rows = this.sqlite.prepare('SELECT id,kind,body,state,actor,provenance,source_json AS sourceJson,created_at AS createdAt,resolved_at AS resolvedAt FROM entries WHERE repository_id=? ORDER BY created_at DESC,id DESC LIMIT ?').all(this.repositoryId, limit + 1);
    const last = this.sqlite.prepare('SELECT id,head,status_hash AS statusHash,dirty,observed_at AS observedAt FROM observations WHERE repository_id=? ORDER BY observed_at DESC,id DESC LIMIT 1').get(this.repositoryId) || null;
    const current = this._measure();
    const map = row => ({ ...row, source: row.sourceJson ? JSON.parse(row.sourceJson) : null, sourceJson: undefined });
    return {
      kind: 'workshop_cockpit', schemaVersion: 1,
      repository: { id: this.repositoryId, path: this.repositoryPath, head: current.head },
      objective,
      facts: rows.filter(row => row.kind === 'fact').slice(0, limit).map(map),
      decisions: rows.filter(row => row.kind === 'decision').slice(0, limit).map(map),
      openQuestions: rows.filter(row => row.kind === 'question' && row.state === 'open').slice(0, limit).map(map),
      kilnRuns: Array.isArray(kilnRuns) ? kilnRuns.slice(0, limit) : [],
      observation: last ? { ...last, dirty: Boolean(last.dirty) } : null,
      current: { ...current, basis: 'measured' },
      drift: { observed: Boolean(last), headChanged: last ? last.head !== current.head : null, workingTreeChanged: last ? last.statusHash !== current.statusHash : null },
      bounds: { itemLimit: limit, omitted: rows.length > limit || (Array.isArray(kilnRuns) && kilnRuns.length > limit) },
      custody: { assertionsAreAttributed: true, hiddenReasoningStored: false, conversationStored: false, actionAuthority: false },
    };
  }
  inspect(options) { return this.readCockpit(options); }
  reconcile(options) { return this.readCockpit(options); }
}

export function createContinuitySeed(repositoryPath, options) { return new ContinuitySeed(repositoryPath, options); }
