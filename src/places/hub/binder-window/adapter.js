import { createHash } from 'node:crypto';

/**
 * Binder Window v1 is deliberately a projector, not a Binder client.
 *
 * It accepts one already-retained response from Binder's
 * `GET /api/dashboard` route. There is no URL client, refresh operation, or
 * mutation method in this module. The source remains Binder's authority;
 * this package only validates, bounds, fingerprints, and presents a private
 * copy of the response.
 */

export const BINDER_WINDOW_API_VERSION = 'binder-window.v1';
export const BINDER_WINDOW_IDENTITY = 'window.binder';
export const BINDER_DASHBOARD_ROUTE = 'GET /api/dashboard';

const DEFAULT_LIMITS = Object.freeze({
  maxSourceBytes: 1_000_000,
  maxObjects: 2_000,
  maxCurvePoints: 2_000,
  maxStringBytes: 4_096,
  maxAbsentSymbols: 2_000,
  maxSourceDisclosureBytes: 512,
});

const HOSTILE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATE_TIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:?\d{2})?$/;
const HASH = /^[a-f0-9]{64}$/;

export class BinderWindowError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'BinderWindowError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function fail(code, message, details = undefined) {
  throw new BinderWindowError(code, message, details);
}

function mergeLimits(limits = {}) {
  if (!isPlainObject(limits)) fail('binder_window_invalid_limits', 'Binder Window limits must be an object.');
  const merged = { ...DEFAULT_LIMITS };
  for (const key of Object.keys(DEFAULT_LIMITS)) {
    if (Object.hasOwn(limits, key)) {
      const value = limits[key];
      if (!Number.isSafeInteger(value) || value < 1) fail('binder_window_invalid_limits', `Binder Window limit ${key} must be a positive safe integer.`);
      merged[key] = value;
    }
  }
  for (const key of Object.keys(limits)) {
    if (!Object.hasOwn(DEFAULT_LIMITS, key)) fail('binder_window_invalid_limits', `Unknown Binder Window limit: ${key}`);
  }
  return Object.freeze(merged);
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function pathLabel(path) {
  return path || '$';
}

function ownKeys(value, path) {
  if (!isPlainObject(value)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) fail('binder_window_hostile', `${pathLabel(path)} has a non-JSON prototype.`);
    fail('binder_window_malformed', `${pathLabel(path)} must be a plain JSON object.`);
  }
  for (const key of Object.keys(value)) {
    if (HOSTILE_KEYS.has(key)) fail('binder_window_hostile', `${pathLabel(path)} contains a hostile object key.`);
  }
  return Object.keys(value);
}

function requireExactKeys(value, expected, path) {
  const keys = ownKeys(value, path);
  const allowed = new Set(expected);
  for (const key of keys) if (!allowed.has(key)) fail('binder_window_unknown_field', `Unknown field ${pathLabel(path)}.${key}.`);
  for (const key of expected) if (!Object.hasOwn(value, key)) fail('binder_window_missing_field', `Missing field ${pathLabel(path)}.${key}.`);
}

function optionalExactKeys(value, allowed, path) {
  const keys = ownKeys(value, path);
  const accepted = new Set(allowed);
  for (const key of keys) if (!accepted.has(key)) fail('binder_window_unknown_field', `Unknown field ${pathLabel(path)}.${key}.`);
}

function ensureNoUndefined(value, path = '$', depth = 0, limits = DEFAULT_LIMITS) {
  if (depth > 30) fail('binder_window_oversized', 'Binder snapshot nesting exceeds the bounded depth.');
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
    fail('binder_window_malformed', `${pathLabel(path)} contains a non-JSON value.`);
  }
  if (typeof value === 'string') {
    if (Buffer.byteLength(value, 'utf8') > limits.maxStringBytes) fail('binder_window_oversized', `${pathLabel(path)} exceeds the bounded string size.`);
    return;
  }
  if (typeof value === 'number' && !Number.isFinite(value)) fail('binder_window_nonfinite', `${pathLabel(path)} must be finite.`);
  if (Array.isArray(value)) {
    if (value.length > limits.maxObjects) fail('binder_window_oversized', `${pathLabel(path)} exceeds the bounded array size.`);
    value.forEach((child, index) => ensureNoUndefined(child, `${pathLabel(path)}[${index}]`, depth + 1, limits));
    return;
  }
  if (value !== null && typeof value === 'object') {
    ownKeys(value, path);
    for (const [key, child] of Object.entries(value)) ensureNoUndefined(child, `${pathLabel(path)}.${key}`, depth + 1, limits);
  }
}

