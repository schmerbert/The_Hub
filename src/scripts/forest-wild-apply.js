import { readConfig } from '../core/config.js';
import { applyWildBackfill } from '../forest/wild-backfill.js';

const config = readConfig();
const confirmed = process.argv.includes('--confirm-apply');
if (!confirmed) { console.error('Wild Forest catch-up requires --confirm-apply.'); process.exitCode = 1; }
else {
  try { console.log(JSON.stringify(applyWildBackfill({ operationalPath: config.dbPath, worldPath: config.worldPath, spinePath: config.spinePath, forestPath: config.forestPath, confirmApply: true }))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
