import { readConfig } from '../core/config.js';
import { buildWildBackfillPlan } from '../forest/wild-backfill.js';

const config = readConfig();
try {
  const plan = buildWildBackfillPlan({ operationalPath: config.dbPath, worldPath: config.worldPath, spinePath: config.spinePath, forestPath: config.forestPath });
  console.log(JSON.stringify({ ...plan, proposed: undefined }));
  process.exitCode = plan.conflicts.length ? 1 : 0;
} catch (error) { console.error(error.message); process.exitCode = 1; }