function string(value, path, { nullable = false, maxBytes = DEFAULT_LIMITS.maxStringBytes } = {}) {
  if (value === null && nullable) return null;
  if (typeof value !== 'string' || !value.trim()) fail('binder_window_malformed', `${pathLabel(path)} must be a non-empty string${nullable ? ' or null' : ''}.`);
  if (Buffer.byteLength(value, 'utf8') > maxBytes) fail('binder_window_oversized', `${pathLabel(path)} exceeds the bounded string size.`);
  return value;
}

function finite(value, path, { nullable = false, min = null, max = null } = {}) {
  if (value === null && nullable) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) fail('binder_window_nonfinite', `${pathLabel(path)} must be a finite number${nullable ? ' or null' : ''}.`);
  if (min !== null && value < min) fail('binder_window_malformed', `${pathLabel(path)} must be at least ${min}.`);
  if (max !== null && value > max) fail('binder_window_malformed', `${pathLabel(path)} must be at most ${max}.`);
  return value;
}

function integer(value, path, { nullable = false, min = null, max = null } = {}) {
  if (value === null && nullable) return null;
  if (!Number.isSafeInteger(value)) fail('binder_window_malformed', `${pathLabel(path)} must be a safe integer${nullable ? ' or null' : ''}.`);
  if (min !== null && value < min) fail('binder_window_malformed', `${pathLabel(path)} must be at least ${min}.`);
  if (max !== null && value > max) fail('binder_window_malformed', `${pathLabel(path)} must be at most ${max}.`);
  return value;
}

function boolean(value, path) {
  if (typeof value !== 'boolean') fail('binder_window_malformed', `${pathLabel(path)} must be a boolean.`);
  return value;
}

function date(value, path, { nullable = false } = {}) {
  if (value === null && nullable) return null;
  if (typeof value !== 'string' || !ISO_DATE.test(value)) fail('binder_window_timestamp', `${pathLabel(path)} must be an ISO calendar date${nullable ? ' or null' : ''}.`);
  const parsed = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value) fail('binder_window_timestamp', `${pathLabel(path)} is not a real calendar date.`);
  return value;
}

function dateTime(value, path, { nullable = false } = {}) {
  if (value === null && nullable) return null;
  if (typeof value !== 'string' || !ISO_DATE_TIME.test(value)) fail('binder_window_timestamp', `${pathLabel(path)} must be an ISO timestamp${nullable ? ' or null' : ''}.`);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) fail('binder_window_timestamp', `${pathLabel(path)} is not a real timestamp.`);
  return value;
}

function nullableNumber(value, path) { return finite(value, path, { nullable: true }); }

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (isPlainObject(value)) return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, clone(child)]));
  return value;
}

function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function canonicalize(value, path = '$') {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map((child, index) => canonicalize(child, `${path}[${index}]`));
  if (isPlainObject(value)) {
    const result = {};
    for (const key of Object.keys(value).sort()) result[key] = canonicalize(value[key], `${path}.${key}`);
    return result;
  }
  fail('binder_window_malformed', `${pathLabel(path)} cannot be canonicalized.`);
}

export function canonicalizeBinderSnapshot(value) {
  ensureNoUndefined(value);
  return JSON.stringify(canonicalize(value));
}

function hashBytes(value) {
  return createHash('sha256').update(value).digest('hex');
}

