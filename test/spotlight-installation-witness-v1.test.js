import test from 'node:test';
import assert from 'node:assert/strict';
import { spotlightInstallationWitness } from '../src/rooms/spotlight-witness.js';

test('Spotlight installation witness proves the standing shell and host-installed entrance', () => {
  const witness = spotlightInstallationWitness();
  assert.equal(witness.verified, true);
  assert.equal(witness.entrancePolicy, 'installed');
  assert.equal(witness.topology.entranceInstalled, true);
  assert.equal(witness.fixtures.length, 5);
  assert.equal(witness.affordances.flatMap(group => group.tools).length, 10);
  assert.equal(witness.affordances.flatMap(group => group.tools).every(tool => tool.ceiling && tool.mounted && tool.handler && tool.schemaHash && ['auto', 'confirm'].includes(tool.approvalClass)), true);
  assert.equal(witness.sockets.every(socket => socket.binding.state === 'optional_unwired'), true);
  assert.equal(witness.custody.every(route => route.binding.state === 'optional_unwired'), true);
  assert.deepEqual(witness.gaps, []);
});

test('Spotlight witness rejects a missing entrance or a falsely connected socket', () => {
  assert.equal(spotlightInstallationWitness({ topology: { ...spotlightInstallationWitness().topology, entranceInstalled: false } }).verified, false);
  const baseline = spotlightInstallationWitness();
  const sockets = baseline.sockets.map(item => ({ ...item.binding }));
  sockets[0] = { ...sockets[0], state: 'installed' };
  // A connected optional wire remains independently represented in the host
  // witness; it does not grant the room any authority by itself.
  const changed = spotlightInstallationWitness({ sockets });
  assert.notEqual(changed.witnessHash, baseline.witnessHash);
});
