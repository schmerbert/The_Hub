import {
  appendRoomInstallationReceipt, assertValidRoomInstallationReceipt, installRoomInstallationLedger, listRoomInstallationReceipts,
} from './installation-ledger.js';
import { workshopInstallationWitness } from './workshop-witness.js';
import { spotlightInstallationWitness } from './spotlight-witness.js';

export const WORKSHOP_INSTALLATION_MIGRATION_COMMAND = 'npm run room:migrate-workshop -- --apply --backup-confirmed';
export const SPOTLIGHT_INSTALLATION_MIGRATION_COMMAND = 'npm run room:migrate-spotlight -- --apply --backup-confirmed';

export function establishInstalledRoomReceipts(world) {
  const sqlite = worldStore(world);
  installRoomInstallationLedger(sqlite);
  const witness = workshopInstallationWitness();
  const inspection = inspectWorkshopInstallationUpgrade(world, { witness });
  if (inspection.status === 'current') {
    establishSpotlightInstallationReceipt(world);
    return inspection.receipt;
  }
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
  const receipt = appendRoomInstallationReceipt(sqlite, {
    witness,
    ancestry: 'inherited_pre_boundary',
    admission: { status: 'not_recorded', reason: 'installation_predates_receipt_boundary' },
    bindings: { witnessHash: witness.witnessHash, standing: true },
    worldEventSequence: topology.sequence,
    worldEventHash: topology.event_hash,
    installedAt: topology.occurred_at,
  });
  establishSpotlightInstallationReceipt(world);
  return receipt;
}

