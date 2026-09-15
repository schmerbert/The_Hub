import { canonicalize, sha256 } from '../core/hash.js';

/**
 * The checkpoint store deliberately hashes JSON evidence, not the evidence's
 * meaning. Domain verifiers remain responsible for deciding whether a
 * manifest, frontier, projection digest, or dependency is sufficient.
 */
export const VERIFIED_ANCESTRY_FORMAT_VERSION = 'verified-ancestry/v1';

const HASH_PATTERN = /^[0-9a-f]{64}$/;

export function isSha256(value) {
  return typeof value === 'string' && HASH_PATTERN.test(value);
}

export function assertSha256(value, label = 'Hash') {
  if (!isSha256(value)) throw Object.assign(new Error(`${label} must be a lowercase SHA-256 hex digest.`), { code: 'verified_ancestry_invalid_argument' });
  return value;
}

function assertJsonValue(value, path = 'value', seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw Object.assign(new Error(`${path} must contain only finite JSON numbers.`), { code: 'verified_ancestry_invalid_argument' });
    return value;
  }
  if (typeof value !== 'object') throw Object.assign(new Error(`${path} must contain JSON-compatible values.`), { code: 'verified_ancestry_invalid_argument' });
  if (seen.has(value)) throw Object.assign(new Error(`${path} cannot contain a cycle.`), { code: 'verified_ancestry_invalid_argument' });
  seen.add(value);
  if (Array.isArray(value)) value.forEach((item, index) => assertJsonValue(item, `${path}[${index}]`, seen));
  else for (const [key, child] of Object.entries(value)) {
    if (typeof key !== 'string') throw Object.assign(new Error(`${path} contains an invalid object key.`), { code: 'verified_ancestry_invalid_argument' });
    assertJsonValue(child, `${path}.${key}`, seen);
  }
  seen.delete(value);
  return value;
}

export function canonicalJson(value, label = 'Value') {
  assertJsonValue(value, label);
  const json = canonicalize(value);
  if (typeof json !== 'string') throw Object.assign(new Error(`${label} could not be canonically serialized.`), { code: 'verified_ancestry_invalid_argument' });
  return json;
}

export function hashJson(value, label = 'Value') {
  return sha256(canonicalJson(value, label));
}

export function normalizeVersion(value, label, { required = false } = {}) {
  if (value === undefined || value === null) {
    if (required) throw Object.assign(new Error(`${label} is required.`), { code: 'verified_ancestry_invalid_argument' });
    return null;
  }
  if (typeof value !== 'string' && typeof value !== 'number') throw Object.assign(new Error(`${label} must be a string or number.`), { code: 'verified_ancestry_invalid_argument' });
  const result = String(value);
  if (!result) throw Object.assign(new Error(`${label} cannot be empty.`), { code: 'verified_ancestry_invalid_argument' });
  return result;
}

export function normalizeName(value, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) throw Object.assign(new Error(`${label} must be a non-empty string of at most 200 characters.`), { code: 'verified_ancestry_invalid_argument' });
  return value;
}

function normalizedDependency(dependency, index) {
  if (!dependency || typeof dependency !== 'object' || Array.isArray(dependency)) throw Object.assign(new Error(`Dependency ${index + 1} must be an object.`), { code: 'verified_ancestry_invalid_argument' });
  const domain = normalizeName(dependency.domain, `Dependency ${index + 1} domain`);
  const storeIdentity = dependency.storeIdentity ?? dependency.storeId;
  if (storeIdentity === undefined) throw Object.assign(new Error(`Dependency ${index + 1} storeIdentity is required.`), { code: 'verified_ancestry_invalid_argument' });
  const frontier = dependency.frontier === undefined ? null : dependency.frontier;
  const checkpointHash = dependency.checkpointHash ?? dependency.checkpoint_sha256;
  if (!isSha256(checkpointHash)) throw Object.assign(new Error(`Dependency ${index + 1} checkpointHash must be a lowercase SHA-256 hex digest.`), { code: 'verified_ancestry_invalid_argument' });
  canonicalJson(storeIdentity, `Dependency ${index + 1} storeIdentity`);
  canonicalJson(frontier, `Dependency ${index + 1} frontier`);
  return { domain, storeIdentity, frontier, checkpointHash };
}

export function normalizeDependencies(dependencies = []) {
  if (!Array.isArray(dependencies)) throw Object.assign(new Error('dependencies must be an array.'), { code: 'verified_ancestry_invalid_argument' });
  const normalized = dependencies.map(normalizedDependency);
  normalized.sort((a, b) => {
    const left = canonicalize(a); const right = canonicalize(b);
    return left < right ? -1 : left > right ? 1 : 0;
  });
  const seen = new Set();
  for (const dependency of normalized) {
    const key = canonicalize({ domain: dependency.domain, storeIdentity: dependency.storeIdentity });
    if (seen.has(key)) throw Object.assign(new Error(`Duplicate dependency for ${dependency.domain}.`), { code: 'verified_ancestry_invalid_argument' });
    seen.add(key);
  }
  return normalized;
}

export function buildCheckpointEnvelope({
  formatVersion = VERIFIED_ANCESTRY_FORMAT_VERSION,
  domain,
  generationId,
  predecessorCheckpointHash = null,
  verifierVersion,
  schemaVersion = null,
  projectorVersion = null,
  topologyVersion = null,
  storeIdentity,
  storeGeneration = null,
  manifest,
  dependencies = [],
  payloadHash,
  completedAt,
}) {
  normalizeName(formatVersion, 'formatVersion');
  normalizeName(domain, 'domain');
  normalizeName(generationId, 'generationId');
  normalizeName(completedAt, 'completedAt');
  const envelope = {
    formatVersion,
    domain,
    generationId,
    predecessorCheckpointHash: predecessorCheckpointHash === undefined ? null : predecessorCheckpointHash,
    verifierVersion: normalizeVersion(verifierVersion, 'verifierVersion', { required: true }),
    schemaVersion: normalizeVersion(schemaVersion, 'schemaVersion'),
    projectorVersion: normalizeVersion(projectorVersion, 'projectorVersion'),
    topologyVersion: normalizeVersion(topologyVersion, 'topologyVersion'),
    storeIdentity,
    storeGeneration,
    manifest,
    manifestHash: hashJson(manifest, 'manifest'),
    dependencies: normalizeDependencies(dependencies),
    payloadHash: assertSha256(payloadHash, 'payloadHash'),
    completedAt,
  };
  if (envelope.predecessorCheckpointHash !== null) assertSha256(envelope.predecessorCheckpointHash, 'predecessorCheckpointHash');
  canonicalJson(envelope, 'checkpoint envelope');
  return envelope;
}

export function canonicalCheckpointEnvelope(envelope) {
  return canonicalJson(envelope, 'checkpoint envelope');
}

export function hashCheckpointEnvelope(envelope) {
  return sha256(canonicalCheckpointEnvelope(envelope));
}
