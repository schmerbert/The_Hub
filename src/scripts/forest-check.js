import { readConfig } from '../core/config.js';
import { checkForestCrossings } from '../forest/check.js';

const config = readConfig();
try { console.log(JSON.stringify(checkForestCrossings({ forestPath: config.forestPath }))); }
catch (error) { console.error(JSON.stringify({ status: 'failed', code: error?.code || 'forest_check_failed', message: error?.message || 'Forest crossing check failed.' })); process.exitCode = 1; }
