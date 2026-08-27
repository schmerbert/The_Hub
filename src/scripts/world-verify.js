import { readConfig } from '../core/config.js';
import { verifyWorldDatabase } from '../world/events.js';

const config = readConfig(process.env);
const verification = verifyWorldDatabase(config.worldPath, { mismatchLimit: 50, requireHearth: true, requireForest: true });
console.log(JSON.stringify({ worldPath: config.worldPath, ...verification }, null, 2));
if (!verification.verified) process.exitCode = 1;
