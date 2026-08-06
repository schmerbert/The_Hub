import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { canonicalize, sha256 } from '../core/hash.js';
import { ForestStore } from './store.js';
import { identityScrubV1 } from './admission.js';
import { verifyForest } from './verify.js';

function readOperational(path) {
  const sqlite = new DatabaseSync(path, { readOnly: true });
  const events = sqlite.prepare(`SELECT e.id, e.thread_id AS threadId, e.wake_id AS wakeId,
    e.actor_kind AS actorKind, e.event_kind AS eventKind, e.content, e.authority, e.provider, e.model,
    e.created_at AS createdAt FROM events e LEFT JOIN wakes w ON w.id=e.wake_id
    WHERE e.event_kind='utterance' AND e.actor_kind IN ('user','resident')
      AND COALESCE(w.provider, e.provider, '') <> 'fake'
    ORDER BY e.thread_id, e.created_at, e.id`).all();
  const excludedFakeCount = sqlite.prepare(`SELECT COUNT(*) AS count FROM events e LEFT JOIN wakes w ON w.id=e.wake_id
    WHERE e.event_kind='utterance' AND e.actor_kind IN ('user','resident')
      AND COALESCE(w.provider, e.provider, '') = 'fake'`).get().count;
  const wakeCount = sqlite.prepare('SELECT COUNT(*) AS count FROM wakes').get().count;
  const threadIds = sqlite.prepare('SELECT DISTINCT thread_id AS id FROM events ORDER BY thread_id').all().map(row => row.id);
  sqlite.close();
  return { events, wakeCount, threadIds, excludedFakeCount };
}

export function buildBackfillPlan({ operationalPath, forest } = {}) {
  const operational = readOperational(operationalPath);
  const existing = new Map((forest?.listEntries() || []).map(entry => [entry.source_event_id, entry]));
  const conflicts = [];
  const proposed = [];
  const byThread = new Map();
  for (const event of operational.events) {
    const sourceHash = sha256(event.content);
    const bodyHash = sourceHash;
    const current = existing.get(event.id);
    if (current) {
      if (current.source_event_hash !== sourceHash || current.body_hash !== bodyHash || current.actor_kind !== event.actorKind || current.thread_id !== event.threadId || (current.wake_id || null) !== (event.wakeId || null)) conflicts.push({ eventId: event.id, reason: 'existing custody differs' });
    } else proposed.push({ eventId: event.id, sourceHash, bodyHash, actorKind: event.actorKind, threadId: event.threadId, wakeId: event.wakeId || null, createdAt: event.createdAt, spineStatus: 'pre_spine' });
    if (!byThread.has(event.threadId)) byThread.set(event.threadId, []);
    byThread.get(event.threadId).push(event);
  }
  let proposedEdges = 0;
  for (const events of byThread.values()) for (let index = 1; index < events.length; index++) if (!existing.has(events[index].id)) proposedEdges++;
  const summary = {
    sourceThreads: operational.threadIds,
    eventCount: operational.events.length,
    wakeCount: operational.wakeCount,
    eligibleUtteranceCount: operational.events.length,
    excludedFakeUtteranceCount: operational.excludedFakeCount,
    proposedEntryCount: proposed.length,
    proposedRespondsToEdgeCount: proposedEdges,
    preSpineEntryCount: operational.events.length,
    sourceHashes: operational.events.map(event => ({ eventId: event.id, sourceHash: sha256(event.content), proposedBodyHash: sha256(event.content) })),
    scrubChanges: 0,
    conflicts,
  };
  return { ...summary, planHash: sha256(canonicalize(summary)), proposed };
}

export function applyBackfill({ operationalPath, forest, spinePath, worldPath, confirmCreate = false } = {}) {
  if (!confirmCreate) throw Object.assign(new Error('Historical Forest creation requires --confirm-create.'), { code: 'confirmation_required' });
  const plan = buildBackfillPlan({ operationalPath, forest });
  if (plan.conflicts.length) throw Object.assign(new Error('Historical Forest apply refused custody conflicts.'), { code: 'forest_custody_conflict', conflicts: plan.conflicts });
  if (forest.count() > 0) {
    forest.verifySchema();
    // A non-empty store is allowed only after its existing append-only custody validates.
    verifyForest({ forestPath: forest.path, operationalPath, spinePath, worldPath, strictBijection: false });
  }
  const operational = readOperational(operationalPath);
  const existingCount = forest.count();
  const previousByThread = new Map();
  for (const event of operational.events) {
    const predecessorSourceEventId = previousByThread.get(event.threadId) || null;
    forest.ingestEvent(event, { scrub: identityScrubV1, spineStatus: 'pre_spine', predecessorSourceEventId });
    previousByThread.set(event.threadId, event.id);
  }
  return { ...plan, appliedEntryCount: forest.count() - existingCount, finalEntryCount: forest.count() };
}

export function applyBackfillAtomically({ operationalPath, forestPath, spinePath, worldPath, confirmCreate = false } = {}) {
  if (!confirmCreate) throw Object.assign(new Error('Historical Forest creation requires --confirm-create.'), { code: 'confirmation_required' });
  if (existsSync(forestPath)) {
    const forest = new ForestStore(forestPath, { mode: 'requireExisting' });
    try {
      verifyForest({ forestPath, operationalPath, spinePath, worldPath, strictBijection: false });
      const result = applyBackfill({ operationalPath, forest, spinePath, worldPath, confirmCreate: true });
      forest.close();
      verifyForest({ forestPath, operationalPath, spinePath, worldPath });
      return result;
    } catch (error) { try { forest.close(); } catch {} throw error; }
  }
  mkdirSync(dirname(forestPath), { recursive: true });
  const temporaryPath = `${forestPath}.tmp-${randomUUID()}`;
  let forest;
  try {
    forest = new ForestStore(temporaryPath);
    const result = applyBackfill({ operationalPath, forest, spinePath, worldPath, confirmCreate: true });
    forest.close(); forest = null;
    verifyForest({ forestPath: temporaryPath, operationalPath, spinePath, worldPath });
    if (existsSync(forestPath)) throw new Error('Forest target appeared during atomic activation.');
    renameSync(temporaryPath, forestPath);
    return result;
  } catch (error) {
    try { forest?.close(); } catch {}
    try { if (existsSync(temporaryPath)) rmSync(temporaryPath, { force: true }); } catch {}
    throw error;
  }
}

export function openOptionalForest(path) {
  return existsSync(path) ? new ForestStore(path, { mode: 'readOnly' }) : null;
}
