import { readConfig } from '../core/config.js';
import { applyBackfillAtomically } from '../forest/backfill.js';

const config = readConfig();
const confirmed = process.argv.includes('--confirm-create');
if (!confirmed) {
  console.error('Historical Forest creation requires --confirm-create.');
  process.exitCode = 1;
  process.exit();
}
try {
  const result = applyBackfillAtomically({ operationalPath: config.dbPath, forestPath: config.forestPath, spinePath: config.spinePath, confirmCreate: confirmed });
  console.log(JSON.stringify({ planHash: result.planHash, appliedEntryCount: result.appliedEntryCount, finalEntryCount: result.finalEntryCount }));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
