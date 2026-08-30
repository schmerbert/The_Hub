import { existsSync } from 'node:fs';
import { verifyForest } from './verify.js';
import { spineLedgerExists } from '../spine/store.js';

const INACTIVE = Object.freeze({
  forestActive: false,
  forestEligibleCount: null,
  forestCount: null,
  forestWildEligibleCount: null,
  forestWildCount: null,
  forestIntakeOfferCount: null,
  forestIntakeHeldCount: null,
  forestIntakeUnresolvedCount: null,
  forestCaughtUp: null,
  forestIntegrity: 'inactive',
  forestErrorCode: null,
  excludedFakeUtteranceCount: null,
});

function liveCounts(forest) {
  const intake = typeof forest.intakeStatus === 'function' ? forest.intakeStatus() : forest.sqlite.prepare(`SELECT
    COUNT(*) AS offers,
    SUM(CASE WHEN latest.state='held' THEN 1 ELSE 0 END) AS held,
    SUM(CASE WHEN latest.state IS NULL THEN 1 ELSE 0 END) AS unresolved
    FROM forest_intake_offers offer LEFT JOIN forest_intake_decisions latest ON latest.offer_id=offer.offer_id
      AND latest.revision=(SELECT MAX(history.revision) FROM forest_intake_decisions history WHERE history.offer_id=offer.offer_id)`).get();
  const wildCount = typeof forest.countWild === 'function' ? forest.countWild() : forest.sqlite.prepare('SELECT COUNT(*) AS count FROM wild_entries').get().count;
  return { intake: { offers: intake.offers, held: intake.held || 0, unresolved: intake.unresolved || 0 }, wildCount, forestCount: forest.count() };
}

export function projectForestHealth({ forest, source, paths, verifiedSnapshot = null, fullVerification = false }) {
  if (!forest) return INACTIVE;
  const eligibleCount = source.listEligibleUtteranceEvents().length;
  const excludedFakeUtteranceCount = source.countExcludedFakeUtterances();
  const current = liveCounts(forest);
  if (!fullVerification) {
    const caughtUp = current.forestCount === eligibleCount && current.intake.held === 0 && current.intake.unresolved === 0;
    return {
      forestActive: true,
      forestEligibleCount: eligibleCount,
      forestCount: current.forestCount,
      forestWildEligibleCount: verifiedSnapshot?.eligibleWildCount ?? null,
      forestWildCount: current.wildCount,
      forestIntakeOfferCount: current.intake.offers,
      forestIntakeHeldCount: current.intake.held,
      forestIntakeUnresolvedCount: current.intake.unresolved,
      forestCaughtUp: caughtUp,
      forestIntegrity: verifiedSnapshot ? 'ok' : 'unverified',
      forestErrorCode: caughtUp ? null : 'forest_intake_lag',
      forestVerification: 'startup_snapshot',
      excludedFakeUtteranceCount,
    };
  }
  try {
    const verification = verifyForest({
      forestPath: paths.forestPath,
      operationalPath: paths.dbPath,
      spinePath: spineLedgerExists(paths.spinePath) ? paths.spinePath : undefined,
      worldPath: existsSync(paths.worldPath) ? paths.worldPath : undefined,
    });
    return {
      forestActive: true,
      forestEligibleCount: eligibleCount,
      forestCount: forest.count(),
      forestWildEligibleCount: verification.eligibleWildCount,
      forestWildCount: verification.wildCount,
      forestIntakeOfferCount: verification.intakeOfferCount,
      forestIntakeHeldCount: verification.intakeHeldCount,
      forestIntakeUnresolvedCount: verification.intakeUnresolvedCount,
      forestCaughtUp: verification.ok
        && verification.entryCount === eligibleCount
        && (verification.eligibleWildCount === null || verification.wildCount === verification.eligibleWildCount)
        && verification.intakeHeldCount === 0
        && verification.intakeUnresolvedCount === 0,
      forestIntegrity: 'ok',
      forestErrorCode: null,
      forestVerification: 'full',
      excludedFakeUtteranceCount,
    };
  } catch {
    const intake = typeof forest.intakeStatus === 'function' ? forest.intakeStatus() : forest.sqlite.prepare(`SELECT
      COUNT(*) AS offers,
      SUM(CASE WHEN latest.state='held' THEN 1 ELSE 0 END) AS held,
      SUM(CASE WHEN latest.state IS NULL THEN 1 ELSE 0 END) AS unresolved
      FROM forest_intake_offers offer LEFT JOIN forest_intake_decisions latest ON latest.offer_id=offer.offer_id
        AND latest.revision=(SELECT MAX(history.revision) FROM forest_intake_decisions history WHERE history.offer_id=offer.offer_id)`).get();
    const wildCount = typeof forest.countWild === 'function'
      ? forest.countWild()
      : forest.sqlite.prepare('SELECT COUNT(*) AS count FROM wild_entries').get().count;
    return {
      forestActive: true,
      forestEligibleCount: eligibleCount,
      forestCount: forest.count(),
      forestWildEligibleCount: null,
      forestWildCount: wildCount,
      forestIntakeOfferCount: intake.offers,
      forestIntakeHeldCount: intake.held || 0,
      forestIntakeUnresolvedCount: intake.unresolved || 0,
      forestCaughtUp: false,
      forestIntegrity: 'error',
      forestErrorCode: 'forest_integrity_error',
      forestVerification: 'full',
      excludedFakeUtteranceCount,
    };
  }
}
