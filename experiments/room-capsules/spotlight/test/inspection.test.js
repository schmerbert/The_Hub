import test from 'node:test';
import assert from 'node:assert/strict';
import { createSpotlightCapsule } from '../src/capsule.js';
import { createFakeHost } from '../src/fake-host.js';

test('bare shell is inspectable with truthful empty slots and capped sockets', () => {
  const inspection = createSpotlightCapsule().inspect();
  assert.equal(inspection.identity, 'room.spotlight');
  assert.equal(inspection.modes.bare.available, true);
  assert.equal(inspection.modes.replay_only.available, false);
  assert.deepEqual(inspection.modes.replay_only.missing, ['storage.append_only', 'clock.replay']);
  assert.deepEqual(inspection.modes.replay_only.unbound, []);
  assert.equal(inspection.modes.live_observation.available, false);
  assert.equal(inspection.fixtures.length, 6);
  assert.ok(inspection.fixtures.every(({ state }) => state === 'empty_slot'));
  assert.ok(inspection.sockets.every(({ state }) => state === 'capped_unwired'));
  assert.equal(inspection.outbox, 'dormant_unwired');
});

test('host binding connects replay fixtures without self-authorization', () => {
  const replayHost = createFakeHost();
  const inspection = createSpotlightCapsule().inspect(replayHost);
  assert.equal(inspection.modes.replay_only.available, true);
  assert.equal(inspection.modes.live_observation.available, false);
  assert.equal(inspection.outbox, 'dormant_unwired');
  assert.equal(inspection.fitOut.current, 'wired');
  assert.equal(inspection.fixtures.find(({ id }) => id === 'fixture.packet_table').state, 'connected');
  assert.equal(inspection.fixtures.find(({ id }) => id === 'fixture.replay_table').state, 'connected');
  assert.equal(inspection.fixtures.find(({ id }) => id === 'fixture.helm').state, 'empty_slot');
  assert.equal(inspection.authority.selfAuthorization, false);
});

test('supplied but unbound wires remain unusable', () => {
  const host = createFakeHost({ bindReplay: false });
  const inspection = createSpotlightCapsule().inspect(host);
  assert.equal(inspection.modes.replay_only.available, false);
  assert.deepEqual(inspection.modes.replay_only.missing, []);
  assert.deepEqual(inspection.modes.replay_only.unbound, ['storage.append_only', 'clock.replay']);
  assert.equal(inspection.fixtures.find(({ id }) => id === 'fixture.packet_table').state, 'wire_available_unbound');
  assert.throws(() => createSpotlightCapsule().replayFirstMarble(host), /unbound: storage\.append_only, clock\.replay/);
});

test('live observation remains dormant until its optional channel is supplied', () => {
  const absent = createSpotlightCapsule().inspect(createFakeHost());
  const supplied = createSpotlightCapsule().inspect(createFakeHost({ marketDelivery: true }));
  assert.equal(absent.modes.live_observation.available, false);
  assert.equal(supplied.modes.live_observation.available, true);
  assert.equal(supplied.fixtures.find(({ id }) => id === 'fixture.present_window').state, 'connected');
});

test('replay refuses a host missing either required wire', () => {
  const capsule = createSpotlightCapsule();
  assert.throws(() => capsule.replayFirstMarble({ capabilities: {}, bindings: {} }), /storage\.append_only, clock\.replay/);
});
