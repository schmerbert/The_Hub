import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { ForestStore, forestSchemaSql } from './store.js';
import { verifyForest } from './verify.js';

const LEGACY_REQUIRED_TABLES = ['forest_metadata','scrub_receipts','forest_entries','forest_edges','presentation_links','emission_links','wild_entries'];

function hasTable(sqlite, name) { return Boolean(sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name)); }

export function buildIntakeLedgerPlan({ forestPath } = {}) {
  if (!forestPath || !existsSync(forestPath)) throw new Error('Forest database is missing.');
  const sqlite = new DatabaseSync(forestPath, { readOnly: true });
  try {
    for (const table of LEGACY_REQUIRED_TABLES) if (!hasTable(sqlite, table)) throw new Error(`Forest schema is missing ${table}.`);
    const installed = hasTable(sqlite, 'forest_intake_offers') && hasTable(sqlite, 'forest_intake_decisions');
    const homeCount = sqlite.prepare('SELECT COUNT(*) AS count FROM forest_entries').get().count;
    const wildCount = sqlite.prepare('SELECT COUNT(*) AS count FROM wild_entries').get().count;
    const admittedDestinationCount = installed ? sqlite.prepare("SELECT COUNT(DISTINCT destination_entry_id) AS count FROM forest_intake_decisions WHERE state='admitted'").get().count : 0;
    return { schemaInstalled: installed, homeEntryCount: homeCount, wildEntryCount: wildCount, admittedDestinationCount, proposedAdmissionCount: homeCount + wildCount - admittedDestinationCount };
  } finally { sqlite.close(); }
}

function installSchema(forestPath) {
  const sqlite = new DatabaseSync(forestPath);
  try {
    for (const table of LEGACY_REQUIRED_TABLES) if (!hasTable(sqlite, table)) throw new Error(`Forest schema is missing ${table}.`);
    sqlite.exec(forestSchemaSql());
  } finally { sqlite.close(); }
}

export function applyIntakeLedgerBackfill({ forestPath, operationalPath, spinePath, worldPath, confirmApply = false } = {}) {
  if (!confirmApply) throw Object.assign(new Error('Forest Intake Ledger installation requires --confirm-apply.'), { code: 'confirmation_required' });
  const plan = buildIntakeLedgerPlan({ forestPath });
  installSchema(forestPath);
  const forest = new ForestStore(forestPath, { mode: 'requireExisting' });
  try {
    for (const entry of forest.listEntries()) {
      const predecessor = forest.sqlite.prepare(`SELECT target.source_event_id AS sourceEventId FROM forest_edges edge
        JOIN forest_entries target ON target.entry_id=edge.to_entry_id WHERE edge.from_entry_id=? AND edge.edge_type='responds_to'`).get(entry.entry_id);
      const { offerId } = forest.ensureIntakeOffer({ sourceKind: 'source_event', sourceId: entry.source_event_id, sourceLocator: { threadId: entry.thread_id, wakeId: entry.wake_id || null, actorKind: entry.actor_kind }, sourceHash: entry.source_event_hash, intendedJurisdiction: 'home', intendedBucket: 'utterance', predecessorSourceId: predecessor?.sourceEventId || null, sourceTimestamp: entry.source_timestamp, scrubPolicy: entry.scrub_policy, scrubVersion: entry.scrub_version, offeredAt: entry.ingested_at });
      forest.transaction(() => forest.appendIntakeDecision({ offerId, state: 'admitted', predecessorSourceId: predecessor?.sourceEventId || null, destinationEntryId: entry.entry_id, decidedAt: entry.ingested_at }));
    }
    for (const entry of forest.listWildEntries()) {
      const { offerId } = forest.ensureIntakeOffer({ sourceKind: 'world_action_span', sourceId: entry.action_receipt_id, sourceLocator: { path: entry.repository_path, startLine: entry.start_line, endLine: entry.end_line }, sourceHash: entry.body_hash, intendedJurisdiction: 'wild', intendedBucket: entry.bucket, sourceTimestamp: null, scrubPolicy: 'workshop_exact_source', scrubVersion: 'v1', offeredAt: entry.created_at });
      forest.transaction(() => forest.appendIntakeDecision({ offerId, state: 'admitted', destinationEntryId: entry.entry_id, decidedAt: entry.created_at }));
    }
  } finally { forest.close(); }
  const verification = verifyForest({ forestPath, operationalPath, spinePath, worldPath });
  return { ...plan, appliedAdmissionCount: plan.proposedAdmissionCount, finalOfferCount: verification.intakeOfferCount, heldCount: verification.intakeHeldCount };
}
