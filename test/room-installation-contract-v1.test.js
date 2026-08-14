import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateRoomInstallationManifest } from '../src/rooms/installation-contract.js';
import { WORKSHOP } from '../src/places/hub/workshop/index.js';
import { CEILING_WIRES, mountedToolNames } from '../src/world/ceiling.js';
import { WORLD_TOOL_HANDLER_NAMES } from '../src/world/gateway/dispatch.js';

const MANIFEST_URL = new URL('../src/places/hub/workshop/room.json', import.meta.url);

async function manifest() {
  return JSON.parse(await readFile(MANIFEST_URL, 'utf8'));
}

test('Workshop carries a valid inert installation request, not self-installing authority', async () => {
  const value = await manifest();
  assert.deepEqual(validateRoomInstallationManifest(value), { ok: true, errors: [] });
  assert.equal(value.identity.id, WORKSHOP.id);
  assert.equal(value.status.autoInstall, false);
  assert.equal(value.placement.hostOwnsDoor, true);
  assert.deepEqual(value.authority, { selfInstall: false, selfAuthorize: false, ambientAuthority: false });
});

test('Workshop manifest accounts for every and only installed Workshop affordance', async () => {
  const value = await manifest();
  const declared = value.affordanceGroups.flatMap(group => group.tools).sort();
  const ceiling = CEILING_WIRES.map(wire => wire.name).filter(name => name.startsWith('workshop_')).sort();
  const mounted = mountedToolNames('room.workshop').filter(name => name.startsWith('workshop_')).sort();
  const handlers = WORLD_TOOL_HANDLER_NAMES.filter(name => name.startsWith('workshop_')).sort();
  assert.deepEqual(declared, ceiling);
  assert.deepEqual(declared, mounted);
  assert.deepEqual(declared, handlers);
});

test('Workshop sockets and fixtures name only package or host-owned crossings', async () => {
  const value = await manifest();
  const fixtureIds = new Set(WORKSHOP.nodes.filter(([, kind]) => kind === 'fixture').map(([id]) => id));
  for (const socket of value.sockets) assert.equal(socket.suppliedBy, 'host', socket.id);
  for (const group of value.affordanceGroups) assert.equal(fixtureIds.has(group.fixtureId), true, group.fixtureId);
  for (const route of value.custody) assert.equal(route.installedBy, 'host', route.id);
});

test('contract refuses manifests that smuggle installation, authority, paths, or duplicate tools', async () => {
  const base = await manifest();
  for (const mutate of [
    value => { value.status.autoInstall = true; },
    value => { value.authority.selfAuthorize = true; },
    value => { value.package.entrypoint = '../escape.js'; },
    value => { value.placement.hostOwnsDoor = false; },
    value => { value.sockets[0].suppliedBy = 'room'; },
    value => { value.affordanceGroups[1].tools.push(value.affordanceGroups[0].tools[0]); },
    value => { value.custody[0].installedBy = 'room'; },
  ]) {
    const hostile = structuredClone(base);
    mutate(hostile);
    assert.equal(validateRoomInstallationManifest(hostile).ok, false);
  }
});
