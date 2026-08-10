import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHub } from '../src/server/app.js';
import { installShutdownHandlers } from '../src/server/index.js';

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function envFor(dir) {
  return {
    HUB_RESIDENT_MODE: 'fake',
    HUB_DB_PATH: join(dir, 'hub.sqlite'),
    HUB_SPINE_PATH: join(dir, 'spine.jsonl'),
    HUB_WORLD_PATH: join(dir, 'world.sqlite'),
    HUB_RESULT_PATH: join(dir, 'results.sqlite'),
    HUB_WORKSHOP_ROOT: dir,
  };
}

function observeStoreClosures(hub, events) {
  for (const [name, store] of [['spine', hub.spine], ['world', hub.world], ['results', hub.results], ['db', hub.db]]) {
    const original = store.close.bind(store);
    store.close = () => { events.push(`${name}:closed`); return original(); };
  }
}

test('signal shutdown waits for sandbox destruction and store closure before exit', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-shutdown-'));
  const releaseDestroy = deferred();
  const events = [];
  const recipeRunner = {
    active: true,
    status: () => ({ active: true }),
    async destroy(reason) {
      events.push(`sandbox:cancel:${reason}`);
      await releaseDestroy.promise;
      events.push('container:destroyed');
      events.push('worktree:removed');
    },
  };
  const hub = createHub({ env: envFor(dir), recipeRunner });
  observeStoreClosures(hub, events);
  await new Promise(resolve => hub.server.listen(0, '127.0.0.1', resolve));
  const processTarget = new EventEmitter();
  processTarget.exit = code => events.push(`exit:${code}`);
  const errors = [];
  const shutdown = installShutdownHandlers(hub, { processTarget, logger: { error: (...args) => errors.push(args) } });
  try {
    processTarget.emit('SIGTERM');
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(events, ['sandbox:cancel:hub_close']);
    assert.doesNotThrow(() => hub.db.getThread());
    const first = hub.close();
    const second = hub.close();
    assert.strictEqual(first, second);
    releaseDestroy.resolve();
    await shutdown('SIGTERM');
    assert.deepEqual(errors, []);
    assert.deepEqual(events.slice(0, 3), ['sandbox:cancel:hub_close', 'container:destroyed', 'worktree:removed']);
    const firstStore = events.findIndex(event => event.endsWith(':closed'));
    assert.ok(firstStore > events.indexOf('worktree:removed'));
    assert.equal(events.at(-1), 'exit:0');
  } finally {
    releaseDestroy.resolve();
    await hub.close().catch(() => {});
    await rm(dir, { recursive: true, force: true });
  }
});

test('signal shutdown reports cleanup rejection and exits nonzero after stores close', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-shutdown-error-'));
  const events = [];
  const cleanupError = new Error('container destroy failed');
  const recipeRunner = {
    active: true,
    status: () => ({ active: true }),
    async destroy() { events.push('sandbox:destroy'); throw cleanupError; },
  };
  const hub = createHub({ env: envFor(dir), recipeRunner });
  observeStoreClosures(hub, events);
  const processTarget = new EventEmitter();
  processTarget.exit = code => events.push(`exit:${code}`);
  const errors = [];
  const shutdown = installShutdownHandlers(hub, { processTarget, logger: { error: (...args) => errors.push(args) } });
  try {
    processTarget.emit('SIGINT');
    await shutdown('SIGINT');
    assert.equal(errors.length, 1);
    assert.match(errors[0][0], /failed to shut down cleanly after SIGINT/);
    assert.strictEqual(errors[0][1], cleanupError);
    assert.ok(events.findIndex(event => event === 'db:closed') > events.indexOf('sandbox:destroy'));
    assert.equal(events.at(-1), 'exit:1');
  } finally {
    await hub.close().catch(() => {});
    await rm(dir, { recursive: true, force: true });
  }
});
