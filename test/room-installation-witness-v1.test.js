import test from 'node:test';
import assert from 'node:assert/strict';
import { assertVerifiedRoomInstallation, buildRoomInstallationWitness } from '../src/rooms/installation-witness.js';
import { workshopInstallationWitness } from '../src/rooms/workshop-witness.js';

function witnessInputs(witness) {
  return {
    manifest: {
      schemaVersion: 1,
      apiVersion: 'room-installation.v1',
      identity: { id: witness.roomId, kind: 'room', version: witness.packageVersion },
      status: { classification: 'standing', autoInstall: false },
      package: { entrypoint: 'index.js', declarationExport: 'WORKSHOP' },
      placement: { requestedParent: witness.topology.requestedParent, hostOwnsDoor: true },
      sockets: witness.sockets.map(({ binding, ...declared }) => declared),
      affordanceGroups: witness.affordances.map(group => ({ ...group, approvalPolicy: 'host_owned', requires: [], tools: group.tools.map(tool => tool.name) })),
      custody: witness.custody.map(({ binding, ...declared }) => declared),
      authority: { selfInstall: false, selfAuthorize: false, ambientAuthority: false },
      removal: { hostDecision: true, preserveCustody: true },
    },
    manifestBytes: 'synthetic exact manifest bytes',
    topology: structuredClone(witness.topology),
    fixtures: witness.fixtures.filter(item => item.installed).map(item => item.id),
    tools: witness.affordances.flatMap(group => group.tools).map(tool => structuredClone(tool)),
    sockets: witness.sockets.map(item => structuredClone(item.binding)),
    custody: witness.custody.map(item => structuredClone(item.binding)),
  };
}

test('Workshop produces one deterministic verified installation witness with no loose wires', () => {
  const first = workshopInstallationWitness();
  const second = workshopInstallationWitness();
  assert.equal(first.verified, true);
  assert.deepEqual(first.gaps, []);
  assert.equal(first.witnessHash, second.witnessHash);
  assert.match(first.manifestHash, /^[a-f0-9]{64}$/);
  assert.match(first.witnessHash, /^[a-f0-9]{64}$/);
  assert.strictEqual(assertVerifiedRoomInstallation(first), first);
  assert.equal(Object.isFrozen(first), true);
});

test('witness makes topology, tool, socket, and custody drift explicit', () => {
  const baseline = workshopInstallationWitness();
  const cases = [
    inputs => { inputs.topology.entranceInstalled = false; },
    inputs => { inputs.tools.find(tool => tool.name === 'workshop_read').handler = false; },
    inputs => { inputs.tools.find(tool => tool.name === 'workshop_git_commit').approvalClass = null; },
    inputs => { inputs.sockets.find(socket => socket.id === 'socket.repository_root').state = 'optional_unwired'; },
    inputs => { inputs.custody.find(route => route.id === 'custody.result_rack').state = 'optional_unwired'; },
  ];
  for (const mutate of cases) {
    const inputs = witnessInputs(baseline);
    mutate(inputs);
    const witness = buildRoomInstallationWitness(inputs);
    assert.equal(witness.verified, false);
    assert.ok(witness.gaps.length > 0);
    assert.throws(() => assertVerifiedRoomInstallation(witness), /not verified/);
  }
});

test('optional Forest socket and custody remain honest without becoming loose wires', () => {
  const witness = workshopInstallationWitness();
  assert.equal(witness.sockets.find(item => item.id === 'socket.forest_admission').binding.state, 'optional_unwired');
  assert.equal(witness.custody.find(item => item.id === 'custody.forest_wild').binding.state, 'optional_unwired');
  assert.equal(witness.verified, true);
});
