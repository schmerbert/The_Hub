import test from 'node:test';
import assert from 'node:assert/strict';
import { admitSpotlightObservation, createSpotlightObservationValidator, validateSpotlightObservation } from '../src/places/hub/spotlight/index.js';

function observation() {
  return {
    schemaVersion: 1,
    kind: 'spotlight_observation',
    source: { authority: 'recorded_market', reference: 'source.recorded_market/row/001' },
    instrument: { id: 'instrument.example_001', label: 'Example 001', quote: 'USD' },
    observedAt: '2026-01-01T00:00:00.000Z',
    receivedAt: '2026-01-01T00:00:01.000Z',
    fields: {
      price: { status: 'present', value: 100 },
      volume: { status: 'present', value: 10 },
      liquidity: { status: 'missing', reason: 'source did not declare liquidity' },
    },
    freshness: { status: 'observed', asOf: '2026-01-01T00:00:00.000Z' },
    completeness: { status: 'partial', missing: ['liquidity'] },
    authority: { observationalOnly: true, financialExecution: false },
  };
}

test('observation admission is bounded, attributable, immutable, and preserves missing fields', () => {
  const admitted = admitSpotlightObservation(observation());
  assert.equal(admitted.apiVersion, 'spotlight-observation.v1');
  assert.equal(admitted.source.reference, 'source.recorded_market/row/001');
  assert.equal(admitted.fields.liquidity.status, 'missing');
  assert.equal(admitted.authority.observationalOnly, true);
  assert.equal(admitted.authority.financialExecution, false);
  assert.equal(Object.isFrozen(admitted), true);
  assert.equal(Object.isFrozen(admitted.fields.liquidity), true);
  assert.throws(() => { admitted.fields.price.value = 101; }, TypeError);
});

test('observation source bytes receive an exact-byte hash and object input receives a canonical hash', () => {
  const payload = JSON.stringify(observation());
  const fromBytes = admitSpotlightObservation(Buffer.from(payload, 'utf8'));
  const fromObject = admitSpotlightObservation(observation());
  assert.equal(fromBytes.sourceReceipt.hashBasis, 'exact_source_bytes');
  assert.equal(fromObject.sourceReceipt.hashBasis, 'canonical_payload');
  assert.notEqual(fromBytes.sourceReceipt.hash, '');
  assert.notEqual(fromObject.sourceReceipt.hash, '');
  assert.equal(validateSpotlightObservation(observation()).valid, true);
});

test('observation validator refuses unknown, hostile, sensitive, nonfinite, oversized, and temporal input', () => {
  const mutate = [
    value => { value.extra = true; },
    value => { value.fields.__proto__ = { status: 'missing', reason: 'hostile' }; },
    value => { value.fields.account_id = { status: 'missing', reason: 'private' }; },
    value => { value.fields.price.value = Number.NaN; },
    value => { value.receivedAt = '2025-12-31T23:59:59.000Z'; },
    value => { value.authority.financialExecution = true; },
    value => { value.fields.price.value = 'x'.repeat(2_100); },
  ];
  for (const change of mutate) {
    const candidate = structuredClone(observation());
    change(candidate);
    assert.equal(validateSpotlightObservation(candidate).valid, false);
  }
  assert.equal(createSpotlightObservationValidator().inspect(observation()).valid, true);
});
