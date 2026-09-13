import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { canonicalize, sha256 } from '../core/hash.js';
import { APPEND_ONLY_TABLES } from './store.js';

function fail(message) { throw Object.assign(new Error(message), { code: 'forest_check_failed' }); }
function count(db, table) { return db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count; }

export function checkForestCrossings({ forestPath }) {
  if (!forestPath || !existsSync(forestPath)) fail('Forest database is missing.');
  const db = new DatabaseSync(forestPath, { readOnly: true });
  try {
    const quick = db.prepare('PRAGMA quick_check').all().map(row => Object.values(row)[0]);
    const metadata = db.prepare('SELECT schema_name AS name,schema_version AS version FROM forest_metadata WHERE metadata_id=1').get();
    if (metadata?.name !== 'forest' || metadata?.version !== 1) fail('Forest schema identity is not supported.');
    const triggerMissing = [];
    for (const table of APPEND_ONLY_TABLES) for (const action of ['update', 'delete']) {
      if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='trigger' AND name=?").get(`${table}_append_only_${action}`)) triggerMissing.push(`${table}:${action}`);
    }
    const latest = db.prepare(`SELECT o.offer_id AS offerId,o.source_kind AS sourceKind,o.intended_jurisdiction AS jurisdiction,o.intended_bucket AS bucket,o.scrub_policy AS scrubPolicy,d.state
      FROM forest_intake_offers o LEFT JOIN forest_intake_decisions d ON d.offer_id=o.offer_id
      AND d.revision=(SELECT MAX(x.revision) FROM forest_intake_decisions x WHERE x.offer_id=o.offer_id)`).all();
    const allowed = new Set(['source_event|home|utterance|utterance_identity', 'source_event|home|journal|journal_identity', 'world_action_span|wild|workshop_source|workshop_exact_source']);
    const unknownRoutes = latest.filter(row => !allowed.has(`${row.sourceKind}|${row.jurisdiction}|${row.bucket}|${row.scrubPolicy}`)).map(row => row.offerId);
    const unresolved = latest.filter(row => !row.state || row.state === 'held').map(row => ({ offerId: row.offerId, state: row.state || 'undecided' }));
    const counts = {
      homeUtterances: count(db, 'forest_entries'), wildWorkshopSources: count(db, 'wild_entries'), homeJournal: count(db, 'forest_journal_entries'),
      intakeOffers: latest.length, admitted: latest.filter(row => row.state === 'admitted').length, heldOrUndecided: unresolved.length,
      presentationLinks: count(db, 'presentation_links'), emissionLinks: count(db, 'emission_links'),
    };
    const frontier = { version: 'forest_crossing_frontier/v1', counts, latestDecisionId: db.prepare('SELECT decision_id AS id FROM forest_intake_decisions ORDER BY decided_at DESC,decision_id DESC LIMIT 1').get()?.id || null };
    frontier.hash = sha256(canonicalize(frontier));
    const findings = [
      ...(quick.length === 1 && quick[0] === 'ok' ? [] : [{ code: 'sqlite_quick_check_failed', count: quick.length }]),
      ...(triggerMissing.length ? [{ code: 'append_only_trigger_missing', items: triggerMissing }] : []),
      ...(unknownRoutes.length ? [{ code: 'unknown_admission_route', offerIds: unknownRoutes.slice(0, 20), count: unknownRoutes.length }] : []),
      ...(unresolved.length ? [{ code: 'unresolved_intake', items: unresolved.slice(0, 20), count: unresolved.length }] : []),
    ];
    return {
      version: 'forest_crossing_check/v1', status: findings.length ? 'attention_required' : 'clean', scope: 'jurisdiction_and_incremental_frontier',
      forensicProof: false, fullVerificationCommand: 'npm run forest:verify', frontier, counts, findings,
      exclusionsChecked: ['provisional_reasoning', 'result_rack', 'roots_exposure', 'spotlight_observation', 'credential', 'generated_reading_projection'],
      meaning: 'Clean means known admission routes, intact append-only guards, no unresolved intake, and SQLite quick integrity. It does not certify factual truth or replace full source/Spine/World verification.',
    };
  } finally { db.close(); }
}
