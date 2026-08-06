import { createHash, randomUUID } from 'node:crypto';

export function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function sha256Bytes(value) {
  return createHash('sha256').update(Buffer.isBuffer(value) ? value : Buffer.from(value)).digest('hex');
}

export function byteLength(value) {
  return Buffer.isBuffer(value) ? value.length : Buffer.byteLength(value, 'utf8');
}

export function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function id(prefix) {
  return `${prefix}_${randomUUID()}`;
}
