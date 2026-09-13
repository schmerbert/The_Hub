import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRobinhoodReadAdapter } from '../src/places/hub/spotlight/robinhood.js';
import { admitSpotlightObservation } from '../src/places/hub/spotlight/observation.js';
import { SpotlightObservationStore } from '../src/places/hub/spotlight/observation-store.js';
import { createSpotlightLiveService } from '../src/places/hub/spotlight/live-service.js';

const OBSERVED_AT = '2026-09-01T14:00:00Z';
const RECEIVED_AT = '2026-09-01T14:00:01Z';
const identity = { sessionId: 'life', wakeId: 'wake-1', commandId: 'call-1' };

function source({ state = 'connected', delay = 0, calls = [], invalid = false } = {}) {
  const adapter = createRobinhoodReadAdapter({
    accountJurisdictions: { primary: { readOnly: true, agentAccessible: true } },
    clock: () => RECEIVED_AT,
    operations: {
      equity_quote: async request => {
        calls.push(request);
        if (delay) await new Promise(resolve => setTimeout(resolve, delay));
        if (invalid) return { invalid: true };
        return { observedAt: OBSERVED_AT, data: { symbol: request.symbol, price: 123.45, currency: 'USD' } };
      },
      crypto_quote: async request => {
        calls.push(request);
        if (delay) await new Promise(resolve => setTimeout(resolve, delay));
        return { observedAt: OBSERVED_AT, data: { symbol: request.symbol, price: 123.45, currency: 'USD' } };
      },
    },
  });
  return {
    status: () => ({ state, code: state }),
    observe: (operation, request) => adapter.observe(operation, request),
    close: async () => {},
  };
}
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'spotlight-live-'));
  const store = new SpotlightObservationStore(join(dir, 'observations.sqlite'));
  return { dir, store };
}
function cleanup(fixtureValue) { try { fixtureValue.store.close(); } catch {} rmSync(fixtureValue.dir, { recursive: true, force: true }); }

test('live service deliberately observes, retains, lists, and reads without refresh on inspection', async () => {
  const f = fixture(); const calls = []; const svc = createSpotlightLiveService({ source: source({ calls }), store: f.store });
  try {
    const result = await svc.invoke('spotlight_observe', { instrument_id: 'AAPL' }, identity);
    assert.equal(result.status, 'observed'); assert.equal(result.network, true); assert.equal(result.observation.fields.price.value, 123.45);
    assert.equal(calls.length, 1); assert.equal(JSON.stringify(result).includes('account_id'), false);
    const listed = svc.invoke('spotlight_observation_list', { instrument_id: 'equity:AAPL' });
    assert.equal(listed.network, false); assert.equal(listed.observations.length, 1); assert.equal(listed.observations[0].retained, true);
    const read = svc.invoke('spotlight_observation_read', { observation_id: result.observationId });
    assert.equal(read.network, false); assert.deepEqual(read.observation, result.observation);
    const status = svc.status(); assert.equal(status.connection.state, 'connected'); assert.equal(status.custody.state, 'ready');
    assert.deepEqual(status.observationGrammar, ['accounts', 'portfolio:<opaque-alias>', 'equity-positions:<opaque-alias>', 'crypto-positions:<opaque-alias>', 'equity:<SYMBOL>', 'crypto:<SYMBOL>', '<SYMBOL>']);
  } finally { await svc.close(); cleanup(f); }
});

test('grammar, references, and source failures refuse safely', async () => {
  const f = fixture(); const unavailable = createSpotlightLiveService({ source: source({ state: 'authentication_required' }), store: f.store });
  try {
    assert.throws(() => unavailable.invoke('spotlight_observe', { instrument_id: 'aapl' }, identity), error => error.code === 'spotlight_invalid_instrument');
    assert.throws(() => unavailable.invoke('spotlight_observe', { instrument_id: 'AAPL', extra: true }, identity), error => error.code === 'spotlight_invalid_argument');
    const failed = await unavailable.invoke('spotlight_observe', { instrument_id: 'AAPL' }, identity);
    assert.equal(failed.status, 'failed'); assert.equal(failed.network, false); assert.equal(failed.errorCode, 'spotlight_authentication_required');
    assert.throws(() => unavailable.invoke('spotlight_observe', { instrument_id: 'AAPL', observation_ref: 'missing' }, { ...identity, commandId: 'call-2' }), error => error.code === 'spotlight_observation_ref_not_found');
    const wrongSource = source(); const wrong = createSpotlightLiveService({ source: wrongSource, store: f.store });
    assert.throws(() => wrong.invoke('spotlight_observe', { instrument_id: 'MSFT', observation_ref: failed.observationId || 'missing' }, { ...identity, commandId: 'call-3' }), error => error.code === 'spotlight_observation_ref_not_found');
    await wrong.close();
  } finally { await unavailable.close(); cleanup(f); }
});

