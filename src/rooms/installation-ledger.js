import { canonicalize, sha256 } from '../core/hash.js';
import { assertVerifiedRoomInstallation } from './installation-witness.js';

export const ROOM_INSTALLATION_RECEIPT_VERSION = 'room-installation-receipt.v1';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS room_installation_epochs (
  epoch_id TEXT PRIMARY KEY,
  boundary_kind TEXT NOT NULL CHECK(boundary_kind='room_installation_receipts/v1'),
  opened_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS room_installation_receipts (
  receipt_id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL CHECK(schema_version=1),
  room_id TEXT NOT NULL,
  package_version TEXT NOT NULL,
  manifest_hash TEXT NOT NULL,
  witness_hash TEXT NOT NULL,
  ancestry TEXT NOT NULL CHECK(ancestry IN ('forward_installation','inherited_pre_boundary')),
  admission_json TEXT NOT NULL,
  bindings_json TEXT NOT NULL,
  world_event_sequence INTEGER NOT NULL REFERENCES world_event_journal(sequence),
  world_event_hash TEXT NOT NULL,
  installed_at TEXT NOT NULL,
  receipt_json TEXT NOT NULL,
  receipt_hash TEXT NOT NULL UNIQUE,
  UNIQUE(room_id, package_version, manifest_hash)
);
CREATE TRIGGER IF NOT EXISTS room_installation_epochs_append_only_update BEFORE UPDATE ON room_installation_epochs BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TRIGGER IF NOT EXISTS room_installation_epochs_append_only_delete BEFORE DELETE ON room_installation_epochs BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TRIGGER IF NOT EXISTS room_installation_receipts_append_only_update BEFORE UPDATE ON room_installation_receipts BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TRIGGER IF NOT EXISTS room_installation_receipts_append_only_delete BEFORE DELETE ON room_installation_receipts BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
`;

export function installRoomInstallationLedger(sqlite, { now = () => new Date().toISOString() } = {}) {
  sqlite.exec(SCHEMA);
  const existing = sqlite.prepare('SELECT * FROM room_installation_epochs ORDER BY opened_at,epoch_id LIMIT 1').get();
  if (existing) return epochRow(existing);
  const openedAt = now();
  const epochId = `room_installation_epoch_${sha256(openedAt).slice(0, 20)}`;
  sqlite.prepare('INSERT INTO room_installation_epochs(epoch_id,boundary_kind,opened_at) VALUES(?,?,?)')
    .run(epochId, 'room_installation_receipts/v1', openedAt);
  return { epochId, boundaryKind: 'room_installation_receipts/v1', openedAt };
}

export function appendRoomInstallationReceipt(sqlite, {
  witness, ancestry, admission, bindings, worldEventSequence, worldEventHash, installedAt,
}) {
  assertVerifiedRoomInstallation(witness);
  if (!['forward_installation', 'inherited_pre_boundary'].includes(ancestry)) throw new Error('Room installation ancestry is invalid.');
  if (!admission || typeof admission !== 'object' || Array.isArray(admission)) throw new Error('Room installation admission must be an object.');
  if (!bindings || typeof bindings !== 'object' || Array.isArray(bindings)) throw new Error('Room installation bindings must be an object.');
  if (!Number.isInteger(worldEventSequence) || worldEventSequence < 1 || typeof worldEventHash !== 'string' || !worldEventHash) throw new Error('Room installation requires an exact World event pointer.');
  if (typeof installedAt !== 'string' || new Date(installedAt).toISOString() !== installedAt) throw new Error('Room installation time is invalid.');
  const worldEvent = sqlite.prepare('SELECT sequence,event_hash,occurred_at FROM world_event_journal WHERE sequence=?').get(worldEventSequence);
  if (!worldEvent || worldEvent.event_hash !== worldEventHash) throw new Error('Room installation World event pointer does not resolve exactly.');
  if (worldEvent.occurred_at !== installedAt) throw new Error('Room installation time must equal its World event time.');

  const body = {
    schemaVersion: 1,
    version: ROOM_INSTALLATION_RECEIPT_VERSION,
    roomId: witness.roomId,
    packageVersion: witness.packageVersion,
    manifestHash: witness.manifestHash,
    witnessHash: witness.witnessHash,
    ancestry,
    admission: structuredClone(admission),
    bindings: structuredClone(bindings),
    worldEvent: { sequence: worldEventSequence, hash: worldEventHash },
    installedAt,
  };
  const receiptHash = sha256(canonicalize(body));
  const receiptId = `room_installation_${receiptHash.slice(0, 20)}`;
  const existing = sqlite.prepare('SELECT receipt_json FROM room_installation_receipts WHERE room_id=? AND package_version=? AND manifest_hash=?')
    .get(body.roomId, body.packageVersion, body.manifestHash);
  if (existing) {
    const parsed = JSON.parse(existing.receipt_json);
    if (canonicalize(parsed) !== canonicalize({ ...body, receiptId, receiptHash })) throw new Error(`Conflicting room installation receipt for ${body.roomId}.`);
    return parsed;
  }
  const receipt = deepFreeze({ ...body, receiptId, receiptHash });
  sqlite.prepare(`INSERT INTO room_installation_receipts(
    receipt_id,schema_version,room_id,package_version,manifest_hash,witness_hash,ancestry,admission_json,bindings_json,
    world_event_sequence,world_event_hash,installed_at,receipt_json,receipt_hash
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    receiptId, 1, body.roomId, body.packageVersion, body.manifestHash, body.witnessHash, ancestry,
    canonicalize(body.admission), canonicalize(body.bindings), worldEventSequence, worldEventHash, installedAt,
    canonicalize(receipt), receiptHash,
  );
  return receipt;
}

export function listRoomInstallationReceipts(sqlite) {
  return sqlite.prepare('SELECT receipt_json FROM room_installation_receipts ORDER BY installed_at,receipt_id').all()
    .map(({ receipt_json }) => deepFreeze(JSON.parse(receipt_json)));
}

export function assertValidRoomInstallationReceipt(receipt) {
  const { receiptId, receiptHash, ...body } = receipt || {};
  if (!receiptId || !receiptHash || receiptHash !== sha256(canonicalize(body)) || receiptId !== `room_installation_${receiptHash.slice(0, 20)}`) {
    throw Object.assign(new Error('Room installation receipt hash is invalid.'), { code: 'room_installation_receipt_invalid' });
  }
  return receipt;
}

function epochRow(row) { return { epochId: row.epoch_id, boundaryKind: row.boundary_kind, openedAt: row.opened_at }; }
function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}
