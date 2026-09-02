import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { canonicalize, sha256 } from '../src/core/hash.js';
import { appendRoomInstallationReceipt, installRoomInstallationLedger, listRoomInstallationReceipts } from '../src/rooms/installation-ledger.js';
import {
  establishSpotlightInstallationReceipt,
  inspectSpotlightInstallationUpgrade,
  migrateSpotlightInstallation,
  SPOTLIGHT_INSTALLATION_MIGRATION_COMMAND,
} from '../src/rooms/installation-runtime.js';
import { spotlightInstallationWitness } from '../src/rooms/spotlight-witness.js';
import { WorldGraphStore } from '../src/world/graph.js';

function legacyWitness() {
  const current = spotlightInstallationWitness();
  const legacy = { ...current, packageVersion: '1.1.0', manifestHash: 'a'.repeat(64) };
  delete legacy.witnessHash; delete legacy.verified;
  legacy.witnessHash = sha256(canonicalize(legacy)); legacy.verified = true;
  return legacy;
}

async function spotlightFixture({ eventFailureInjector = null } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'hub-spotlight-installation-migration-'));
  const path = join(dir, 'world.sqlite');
  const world = new WorldGraphStore(path, { topologyVersion: 'spotlight' });
  world.eventFailureInjector = eventFailureInjector;
  installRoomInstallationLedger(world.sqlite);
  const witness = legacyWitness();
  const topology = world.sqlite.prepare("SELECT sequence,event_hash,occurred_at FROM world_event_journal WHERE event_kind='topology.spotlight_installed/v1'").get();
  const priorReceipt = appendRoomInstallationReceipt(world.sqlite, {
    witness,
    ancestry: 'forward_installation',
    admission: { status: 'admitted', authority: 'user', reason: 'spotlight_observatory_v1_adoption' },
    bindings: { witnessHash: witness.witnessHash, standing: true, entrancePolicy: 'withheld' },
    worldEventSequence: topology.sequence,
    worldEventHash: topology.event_hash,
    installedAt: topology.occurred_at,
  });
  return { dir, path, world, priorReceipt, topology };
}

async function currentFixture() {
  const dir = await mkdtemp(join(tmpdir(), 'hub-spotlight-installation-current-'));
  const path = join(dir, 'world.sqlite');
  const world = new WorldGraphStore(path, { topologyVersion: 'spotlight' });
  installRoomInstallationLedger(world.sqlite);
  const witness = spotlightInstallationWitness();
  const topology = world.sqlite.prepare("SELECT sequence,event_hash,occurred_at FROM world_event_journal WHERE event_kind='topology.spotlight_door_installed/v1'").get();
  const receipt = appendRoomInstallationReceipt(world.sqlite, {
    witness,
    ancestry: 'forward_installation',
    admission: { status: 'admitted', authority: 'user', reason: 'spotlight_observatory_v1_adoption' },
    bindings: { witnessHash: witness.witnessHash, standing: true, entrancePolicy: 'installed' },
    worldEventSequence: topology.sequence,
    worldEventHash: topology.event_hash,
    installedAt: topology.occurred_at,
  });
  return { dir, path, world, receipt };
}

test('Spotlight startup refuses an older receipt with its explicit migration command', async () => {
  const fixture = await spotlightFixture();
  try {
    const inspection = inspectSpotlightInstallationUpgrade(fixture.world);
    assert.equal(inspection.status, 'upgrade_required');
    assert.equal(inspection.command, SPOTLIGHT_INSTALLATION_MIGRATION_COMMAND);
    fixture.world.close();
    const reopened = new WorldGraphStore(fixture.path, { topologyVersion: 'spotlight' });
    try {
      assert.throws(() => establishSpotlightInstallationReceipt(reopened), error => error.code === 'spotlight_installation_upgrade_required' && error.command === SPOTLIGHT_INSTALLATION_MIGRATION_COMMAND);
      assert.equal(listRoomInstallationReceipts(reopened.sqlite).length, 1);
      assert.equal(reopened.sqlite.prepare("SELECT COUNT(*) AS count FROM world_event_journal WHERE event_kind='room.installation.revised/v1' AND aggregate_id='room.spotlight'").get().count, 0);
    } finally { reopened.close(); }
  } finally { try { fixture.world.close(); } catch {} await rm(fixture.dir, { recursive: true, force: true }); }
});

