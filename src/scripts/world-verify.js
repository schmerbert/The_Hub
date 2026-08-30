import { readConfig } from '../core/config.js';
import { verifyWorldDatabase } from '../world/events.js';

const config = readConfig(process.env);
// The configured Hub now installs the full current topology. Keeping this
// command aligned with that boundary prevents newer, valid extensions from
// being misreported as unexpected events.
const verification = verifyWorldDatabase(config.worldPath, {
  mismatchLimit: 50,
  requireHearth: true,
  requireForest: true,
  requireBinderWindow: true,
  requireSpotlight: true,
});
console.log(JSON.stringify({ worldPath: config.worldPath, ...verification }, null, 2));
if (!verification.verified) process.exitCode = 1;
