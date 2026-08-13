import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { activateCapsule } from '../src/activation.js';
import { discoverCapsules } from '../src/discovery.js';
import { invokeDeclaredOperation } from '../src/invoke.js';
import { createLabHost } from '../src/lab-host.js';
import { createReplayWireKit } from '../src/wire-kit.js';

test('generic laboratory discovers, activates, wires, and invokes Spotlight by declarations', async () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const descriptor = discoverCapsules(root).find(({ identity }) => identity === 'room.spotlight');
  assert.ok(descriptor);
  const activation = await activateCapsule(descriptor, { approvedRoomId: descriptor.identity });
  const host = createLabHost(descriptor.manifest);
  const kit = createReplayWireKit();
  for (const socket of descriptor.manifest.sockets) {
    if (!kit.capabilities[socket.capability]) continue;
    host.attach(socket.capability, kit.capabilities[socket.capability]);
    host.bind(socket.id, socket.capability);
  }
  const operation = descriptor.manifest.operations[0];
  const result = invokeDeclaredOperation(activation, host, operation.id);
  assert.match(result.identity, /^packet\.spotlight_/);
  assert.equal(result.authority.financialExecution, false);
  assert.equal(kit.records().filter(({ kind }) => kind === 'spotlight_packet').length, 1);
});
