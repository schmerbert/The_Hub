import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { WorldGraphStore } from '../world/graph.js';
import { createHub } from '../server/app.js';

function instrument(object, method, counters) {
  const original = object[method].bind(object);
  object[method] = (...args) => {
    counters[method] = (counters[method] || 0) + 1;
    return original(...args);
  };
}

const root = await mkdtemp(join(tmpdir(), 'hub-structural-baseline-'));
let hub = null;
try {
  const counters = {};
  const world = new WorldGraphStore(join(root, 'world.sqlite'), { topologyVersion: 'spotlight' });
  instrument(world, 'verification', counters);
  instrument(world, 'assertVerified', counters);

  const compositionStarted = performance.now();
  hub = createHub({
    env: {
      HUB_RESIDENT_MODE: 'fake',
      HUB_PORT: '0',
      HUB_RUNTIME_ROOT: root,
      HUB_WORKSHOP_ROOT: process.cwd(),
    },
    world,
  });
  const compositionMs = performance.now() - compositionStarted;
  instrument(hub.db, 'verifyGlassTrace', counters);
  instrument(hub.db, 'verifyRoots', counters);

  const bindingStarted = performance.now();
  await new Promise((resolve, reject) => {
    hub.server.once('error', reject);
    hub.server.listen(0, '127.0.0.1', resolve);
  });
  const bindingMs = performance.now() - bindingStarted;
  const base = `http://127.0.0.1:${hub.server.address().port}`;

  const healthStarted = performance.now();
  const healthText = await fetch(`${base}/api/health`).then(response => response.text());
  const healthMs = performance.now() - healthStarted;
  const afterHealth = { ...counters };

  const wakeStarted = performance.now();
  const wakeResponse = await fetch(`${base}/api/wakes?projection=compact`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: 'Measure one disposable ordinary wake.' }),
  });
  const wakeText = await wakeResponse.text();
  const wakeMs = performance.now() - wakeStarted;

  process.stdout.write(`${JSON.stringify({
    kind: 'hub_structural_baseline/v1',
    disposable: true,
    node: process.version,
    compositionMs: Math.round(compositionMs * 100) / 100,
    bindingMs: Math.round(bindingMs * 100) / 100,
    healthMs: Math.round(healthMs * 100) / 100,
    wakeMs: Math.round(wakeMs * 100) / 100,
    healthBytes: Buffer.byteLength(healthText),
    wakeBytes: Buffer.byteLength(wakeText),
    wakeStatus: wakeResponse.status,
    verifierCalls: counters,
    verifierCallsAfterHealth: afterHealth,
  }, null, 2)}\n`);
} finally {
  if (hub) await hub.close().catch(() => {});
  await rm(root, { recursive: true, force: true });
}
