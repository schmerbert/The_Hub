import {
  appendRoomInstallationReceipt, assertValidRoomInstallationReceipt, installRoomInstallationLedger, listRoomInstallationReceipts,
} from './installation-ledger.js';
import { workshopInstallationWitness } from './workshop-witness.js';

export const WORKSHOP_INSTALLATION_MIGRATION_COMMAND = 'npm run room:migrate-workshop -- --apply --backup-confirmed';

export function establishInstalledRoomReceipts(world) {
  const sqlite = worldStore(world);
  installRoomInstallationLedger(sqlite);
  const witness = workshopInstallationWitness();
  const inspection = inspectWorkshopInstallationUpgrade(world, { witness });
  if (inspection.status === 'current') return inspection.receipt;
  if (inspection.status === 'upgrade_required') {
    throw Object.assign(new Error(`Workshop installation upgrade required from ${inspection.priorReceipt.packageVersion} to ${witness.packageVersion}. Run ${WORKSHOP_INSTALLATION_MIGRATION_COMMAND} after creating a recoverable backup.`), {
      code: 'room_installation_upgrade_required',
      command: WORKSHOP_INSTALLATION_MIGRATION_COMMAND,
      priorReceiptId: inspection.priorReceipt.receiptId,
      priorReceiptHash: inspection.priorReceipt.receiptHash,
      priorPackageVersion: inspection.priorReceipt.packageVersion,
      priorManifestHash: inspection.priorReceipt.manifestHash,
      priorWitnessHash: inspection.priorReceipt.witnessHash,
      newPackageVersion: witness.packageVersion,
      newManifestHash: witness.manifestHash,
      newWitnessHash: witness.witnessHash,
    });
  }
  if (inspection.status === 'witness_drift') {
    throw Object.assign(new Error(`Workshop installation witness drift for ${witness.packageVersion}: standing ${inspection.receipt.witnessHash}, current ${witness.witnessHash}.`), {
      code: 'room_installation_witness_drift', oldWitnessHash: inspection.receipt.witnessHash, newWitnessHash: witness.witnessHash,
    });
  }
  if (inspection.status !== 'missing_original_receipt') throw Object.assign(new Error(`Workshop installation receipt state is ${inspection.status}.`), { code: 'room_installation_receipt_invalid', inspection });
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

export function inspectWorkshopInstallationUpgrade(world, { witness = workshopInstallationWitness() } = {}) {
  const sqlite = worldStore(world);
  const receipts = listRoomInstallationReceipts(sqlite).filter(receipt => receipt.roomId === witness.roomId);
  for (const receipt of receipts) assertValidRoomInstallationReceipt(receipt);
  const revisionEvents = sqlite.prepare("SELECT sequence,event_hash,payload_json FROM world_event_journal WHERE event_kind='room.installation.revised/v1' AND aggregate_id=? ORDER BY aggregate_revision,sequence").all(witness.roomId);
  const exact = receipts.find(receipt => receipt.packageVersion === witness.packageVersion && receipt.manifestHash === witness.manifestHash);
  if (exact) {
    if (exact.witnessHash !== witness.witnessHash) return { status: 'witness_drift', receipt: exact, witness };
    if (exact.ancestry === 'forward_installation') {
      const event = revisionEvents.at(-1);
      let payload = null;
      try { payload = event ? JSON.parse(event.payload_json) : null; } catch {}
      const prior = payload && receipts.find(receipt => receipt.receiptId === payload.priorReceiptId);
      const eventMatches = event && payload && prior && payload.priorReceiptHash === prior.receiptHash && payload.priorPackageVersion === prior.packageVersion && payload.priorManifestHash === prior.manifestHash && payload.priorWitnessHash === prior.witnessHash && payload.newPackageVersion === exact.packageVersion && payload.newManifestHash === exact.manifestHash && payload.newWitnessHash === exact.witnessHash && exact.bindings?.revisionEvent?.sequence === event.sequence && exact.bindings?.revisionEvent?.hash === event.event_hash;
      if (!eventMatches) return { status: 'corrupt_or_incomplete_upgrade', receipt: exact, witness, revisionEvents };
    }
    return { status: 'current', receipt: exact, witness };
  }
  if (!receipts.length) return { status: 'missing_original_receipt', witness };
  const priorReceipt = receipts.at(-1);
  if (revisionEvents.length && !receipts.some(receipt => receipt.receiptId !== priorReceipt.receiptId && receipt.packageVersion === witness.packageVersion && receipt.manifestHash === witness.manifestHash)) {
    return { status: 'corrupt_or_incomplete_upgrade', priorReceipt, witness, revisionEvents };
  }
  return { status: 'upgrade_required', priorReceipt, witness, command: WORKSHOP_INSTALLATION_MIGRATION_COMMAND, revisionEvents };
}

export function migrateWorkshopInstallation(world, {
  backupConfirmed = false, reason = 'workshop_wiring_revision', admission = { status: 'admitted', authority: 'host' },
} = {}) {
  if (backupConfirmed !== true) throw Object.assign(new Error('Workshop installation migration requires explicit confirmation that a recoverable World database backup exists.'), { code: 'room_installation_backup_required' });
  const verification = world.verification({ mismatchLimit: 50 });
  if (!verification.verified) throw Object.assign(new Error('Workshop installation migration requires an exactly verified World database.'), { code: 'room_installation_migration_refused', verification });
  const witness = workshopInstallationWitness();
  const inspection = inspectWorkshopInstallationUpgrade(world, { witness });
  if (inspection.status === 'current') return { status: 'current', receipt: inspection.receipt, verification };
  if (inspection.status !== 'upgrade_required') throw Object.assign(new Error(`Workshop installation migration refused because status is ${inspection.status}.`), { code: 'room_installation_migration_refused', inspection });
  const prior = assertValidRoomInstallationReceipt(inspection.priorReceipt);
  if (prior.roomId !== witness.roomId || prior.packageVersion === witness.packageVersion || prior.manifestHash === witness.manifestHash) throw Object.assign(new Error('Workshop installation migration prior receipt is not an older exact installation.'), { code: 'room_installation_migration_refused', priorReceipt: prior });
  if (typeof reason !== 'string' || !reason.trim() || !admission || typeof admission !== 'object' || Array.isArray(admission)) throw Object.assign(new Error('Workshop installation migration reason or admission is invalid.'), { code: 'room_installation_migration_invalid' });
  const payload = {
    roomId: witness.roomId,
    priorReceiptId: prior.receiptId,
    priorReceiptHash: prior.receiptHash,
    priorPackageVersion: prior.packageVersion,
    priorManifestHash: prior.manifestHash,
    priorWitnessHash: prior.witnessHash,
    newPackageVersion: witness.packageVersion,
    newManifestHash: witness.manifestHash,
    newWitnessHash: witness.witnessHash,
    reason: reason.trim(),
    admission: structuredClone(admission),
  };
  let receipt = null;
  const eventResult = world.appendRoomInstallationRevisionEvent({
    payload,
    afterEvent: event => {
      receipt = appendRoomInstallationReceipt(worldStore(world), {
        witness,
        ancestry: 'forward_installation',
        admission,
        bindings: { witnessHash: witness.witnessHash, standing: true, priorReceiptId: prior.receiptId, priorReceiptHash: prior.receiptHash, revisionEvent: { sequence: event.sequence, hash: event.event_hash } },
        worldEventSequence: event.sequence,
        worldEventHash: event.event_hash,
        installedAt: event.occurred_at,
      });
    },
  });
  if (eventResult.status === 'current') {
    const current = inspectWorkshopInstallationUpgrade(world, { witness });
    if (current.status !== 'current') throw Object.assign(new Error('Existing Workshop installation revision event has no matching current receipt.'), { code: 'room_installation_migration_refused', current, event: eventResult.event });
    return { status: 'current', receipt: current.receipt, event: eventResult.event, verification: world.verification({ mismatchLimit: 50 }) };
  }
  const current = inspectWorkshopInstallationUpgrade(world, { witness });
  if (current.status !== 'current' || !receipt) throw Object.assign(new Error('Workshop installation migration did not establish the current receipt.'), { code: 'room_installation_migration_verification_failed', current });
  const finalVerification = world.verification({ mismatchLimit: 50 });
  if (!finalVerification.verified) throw Object.assign(new Error('Workshop installation migration did not leave a verified World.'), { code: 'room_installation_migration_verification_failed', verification: finalVerification });
  return { status: 'migrated', receipt, event: eventResult.event, verification: finalVerification };
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
