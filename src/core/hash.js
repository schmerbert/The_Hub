import { createHash, randomUUID } from 'node:crypto';

export function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function id(prefix) {
  return `${prefix}_${randomUUID()}`;
}
