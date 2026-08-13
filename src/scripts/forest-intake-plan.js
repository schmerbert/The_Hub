import { readConfig } from '../core/config.js';
import { buildIntakeLedgerPlan } from '../forest/intake-backfill.js';

const config = readConfig();
try { console.log(JSON.stringify(buildIntakeLedgerPlan({ forestPath: config.forestPath }))); }
catch (error) { console.error(error.message); process.exitCode = 1; }
