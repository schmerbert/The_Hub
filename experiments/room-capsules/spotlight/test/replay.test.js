import test from 'node:test';
import assert from 'node:assert/strict';
import { createSpotlightCapsule } from '../src/capsule.js';
import { createFakeHost } from '../src/fake-host.js';
import { sha256 } from '../src/canonical.js';

function firstMarble() {
  const host = createFakeHost();
  const packet = createSpotlightCapsule().replayFirstMarble(host);
  return { host, packet };
}

test('first marble is deterministic across independent runs', () => {
  const first = firstMarble();
  const second = firstMarble();
  assert.deepEqual(first.packet, second.packet);
  assert.equal(first.host.records().filter(({ kind }) => kind === 'spotlight_packet').length, 1);
  assert.equal(second.host.records().filter(({ kind }) => kind === 'spotlight_packet').length, 1);
  assert.equal(first.host.records().filter(({ kind }) => kind === 'market_observation').length, 4);
});

test('packet is deeply immutable, canonical, and source-bound', () => {
  const { packet } = firstMarble();
  assert.equal(Object.isFrozen(packet), true);
  assert.equal(Object.isFrozen(packet.analogues), true);
  assert.equal(Object.isFrozen(packet.analogues[0]), true);
  assert.throws(() => { packet.claims[0].observed = 999; }, TypeError);
  const { identity, hash, ...body } = packet;
  const expected = sha256(body);
  assert.equal(hash, `sha256:${expected}`);
  assert.equal(identity, `packet.spotlight_${expected.slice(0, 20)}`);
  assert.deepEqual(packet.sourceRefs, ['source.recorded_market/row/001', 'source.recorded_market/row/003']);
  assert.equal(packet.analogues.length, 3);
  assert.equal(packet.analogues[2].status, 'insufficient_history');
  assert.ok(packet.missingData.length > 0);
  assert.ok(packet.counterevidence.length > 0);
  assert.match(packet.nextObservation, /next recorded interval/);
  assert.equal(packet.authority.financialExecution, false);
});

test('fake host retains immutable append-only copies and no imaginary outbox delivery', () => {
  const { host, packet } = firstMarble();
  const records = host.records();
  assert.equal(Object.isFrozen(records), true);
  assert.equal(records.find(({ kind }) => kind === 'spotlight_packet').packet.identity, packet.identity);
  assert.equal(createSpotlightCapsule().inspect(host).outbox, 'dormant_unwired');
});
