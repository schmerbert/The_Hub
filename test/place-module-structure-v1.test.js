import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PLACE_MODULES, placeModuleById } from '../src/places/index.js';
import { ROOM_PROFILES } from '../src/world/ceiling.js';
import { installedTopologyHash } from '../src/world/topology.js';
import { extendedTopologyHash } from '../src/world/topology-b1.js';
import { hearthTopologyHash } from '../src/world/topology-hearth.js';

test('place declarations are inert, immutable, uniquely fitted modules', async () => {
  const ids = PLACE_MODULES.map(module => module.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(PLACE_MODULES.every(module => Object.isFrozen(module) && Object.isFrozen(module.nodes) && Object.isFrozen(module.edges)), true);
  for (const module of PLACE_MODULES) assert.equal(placeModuleById(module.id), module);
  for (const relative of ['../src/places/hub/center.js','../src/places/hub/workshop.js','../src/places/garden/index.js','../src/places/house/index.js','../src/places/threshold/index.js']) {
    const source = await readFile(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
    assert.doesNotMatch(source, /from ['"].*(runtime|server|providers|ledger|spine|forest)\//);
    assert.doesNotMatch(source, /\b(sqlite|fetch|process\.env)\b/);
  }
});

test('place-owned capability declarations match the installed Patch Bay profiles', () => {
  for (const id of ['room.center','place.garden','place.house','place.threshold']) {
    assert.deepEqual(ROOM_PROFILES[id], placeModuleById(id).mountedTools);
  }
  assert.ok(ROOM_PROFILES['room.workshop'].length > 1);
});

test('place extraction preserves all canonical installed topology hashes', () => {
  assert.equal(installedTopologyHash(), '2445a30ef6a95dd254552e9017ccea3ae293b836757c9d4844a123eb1903e8b6');
  assert.equal(extendedTopologyHash(), '9f791d2de1bcfd66169ca8514793fdd7ddfe76633209ec3b64d7b5fa469d82b1');
  assert.equal(hearthTopologyHash(), '82b1b441c733eec16caea4247841be99a0556bfd9bc819ab7679f2f492e87bd5');
});
