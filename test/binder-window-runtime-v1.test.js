import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadBinderWindowSnapshot, projectBinderSnapshot } from '../src/places/hub/binder-window/index.js';
import { WorkshopAdapter } from '../src/places/hub/workshop/index.js';
import { WorldGraphStore } from '../src/world/graph.js';
import { WorldActionGateway } from '../src/world/gateway.js';
import { inspectFixtureContents } from '../src/world/gateway/fixture-inspectors.js';
import { placeInCenterFromHouse } from './support/house-navigation.js';

const snapshot = {
  belts: [], bodies: [],
  totals: { cost_usd: 0, value_usd: 0, priced_cost_usd: 0, unvalued_cost_usd: 0, dark_pct: 0, objects: 0, belts: 0, bodies: 0, lots: 0, priced_bodies: 0, unpriced_bodies: 0, confidence: 'empty', as_of: null },
  curve: { series: [], days: 0, change_usd: null, comparable: false, unread_days: 0, carried_days: 0, covers: 'cards' },
  absent: {
    treasury: { absent: true, why: 'no cash account' },
    thesis: { absent: true, why: 'no objects', of: 0 },
    orbits: { absent: true, why: 'no relations' },
    quotes: { absent: false, unquoted: 0, of: 0, symbols: [], belts_unpriced: 0, why: 'no positions require quotes' },
  },
};

test('the Center fixture projects one frozen local Binder snapshot without refresh behavior', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hub-binder-window-runtime-'));
  try {
    const path = join(dir, 'binder-window.json');
    writeFileSync(path, JSON.stringify(snapshot));
    const admitted = loadBinderWindowSnapshot(path);
    const inspected = inspectFixtureContents({ binderWindow: admitted, fixtureId: 'fixture.binder_window' });
    assert.strictEqual(inspected, admitted);
    assert.equal(inspected.availability, 'available');
    assert.equal(inspected.source.authority, 'binder');
    assert.equal(inspected.source.route, 'GET /api/dashboard');
    assert.equal(typeof inspected.refresh, 'undefined');
    assert.equal(typeof inspected.fetch, 'undefined');
    assert.ok(Object.isFrozen(inspected));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a missing configured snapshot is a truthful dormant Window', () => {
  const admitted = loadBinderWindowSnapshot(join(tmpdir(), 'binder-window-definitely-absent.json'));
  const inspected = inspectFixtureContents({ binderWindow: admitted, fixtureId: 'fixture.binder_window' });
  assert.equal(inspected.availability, 'dormant');
  assert.equal(inspected.reason, 'missing_snapshot');
  assert.equal(inspected.totals, null);
});

test('ordinary fixtures cannot inherit Binder material', () => {
  const binderWindow = projectBinderSnapshot(snapshot);
  const inspected = inspectFixtureContents({ world: { node: () => ({ resident_text: 'stone' }) }, binderWindow, fixtureId: 'fixture.stone_bench' });
  assert.deepEqual(inspected, { kind: 'fixture', text: 'stone' });
});

test('Window inspection commits a canonical World receipt without projection drift', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hub-binder-window-inspect-'));
  const world = new WorldGraphStore(join(dir, 'world.sqlite'), { topologyVersion: 'binder_window' });
  const workshop = new WorkshopAdapter(dir);
  const binderWindow = projectBinderSnapshot(snapshot);
  const gateway = new WorldActionGateway({ world, workshop, binderWindow, approvalMode: 'confirm' });
  try {
    await placeInCenterFromHouse(world, gateway, 'life');
    const inspected = await gateway.execute({
      sessionId: 'life',
      wakeId: 'wake',
      intent: { id: 'inspect-window', type: 'function', function: { name: 'inspect_fixture', arguments: '{"fixture_id":"fixture.binder_window"}' } },
    });
    assert.equal(inspected.result.kind, 'fixture_inspect');
    assert.equal(inspected.result.fixtureId, 'fixture.binder_window');
    assert.equal(inspected.result.contents.availability, 'available');
    assert.equal(inspected.result.contents.freshness.newest, null);
    assert.ok(inspected.actionReceipt.receiptId);
    const receipt = world.sqlite.prepare('SELECT outcome, result_json FROM world_action_receipts WHERE receipt_id=?').get(inspected.actionReceipt.receiptId);
    assert.equal(receipt.outcome, 'committed');
    assert.equal(JSON.parse(receipt.result_json).contents.freshness.newest, null);
    assert.equal(world.verification().verified, true);
  } finally {
    world.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