test('Spotlight migration requires backup confirmation and leaves the World untouched', async () => {
  const fixture = await spotlightFixture();
  try {
    assert.throws(() => migrateSpotlightInstallation(fixture.world), error => error.code === 'room_installation_backup_required');
    assert.equal(fixture.world.sqlite.prepare("SELECT COUNT(*) AS count FROM world_event_journal WHERE event_kind='room.installation.revised/v1' AND aggregate_id='room.spotlight'").get().count, 0);
    assert.equal(listRoomInstallationReceipts(fixture.world.sqlite).length, 1);
  } finally { fixture.world.close(); await rm(fixture.dir, { recursive: true, force: true }); }
});

test('Spotlight migration preserves topology and prior receipt ancestry, then is idempotent', async () => {
  const fixture = await spotlightFixture();
  try {
    const migrated = migrateSpotlightInstallation(fixture.world, { backupConfirmed: true, reason: 'install the complete capped hand surface' });
    assert.equal(migrated.status, 'migrated');
    assert.equal(fixture.world.verification().verified, true);
    const topology = fixture.world.sqlite.prepare("SELECT sequence,event_hash FROM world_event_journal WHERE event_kind='topology.spotlight_installed/v1'").get();
    assert.equal(topology.sequence, fixture.topology.sequence);
    assert.equal(topology.event_hash, fixture.topology.event_hash);
    const revision = fixture.world.sqlite.prepare("SELECT * FROM world_event_journal WHERE event_kind='room.installation.revised/v1' AND aggregate_id='room.spotlight'").get();
    assert.ok(revision);
    const payload = JSON.parse(revision.payload_json);
    assert.equal(payload.roomId, 'room.spotlight');
    assert.equal(payload.priorReceiptId, fixture.priorReceipt.receiptId);
    assert.equal(payload.priorReceiptHash, fixture.priorReceipt.receiptHash);
    const receipts = listRoomInstallationReceipts(fixture.world.sqlite);
    assert.equal(receipts.length, 2);
    assert.equal(receipts[0].receiptId, fixture.priorReceipt.receiptId);
    assert.equal(receipts[1].ancestry, 'forward_installation');
    assert.equal(receipts[1].bindings.priorReceiptId, fixture.priorReceipt.receiptId);
    assert.equal(receipts[1].bindings.priorReceiptHash, fixture.priorReceipt.receiptHash);
    assert.deepEqual(receipts[1].worldEvent, { sequence: revision.sequence, hash: revision.event_hash });
    const second = migrateSpotlightInstallation(fixture.world, { backupConfirmed: true });
    assert.equal(second.status, 'current');
    assert.equal(fixture.world.sqlite.prepare("SELECT COUNT(*) AS count FROM world_event_journal WHERE event_kind='room.installation.revised/v1' AND aggregate_id='room.spotlight'").get().count, 1);
    assert.equal(listRoomInstallationReceipts(fixture.world.sqlite).length, 2);
  } finally { fixture.world.close(); await rm(fixture.dir, { recursive: true, force: true }); }
});

