import { existsSync, readFileSync } from 'node:fs';
import { projectBinderSnapshot } from './adapter.js';

export function loadBinderWindowSnapshot(path) {
  if (typeof path !== 'string' || !path) return projectBinderSnapshot(null);
  if (!existsSync(path)) return projectBinderSnapshot(null);
  return projectBinderSnapshot(readFileSync(path));
}
