import { canonicalStringify, deepFreeze, isPlainObject, sha256, sha256Bytes } from './canonical.js';

export const SPOTLIGHT_OBSERVATION_API = 'spotlight-observation.v1';
export const SPOTLIGHT_OBSERVATION_KIND = 'spotlight_observation';

const DEFAULT_LIMITS = Object.freeze({
  maxSourceBytes: 256_000,
  maxStringBytes: 2_048,
  maxFields: 128,
  maxObjects: 256,
  maxDepth: 12,
  maxMissing: 128,
});
const HOSTILE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const SENSITIVE_KEY = /(?:password|passwd|secret|token|credential|bearer|private[_-]?key|account[_-]?(?:id|number)|order[_-]?(?:id|number)|transfer[_-]?(?:id|number))/i;
const SAFE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:/#-]{0,255}$/;
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:?\d{2})$/;
const FIELD_NAME = /^[a-z][a-z0-9_.-]{0,63}$/;
const FRESHNESS = new Set(['observed', 'delayed', 'stale', 'unknown']);
const COMPLETENESS = new Set(['complete', 'partial', 'unknown']);

export class SpotlightObservationError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'SpotlightObservationError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function fail(code, message, details = undefined) {
  throw new SpotlightObservationError(code, message, details);
}

function limitsOf(configured = {}) {
  if (!isPlainObject(configured)) fail('spotlight_observation_invalid_limits', 'Observation limits must be an object.');
  const limits = { ...DEFAULT_LIMITS };
  for (const key of Object.keys(configured)) {
    if (!Object.hasOwn(DEFAULT_LIMITS, key) || !Number.isSafeInteger(configured[key]) || configured[key] < 1) {
      fail('spotlight_observation_invalid_limits', `Invalid observation limit: ${key}.`);
    }
    limits[key] = configured[key];
  }
  return Object.freeze(limits);
}

function ownKeys(value, path) {
  if (!isPlainObject(value)) fail('spotlight_observation_malformed', `${path} must be a plain JSON object.`);
  for (const key of Object.keys(value)) {
    if (HOSTILE_KEYS.has(key)) fail('spotlight_observation_hostile', `${path} contains a hostile object key.`);
    if (SENSITIVE_KEY.test(key)) fail('spotlight_observation_sensitive', `${path}.${key} is not admissible in an observation.`);
  }
  return Object.keys(value);
}

function exactKeys(value, expected, path) {
  const keys = ownKeys(value, path);
  const allowed = new Set(expected);
  for (const key of keys) if (!allowed.has(key)) fail('spotlight_observation_unknown_field', `Unknown field ${path}.${key}.`);
  for (const key of expected) if (!Object.hasOwn(value, key)) fail('spotlight_observation_missing_field', `Missing field ${path}.${key}.`);
}

function string(value, path, { nullable = false, reference = false } = {}) {
  if (value === null && nullable) return null;
  if (typeof value !== 'string' || !value.trim()) fail('spotlight_observation_malformed', `${path} must be a non-empty string${nullable ? ' or null' : ''}.`);
  if (Buffer.byteLength(value, 'utf8') > DEFAULT_LIMITS.maxStringBytes) fail('spotlight_observation_oversized', `${path} exceeds the bounded string size.`);
  if (reference && (!SAFE_REFERENCE.test(value) || SENSITIVE_KEY.test(value))) fail('spotlight_observation_sensitive', `${path} is not a safe public reference.`);
  return value;
}

function timestamp(value, path, { nullable = false } = {}) {
  if (value === null && nullable) return null;
  if (typeof value !== 'string' || !ISO_DATE_TIME.test(value) || !Number.isFinite(Date.parse(value))) fail('spotlight_observation_timestamp', `${path} must be a valid ISO timestamp${nullable ? ' or null' : ''}.`);
  return value;
}

function boolean(value, path) {
  if (typeof value !== 'boolean') fail('spotlight_observation_malformed', `${path} must be a boolean.`);
  return value;
}