function bytesInput(value) {
  if (typeof value === 'string') return Buffer.from(value, 'utf8');
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (value instanceof Uint8Array) return Buffer.from(value);
  return null;
}

function parseInput(input, limits) {
  const bytes = bytesInput(input);
  if (bytes) {
    if (!bytes.length) fail('binder_window_malformed', 'Binder snapshot bytes are empty.');
    if (bytes.length > limits.maxSourceBytes) fail('binder_window_oversized', 'Binder snapshot exceeds the bounded source size.');
    const text = bytes.toString('utf8');
    if (text.includes('\uFFFD') || bytes.includes(0)) fail('binder_window_hostile', 'Binder snapshot is not valid UTF-8 JSON.');
    let payload;
    try { payload = JSON.parse(text); } catch { fail('binder_window_malformed', 'Binder snapshot bytes are not valid JSON.'); }
    ensureNoUndefined(payload, '$', 0, limits);
    return { payload, source: { hash: hashBytes(bytes), hashBasis: 'exact_source_bytes', byteLength: bytes.length } };
  }
  if (!isPlainObject(input)) {
    if (input === null || input === undefined) return null;
    fail('binder_window_malformed', 'Binder snapshot must be a JSON object, JSON text, or bytes.');
  }
  ensureNoUndefined(input, '$', 0, limits);
  const canonical = canonicalizeBinderSnapshot(input);
  const bytesLength = Buffer.byteLength(canonical, 'utf8');
  if (bytesLength > limits.maxSourceBytes) fail('binder_window_oversized', 'Binder snapshot exceeds the bounded source size.');
  return { payload: input, source: { hash: hashBytes(Buffer.from(canonical, 'utf8')), hashBasis: 'canonical_payload', byteLength: bytesLength } };
}

function validateBelt(value, index, limits) {
  const path = `$.belts[${index}]`;
  requireExactKeys(value, ['key', 'label', 'lots', 'copies', 'cost_usd', 'value_usd', 'unpriced', 'priced_on'], path);
  return {
    key: string(value.key, `${path}.key`),
    label: string(value.label, `${path}.label`),
    lots: integer(value.lots, `${path}.lots`, { min: 0, max: limits.maxObjects }),
    copies: finite(value.copies, `${path}.copies`, { min: 0 }),
    cost_usd: finite(value.cost_usd, `${path}.cost_usd`, { min: 0 }),
    value_usd: nullableNumber(value.value_usd, `${path}.value_usd`),
    unpriced: integer(value.unpriced, `${path}.unpriced`, { min: 0, max: limits.maxObjects }),
    priced_on: date(value.priced_on, `${path}.priced_on`, { nullable: true }),
  };
}