test('Spotlight installation supports the capped-hands receipt followed by the enterable-room receipt', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-spotlight-installation-sequence-'));
  const path = join(dir, 'world.sqlite');
  const world = new WorldGraphStore(path, { topologyVersion: 'spotlight' });
  try {
    installRoomInstallationLedger(world.sqlite);
    const current = spotlightInstallationWitness();
    const makeWitness = (packageVersion, manifestHash) => {
      const witness = { ...current, packageVersion, manifestHash };
      delete witness.witnessHash; delete witness.verified;
      witness.witnessHash = sha256(canonicalize(witness)); witness.verified = true;
      return witness;
    };
    const shell = world.sqlite.prepare("SELECT sequence,event_hash,occurred_at FROM world_event_journal WHERE event_kind='topology.spotlight_installed/v1'").get();
    const first = makeWitness('1.0.0', 'a'.repeat(64));
    const firstReceipt = appendRoomInstallationReceipt(world.sqlite, {
      witness: first, ancestry: 'forward_installation', admission: { status: 'admitted', authority: 'user' },
      bindings: { witnessHash: first.witnessHash, standing: true, entrancePolicy: 'withheld' },
      worldEventSequence: shell.sequence, worldEventHash: shell.event_hash, installedAt: shell.occurred_at,
    });
    const capped = makeWitness('1.1.0', 'b'.repeat(64));
    const cappedPayload = {
      roomId: 'room.spotlight', priorReceiptId: firstReceipt.receiptId, priorReceiptHash: firstReceipt.receiptHash,
      priorPackageVersion: firstReceipt.packageVersion, priorManifestHash: firstReceipt.manifestHash, priorWitnessHash: firstReceipt.witnessHash,
      newPackageVersion: capped.packageVersion, newManifestHash: capped.manifestHash, newWitnessHash: capped.witnessHash,
      reason: 'install capped hands', admission: { status: 'admitted', authority: 'host' },
    };
    world.appendRoomInstallationRevisionEvent({
      roomId: 'room.spotlight', payload: cappedPayload,
      afterEvent: event => appendRoomInstallationReceipt(world.sqlite, {
        witness: capped, ancestry: 'forward_installation', admission: cappedPayload.admission,
        bindings: { witnessHash: capped.witnessHash, standing: true, priorReceiptId: firstReceipt.receiptId, priorReceiptHash: firstReceipt.receiptHash, revisionEvent: { sequence: event.sequence, hash: event.event_hash } },
        worldEventSequence: event.sequence, worldEventHash: event.event_hash, installedAt: event.occurred_at,
      }),
    });
    assert.equal(inspectSpotlightInstallationUpgrade(world).status, 'upgrade_required');
    const migrated = migrateSpotlightInstallation(world, { backupConfirmed: true, reason: 'install enterable room' });
    assert.equal(migrated.status, 'migrated');
    assert.equal(world.sqlite.prepare("SELECT COUNT(*) AS count FROM world_event_journal WHERE event_kind='room.installation.revised/v1' AND aggregate_id='room.spotlight'").get().count, 2);
    assert.equal(listRoomInstallationReceipts(world.sqlite).length, 3);
    assert.equal(inspectSpotlightInstallationUpgrade(world).status, 'current');
  } finally { world.close(); await rm(dir, { recursive: true, force: true }); }
});

test('Spotlight migration reports current installations and refuses World drift', async () => {
  const current = await currentFixture();
  try {
    assert.equal(inspectSpotlightInstallationUpgrade(current.world).status, 'current');
    assert.equal(migrateSpotlightInstallation(current.world, { backupConfirmed: true }).status, 'current');
    const driftWitness = { ...spotlightInstallationWitness(), witnessHash: 'b'.repeat(64) };
    assert.equal(inspectSpotlightInstallationUpgrade(current.world, { witness: driftWitness }).status, 'witness_drift');
  } finally { current.world.close(); await rm(current.dir, { recursive: true, force: true }); }

  const refused = await spotlightFixture();
  try {
    refused.world.sqlite.exec('DROP TRIGGER world_event_journal_append_only_update');
    refused.world.sqlite.prepare("UPDATE world_event_journal SET payload_json='{}' WHERE event_kind='topology.spotlight_installed/v1'").run();
    assert.throws(() => migrateSpotlightInstallation(refused.world, { backupConfirmed: true }), error => error.code === 'spotlight_installation_migration_refused' && !error.message.includes('backup'));
    assert.equal(refused.world.sqlite.prepare("SELECT COUNT(*) AS count FROM world_event_journal WHERE event_kind='room.installation.revised/v1' AND aggregate_id='room.spotlight'").get().count, 0);
  } finally { refused.world.close(); await rm(refused.dir, { recursive: true, force: true }); }
});

test('Spotlight migration rolls back its revision event and receipt together', async () => {
  const fixture = await spotlightFixture({ eventFailureInjector: ({ phase }) => { if (phase === 'after_projection_apply') throw new Error('Spotlight revision rollback'); } });
  try {
    assert.throws(() => migrateSpotlightInstallation(fixture.world, { backupConfirmed: true }), /Spotlight revision rollback/);
    assert.equal(fixture.world.sqlite.prepare("SELECT COUNT(*) AS count FROM world_event_journal WHERE event_kind='room.installation.revised/v1' AND aggregate_id='room.spotlight'").get().count, 0);
    assert.equal(listRoomInstallationReceipts(fixture.world.sqlite).length, 1);
    assert.equal(fixture.world.verification().verified, true);
  } finally { fixture.world.close(); await rm(fixture.dir, { recursive: true, force: true }); }
});
