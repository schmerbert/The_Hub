import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { canonicalize } from '../src/core/hash.js';
import {
  BinderWindowError,
  canonicalizeBinderSnapshot,
  createBinderWindowAdapter,
  projectBinderSnapshot,
  validateBinderSnapshot,
} from '../src/places/hub/binder-window/index.js';

const body = {
  asset_id: 'sec:XNYS:ABC',
  kind: 'security',
  symbol: 'ABC',
  name: 'Example Corp',
  venue: 'NYSE',
  venue_name: 'New York Stock Exchange',
  asset_class: 'equity',
  chain: null,
  currency: 'USD',
  lots: 1,
  quantity: 2,
  cost_usd: 100,
  cost_nano: 100000000000,
  last: 60,
  last_at: '2026-08-28T15:30:00Z',
  priced_on: '2026-08-28',
  session: 'regular',
  source: 'stooq',
  priced_venue: 'NYSE',
  delayed: true,
  stale: false,
  price_how: 'measured',
  value_usd: 120,
  pl_usd: 20,
  day_change_usd: 2,
  day_change_pct: 1.7,
  given: false,
  quantity_as_of: '2026-08-01',
  events: 0,
};

const payload = {
  belts: [{ key: 'alpha', label: 'Alpha', lots: 1, copies: 3, cost_usd: 20, value_usd: null, unpriced: 1, priced_on: null }],
  bodies: [body],
  totals: {
    cost_usd: 120,
    value_usd: 120,
    priced_cost_usd: 100,
    unvalued_cost_usd: 20,
    dark_pct: 16.6666667,
    objects: 2,
    belts: 1,
    bodies: 1,
    lots: 2,
    priced_bodies: 1,
    unpriced_bodies: 0,
    confidence: 'mixed',
    as_of: '2026-08-28T00:00:00Z',
  },
  curve: {
    series: [{ day: '2026-08-28', value_usd: 120, assets: 1, unread: 0, carried: 0, measured: 1, complete: true, how: 'measured' }],
    days: 1,
    change_usd: 0,
    comparable: true,
    unread_days: 0,
    carried_days: 0,
    covers: 'cards',
  },
  absent: {
    treasury: { absent: true, why: 'no cash account' },
    thesis: { absent: true, why: 'no thesis', of: 2 },
    orbits: { absent: true, why: 'no orbits' },
    quotes: { absent: false, unquoted: 0, of: 1, symbols: [], belts_unpriced: 1, why: 'every position has a quote' },
  },
};

const json = JSON.stringify(payload);

test('projects a dashboard snapshot without creating a network or mutation surface', () => {
  const input = structuredClone(payload);
  const projection = projectBinderSnapshot(input);
  assert.equal(projection.kind, 'binder_window_projection');
  assert.equal(projection.availability, 'available');
  assert.equal(projection.source.authority, 'binder');
  assert.equal(projection.source.route, 'GET /api/dashboard');
  assert.equal(projection.source.hashBasis, 'canonical_payload');
  assert.equal(projection.freshness.status, 'delayed');
  assert.equal(projection.freshness.newest, null);
  assert.equal(projection.completeness.status, 'complete');
  assert.deepEqual(JSON.parse(canonicalize(projection)).freshness, projection.freshness);
  assert.ok(Object.isFrozen(projection));
  assert.ok(Object.isFrozen(projection.bodies));
  assert.ok(Object.isFrozen(projection.bodies[0]));
  assert.throws(() => { projection.bodies[0].symbol = 'forged'; }, TypeError);
  assert.equal(input.bodies[0].symbol, 'ABC');
});

test('raw JSON uses exact source bytes while object input uses canonical payload bytes', () => {
  const raw = Buffer.from(` ${json}\n`, 'utf8');
  const exact = projectBinderSnapshot(raw);
  assert.equal(exact.source.hashBasis, 'exact_source_bytes');
  assert.equal(exact.source.byteLength, raw.length);
  assert.equal(exact.source.hash, createHash('sha256').update(raw).digest('hex'));

  const reordered = JSON.parse(json);
  const canonical = projectBinderSnapshot(reordered);
  assert.equal(canonical.source.hashBasis, 'canonical_payload');
  assert.equal(canonical.source.hash, createHash('sha256').update(canonicalizeBinderSnapshot(reordered)).digest('hex'));
});