function validateBody(value, index, limits) {
  const path = `$.bodies[${index}]`;
  requireExactKeys(value, [
    'asset_id', 'kind', 'symbol', 'name', 'venue', 'venue_name', 'asset_class', 'chain', 'currency',
    'lots', 'quantity', 'cost_usd', 'cost_nano', 'last', 'last_at', 'priced_on', 'session', 'source',
    'priced_venue', 'delayed', 'stale', 'price_how', 'value_usd', 'pl_usd', 'day_change_usd',
    'day_change_pct', 'given', 'quantity_as_of', 'events',
  ], path);
  return {
    asset_id: string(value.asset_id, `${path}.asset_id`),
    kind: string(value.kind, `${path}.kind`),
    symbol: string(value.symbol, `${path}.symbol`),
    name: string(value.name, `${path}.name`),
    venue: string(value.venue, `${path}.venue`, { nullable: true }),
    venue_name: string(value.venue_name, `${path}.venue_name`, { nullable: true }),
    asset_class: string(value.asset_class, `${path}.asset_class`, { nullable: true }),
    chain: string(value.chain, `${path}.chain`, { nullable: true }),
    currency: string(value.currency, `${path}.currency`),
    lots: integer(value.lots, `${path}.lots`, { min: 0, max: limits.maxObjects }),
    quantity: finite(value.quantity, `${path}.quantity`, { min: 0 }),
    cost_usd: nullableNumber(value.cost_usd, `${path}.cost_usd`),
    cost_nano: nullableNumber(value.cost_nano, `${path}.cost_nano`),
    last: nullableNumber(value.last, `${path}.last`),
    last_at: dateTime(value.last_at, `${path}.last_at`, { nullable: true }),
    priced_on: date(value.priced_on, `${path}.priced_on`, { nullable: true }),
    session: string(value.session, `${path}.session`, { nullable: true }),
    source: string(value.source, `${path}.source`, { nullable: true, maxBytes: limits.maxSourceDisclosureBytes }),
    priced_venue: string(value.priced_venue, `${path}.priced_venue`, { nullable: true }),
    delayed: boolean(value.delayed, `${path}.delayed`),
    stale: boolean(value.stale, `${path}.stale`),
    price_how: string(value.price_how, `${path}.price_how`),
    value_usd: nullableNumber(value.value_usd, `${path}.value_usd`),
    pl_usd: nullableNumber(value.pl_usd, `${path}.pl_usd`),
    day_change_usd: nullableNumber(value.day_change_usd, `${path}.day_change_usd`),
    day_change_pct: nullableNumber(value.day_change_pct, `${path}.day_change_pct`),
    given: boolean(value.given, `${path}.given`),
    quantity_as_of: date(value.quantity_as_of, `${path}.quantity_as_of`, { nullable: true }),
    events: integer(value.events, `${path}.events`, { min: 0, max: limits.maxObjects }),
  };
}

function validateTotals(value, limits) {
  const path = '$.totals';
  requireExactKeys(value, [
    'cost_usd', 'value_usd', 'priced_cost_usd', 'unvalued_cost_usd', 'dark_pct', 'objects', 'belts',
    'bodies', 'lots', 'priced_bodies', 'unpriced_bodies', 'confidence', 'as_of',
  ], path);
  const out = {
    cost_usd: finite(value.cost_usd, `${path}.cost_usd`, { min: 0 }),
    value_usd: nullableNumber(value.value_usd, `${path}.value_usd`),
    priced_cost_usd: finite(value.priced_cost_usd, `${path}.priced_cost_usd`, { min: 0 }),
    unvalued_cost_usd: finite(value.unvalued_cost_usd, `${path}.unvalued_cost_usd`, { min: 0 }),
    dark_pct: finite(value.dark_pct, `${path}.dark_pct`, { min: 0, max: 100 }),
    objects: integer(value.objects, `${path}.objects`, { min: 0, max: limits.maxObjects }),
    belts: integer(value.belts, `${path}.belts`, { min: 0, max: limits.maxObjects }),
    bodies: integer(value.bodies, `${path}.bodies`, { min: 0, max: limits.maxObjects }),
    lots: integer(value.lots, `${path}.lots`, { min: 0, max: limits.maxObjects }),
    priced_bodies: integer(value.priced_bodies, `${path}.priced_bodies`, { min: 0, max: limits.maxObjects }),
    unpriced_bodies: integer(value.unpriced_bodies, `${path}.unpriced_bodies`, { min: 0, max: limits.maxObjects }),
    confidence: string(value.confidence, `${path}.confidence`),
    as_of: dateTime(value.as_of, `${path}.as_of`, { nullable: true }),
  };
  return out;
}

