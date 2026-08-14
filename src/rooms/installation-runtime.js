import { appendRoomInstallationReceipt, installRoomInstallationLedger, listRoomInstallationReceipts } from './installation-ledger.js';
import { workshopInstallationWitness } from './workshop-witness.js';

export function establishInstalledRoomReceipts(world) {
  const sqlite = worldStore(world);
  installRoomInstallationLedger(sqlite);
  const witness = workshopInstallationWitness();
  const topology = sqlite.prepare("SELECT sequence,event_hash,occurred_at FROM world_event_journal WHERE event_kind IN ('topology.installed/v1','legacy_snapshot.imported/v1') ORDER BY sequence LIMIT 1").get();
  if (!topology) throw new Error('Workshop installation ancestry has no exact World root event.');
  return appendRoomInstallationReceipt(sqlite, {
    witness,
    ancestry: 'inherited_pre_boundary',
    admission: { status: 'not_recorded', reason: 'installation_predates_receipt_boundary' },
    bindings: { witnessHash: witness.witnessHash, standing: true },
    worldEventSequence: topology.sequence,
    worldEventHash: topology.event_hash,
    installedAt: topology.occurred_at,
  });
}

export function installedRoomReceipts(world) {
  const sqlite = worldStore(world);
  const available = sqlite.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='room_installation_receipts'").get();
  return available ? listRoomInstallationReceipts(sqlite) : [];
}

function worldStore(world) {
  const sqlite = Reflect.get(world, 'sqlite');
  if (!sqlite?.prepare) throw new Error('Room installation custody requires the host World store.');
  return sqlite;
}
