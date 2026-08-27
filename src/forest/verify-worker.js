import { parentPort, workerData } from 'node:worker_threads';
import { verifyForest } from './verify.js';

try {
  parentPort.postMessage({ status: 'verified', verification: verifyForest(workerData) });
} catch (error) {
  parentPort.postMessage({ status: 'failed', error: { name: error?.name || 'Error', message: error?.message || 'Forest verification failed.' } });
}
