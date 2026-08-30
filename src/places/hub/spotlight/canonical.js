import { createHash } from 'node:crypto';

export function canonicalStringify(value) {
  return JSON.stringify(canonicalize(value));
}

export function canonicalize(value, path = '$') {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map((child, index) => canonicalize(child, `${path}[${index}]`));
  if (isPlainObject(value)) {
    const result = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] === undefined) throw new TypeError(`Undefined value at ${path}.${key}`);
      result[key] = canonicalize(value[key], `${path}.${key}`);
    }
    return result;
  }
  throw new TypeError(`Unsupported canonical value at ${path}`);
}

export function sha256(value) {
  return createHash('sha256').update(canonicalStringify(value), 'utf8').digest('hex');
}

export function sha256Bytes(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (isPlainObject(value)) return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, clone(child)]));
  return value;
}

export function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