function validateCurve(value, limits) {
  const path = '$.curve';
  requireExactKeys(value, ['series', 'days', 'change_usd', 'comparable', 'unread_days', 'carried_days', 'covers'], path);
  if (!Array.isArray(value.series) || value.series.length > limits.maxCurvePoints) fail('binder_window_oversized', `${path}.series exceeds the bounded point count.`);
  const series = value.series.map((point, index) => {
    const pointPath = `${path}.series[${index}]`;
    requireExactKeys(point, ['day', 'value_usd', 'assets', 'unread', 'carried', 'measured', 'complete', 'how'], pointPath);
    return {
      day: date(point.day, `${pointPath}.day`),
      value_usd: nullableNumber(point.value_usd, `${pointPath}.value_usd`),
      assets: integer(point.assets, `${pointPath}.assets`, { min: 0, max: limits.maxObjects }),
      unread: integer(point.unread, `${pointPath}.unread`, { min: 0, max: limits.maxObjects }),
      carried: integer(point.carried, `${pointPath}.carried`, { min: 0, max: limits.maxObjects }),
      measured: integer(point.measured, `${pointPath}.measured`, { min: 0, max: limits.maxObjects }),
      complete: boolean(point.complete, `${pointPath}.complete`),
      how: string(point.how, `${pointPath}.how`),
    };
  });
  return {
    series,
    days: integer(value.days, `${path}.days`, { min: 0, max: limits.maxCurvePoints }),
    change_usd: nullableNumber(value.change_usd, `${path}.change_usd`),
    comparable: boolean(value.comparable, `${path}.comparable`),
    unread_days: integer(value.unread_days, `${path}.unread_days`, { min: 0, max: limits.maxCurvePoints }),
    carried_days: integer(value.carried_days, `${path}.carried_days`, { min: 0, max: limits.maxCurvePoints }),
    covers: string(value.covers, `${path}.covers`),
  };
}

function validateAbsent(value, limits) {
  const path = '$.absent';
  requireExactKeys(value, ['treasury', 'thesis', 'orbits', 'quotes'], path);
  const validate = (entry, key, expected) => {
    const entryPath = `${path}.${key}`;
    requireExactKeys(entry, expected, entryPath);
    const result = { absent: boolean(entry.absent, `${entryPath}.absent`), why: string(entry.why, `${entryPath}.why`) };
    for (const field of expected.slice(2)) {
      if (field === 'of' || field === 'unquoted' || field === 'belts_unpriced') result[field] = integer(entry[field], `${entryPath}.${field}`, { min: 0, max: limits.maxObjects });
      if (field === 'symbols') {
        if (!Array.isArray(entry[field]) || entry[field].length > limits.maxAbsentSymbols) fail('binder_window_oversized', `${entryPath}.symbols exceeds the bounded count.`);
        result[field] = entry[field].map((symbol, index) => string(symbol, `${entryPath}.symbols[${index}]`));
      }
    }
    return result;
  };
  return {
    treasury: validate(value.treasury, 'treasury', ['absent', 'why']),
    thesis: validate(value.thesis, 'thesis', ['absent', 'why', 'of']),
    orbits: validate(value.orbits, 'orbits', ['absent', 'why']),
    quotes: validate(value.quotes, 'quotes', ['absent', 'unquoted', 'of', 'symbols', 'belts_unpriced', 'why']),
  };
}

function validatePayload(payload, limits) {
  requireExactKeys(payload, ['belts', 'bodies', 'totals', 'curve', 'absent'], '$');
  if (!Array.isArray(payload.belts) || payload.belts.length > limits.maxObjects) fail('binder_window_oversized', '$.belts exceeds the bounded object count.');
  if (!Array.isArray(payload.bodies) || payload.bodies.length > limits.maxObjects) fail('binder_window_oversized', '$.bodies exceeds the bounded object count.');
  const belts = payload.belts.map((belt, index) => validateBelt(belt, index, limits));
  const bodies = payload.bodies.map((body, index) => validateBody(body, index, limits));
  const totals = validateTotals(payload.totals, limits);
  const curve = validateCurve(payload.curve, limits);
  const absent = validateAbsent(payload.absent, limits);
  if (belts.length + bodies.length > limits.maxObjects) fail('binder_window_oversized', 'Binder dashboard objects exceed the bounded total.');
  return { belts, bodies, totals, curve, absent };
}

