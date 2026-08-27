import { Worker } from 'node:worker_threads';

export function verifyForestAsync(options) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./verify-worker.js', import.meta.url), { workerData: structuredClone(options) });
    let settled = false;
    worker.once('message', message => {
      settled = true;
      if (message?.status === 'verified') resolve(message.verification);
      else reject(Object.assign(new Error(message?.error?.message || 'Forest verification worker failed.'), { name: message?.error?.name || 'Error' }));
    });
    worker.once('error', error => { settled = true; reject(error); });
    worker.once('exit', code => {
      if (!settled) reject(new Error(`Forest verification worker exited before returning a result (${code}).`));
    });
  });
}