test('concurrent and settled retries use one network call and interrupted attempts stay fail-closed', async () => {
  const f = fixture(); const calls = []; const svc = createSpotlightLiveService({ source: source({ calls, delay: 20 }), store: f.store });
  try {
    const first = svc.invoke('spotlight_observe', { instrument_id: 'AAPL' }, identity);
    const second = svc.invoke('spotlight_observe', { instrument_id: 'AAPL' }, identity);
    const [a, b] = await Promise.all([first, second]); assert.equal(calls.length, 1); assert.equal(a.observationId, b.observationId);
    const settled = await svc.invoke('spotlight_observe', { instrument_id: 'AAPL' }, identity); assert.equal(settled.replayed, true); assert.equal(settled.network, false); assert.equal(calls.length, 1);
  } finally { await svc.close(); cleanup(f); }
  const pending = fixture(); const attempt = pending.store.recordAttempt({ ...identity, operation: 'equity_quote', instrumentId: 'equity:AAPL', request: { symbol: 'AAPL' } });
  pending.store.close(); const reopened = new SpotlightObservationStore(join(pending.dir, 'observations.sqlite')); const restarted = createSpotlightLiveService({ source: source(), store: reopened });
  try { assert.throws(() => restarted.invoke('spotlight_observe', { instrument_id: 'AAPL' }, identity), error => error.code === 'spotlight_observation_pending_restart'); } finally { await restarted.close(); rmSync(pending.dir, { recursive: true, force: true }); }
  assert.ok(attempt.attempt.attempt_id);
});

test('financial hands remain gate-capped and shutdown closes source before custody', async () => {
  const f = fixture(); let sourceClosed = false;
  const liveSource = source(); liveSource.close = async () => { sourceClosed = true; };
  const svc = createSpotlightLiveService({ source: liveSource, store: f.store });
  try {
    const proposal = svc.invoke('spotlight_trade_propose', { instrument_id: 'AAPL', side: 'buy', quantity: 1, order_type: 'market', thesis: 'x' });
    assert.equal(proposal.status, 'withheld'); assert.equal(proposal.network, false); assert.equal(proposal.mutated, false);
  } finally { await svc.close(); }
  assert.equal(sourceClosed, true);
  assert.throws(() => svc.invoke('spotlight_observe', { instrument_id: 'AAPL' }, { ...identity, commandId: 'call-4' }), error => error.code === 'spotlight_service_closed');
  cleanup(f);
});

test('explicit asset grammar keeps same ticker observations isolated', async () => {
  const f = fixture(); const calls = []; const svc = createSpotlightLiveService({ source: source({ calls }), store: f.store });
  try {
    const equity = await svc.invoke('spotlight_observe', { instrument_id: 'equity:BTC' }, { ...identity, commandId: 'equity-call' });
    const crypto = await svc.invoke('spotlight_observe', { instrument_id: 'crypto:BTC' }, { ...identity, commandId: 'crypto-call' });
    assert.equal(calls.length, 2);
    assert.equal(svc.invoke('spotlight_observation_list', { instrument_id: 'equity:BTC' }).observations.length, 1);
    assert.equal(svc.invoke('spotlight_observation_list', { instrument_id: 'crypto:BTC' }).observations.length, 1);
    assert.throws(() => svc.invoke('spotlight_observe', { instrument_id: 'crypto:BTC', observation_ref: equity.observationId }, { ...identity, commandId: 'crypto-ref-call' }), error => error.code === 'spotlight_observation_ref_mismatch');
    assert.notEqual(equity.observationId, crypto.observationId);
  } finally { await svc.close(); cleanup(f); }
});

test('source authority and operation identity are checked before custody admission', async () => {
  const f = fixture();
  const lookalike = admitSpotlightObservation({
    schemaVersion: 1, kind: 'spotlight_observation',
    source: { authority: 'recorded_market', reference: 'robinhood:crypto_quote:BTC' },
    instrument: { id: 'BTC', label: 'BTC', quote: 'USD' },
    observedAt: OBSERVED_AT, receivedAt: RECEIVED_AT,
    fields: { price: { status: 'present', value: 1 } },
    freshness: { status: 'observed', asOf: OBSERVED_AT }, completeness: { status: 'complete', missing: [] },
    authority: { observationalOnly: true, financialExecution: false },
  });
  const svc = createSpotlightLiveService({ source: { status: () => ({ state: 'connected', code: 'connected' }), observe: async () => lookalike, close: async () => {} }, store: f.store });
  try {
    const result = await svc.invoke('spotlight_observe', { instrument_id: 'crypto:BTC' }, { ...identity, commandId: 'lookalike' });
    assert.equal(result.status, 'failed'); assert.equal(result.errorCode, 'spotlight_source_invalid_observation'); assert.equal(f.store.list().length, 0);
  } finally { await svc.close(); cleanup(f); }
});
