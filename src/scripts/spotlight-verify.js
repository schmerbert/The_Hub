import { loadEnvFile } from '../core/env.js';
import { resolveHubConfig } from '../core/config.js';
import { SpotlightObservationStore } from '../places/hub/spotlight/observation-store.js';

loadEnvFile();
const config = resolveHubConfig();
let store;
try {
  store = new SpotlightObservationStore(config.spotlightObservationPath, { readOnly: true });
  const report = store.verify();
  console.log(JSON.stringify(report, null, 2));
  if (report.verified === false) process.exitCode = 1;
} catch {
  console.error(JSON.stringify({ verified: false, code: 'spotlight_verification_failed', message: 'Observation custody is absent, incompatible, or failed integrity verification.' }));
  process.exitCode = 1;
} finally { store?.close(); }
