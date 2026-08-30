import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { WorldGraphStore } from '../src/world/graph.js';
import { appendRoomInstallationReceipt, installRoomInstallationLedger, listRoomInstallationReceipts } from '../src/rooms/installation-ledger.js';
import { workshopInstallationWitness } from '../src/rooms/workshop-witness.js';
import { createHub } from '../src/server/app.js';
import { projectWorldBuilderInspection } from '../src/world/inspection.js';

test('room installation receipts close exact witness to World ancestry without inventing admission history', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-room-installation-receipt-'));
  const world = new WorldGraphStore(join(dir, 'world.sqlite'));
  const epoch = installRoomInstallationLedger(world.sqlite, { now: () => '2026-08-13T00:00:00.000Z' });
  const topology = world.sqlite.prepare("SELECT sequence,event_hash,occurred_at FROM world_event_journal WHERE event_kind='topology.installed/v1'").get();
  const witness = workshopInstallationWitness();
  const receipt = appendRoomInstallationReceipt(world.sqlite, {
    witness,
    ancestry: 'inherited_pre_boundary',
    admission: { status: 'not_recorded', reason: 'installation_predates_receipt_boundary' },
    bindings: { witnessHash: witness.witnessHash, standing: true },
    worldEventSequence: topology.sequence,
    worldEventHash: topology.event_hash,
    installedAt: topology.occurred_at,
  });
  assert.equal(epoch.boundaryKind, 'room_installation_receipts/v1');
  assert.equal(receipt.roomId, 'room.workshop');
  assert.equal(receipt.ancestry, 'inherited_pre_boundary');
  assert.equal(receipt.admission.status, 'not_recorded');
  assert.deepEqual(listRoomInstallationReceipts(world.sqlite), [receipt]);
  assert.deepEqual(appendRoomInstallationReceipt(world.sqlite, {
    witness, ancestry: receipt.ancestry, admission: receipt.admission, bindings: receipt.bindings,
    worldEventSequence: topology.sequence, worldEventHash: topology.event_hash, installedAt: topology.occurred_at,
  }), receipt);
  assert.throws(() => world.sqlite.exec("UPDATE room_installation_receipts SET room_id='room.other'"), /append-only/);
  world.close();
});

test('room installation receipts refuse an unresolved or mismatched World pointer', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-room-installation-receipt-refusal-'));
  const world = new WorldGraphStore(join(dir, 'world.sqlite'));
  installRoomInstallationLedger(world.sqlite);
  const witness = workshopInstallationWitness();
  assert.throws(() => appendRoomInstallationReceipt(world.sqlite, {
    witness, ancestry: 'forward_installation', admission: { status: 'admitted' }, bindings: {},
    worldEventSequence: 999, worldEventHash: 'missing', installedAt: '2026-08-13T00:00:00.000Z',
  }), /does not resolve exactly/);
  world.close();
});

test('Hub startup opens the boundary once and exposes inherited Workshop ancestry', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-room-installation-runtime-'));
  const paths = {
    dbPath: join(dir, 'hub.sqlite'), forestPath: join(dir, 'forest.sqlite'), spinePath: join(dir, 'spine.sqlite'),
    worldPath: join(dir, 'world.sqlite'), resultPath: join(dir, 'results.sqlite'),
  };
  const hub = createHub({ env: { HUB_MODE: 'fake', HUB_WORKSHOP_ROOT: dir }, ...paths });
  const inspection = projectWorldBuilderInspection(hub.world, hub.db.session.id);
  assert.equal(inspection.installationReceipts.length, 2);
  assert.equal(inspection.installationReceipts[0].roomId, 'room.workshop');
  assert.equal(inspection.installationReceipts[0].ancestry, 'inherited_pre_boundary');
  assert.equal(inspection.installationReceipts[1].roomId, 'room.spotlight');
  assert.equal(inspection.installationReceipts[1].ancestry, 'forward_installation');
  assert.equal(inspection.installationReceipts[1].bindings.entrancePolicy, 'withheld');
  await hub.close();
});

test('runtime ancestry accepts the exact legacy World root used by inherited installations', async () => {
  const source = await import('node:fs/promises').then(({ readFile }) => readFile(new URL('../src/rooms/installation-runtime.js', import.meta.url), 'utf8'));
  assert.match(source, /legacy_snapshot\.imported\/v1/);
});
