import { readConfig } from '../core/config.js';
import { applyIntakeLedgerBackfill } from '../forest/intake-backfill.js';

const config = readConfig();
const confirmed = process.argv.includes('--confirm-apply');
if (!confirmed) { console.error('Forest Intake Ledger installation requires --confirm-apply.'); process.exitCode = 1; }
else {
  try { console.log(JSON.stringify(applyIntakeLedgerBackfill({ forestPath: config.forestPath, operationalPath: config.dbPath, spinePath: config.spinePath, worldPath: config.worldPath, confirmApply: true }))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
