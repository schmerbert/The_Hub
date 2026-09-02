import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SPOTLIGHT, SPOTLIGHT_FIXTURE_IDS, SPOTLIGHT_TOOL_NAMES, loadSpotlightManifest, validateSpotlightManifest } from '../src/places/hub/spotlight/index.js';
import { validateRoomInstallationManifest } from '../src/rooms/installation-contract.js';

test('Spotlight is a source-coherent standing room with a host-installed door', async () => {
  const manifest = loadSpotlightManifest();
  assert.deepEqual(validateSpotlightManifest(manifest), { ok: true, errors: [] });
  assert.deepEqual(validateRoomInstallationManifest(manifest), { ok: true, errors: [] });
  assert.equal(manifest.identity.id, 'room.spotlight');
  assert.equal(manifest.status.classification, 'standing');
  assert.equal(manifest.status.autoInstall, false);
  assert.equal(manifest.placement.entrancePolicy, 'installed');
  assert.deepEqual(manifest.authority, { selfInstall: false, selfAuthorize: false, ambientAuthority: false });
  assert.deepEqual(new Set(manifest.affordanceGroups.map(group => group.fixtureId)), new Set(SPOTLIGHT_FIXTURE_IDS));
  assert.deepEqual(manifest.affordanceGroups.filter(group => group.effect === 'execute').flatMap(group => group.tools).sort(), ['spotlight_ring_adjust', 'spotlight_trade_execute']);
  assert.deepEqual(manifest.affordanceGroups.filter(group => group.effect === 'govern').flatMap(group => group.tools).sort(), ['spotlight_ring_propose', 'spotlight_trade_propose']);
  assert.deepEqual(manifest.affordanceGroups.flatMap(group => group.tools).sort(), [...SPOTLIGHT_TOOL_NAMES].sort());
  assert.ok(manifest.sockets.every(socket => socket.suppliedBy === 'host' && socket.optional === true));
  assert.deepEqual(SPOTLIGHT_FIXTURE_IDS, SPOTLIGHT.nodes.filter(([, kind]) => kind === 'fixture').map(([id]) => id));
  assert.equal(SPOTLIGHT.edges.every(([, type, from, to]) => type === 'contains' && from === 'room.spotlight' && SPOTLIGHT_FIXTURE_IDS.includes(to)), true);
  assert.equal(SPOTLIGHT.edges.some(([, type]) => ['door', 'passage'].includes(type)), false);
});

test('Spotlight package is inert and does not import its experimental ancestry', async () => {
  const files = ['declaration.js', 'index.js', 'manifest.js', 'observation.js', 'replay.js'];
  for (const file of files) {
    const source = await readFile(new URL(`../src/places/hub/spotlight/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /experiments[\\/]/);
    assert.doesNotMatch(source, /fetch\(|process\.env|child_process/);
  }
  assert.equal(Object.isFrozen(SPOTLIGHT), true);
  assert.equal(Object.isFrozen(SPOTLIGHT.nodes), true);
  assert.equal(Object.isFrozen(SPOTLIGHT.edges), true);
});

test('Spotlight manifest rejects attempted self-installation, execution, and opened entrance', () => {
  const base = loadSpotlightManifest();
  for (const mutate of [
    value => { value.status.autoInstall = true; },
    value => { value.authority.selfAuthorize = true; },
    value => { value.placement.entrancePolicy = 'withheld'; },
    value => { value.affordanceGroups.push({ id: 'affordance.execute', fixtureId: 'fixture.spotlight_telescope', effect: 'execute', approvalPolicy: 'host_owned', requires: [], tools: ['spotlight_execute'] }); },
  ]) {
    const hostile = structuredClone(base);
    mutate(hostile);
    assert.equal(validateSpotlightManifest(hostile).ok, false);
  }
});
