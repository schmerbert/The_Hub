import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { assertValidRoomManifest } from './manifest.js';
import { deepFreeze } from './immutable.js';

export const DEFAULT_LIMITS = deepFreeze({ manifestBytes: 64 * 1024, entrypointBytes: 512 * 1024 });

export function discoverCapsules(root, { limits = DEFAULT_LIMITS } = {}) {
  const explicitRoot = resolve(root);
  rejectSymlink(explicitRoot, 'discovery root');
  const descriptors = [];
  for (const entry of readdirSync(explicitRoot, { withFileTypes: true })) {
    const capsulePath = resolve(explicitRoot, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Symlink capsule entry refused: ${entry.name}`);
    if (!entry.isDirectory()) continue;
    const manifestPath = resolve(capsulePath, 'room.json');
    let manifestBytes;
    try {
      manifestBytes = readBoundedRegularFile(manifestPath, limits.manifestBytes, capsulePath, 'manifest');
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }
    let manifest;
    try {
      manifest = JSON.parse(manifestBytes.toString('utf8'));
    } catch (error) {
      throw new Error(`Malformed JSON manifest at ${manifestPath}: ${error.message}`);
    }
    assertValidRoomManifest(manifest);
    const entrypointPath = resolve(capsulePath, ...manifest.entrypoint.split('/'));
    const entrypointBytes = readBoundedRegularFile(entrypointPath, limits.entrypointBytes, capsulePath, 'entrypoint');
    descriptors.push(deepFreeze({
      identity: manifest.identity.id,
      version: manifest.identity.version,
      apiVersion: manifest.apiVersion,
      capsulePath,
      manifestPath,
      entrypointPath,
      manifestHash: hash(manifestBytes),
      entrypointHash: hash(entrypointBytes),
      manifestBytes: manifestBytes.length,
      entrypointBytes: entrypointBytes.length,
      manifest: structuredClone(manifest),
      state: 'discovered_inert'
    }));
  }
  const identities = new Set();
  for (const descriptor of descriptors) {
    if (identities.has(descriptor.identity)) throw new Error(`Duplicate room identity refused: ${descriptor.identity}`);
    identities.add(descriptor.identity);
  }
  return deepFreeze(descriptors.sort((a, b) => a.identity.localeCompare(b.identity)));
}

export function reverifyDescriptor(descriptor, limits = DEFAULT_LIMITS) {
  const manifestBytes = readBoundedRegularFile(descriptor.manifestPath, limits.manifestBytes, descriptor.capsulePath, 'manifest');
  const manifest = assertValidRoomManifest(JSON.parse(manifestBytes.toString('utf8')));
  if (hash(manifestBytes) !== descriptor.manifestHash) throw new Error(`Manifest hash drift refused for ${descriptor.identity}`);
  if (manifest.identity.id !== descriptor.identity || manifest.identity.version !== descriptor.version || manifest.entrypoint !== descriptor.manifest.entrypoint) throw new Error(`Manifest identity or entrypoint drift refused for ${descriptor.identity}`);
  const entrypointBytes = readBoundedRegularFile(descriptor.entrypointPath, limits.entrypointBytes, descriptor.capsulePath, 'entrypoint');
  if (hash(entrypointBytes) !== descriptor.entrypointHash) throw new Error(`Entrypoint hash drift refused for ${descriptor.identity}`);
  return true;
}

function readBoundedRegularFile(path, maximum, capsulePath, label) {
  assertWithin(capsulePath, path, label);
  assertNoSymlinkComponents(capsulePath, path, label);
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) throw new Error(`Symlink ${label} refused: ${path}`);
  if (!stat.isFile()) throw new Error(`${label} must be a regular file: ${path}`);
  if (stat.size > maximum) throw new Error(`${label} exceeds ${maximum} byte limit: ${path}`);
  const bytes = readFileSync(path);
  if (bytes.length > maximum) throw new Error(`${label} exceeded bounded read: ${path}`);
  return bytes;
}

function assertNoSymlinkComponents(capsulePath, path, label) {
  let cursor = dirname(path);
  while (cursor !== capsulePath) {
    assertWithin(capsulePath, cursor, label);
    rejectSymlink(cursor, label);
    const parent = dirname(cursor);
    if (parent === cursor) throw new Error(`${label} escaped capsule`);
    cursor = parent;
  }
  rejectSymlink(capsulePath, 'capsule directory');
}

function assertWithin(root, candidate, label) {
  const base = resolve(root);
  const target = resolve(candidate);
  if (target !== base && !target.startsWith(`${base}${sep}`)) throw new Error(`${label} path escapes capsule: ${candidate}`);
}

function rejectSymlink(path, label) {
  if (lstatSync(path).isSymbolicLink()) throw new Error(`Symlink ${label} refused: ${path}`);
}

function hash(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}
