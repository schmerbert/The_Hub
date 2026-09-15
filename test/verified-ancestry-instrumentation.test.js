import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HubDatabase } from '../src/ledger/source.js';
import { applyBackfillAtomically } from '../src/forest/backfill.js';
import { verifyForest } from '../src/forest/verify.js';
import { buildContext } from '../src/context/assemble.js';
import { WorldGraphStore } from '../src/world/graph.js';

async function temporary(prefix) {
  return mkdtemp(join(tmpdir(), prefix));
}

async function createForestFixture(dir) {
  const operationalPath = join(dir, 'hub.sqlite');
  const forestPath = join(dir, 'forest.sqlite');
  const db = new HubDatabase(operationalPath);
  const content = 'instrumentation fixture';
  const created = db.createWake({
    provider: 'deepseek', model: 'test-model', content,
    contextBuilder: ({ threadId, wakeId, startedAt }) => buildContext({
      utterances: [], newContent: content, ceiling: 20, threadId, wakeId,
      wakeStartedAtUtc: startedAt, residentMode: 'live', requestedModel: 'test-model',
    }).items,
  });
  db.commitWake(created.wakeId, { resolvedModel: 'test-model' }, 'instrumentation reply');
  db.close();
  applyBackfillAtomically({ operationalPath, forestPath, confirmCreate: true });
  return { operationalPath, forestPath };
}

function assertPhaseTiming(metrics, names) {
  assert.equal(metrics.mode, 'full');
  assert.ok(Number.isFinite(metrics.elapsedMs));
  assert.ok(metrics.elapsedMs >= 0);
  for (const name of names) {
    assert.ok(metrics.phases[name]);
    assert.ok(Number.isFinite(metrics.phases[name].elapsedMs));
    assert.ok(metrics.phases[name].elapsedMs >= 0);
  }
}

test('full Forest verification returns bounded phase instrumentation without sensitive detail', async () => {
  const dir = await temporary('hub-ancestry-forest-metrics-');
  try {
    const paths = await createForestFixture(dir);
    const result = verifyForest(paths);
    assert.equal(result.ok, true);
    const metrics = result.instrumentation;
    assert.equal(metrics.domain, 'forest');
    assertPhaseTiming(metrics, ['schema', 'source', 'topology', 'spine', 'emissions', 'wild', 'intake']);
    assert.equal(metrics.counters.entryCount, result.entryCount);
    assert.equal(metrics.counters.spineFrameCount, 0);
    assert.equal(metrics.counters.spineRequestBodyBytes, 0);
    assert.equal(metrics.counters.spineRawReturnBytes, 0);
    assert.doesNotMatch(JSON.stringify(metrics), /instrumentation fixture|hub\.sqlite|forest\.sqlite|thread-test|wake-test|event_[a-z0-9-]+/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('full World verification returns bounded phase instrumentation without identities', async () => {
  const dir = await temporary('hub-ancestry-world-metrics-');
  const world = new WorldGraphStore(join(dir, 'world.sqlite'), { topologyVersion: 'hearth' });
  try {
    const result = world.verification();
    assert.equal(result.verified, true);
    const metrics = result.instrumentation;
    assert.equal(metrics.domain, 'world');
    assertPhaseTiming(metrics, ['schema', 'journal', 'projection', 'custody', 'topology']);
    assert.equal(metrics.counters.eventCount, result.eventCount);
    assert.ok(metrics.counters.journalPayloadBytes > 0);
    assert.ok(metrics.counters.projectionRowCount > 0);
    assert.doesNotMatch(JSON.stringify(metrics), /world_event_|world\.sqlite|event_id|event_hash|content/);
  } finally {
    world.close();
    await rm(dir, { recursive: true, force: true });
  }
});
