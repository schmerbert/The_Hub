import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoomCapsule, createSpotlightCapsule } from '../src/capsule.js';
import { createFakeHost } from '../src/fake-host.js';

test('standard entrypoint preserves the capsule contract and compatibility export', () => {
  const standard = createRoomCapsule();
  const compatible = createSpotlightCapsule();
  assert.equal(standard.apiVersion, 'room-capsule.v1');
  assert.equal(standard.manifest.identity.id, 'room.spotlight');
  assert.equal(typeof standard.inspect, 'function');
  assert.equal(typeof standard.invoke, 'function');
  assert.equal(typeof compatible.replayFirstMarble, 'function');
});

test('standard invocation refuses unknown operations and invokes the declared observation', () => {
  const capsule = createRoomCapsule();
  const host = createFakeHost();
  assert.throws(() => capsule.invoke('operation.not_declared', host, null), /Unknown or undeclared/);
  const packet = capsule.invoke('operation.replay_first_marble', host, {});
  assert.match(packet.identity, /^packet\.spotlight_/);
});