test('missing snapshot stays explicitly dormant', () => {
  const adapter = createBinderWindowAdapter();
  const projection = adapter.project(null);
  assert.equal(projection.availability, 'dormant');
  assert.equal(projection.reason, 'missing_snapshot');
  assert.equal(projection.freshness.status, 'unknown');
  assert.equal(projection.completeness.status, 'unknown');
  assert.equal(projection.totals, null);
  assert.deepEqual(adapter.inspect(undefined), { valid: false, dormant: true, code: 'missing_snapshot', errors: ['Binder snapshot is absent.'] });
});

test('rejects unknown fields and hostile keys at the bounded crossing', () => {
  const unknown = structuredClone(payload);
  unknown.bodies[0].credential = 'do-not-project';
  assert.throws(() => projectBinderSnapshot(unknown), (error) => error instanceof BinderWindowError && error.code === 'binder_window_unknown_field');

  const hostile = structuredClone(payload);
  Object.defineProperty(hostile.absent.treasury, '__proto__', { value: { polluted: true }, enumerable: true });
  assert.throws(() => projectBinderSnapshot(hostile), (error) => error instanceof BinderWindowError && ['binder_window_hostile', 'binder_window_unknown_field'].includes(error.code));
});

test('rejects nonfinite numbers, invalid timestamps, malformed JSON, and oversized snapshots', () => {
  const nonfinite = structuredClone(payload);
  nonfinite.bodies[0].last = Infinity;
  assert.throws(() => projectBinderSnapshot(nonfinite), (error) => error instanceof BinderWindowError && error.code === 'binder_window_nonfinite');

  const badTime = structuredClone(payload);
  badTime.bodies[0].priced_on = 'yesterday';
  assert.throws(() => projectBinderSnapshot(badTime), (error) => error instanceof BinderWindowError && error.code === 'binder_window_timestamp');

  assert.throws(() => projectBinderSnapshot('{not-json'), (error) => error instanceof BinderWindowError && error.code === 'binder_window_malformed');
  assert.throws(() => projectBinderSnapshot(Buffer.from(json), { limits: { maxSourceBytes: 20 } }), (error) => error instanceof BinderWindowError && error.code === 'binder_window_oversized');
});

test('validation is inspectable without exposing a permissive fallback', () => {
  const valid = validateBinderSnapshot(payload);
  assert.equal(valid.valid, true);
  const invalid = validateBinderSnapshot({ ...payload, curve: { ...payload.curve, series: [{ ...payload.curve.series[0], value_usd: NaN }] } });
  assert.equal(invalid.valid, false);
  assert.equal(invalid.code, 'binder_window_nonfinite');
});

test('asset identity follows Binder opaque TEXT identifiers rather than numeric arithmetic', () => {
  for (const assetId of ['sec:XNAS:MSFT', 'tok:btc:bitcoin', 'print:42']) {
    const projection = projectBinderSnapshot({ ...payload, bodies: [{ ...body, asset_id: assetId }] });
    assert.equal(projection.bodies[0].asset_id, assetId);
  }
  assert.throws(
    () => projectBinderSnapshot({ ...payload, bodies: [{ ...body, asset_id: 42 }] }),
    (error) => error instanceof BinderWindowError && error.code === 'binder_window_malformed',
  );
});

test('timestamps retain Binder microsecond precision and explicit offsets', () => {
  const timestamp = '2026-08-28T08:03:03.923318-05:00';
  const projection = projectBinderSnapshot({ ...payload, bodies: [{ ...body, last_at: timestamp }] });
  assert.equal(projection.bodies[0].last_at, timestamp);
});
