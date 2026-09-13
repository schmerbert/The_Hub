import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { admitSpotlightObservation } from '../src/places/hub/spotlight/observation.js';
import { SpotlightObservationStore } from '../src/places/hub/spotlight/observation-store.js';

function observation(instrument = 'AAPL') {
  return admitSpotlightObservation({
    schemaVersion: 1, kind: 'spotlight_observation',
    source: { authority: 'robinhood', reference: `robinhood:equity_quote:${instrument}` },
    instrument: { id: instrument, label: `Robinhood ${instrument}`, quote: 'USD' },
    observedAt: '2026-09-01T14:00:00Z', receivedAt: '2026-09-01T14:00:01Z',
    fields: { price: { status: 'present', value: 123.45 } },
    freshness: { status: 'observed', asOf: '2026-09-01T14:00:00Z' },
    completeness: { status: 'complete', missing: [] },
    authority: { observationalOnly: true, financialExecution: false },
  });
}
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'spotlight-store-'));
  const path = join(dir, 'observations.sqlite');
  const store = new SpotlightObservationStore(path);
  return { dir, path, store };
}
function attempt(store, commandId = 'call-1', instrumentId = 'AAPL') {
  return store.recordAttempt({ sessionId: 'life', wakeId: 'wake-1', commandId, operation: 'equity_quote', instrumentId, request: { symbol: instrumentId } });
}

test('generation-1 store retains validated observations and hash-linked witnesses', () => {
  const f = fixture();
  try {
    const started = attempt(f.store); const settled = f.store.settleSuccess({ attemptId: started.attempt.attempt_id, observation: observation() });
    assert.equal(settled.status, 'succeeded'); assert.ok(settled.observationId);
    assert.deepEqual(f.store.read(settled.observationId).observation, observation());
    assert.equal(f.store.list().length, 1); assert.equal(f.store.verify().verified, true);
    assert.equal(f.store.sqlite.prepare('SELECT COUNT(*) AS count FROM spotlight_events').get().count, 3);
    assert.throws(() => f.store.sqlite.prepare('UPDATE spotlight_observations SET instrument_id=?').run('MSFT'), /append-only/);
    assert.throws(() => f.store.sqlite.prepare('DELETE FROM spotlight_settlements').run(), /append-only/);
  } finally { f.store.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test('store settles duplicate command identities without a second attempt and preserves failures', () => {
  const f = fixture();
  try {
    const started = attempt(f.store); const duplicate = attempt(f.store); assert.equal(duplicate.kind, 'pending');
    const failed = f.store.settleFailure({ attemptId: started.attempt.attempt_id, code: 'spotlight_authentication_required', message: 'provider secret must never persist', network: false });
    assert.equal(failed.status, 'failed'); assert.equal(f.store.settlementFor({ sessionId: 'life', wakeId: 'wake-1', commandId: 'call-1' }).errorCode, 'spotlight_authentication_required');
    const replay = attempt(f.store); assert.equal(replay.kind, 'settled'); assert.equal(replay.settlement.status, 'failed');
    assert.throws(() => attempt(f.store, 'call-1', 'MSFT'), error => error.code === 'spotlight_store_duplicate_conflict');
    assert.equal(JSON.stringify(f.store.settlementFor({ sessionId: 'life', wakeId: 'wake-1', commandId: 'call-1' })).includes('provider secret'), false);
  } finally { f.store.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test('startup refuses pending restart, unknown schema, and hash drift without repair', () => {
  const f = fixture(); const started = attempt(f.store); f.store.close();
  const reopened = new SpotlightObservationStore(f.path); assert.equal(attempt(reopened).kind, 'pending_restart');
  reopened.close();
  const sqlite = new DatabaseSync(f.path); sqlite.exec('DROP TRIGGER spotlight_events_append_only_update;'); sqlite.prepare('UPDATE spotlight_events SET payload_json=? WHERE sequence=1').run('{}'); sqlite.close();
  assert.throws(() => new SpotlightObservationStore(f.path), error => ['spotlight_store_drift', 'spotlight_store_schema_drift'].includes(error.code));
  rmSync(f.dir, { recursive: true, force: true }); assert.ok(started.attempt.attempt_id);
});

test('read-only verification does not create a missing store', () => {
  const dir = mkdtempSync(join(tmpdir(), 'spotlight-store-empty-')); const path = join(dir, 'missing.sqlite');
  assert.throws(() => new SpotlightObservationStore(path, { readOnly: true }), error => error.code === 'spotlight_store_missing');
  const f = fixture(); f.store.close(); const readonly = new SpotlightObservationStore(f.path, { readOnly: true });
  try { assert.equal(readonly.verify().verified, true); assert.throws(() => attempt(readonly, 'read-only'), error => error.code === 'spotlight_store_read_only'); } finally { readonly.close(); rmSync(dir, { recursive: true, force: true }); rmSync(f.dir, { recursive: true, force: true }); }
});
