import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { activateCapsule } from '../src/activation.js';
import { discoverCapsules } from '../src/discovery.js';
import { invokeDeclaredOperation } from '../src/invoke.js';
import { createLabHost } from '../src/lab-host.js';
import { baseManifest, createSyntheticCapsule } from './helpers.js';

async function activeWiredRoom(t) {
  const root = mkdtempSync(join(tmpdir(), 'capsule-invoke-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const manifest = baseManifest('room.wired', 'operation.observe');
  manifest.sockets = [{ id: 'socket.records', capability: 'storage.append_only' }];
  manifest.modes.ready = { requires: ['storage.append_only'] };
  manifest.operations[0].requiredMode = 'ready';
  createSyntheticCapsule(root, 'wired', manifest);
  const descriptor = discoverCapsules(root)[0];
  return { descriptor, activation: await activateCapsule(descriptor, { approvedRoomId: descriptor.identity }) };
}

test('wire supply and socket binding are distinct and required for invocation', async (t) => {
  const { descriptor, activation } = await activeWiredRoom(t);
  const host = createLabHost(descriptor.manifest);
  const wire = { append() { return 1; } };
  assert.throws(() => invokeDeclaredOperation(activation, host, 'operation.observe'), /missing storage\.append_only/);
  host.attach('storage.append_only', wire);
  assert.throws(() => invokeDeclaredOperation(activation, host, 'operation.observe'), /unbound storage\.append_only/);
  assert.throws(() => host.bind('socket.records', 'clock.replay'), /does not accept/);
  host.bind('socket.records', 'storage.append_only');
  assert.deepEqual(invokeDeclaredOperation(activation, host, 'operation.observe', { sample: 1 }), {
    roomId: 'room.wired', operationId: 'operation.observe', input: { sample: 1 }
  });
});

test('generic host refuses unknown operations before capsule invocation', async (t) => {
  const { descriptor, activation } = await activeWiredRoom(t);
  const host = createLabHost(descriptor.manifest);
  assert.throws(() => invokeDeclaredOperation(activation, host, 'operation.unknown'), /Unknown or undeclared/);
});

test('generic host refuses silent wire replacement and socket rebinding', async (t) => {
  const { descriptor } = await activeWiredRoom(t);
  const host = createLabHost(descriptor.manifest);
  host.attach('storage.append_only', { append() { return 1; } });
  assert.throws(
    () => host.attach('storage.append_only', { append() { return 2; } }),
    /already supplied/
  );
  host.bind('socket.records', 'storage.append_only');
  assert.throws(() => host.bind('socket.records', 'storage.append_only'), /already bound/);
});
