import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { readConfig } from '../core/config.js';
import { validateBinderSnapshot } from '../places/hub/binder-window/index.js';

const config = readConfig(process.env);
const source = process.env.BINDER_WINDOW_SOURCE_URL || 'http://127.0.0.1:4030/api/dashboard?days=30';
const url = new URL(source);
if (!['127.0.0.1', 'localhost', '::1'].includes(url.hostname) || url.protocol !== 'http:' || url.pathname !== '/api/dashboard') {
  throw new Error('BINDER_WINDOW_SOURCE_URL must be the local Binder http:// loopback /api/dashboard endpoint.');
}

const response = await fetch(url, { headers: { accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(15_000) });
if (!response.ok) throw new Error(`Binder dashboard snapshot refused with HTTP ${response.status}.`);
const bytes = Buffer.from(await response.arrayBuffer());
const validation = validateBinderSnapshot(bytes);
if (!validation.valid) throw new Error(`Binder dashboard snapshot is invalid: ${validation.code}: ${validation.errors.join('; ')}`);

const destination = resolve(config.binderWindowSnapshotPath);
await mkdir(dirname(destination), { recursive: true });
const temporary = `${destination}.next`;
await writeFile(temporary, bytes, { flag: 'w' });
await rename(temporary, destination);
console.log(JSON.stringify({
  status: 'captured',
  destination,
  source: `${url.origin}${url.pathname}`,
  sourceHash: validation.hash,
  sourceHashBasis: validation.hashBasis,
  byteLength: validation.byteLength,
}, null, 2));
