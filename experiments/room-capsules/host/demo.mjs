import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { activateCapsule, createLabHost, createReplayWireKit, discoverCapsules, inspectActivatedCapsule, invokeDeclaredOperation } from './src/index.js';

const capsuleRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const requestedRoomId = 'room.spotlight';
const descriptor = discoverCapsules(capsuleRoot).find(({ identity }) => identity === requestedRoomId);
if (!descriptor) throw new Error(`Requested capsule was not discovered: ${requestedRoomId}`);

const activation = await activateCapsule(descriptor, { approvedRoomId: requestedRoomId });
const host = createLabHost(descriptor.manifest);
const kit = createReplayWireKit();
for (const socket of descriptor.manifest.sockets) {
  const implementation = kit.capabilities[socket.capability];
  if (!implementation) continue;
  host.attach(socket.capability, implementation);
  host.bind(socket.id, socket.capability);
}
const operationId = descriptor.manifest.operations.find(({ observationalOnly, externalEffects }) => observationalOnly && externalEffects === false)?.id;
if (!operationId) throw new Error('No observational operation is declared');
const inspection = inspectActivatedCapsule(activation, host);
const result = invokeDeclaredOperation(activation, host, operationId, null);
console.log(JSON.stringify({
  discovered: descriptor.identity,
  discoveryState: descriptor.state,
  activationState: activation.state,
  availableModes: Object.entries(inspection.modes).filter(([, mode]) => mode.available).map(([id]) => id),
  operationId,
  resultIdentity: result?.identity ?? null,
  resultHash: result?.hash ?? null,
  retainedRecordCount: kit.records().length
}, null, 2));
