import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function baseManifest(id = 'room.synthetic', operationId = 'operation.observe') {
  return {
    schemaVersion: 1,
    apiVersion: 'room-capsule.v1',
    entrypoint: 'src/entry.mjs',
    identity: { id, kind: 'room', version: '0.0.1' },
    status: { classification: 'experimental', activation: 'inert', standing: false, autoInstall: false },
    sockets: [],
    modes: { bare: { alwaysAvailable: true } },
    operations: [{ id: operationId, requiredMode: 'bare', observationalOnly: true, externalEffects: false }],
    authority: { selfAuthorization: false, financialExecution: false, externalEffects: false }
  };
}

export function createSyntheticCapsule(root, directoryName, manifest = baseManifest(), source = null) {
  const capsulePath = join(root, directoryName);
  mkdirSync(join(capsulePath, 'src'), { recursive: true });
  writeFileSync(join(capsulePath, 'room.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  writeFileSync(join(capsulePath, 'src', 'entry.mjs'), source ?? standardSource(manifest), 'utf8');
  return capsulePath;
}

export function standardSource(manifest) {
  return `
const manifest = ${JSON.stringify(manifest)};
export function createRoomCapsule() {
  return {
    apiVersion: manifest.apiVersion,
    manifest,
    inspect(host = { capabilities: {}, bindings: {} }) {
      const connected = new Set(manifest.sockets.filter((socket) => host.capabilities?.[socket.capability] && host.bindings?.[socket.id] === socket.capability).map((socket) => socket.capability));
      return {
        identity: manifest.identity.id,
        modes: Object.fromEntries(Object.entries(manifest.modes).map(([id, mode]) => [id, {
          available: mode.alwaysAvailable === true || (mode.requires ?? []).every((capability) => connected.has(capability)),
          missing: (mode.requires ?? []).filter((capability) => !host.capabilities?.[capability]),
          unbound: (mode.requires ?? []).filter((capability) => host.capabilities?.[capability] && !connected.has(capability))
        }]))
      };
    },
    invoke(operationId, host, input) {
      if (!manifest.operations.some(({ id }) => id === operationId)) throw new Error('undeclared');
      return { roomId: manifest.identity.id, operationId, input };
    }
  };
}
`;
}
