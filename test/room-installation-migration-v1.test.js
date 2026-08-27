import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { canonicalize, sha256 } from '../src/core/hash.js';
import { appendRoomInstallationReceipt, installRoomInstallationLedger, listRoomInstallationReceipts } from '../src/rooms/installation-ledger.js';
import { establishInstalledRoomReceipts, inspectWorkshopInstallationUpgrade, migrateWorkshopInstallation } from '../src/rooms/installation-runtime.js';
import { workshopInstallationWitness } from '../src/rooms/workshop-witness.js';
import { WorldGraphStore } from '../src/world/graph.js';

function legacyWitness() {
  const current = workshopInstallationWitness();
  const legacy = { ...current, packageVersion: '1.0.0', manifestHash: 'a'.repeat(64) };
  delete legacy.witnessHash; delete legacy.verified;
  legacy.witnessHash = sha256(canonicalize(legacy)); legacy.verified = true;
  return legacy;
}

async function legacyFixture({ eventFailureInjector = null } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'hub-room-installation-migration-'));
  const path = join(dir, 'world.sqlite');
  const world = new WorldGraphStore(path, { eventFailureInjector });
  installRoomInstallationLedger(world.sqlite);
  const witness = legacyWitness();
  const root = world.sqlite.prepare("SELECT sequence,event_hash,occurred_at FROM world_event_journal WHERE event_kind='topology.installed/v1'").get();
  const priorReceipt = appendRoomInstallationReceipt(world.sqlite, {
    witness, ancestry: 'inherited_pre_boundary',
    admission: { status: 'not_recorded', reason: 'installation_predates_receipt_boundary' },
    bindings: { witnessHash: witness.witnessHash, standing: true },
    worldEventSequence: root.sequence, worldEventHash: root.event_hash, installedAt: root.occurred_at,
  });
  return { dir, path, world, priorReceipt };
}

test('startup refuses an older Workshop receipt with an explicit migration command', async () => {
  const fixture = await legacyFixture();
  try {
    const inspection = inspectWorkshopInstallationUpgrade(fixture.world);
    assert.equal(inspection.status, 'upgrade_required');
    fixture.world.close();
    const reopened = new WorldGraphStore(fixture.path);
    try {
      assert.throws(() => establishInstalledRoomReceipts(reopened), error => error.code === 'room_installation_upgrade_required' && error.command.includes('room:migrate-workshop'));
      assert.equal(listRoomInstallationReceipts(reopened.sqlite).length, 1);
      assert.equal(reopened.sqlite.prepare("SELECT COUNT(*) AS count FROM world_event_journal WHERE event_kind='room.installation.revised/v1'").get().count, 0);
    } finally { reopened.close(); }
  } finally { try { fixture.world.close(); } catch {} await rm(fixture.dir, { recursive: true, force: true }); }
});

test('Workshop installation migration appends a strict World event and forward receipt idempotently', async () => {
  const fixture = await legacyFixture();
  try {
    const migrated = migrateWorkshopInstallation(fixture.world, { backupConfirmed: true, reason: 'verified Workshop wiring revision' });
    assert.equal(migrated.status, 'migrated');
    assert.equal(fixture.world.verification().verified, true);
    assert.equal(fixture.world.sqlite.prepare("SELECT COUNT(*) AS count FROM world_event_journal WHERE event_kind='room.installation.revised/v1'").get().count, 1);
    const receipts = listRoomInstallationReceipts(fixture.world.sqlite);
    assert.equal(receipts.length, 2);
    assert.equal(receipts[0].receiptId, fixture.priorReceipt.receiptId);
    assert.equal(receipts[1].ancestry, 'forward_installation');
    assert.equal(receipts[1].bindings.priorReceiptHash, fixture.priorReceipt.receiptHash);
    const second = migrateWorkshopInstallation(fixture.world, { backupConfirmed: true });
    assert.equal(second.status, 'current');
    assert.equal(fixture.world.sqlite.prepare("SELECT COUNT(*) AS count FROM world_event_journal WHERE event_kind='room.installation.revised/v1'").get().count, 1);
  } finally { fixture.world.close(); await rm(fixture.dir, { recursive: true, force: true }); }
});

test('Workshop installation migration rolls back its event and receipt together', async () => {
  const fixture = await legacyFixture(); fixture.world.close();
  const world = new WorldGraphStore(fixture.path, { eventFailureInjector: ({ phase }) => { if (phase === 'after_projection_apply') throw new Error('revision rollback'); } });
  try {
    assert.throws(() => migrateWorkshopInstallation(world, { backupConfirmed: true }), /revision rollback/);
    assert.equal(world.sqlite.prepare("SELECT COUNT(*) AS count FROM world_event_journal WHERE event_kind='room.installation.revised/v1'").get().count, 0);
    assert.equal(listRoomInstallationReceipts(world.sqlite).length, 1);
    assert.equal(world.verification().verified, true);
  } finally { world.close(); await rm(fixture.dir, { recursive: true, force: true }); }
});

test('World verifier rejects a revision event whose payload is not strict', async () => {
  const fixture = await legacyFixture();
  try {
    migrateWorkshopInstallation(fixture.world, { backupConfirmed: true });
    fixture.world.sqlite.exec('DROP TRIGGER world_event_journal_append_only_update');
    fixture.world.sqlite.prepare("UPDATE world_event_journal SET payload_json='{}' WHERE event_kind='room.installation.revised/v1'").run();
    assert.equal(fixture.world.verification().verified, false);
  } finally { fixture.world.close(); await rm(fixture.dir, { recursive: true, force: true }); }
});