function freshnessOf(payload) {
  const totals = payload.totals;
  const stale = totals.stale > 0 || payload.bodies.some((body) => body.stale);
  const delayed = totals.delayed > 0 || payload.bodies.some((body) => body.delayed);
  const hasObservation = Boolean(totals.as_of || totals.newest || payload.bodies.some((body) => body.last_at || body.priced_on));
  return {
    status: stale ? 'stale' : delayed ? 'delayed' : hasObservation ? 'observed' : 'unknown',
    asOf: totals.as_of,
    newest: null, // Binder dashboard totals have no newest; undefined here is not JSON and poisons World receipts.
    stale,
    delayed,
    source: 'binder',
  };
}

function completenessOf(payload) {
  const complete = payload.totals.unpriced_bodies === 0 && payload.bodies.every((body) => body.last !== null);
  return {
    status: complete ? 'complete' : 'incomplete',
    complete,
    objects: payload.totals.objects,
    priced: payload.totals.priced_bodies,
    unpriced: payload.totals.unpriced_bodies,
    declaredAbsences: Object.values(payload.absent).filter((entry) => entry.absent).map((entry) => entry.why),
  };
}

function dormantProjection(reason = 'missing_snapshot') {
  return deepFreeze({
    kind: 'binder_window_projection',
    apiVersion: BINDER_WINDOW_API_VERSION,
    identity: BINDER_WINDOW_IDENTITY,
    availability: 'dormant',
    reason,
    readable: false,
    source: { authority: 'binder', route: BINDER_DASHBOARD_ROUTE, hash: null, hashBasis: null, byteLength: 0 },
    freshness: { status: 'unknown', asOf: null, newest: null, stale: false, delayed: false, source: 'binder' },
    completeness: { status: 'unknown', complete: false, objects: 0, priced: 0, unpriced: 0, declaredAbsences: [] },
    belts: [],
    bodies: [],
    totals: null,
    curve: null,
    absent: null,
  });
}

export function projectBinderSnapshot(input, { limits: configuredLimits = {} } = {}) {
  const limits = mergeLimits(configuredLimits);
  const parsed = parseInput(input, limits);
  if (!parsed) return dormantProjection();
  const payload = validatePayload(parsed.payload, limits);
  const projection = {
    kind: 'binder_window_projection',
    apiVersion: BINDER_WINDOW_API_VERSION,
    identity: BINDER_WINDOW_IDENTITY,
    availability: 'available',
    reason: null,
    readable: true,
    source: {
      authority: 'binder',
      route: BINDER_DASHBOARD_ROUTE,
      hash: parsed.source.hash,
      hashBasis: parsed.source.hashBasis,
      byteLength: parsed.source.byteLength,
    },
    freshness: freshnessOf(payload),
    completeness: completenessOf(payload),
    ...payload,
  };
  return deepFreeze(projection);
}

export function validateBinderSnapshot(input, { limits: configuredLimits = {} } = {}) {
  try {
    const limits = mergeLimits(configuredLimits);
    const parsed = parseInput(input, limits);
    if (!parsed) return { valid: false, dormant: true, code: 'missing_snapshot', errors: ['Binder snapshot is absent.'] };
    validatePayload(parsed.payload, limits);
    return { valid: true, dormant: false, hash: parsed.source.hash, hashBasis: parsed.source.hashBasis, byteLength: parsed.source.byteLength, errors: [] };
  } catch (error) {
    if (!(error instanceof BinderWindowError)) throw error;
    return { valid: false, dormant: false, code: error.code, errors: [error.message] };
  }
}

export function createBinderWindowAdapter(options = {}) {
  const limits = mergeLimits(options.limits || {});
  return deepFreeze({
    apiVersion: BINDER_WINDOW_API_VERSION,
    identity: BINDER_WINDOW_IDENTITY,
    limits,
    dormant: () => dormantProjection(),
    inspect: (snapshot) => validateBinderSnapshot(snapshot, { limits }),
    project: (snapshot) => projectBinderSnapshot(snapshot, { limits }),
  });
}

// Short aliases make the seam convenient for host composition while keeping
// the descriptive exports above as the canonical contract.
export const createBinderWindowProjection = projectBinderSnapshot;
export const consumeBinderDashboard = projectBinderSnapshot;
