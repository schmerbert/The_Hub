import assert from 'node:assert/strict';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { VerifiedAncestryStore } from '../src/integrity/checkpoint-store.js';

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'hub-verified-ancestry-'));
  const path = join(dir, 'verified-ancestry.sqlite');
  const store = new VerifiedAncestryStore(path);
  return { dir, path, store };
}

function checkpointInput(overrides = {}) {
  return {
    domain: 'world',
    verifierVersion: 'world-verifier/v1',
    schemaVersion: 'world-schema/v1',
    projectorVersion: 'world-projector/v1',
    topologyVersion: 'topology/hearth',
    storeIdentity: { kind: 'sqlite', logicalName: 'world' },
    storeGeneration: { topology: 3 },
    manifest: { eventSequence: 17, eventHash: 'a'.repeat(64), projectionHash: 'b'.repeat(64) },
    payload: { replayState: { roomId: 'room.center' }, projections: [{ name: 'locations', digest: 'c'.repeat(64) }] },
    indexes: { frontier: { sequence: 17, hash: 'a'.repeat(64) } },
    ...overrides,
  };
}

test('publishes an immutable envelope, payload, and indexes as one generation', () => {
  const { store } = fixture();
  try {
    const first = store.publish(checkpointInput({ generationId: 'world-generation-1' }));
    assert.equal(first.generationId, 'world-generation-1');
    assert.equal(first.generationNumber, 1);
    assert.equal(first.payload.replayState.roomId, 'room.center');
    assert.equal(first.indexes.frontier.sequence, 17);
    assert.equal(first.manifestHash, first.manifestSha256);
    assert.equal(first.payloadHash, first.payloadSha256);
    assert.equal(first.checkpointHash, first.checkpointSha256);
    assert.equal(store.getGeneration(first.generationId).checkpointHash, first.checkpointHash);
    const selected = store.selectCompatible({
      domain: 'world', verifierVersion: 'world-verifier/v1', schemaVersion: 'world-schema/v1',
      projectorVersion: 'world-projector/v1', topologyVersion: 'topology/hearth',
      storeIdentity: { logicalName: 'world', kind: 'sqlite' }, storeGeneration: { topology: 3 },
      dependencies: [],
    });
    assert.equal(selected.standing, 'compatible');
    assert.equal(selected.generationId, first.generationId);
    assert.equal(selected.generation.generationId, first.generationId);
  } finally { store.close(); }
});

test('requires immediate predecessor linkage and selects newest compatible generation', () => {
  const { store } = fixture();
  try {
    const first = store.publish(checkpointInput({ generationId: 'world-generation-1' }));
    assert.throws(() => store.publish(checkpointInput({ generationId: 'world-generation-bad', manifest: { eventSequence: 18 }, payload: {}, predecessorCheckpointHash: null })), error => error.code === 'verified_ancestry_predecessor_mismatch');
    const second = store.publish(checkpointInput({ generationId: 'world-generation-2', manifest: { eventSequence: 18 }, payload: { replayState: { roomId: 'room.workshop' } }, predecessorCheckpointHash: first.checkpointHash }));
    assert.equal(store.findCompatible({ domain: 'world', verifierVersion: 'world-verifier/v1' }).generationId, second.generationId);
    assert.equal(store.selectCompatible({ domain: 'world', verifierVersion: 'different-verifier/v2' }).standing, 'miss');
  } finally { store.close(); }
});

test('append-only triggers and tamper detection fail closed', () => {
  const { path, store } = fixture();
  try {
    const first = store.publish(checkpointInput({ generationId: 'world-generation-1' }));
    const db = new DatabaseSync(path);
    assert.throws(() => db.prepare('UPDATE verified_ancestry_generations SET domain=? WHERE generation_id=?').run('forest', first.generationId), /append-only/);
    db.exec('DROP TRIGGER verified_ancestry_generations_update;');
    db.prepare('UPDATE verified_ancestry_generations SET envelope_json=? WHERE generation_id=?').run('{}', first.generationId);
    db.close();
    assert.throws(() => store.selectCompatible({ domain: 'world', verifierVersion: 'world-verifier/v1' }), error => error.code === 'verified_ancestry_schema_unsupported');
    assert.equal(store.status().standing, 'refused');
  } finally { store.close(); }
});

test('incomplete generations are refused and a failed transaction leaves no rows', () => {
  const { path, store } = fixture();
  try {
    assert.throws(() => store.transaction(() => {
      store.sqlite.prepare(`INSERT INTO verified_ancestry_generations(
        generation_id,domain,format_version,verifier_version,store_identity_json,store_generation_json,manifest_json,
        manifest_sha256,dependencies_json,payload_sha256,envelope_json,checkpoint_sha256,completed_at,publication_state
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('incomplete', 'world', 'verified-ancestry/v1', 'v1', '{}', 'null', '{}', '0'.repeat(64), '[]', '1'.repeat(64), '{}', '2'.repeat(64), new Date().toISOString(), 'publishing');
      throw new Error('simulated interruption');
    }), /simulated interruption/);
    assert.equal(store.listGenerations().length, 0);
    store.sqlite.prepare(`INSERT INTO verified_ancestry_generations(
      generation_id,domain,format_version,verifier_version,store_identity_json,store_generation_json,manifest_json,
      manifest_sha256,dependencies_json,payload_sha256,envelope_json,checkpoint_sha256,completed_at,publication_state
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('incomplete', 'world', 'verified-ancestry/v1', 'v1', '{}', 'null', '{}', '0'.repeat(64), '[]', '1'.repeat(64), '{}', '2'.repeat(64), new Date().toISOString(), 'publishing');
    assert.throws(() => store.selectCompatible({ domain: 'world', verifierVersion: 'v1' }), error => error.code === 'verified_ancestry_incomplete');
  } finally { store.close(); }
  assert.ok(existsSync(path));
});

test('rebuild deletes only the derived checkpoint store and returns an empty status', () => {
  const { path, store } = fixture();
  store.publish(checkpointInput({ generationId: 'world-generation-1' }));
  const result = store.rebuild();
  assert.equal(result.standing, 'empty');
  assert.equal(store.listGenerations().length, 0);
  store.close();
  assert.ok(existsSync(path));
});
