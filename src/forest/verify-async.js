import { Worker } from 'node:worker_threads';

/**
 * Verify a Forest in a worker. The optional AbortSignal only cancels the
 * worker; it never turns cancellation into a successful verification.
 */
export function verifyForestAsync(options, { signal = null } = {}) {
  let worker;
  let settled = false;
  let rejectPromise;
  const cleanup = () => {
    signal?.removeEventListener?.('abort', onAbort);
    worker?.removeAllListeners();
  };
  const cancel = () => {
    if (settled) return;
    settled = true;
    cleanup();
    void worker?.terminate();
    rejectPromise?.(Object.assign(new Error('Forest verification was cancelled.'), { code: 'forest_verification_cancelled' }));
  };
  const onAbort = () => cancel();
  const promise = new Promise((resolve, reject) => {
    rejectPromise = reject;
    worker = new Worker(new URL('./verify-worker.js', import.meta.url), { workerData: structuredClone(options) });
    worker.once('message', message => {
      if (settled) return;
      settled = true;
      cleanup();
      if (message?.status === 'verified') resolve(message.verification);
      else reject(Object.assign(new Error(message?.error?.message || 'Forest verification worker failed.'), { code: 'forest_verification_failed', name: message?.error?.name || 'Error' }));
    });
    worker.once('error', error => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    });
    worker.once('exit', code => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(Object.assign(new Error(`Forest verification worker exited before returning a result (${code}).`), { code: 'forest_verification_failed' }));
      }
    });
    if (signal?.aborted) onAbort();
    else signal?.addEventListener?.('abort', onAbort, { once: true });
  });
  // Kept as a non-public convenience for runtime shutdown. The returned value
  // remains an ordinary Promise for existing callers.
  promise.cancel = cancel;
  return promise;
}
