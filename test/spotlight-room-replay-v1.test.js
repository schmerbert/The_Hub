import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSpotlightReplayFixture, replayFirstSpotlight, runSpotlightReplay, SPOTLIGHT_PACKET_API } from '../src/places/hub/spotlight/index.js';
import { canonicalStringify, sha256 } from '../src/places/hub/spotlight/canonical.js';

function host() {
  const records = [];
  let now = null;
  return {
    records,
    storage: { append(record) { records.push(record); return records.length; } },
    clock: { set(value) { now = new Date(value).toISOString(); }, now() { if (!now) throw new Error('clock not advanced'); return now; } },
  };
}

test('recorded replay is deterministic, future-blind, and emits one immutable observational packet', () => {
  const firstHost = host();
  const secondHost = host();
  const first = replayFirstSpotlight({ dataset: loadSpotlightReplayFixture(), storage: firstHost.storage, clock: firstHost.clock });
  const second = runSpotlightReplay({ dataset: loadSpotlightReplayFixture(), storage: secondHost.storage, clock: secondHost.clock });
  assert.deepEqual(first, second);
  assert.equal(first.apiVersion, SPOTLIGHT_PACKET_API);
  assert.equal(first.authority.observationalOnly, true);
  assert.equal(first.authority.financialExecution, false);
  assert.equal(firstHost.records.filter(record => record.kind === 'spotlight_observation').length, 4);
  assert.equal(firstHost.records.filter(record => record.kind === 'spotlight_packet').length, 1);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.claims[0]), true);
  assert.equal(Object.isFrozen(first.observationPackets[0]), true);
  const { identity, hash, ...body } = first;
  assert.equal(hash, `sha256:${sha256(body)}`);
  assert.equal(identity, `packet.spotlight_${sha256(body).slice(0, 20)}`);
});

test('changing a future row cannot change the packet already crossed by replay', () => {
  const original = loadSpotlightReplayFixture();
  const changed = structuredClone(original);
  changed.observations[3].price = 9_999_999;
  changed.observations[3].volume = 1;
  const firstHost = host();
  const secondHost = host();
  const first = runSpotlightReplay({ dataset: original, storage: firstHost.storage, clock: firstHost.clock });
  const second = runSpotlightReplay({ dataset: changed, storage: secondHost.storage, clock: secondHost.clock });
  assert.deepEqual(first, second);
  assert.equal(canonicalStringify(first), canonicalStringify(second));
});

test('replay refuses absent host custody and malformed chronology', () => {
  assert.throws(() => runSpotlightReplay({ dataset: loadSpotlightReplayFixture(), storage: null, clock: null }), /host-owned append-only storage/);
  const broken = structuredClone(loadSpotlightReplayFixture());
  broken.observations[1].observedAt = broken.observations[0].observedAt;
  assert.throws(() => runSpotlightReplay({ dataset: broken, storage: host().storage, clock: host().clock }), /strictly chronological/);
});
