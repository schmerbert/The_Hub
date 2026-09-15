import { readConfig } from '../core/config.js';
import { verifyForestWithCheckpoint } from '../integrity/forest-checkpoint.js';

const config = readConfig();
const forceFull = process.argv.slice(2).includes('--full');
try { console.log(JSON.stringify(verifyForestWithCheckpoint({ checkpointPath: config.verifiedAncestryPath, forestPath: config.forestPath, operationalPath: config.dbPath, spinePath: config.spinePath, worldPath: config.worldPath, strictWildBijection: true }, { forceFull }))); }
catch (error) { console.error(error.message); process.exitCode = 1; }
