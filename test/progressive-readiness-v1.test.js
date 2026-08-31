import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { HubDatabase } from '../src/ledger/source.js';
import { ForestStore } from '../src/forest/store.js';
import { createHub } from '../src/server/app.js';
import { ReadinessProjection } from '../src/runtime/readiness.js';

function deferred() {
  let resolve; let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function fixture(forestVerifier) {
  const dir = await mkdtemp(join(tmpdir(), 'hub-progressive-readiness-'));
  const dbPath = join(dir, 'hub.sqlite');
  const forestPath = join(dir, 'forest.sqlite');
  new HubDatabase(dbPath).close();
  new ForestStore(forestPath).close();
  const hub = createHub({
    env: {
      HUB_RESIDENT_MODE: 'live',
      DEEPSEEK_MODEL: 'test-model',
      HUB_SEMANTIC_INDEX_PATH: join(dir, 'semantic.sqlite'),
      HUB_FOREST_TRAVERSAL_PATH: join(dir, 'traversal.sqlite'),
      HUB_WORKSHOP_ROOT: process.cwd(),
    },
    dbPath,
    forestPath,
    spinePath: join(dir, 'spine.jsonl'),
    worldPath: join(dir, 'world.sqlite'),
    resultPath: join(dir, 'results.sqlite'),
    activateForest: true,
    progressiveStartup: true,
    forestVerifier,
  });
  await new Promise(resolve => hub.server.listen(0, '127.0.0.1', resolve));
  return {
    dir, hub,
    base: `http://127.0.0.1:${hub.server.address().port}`,
    async close() { await hub.close(); await rm(dir, { recursive: true, force: true }); },
  };
}

test('readiness projection settles once and exposes bounded monotonic timing', () => {
  let now = 10;
  const readiness = new ReadinessProjection({ clock: () => now, timestamp: () => `t${now}` });
  readiness.begin('shell');
  readiness.begin('conversation');
  readiness.settle('conversation', 'ready');
  now = 17;
  readiness.settle('shell', 'ready');
  readiness.settle('shell', 'failed');
  const projected = readiness.projection();
  assert.equal(projected.shell.state, 'ready');
  assert.equal(projected.shell.elapsedMs, 7);
  assert.equal(projected.conversation.state, 'ready');
  assert.equal(JSON.stringify(projected).includes('path'), false);
});

test('progressive health withholds Forest until strict verification settles', async () => {
  const gate = deferred();
  const f = await fixture(() => gate.promise);
  try {
    const pending = await fetch(`${f.base}/api/health`).then(response => response.json());
    assert.equal(pending.readiness.shell.state, 'ready');
    assert.equal(pending.readiness.conversation.state, 'ready');
    assert.equal(pending.readiness.forest.state, 'pending');
    assert.equal(pending.forestIntegrity, 'pending');
    assert.equal(pending.mountedTools.some(name => name === 'enter_forest'), false);
    assert.equal(f.hub.forest, null);
    assert.equal(f.hub.gateway.forest, null);
    assert.equal(f.hub.wakeService.forest, null);

    gate.resolve({ ok: true, entryCount: 0, wildCount: 0, eligibleWildCount: 0, intakeOfferCount: 0, intakeHeldCount: 0, intakeUnresolvedCount: 0 });
    await f.hub.forestVerificationPromise;
    const ready = await fetch(`${f.base}/api/health`).then(response => response.json());
    assert.equal(ready.readiness.forest.state, 'ready');
    assert.equal(ready.forestIntegrity, 'ok');
    assert.ok(f.hub.forest);
    assert.equal(f.hub.gateway.forest, f.hub.forest);
    assert.equal(f.hub.wakeService.forest, f.hub.forest);
  } finally { await f.close(); }
});

test('failed verification stays bounded and core conversation remains ready', async () => {
  const gate = deferred();
  const f = await fixture(() => gate.promise);
  try {
    gate.reject(new Error('sensitive verifier detail'));
    await f.hub.forestVerificationPromise;
    const health = await fetch(`${f.base}/api/health`).then(response => response.json());
    assert.equal(health.readiness.conversation.state, 'ready');
    assert.equal(health.readiness.forest.state, 'failed');
    assert.equal(health.readiness.forest.code, 'forest_verification_failed');
    assert.equal(JSON.stringify(health).includes('sensitive verifier detail'), false);
    assert.equal(f.hub.forest, null);
  } finally { await f.close(); }
});

test('a proof is refused as stale when eligible Source advances while verification is pending', async () => {
  const gate = deferred();
  const f = await fixture(() => gate.promise);
  try {
    f.hub.db.sqlite.prepare(`INSERT INTO events(
      id,thread_id,wake_id,actor_kind,event_kind,content,authority,provider,model,created_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
      'event_after_verification_started', f.hub.db.threadId, null, 'user', 'utterance',
      'arrived while continuity was preparing', 'ground', null, null, new Date().toISOString(),
    );
    gate.resolve({ ok: true, entryCount: 0 });
    await f.hub.forestVerificationPromise;
    const health = await fetch(`${f.base}/api/health`).then(response => response.json());
    assert.equal(health.readiness.forest.state, 'failed');
    assert.equal(health.readiness.forest.code, 'forest_verification_stale');
    assert.equal(f.hub.forest, null);
    assert.equal(f.hub.wakeService.forest, null);
  } finally { await f.close(); }
});

test('shutdown cancels pending verification without late activation', async () => {
  const gate = deferred();
  const f = await fixture((_options, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(Object.assign(new Error('cancelled'), { code: 'forest_verification_cancelled' })), { once: true });
    gate.promise.then(resolve, reject);
  }));
  const closing = f.hub.close();
  gate.resolve({ ok: true });
  await closing;
  assert.notEqual(f.hub.readiness.projection().forest.state, 'ready');
  await rm(f.dir, { recursive: true, force: true });
});
