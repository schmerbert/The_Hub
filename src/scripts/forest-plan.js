import { readConfig } from '../core/config.js';
import { buildBackfillPlan, openOptionalForest } from '../core/backfill.js';

const config = readConfig();
const forest = openOptionalForest(config.forestPath);
try {
  const plan = buildBackfillPlan({ operationalPath: config.dbPath, forest });
  console.log(JSON.stringify({ ...plan, proposed: undefined }));
  process.exitCode = plan.conflicts.length ? 1 : 0;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally { forest?.close(); }
