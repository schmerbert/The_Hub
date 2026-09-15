import { parentPort, workerData } from 'node:worker_threads';
import { verifyForestWithCheckpoint } from '../integrity/forest-checkpoint.js';

try {
  const { forceFull = false, ...options } = workerData;
  parentPort.postMessage({ status: 'verified', verification: verifyForestWithCheckpoint(options, { forceFull }) });
} catch (error) {
  parentPort.postMessage({ status: 'failed', error: { name: error?.name || 'Error', code: error?.code || 'forest_verification_failed', message: error?.message || 'Forest verification failed.' } });
}
