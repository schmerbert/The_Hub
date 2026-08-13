import { existsSync } from 'node:fs';
import { verifyForest } from './verify.js';

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

export function projectForestHealth({ forest, source, paths }) {
  if (!forest) return INACTIVE;
  const eligibleCount = source.listEligibleUtteranceEvents().length;
  const excludedFakeUtteranceCount = source.countExcludedFakeUtterances();
  try {
    const verification = verifyForest({
      forestPath: paths.forestPath,
      operationalPath: paths.dbPath,
      spinePath: existsSync(paths.spinePath) ? paths.spinePath : undefined,
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
      excludedFakeUtteranceCount,
    };
  }
}