function boundedValue(value, path, limits, depth = 0) {
  if (depth > limits.maxDepth) fail('spotlight_observation_oversized', `${path} exceeds the bounded nesting depth.`);
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (Buffer.byteLength(value, 'utf8') > limits.maxStringBytes) fail('spotlight_observation_oversized', `${path} exceeds the bounded string size.`);
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('spotlight_observation_nonfinite', `${path} must be finite.`);
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > limits.maxObjects) fail('spotlight_observation_oversized', `${path} exceeds the bounded array size.`);
    return value.map((child, index) => boundedValue(child, `${path}[${index}]`, limits, depth + 1));
  }
  if (isPlainObject(value)) {
    const keys = ownKeys(value, path);
    if (keys.length > limits.maxObjects) fail('spotlight_observation_oversized', `${path} exceeds the bounded object size.`);
    const result = {};
    for (const key of keys) result[key] = boundedValue(value[key], `${path}.${key}`, limits, depth + 1);
    return result;
  }
  fail('spotlight_observation_malformed', `${path} contains a non-JSON value.`);
}

function sourceOf(value) {
  exactKeys(value, ['authority', 'reference'], '$.source');
  return {
    authority: string(value.authority, '$.source.authority', { reference: true }),
    reference: string(value.reference, '$.source.reference', { reference: true }),
  };
}

function instrumentOf(value) {
  exactKeys(value, ['id', 'label', 'quote'], '$.instrument');
  return {
    id: string(value.id, '$.instrument.id', { reference: true }),
    label: string(value.label, '$.instrument.label'),
    quote: string(value.quote, '$.instrument.quote', { reference: true }),
  };
}

function fieldsOf(value, limits) {
  ownKeys(value, '$.fields');
  const keys = Object.keys(value);
  if (!keys.length) fail('spotlight_observation_malformed', '$.fields must declare at least one field.');
  if (keys.length > limits.maxFields) fail('spotlight_observation_oversized', '$.fields exceeds the bounded field count.');
  const result = {};
  for (const key of keys.sort()) {
    if (!FIELD_NAME.test(key) || SENSITIVE_KEY.test(key)) fail('spotlight_observation_sensitive', `$.fields.${key} is not an admissible field.`);
    const field = value[key];
    if (!isPlainObject(field)) fail('spotlight_observation_malformed', `$.fields.${key} must preserve present/missing status.`);
    const keysForField = Object.keys(field);
    if (keysForField.length === 0 || keysForField.some(item => !['status', 'value', 'reason'].includes(item))) fail('spotlight_observation_unknown_field', `$.fields.${key} has unknown field metadata.`);
    if (field.status === 'present') {
      if (keysForField.length !== 2 || !Object.hasOwn(field, 'value') || Object.hasOwn(field, 'reason')) fail('spotlight_observation_malformed', `$.fields.${key} present value is malformed.`);
      result[key] = { status: 'present', value: boundedValue(field.value, `$.fields.${key}.value`, limits) };
    } else if (field.status === 'missing') {
      if (keysForField.length !== 2 || !Object.hasOwn(field, 'reason') || Object.hasOwn(field, 'value')) fail('spotlight_observation_malformed', `$.fields.${key} missing value is malformed.`);
      result[key] = { status: 'missing', reason: string(field.reason, `$.fields.${key}.reason`) };
    } else {
      fail('spotlight_observation_malformed', `$.fields.${key}.status must be present or missing.`);
    }
  }
  return result;
}

function freshnessOf(value) {
  exactKeys(value, ['status', 'asOf'], '$.freshness');
  if (!FRESHNESS.has(value.status)) fail('spotlight_observation_malformed', '$.freshness.status is invalid.');
  return { status: value.status, asOf: timestamp(value.asOf, '$.freshness.asOf', { nullable: true }) };
}

function completenessOf(value, missingCount, limits) {
  exactKeys(value, ['status', 'missing'], '$.completeness');
  if (!COMPLETENESS.has(value.status)) fail('spotlight_observation_malformed', '$.completeness.status is invalid.');
  if (!Array.isArray(value.missing)) fail('spotlight_observation_malformed', '$.completeness.missing must be an array.');
  if (value.missing.length > limits.maxMissing) fail('spotlight_observation_oversized', '$.completeness.missing exceeds the bounded count.');
  const missing = value.missing.map((entry, index) => string(entry, `$.completeness.missing[${index}]`));
  const declaredMissing = missingCount;
  if (value.status === 'complete' && missing.length) fail('spotlight_observation_malformed', 'Complete observations cannot declare missing fields.');
  if (value.status === 'partial' && !missing.length && declaredMissing === 0) fail('spotlight_observation_malformed', 'Partial observations must disclose missing fields.');
  return { status: value.status, missing };
}

function authorityOf(value) {
  exactKeys(value, ['observationalOnly', 'financialExecution'], '$.authority');
  if (value.observationalOnly !== true || value.financialExecution !== false) fail('spotlight_observation_authority', 'Observation authority must be observationalOnly=true and financialExecution=false.');
  return { observationalOnly: true, financialExecution: false };
}

