import { readConfig } from '../core/config.js';
import { verifyForest } from '../core/forest.js';

const config = readConfig();
try { console.log(JSON.stringify(verifyForest({ forestPath: config.forestPath, operationalPath: config.dbPath, spinePath: config.spinePath }))); }
catch (error) { console.error(error.message); process.exitCode = 1; }
