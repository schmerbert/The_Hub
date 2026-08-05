import { readConfig } from '../core/config.js';
import { verifySpine } from '../core/spine.js';

const config = readConfig();
try { console.log(JSON.stringify(verifySpine(config.spinePath))); }
catch (error) { console.error(error.message); process.exitCode = 1; }