export function establishSpotlightInstallationReceipt(world) {
  const sqlite = worldStore(world);
  installRoomInstallationLedger(sqlite);
  const witness = spotlightInstallationWitness();
  if (!witness.verified) throw Object.assign(new Error(`Spotlight installation witness has loose wires: ${witness.gaps.join(', ')}`), { code: 'spotlight_installation_witness_drift', witness });
  const inspection = inspectSpotlightInstallationUpgrade(world, { witness });
  if (inspection.status === 'missing_topology') return null;
  if (inspection.status === 'current') return inspection.receipt;
  if (inspection.status === 'upgrade_required') {
    throw Object.assign(new Error(`Spotlight installation upgrade required from ${inspection.priorReceipt.packageVersion} to ${witness.packageVersion}. Run ${SPOTLIGHT_INSTALLATION_MIGRATION_COMMAND} after creating a recoverable backup.`), {
      code: 'spotlight_installation_upgrade_required',
      command: SPOTLIGHT_INSTALLATION_MIGRATION_COMMAND,
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
    throw Object.assign(new Error(`Spotlight installation witness drift for ${witness.packageVersion}: standing ${inspection.receipt.witnessHash}, current ${witness.witnessHash}.`), {
      code: 'spotlight_installation_witness_drift', oldWitnessHash: inspection.receipt.witnessHash, newWitnessHash: witness.witnessHash,
    });
  }
  if (inspection.status === 'receipt_drift') throw Object.assign(new Error('Spotlight installation receipt does not point to the exact topology event.'), { code: 'spotlight_installation_receipt_drift', receipt: inspection.receipt, topology: inspection.topology });
  if (inspection.status !== 'missing_original_receipt') throw Object.assign(new Error(`Spotlight installation receipt state is ${inspection.status}.`), { code: 'spotlight_installation_receipt_invalid', inspection });
  return appendRoomInstallationReceipt(sqlite, {
    witness,
    ancestry: 'forward_installation',
    admission: { status: 'admitted', authority: 'user', reason: 'spotlight_observatory_v1_adoption' },
    bindings: { witnessHash: witness.witnessHash, standing: true, entrancePolicy: 'installed' },
    worldEventSequence: inspection.topology.sequence,
    worldEventHash: inspection.topology.event_hash,
    installedAt: inspection.topology.occurred_at,
  });
}

export function inspectSpotlightInstallationUpgrade(world, { witness = spotlightInstallationWitness() } = {}) {
  const sqlite = worldStore(world);
  const topology = sqlite.prepare("SELECT sequence,event_hash,occurred_at FROM world_event_journal WHERE event_kind IN ('topology.spotlight_installed/v1','topology.spotlight_door_installed/v1') ORDER BY sequence DESC LIMIT 1").get();
  if (!topology) return { status: 'missing_topology', witness };
  const receipts = listRoomInstallationReceipts(sqlite).filter(receipt => receipt.roomId === witness.roomId);
  for (const receipt of receipts) assertValidRoomInstallationReceipt(receipt);
  const revisionEvents = sqlite.prepare("SELECT sequence,event_hash,payload_json FROM world_event_journal WHERE event_kind='room.installation.revised/v1' AND aggregate_id=? ORDER BY aggregate_revision,sequence").all(witness.roomId);
  const exact = receipts.find(receipt => receipt.packageVersion === witness.packageVersion && receipt.manifestHash === witness.manifestHash);
  if (exact) {
    if (exact.witnessHash !== witness.witnessHash) return { status: 'witness_drift', receipt: exact, witness, topology, revisionEvents };
    const revisionEventPointer = exact.bindings?.revisionEvent;
    if (revisionEventPointer) {
      const event = revisionEvents.find(candidate => candidate.sequence === revisionEventPointer.sequence && candidate.event_hash === revisionEventPointer.hash);
      let payload = null;
      try { payload = event ? JSON.parse(event.payload_json) : null; } catch {}
      const prior = payload && receipts.find(receipt => receipt.receiptId === payload.priorReceiptId);
      const eventMatches = event && payload && prior
        && payload.roomId === witness.roomId
        && payload.priorReceiptHash === prior.receiptHash
        && payload.priorPackageVersion === prior.packageVersion
        && payload.priorManifestHash === prior.manifestHash
        && payload.priorWitnessHash === prior.witnessHash
        && payload.newPackageVersion === exact.packageVersion
        && payload.newManifestHash === exact.manifestHash
        && payload.newWitnessHash === exact.witnessHash
        && exact.worldEvent?.sequence === event.sequence
        && exact.worldEvent?.hash === event.event_hash
        && exact.bindings?.revisionEvent?.sequence === event.sequence
        && exact.bindings?.revisionEvent?.hash === event.event_hash;
      if (!eventMatches) return { status: 'corrupt_or_incomplete_upgrade', receipt: exact, witness, topology, revisionEvents };
    } else if (exact.worldEvent?.sequence !== topology.sequence || exact.worldEvent?.hash !== topology.event_hash) {
      return { status: 'receipt_drift', receipt: exact, witness, topology, revisionEvents };
    }
    return { status: 'current', receipt: exact, witness, topology, revisionEvents };
  }
  if (!receipts.length) return { status: 'missing_original_receipt', witness, topology, revisionEvents };
  const priorReceipt = receipts.at(-1);
  const unpairedRevision = revisionEvents.find(event => !receipts.some(receipt => receipt.bindings?.revisionEvent?.sequence === event.sequence && receipt.bindings?.revisionEvent?.hash === event.event_hash));
  if (unpairedRevision) return { status: 'corrupt_or_incomplete_upgrade', priorReceipt, witness, topology, revisionEvents };
  return { status: 'upgrade_required', priorReceipt, witness, topology, command: SPOTLIGHT_INSTALLATION_MIGRATION_COMMAND, revisionEvents };
}

export function migrateSpotlightInstallation(world, {
  backupConfirmed = false, reason = 'spotlight_enterable_room_revision', admission = { status: 'admitted', authority: 'host' },
} = {}) {
  if (backupConfirmed !== true) throw Object.assign(new Error('Spotlight installation migration requires explicit confirmation that a recoverable World database backup exists.'), { code: 'room_installation_backup_required' });
  const verification = world.verification({ mismatchLimit: 50 });
  if (!verification.verified) throw Object.assign(new Error('Spotlight installation migration requires an exactly verified World database.'), { code: 'spotlight_installation_migration_refused', verification });
  const witness = spotlightInstallationWitness();
  const inspection = inspectSpotlightInstallationUpgrade(world, { witness });
  if (inspection.status === 'current') return { status: 'current', receipt: inspection.receipt, verification };
  if (inspection.status !== 'upgrade_required') throw Object.assign(new Error(`Spotlight installation migration refused because status is ${inspection.status}.`), { code: 'spotlight_installation_migration_refused', inspection });
  const prior = assertValidRoomInstallationReceipt(inspection.priorReceipt);
  if (prior.roomId !== witness.roomId || prior.packageVersion === witness.packageVersion || prior.manifestHash === witness.manifestHash || prior.witnessHash === witness.witnessHash) throw Object.assign(new Error('Spotlight installation migration prior receipt is not an older exact installation.'), { code: 'spotlight_installation_migration_refused', priorReceipt: prior });
  if (typeof reason !== 'string' || !reason.trim() || !admission || typeof admission !== 'object' || Array.isArray(admission)) throw Object.assign(new Error('Spotlight installation migration reason or admission is invalid.'), { code: 'spotlight_installation_migration_invalid' });
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
    roomId: witness.roomId,
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
    const current = inspectSpotlightInstallationUpgrade(world, { witness });
    if (current.status !== 'current') throw Object.assign(new Error('Existing Spotlight installation revision event has no matching current receipt.'), { code: 'spotlight_installation_migration_refused', current, event: eventResult.event });
    return { status: 'current', receipt: current.receipt, event: eventResult.event, verification: world.verification({ mismatchLimit: 50 }) };
  }
  const current = inspectSpotlightInstallationUpgrade(world, { witness });
  if (current.status !== 'current' || !receipt) throw Object.assign(new Error('Spotlight installation migration did not establish the current receipt.'), { code: 'spotlight_installation_migration_verification_failed', current });
  const finalVerification = world.verification({ mismatchLimit: 50 });
  if (!finalVerification.verified) throw Object.assign(new Error('Spotlight installation migration did not leave a verified World.'), { code: 'spotlight_installation_migration_verification_failed', verification: finalVerification });
  return { status: 'migrated', receipt, event: eventResult.event, verification: finalVerification };
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
  const pairedRevision = new Set(receipts.map(receipt => `${receipt.bindings?.revisionEvent?.sequence || ''}:${receipt.bindings?.revisionEvent?.hash || ''}`));
  const unpairedRevision = revisionEvents.find(event => !pairedRevision.has(`${event.sequence}:${event.event_hash}`));
  if (unpairedRevision) return { status: 'corrupt_or_incomplete_upgrade', priorReceipt, witness, revisionEvents };
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
  if (prior.roomId !== witness.roomId || prior.packageVersion === witness.packageVersion || prior.manifestHash === witness.manifestHash || prior.witnessHash === witness.witnessHash) throw Object.assign(new Error('Workshop installation migration prior receipt is not an older exact installation.'), { code: 'room_installation_migration_refused', priorReceipt: prior });
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
