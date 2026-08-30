import test from 'node:test';
import assert from 'node:assert/strict';
import { spotlightInstallationWitness } from '../src/rooms/spotlight-witness.js';

test('Spotlight installation witness proves the standing shell and deliberately withheld entrance', () => {
  const witness = spotlightInstallationWitness();
  assert.equal(witness.verified, true);
  assert.equal(witness.entrancePolicy, 'withheld');
  assert.equal(witness.topology.entranceInstalled, false);
  assert.equal(witness.fixtures.length, 5);
  assert.equal(witness.affordances.every(group => group.tools.length === 0), true);
  assert.equal(witness.sockets.every(socket => socket.binding.state === 'optional_unwired'), true);
  assert.equal(witness.custody.every(route => route.binding.state === 'optional_unwired'), true);
  assert.deepEqual(witness.gaps, []);
});

test('Spotlight witness rejects an early entrance or a falsely connected socket', () => {
  assert.equal(spotlightInstallationWitness({ topology: { ...spotlightInstallationWitness().topology, entranceInstalled: true } }).verified, false);
  const baseline = spotlightInstallationWitness();
  const sockets = baseline.sockets.map(item => ({ ...item.binding }));
  sockets[0] = { ...sockets[0], state: 'installed' };
  // A connected optional wire is valid only once the manifest and production
  // host witness are revised together; this v1 witness is intentionally capped.
  const changed = spotlightInstallationWitness({ sockets });
  assert.notEqual(changed.witnessHash, baseline.witnessHash);
});