function bytesInput(input) {
  if (typeof input === 'string') return Buffer.from(input, 'utf8');
  if (Buffer.isBuffer(input)) return Buffer.from(input);
  if (input instanceof Uint8Array) return Buffer.from(input);
  return null;
}

function parseInput(input, limits) {
  const bytes = bytesInput(input);
  if (bytes) {
    if (!bytes.length) fail('spotlight_observation_malformed', 'Observation bytes are empty.');
    if (bytes.length > limits.maxSourceBytes) fail('spotlight_observation_oversized', 'Observation source exceeds the bounded byte size.');
    const text = bytes.toString('utf8');
    if (text.includes('\uFFFD') || bytes.includes(0)) fail('spotlight_observation_hostile', 'Observation bytes are not valid UTF-8 JSON.');
    let payload;
    try { payload = JSON.parse(text); } catch { fail('spotlight_observation_malformed', 'Observation bytes are not valid JSON.'); }
    return { payload, source: { hash: sha256Bytes(bytes), hashBasis: 'exact_source_bytes', byteLength: bytes.length } };
  }
  if (!isPlainObject(input)) fail('spotlight_observation_malformed', 'Observation must be a JSON object, JSON text, or bytes.');
  return { payload: input, source: null };
}

function normalize(input, limits) {
  const parsed = parseInput(input, limits);
  exactKeys(parsed.payload, ['schemaVersion', 'kind', 'source', 'instrument', 'observedAt', 'receivedAt', 'fields', 'freshness', 'completeness', 'authority'], '$');
  if (parsed.payload.schemaVersion !== 1 || parsed.payload.kind !== SPOTLIGHT_OBSERVATION_KIND) fail('spotlight_observation_malformed', `Observation must be ${SPOTLIGHT_OBSERVATION_API}.`);
  const fields = fieldsOf(parsed.payload.fields, limits);
  const missingCount = Object.values(fields).filter(field => field.status === 'missing').length;
  const normalized = {
    schemaVersion: 1,
    apiVersion: SPOTLIGHT_OBSERVATION_API,
    kind: SPOTLIGHT_OBSERVATION_KIND,
    source: sourceOf(parsed.payload.source),
    instrument: instrumentOf(parsed.payload.instrument),
    observedAt: timestamp(parsed.payload.observedAt, '$.observedAt'),
    receivedAt: timestamp(parsed.payload.receivedAt, '$.receivedAt'),
    fields,
    freshness: freshnessOf(parsed.payload.freshness),
    completeness: completenessOf(parsed.payload.completeness, missingCount, limits),
    authority: authorityOf(parsed.payload.authority),
    sourceReceipt: parsed.source || {
      hash: sha256(parsed.payload),
      hashBasis: 'canonical_payload',
      byteLength: Buffer.byteLength(canonicalStringify(parsed.payload), 'utf8'),
    },
  };
  if (normalized.sourceReceipt.byteLength > limits.maxSourceBytes) fail('spotlight_observation_oversized', 'Observation source exceeds the bounded byte size.');
  if (Date.parse(normalized.receivedAt) < Date.parse(normalized.observedAt)) fail('spotlight_observation_timestamp', 'receivedAt cannot precede observedAt.');
  return deepFreeze(normalized);
}

export function admitSpotlightObservation(input, { limits: configuredLimits = {} } = {}) {
  return normalize(input, limitsOf(configuredLimits));
}

export function validateSpotlightObservation(input, { limits: configuredLimits = {} } = {}) {
  try {
    const observation = admitSpotlightObservation(input, { limits: configuredLimits });
    return { valid: true, apiVersion: SPOTLIGHT_OBSERVATION_API, hash: observation.sourceReceipt.hash, hashBasis: observation.sourceReceipt.hashBasis, byteLength: observation.sourceReceipt.byteLength, errors: [] };
  } catch (error) {
    if (!(error instanceof SpotlightObservationError)) throw error;
    return { valid: false, code: error.code, errors: [error.message] };
  }
}

export function createSpotlightObservationValidator(options = {}) {
  const limits = limitsOf(options.limits || {});
  return deepFreeze({
    apiVersion: SPOTLIGHT_OBSERVATION_API,
    limits,
    inspect: input => validateSpotlightObservation(input, { limits }),
    admit: input => admitSpotlightObservation(input, { limits }),
  });
}
