import { canonicalize, sha256 } from '../core/hash.js';

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

export const INSTALLED_WORLD_NODES = deepFreeze([
  ['room.center', 'room', 'The Center. Packed sand lies under a low stone bench and a small tin cup; the Workshop door stands nearby.', { room: 'center' }, 'standing'],
  ['room.workshop', 'room', 'The Workshop. Shelves hold the repository close to a scarred workbench; a kiln, ledger, and clipboard keep their separate places. Tools are mounted here without engaging; engagement is orientation only.', { room: 'workshop' }, 'standing'],
  ['fixture.packed_sand', 'fixture', 'Packed sand makes the Center floor.', { material: 'packed_sand' }, 'standing'],
  ['fixture.stone_bench', 'fixture', 'A low stone bench carries the weight of the room.', { material: 'stone' }, 'standing'],
  ['object.tin_cup', 'object', 'A small tin cup. Its contents are unspecified.', { material: 'tin', contents: 'unspecified' }, 'standing'],
  ['fixture.workshop_shelves', 'fixture', 'Shelves hold the repository where it can be examined as it is.', { engageable: true, fixture: 'shelves' }, 'standing'],
  ['fixture.workshop_workbench', 'fixture', 'The workbench is a heavy surface for cuts and changes; pending cuts wait here for the Builder.', { engageable: true, fixture: 'workbench' }, 'standing'],
  ['fixture.workshop_kiln', 'fixture', 'The kiln accepts a named recipe and keeps its running state.', { engageable: true, fixture: 'kiln' }, 'standing'],
  ['fixture.workshop_ledger', 'fixture', 'The ledger keeps history, staging, and landing in one standing record.', { engageable: true, fixture: 'ledger' }, 'standing'],
  ['fixture.workshop_clipboard', 'fixture', 'The clipboard holds an objective, scope, and acceptance before work begins.', { engageable: true, fixture: 'clipboard' }, 'standing'],
  ['station.spec_table', 'station', 'Spec Table. Retired Workshop station.', { station: 'spec_table', retired: true }, 'retired'],
  ['station.control_panel', 'station', 'Control Panel. Retired Workshop station.', { station: 'control_panel', retired: true }, 'retired'],
]);

export const INSTALLED_WORLD_EDGES = deepFreeze([
  ['edge.door.workshop.center_to_workshop', 'door', 'room.center', 'room.workshop', 'door.workshop', 'Workshop'],
  ['edge.door.workshop.workshop_to_center', 'door', 'room.workshop', 'room.center', 'door.workshop', 'Center'],
  ['edge.contains.center.packed_sand', 'contains', 'room.center', 'fixture.packed_sand', null, null],
  ['edge.contains.center.stone_bench', 'contains', 'room.center', 'fixture.stone_bench', null, null],
  ['edge.contains.center.tin_cup', 'contains', 'room.center', 'object.tin_cup', null, null],
  ['edge.contains.workshop.shelves', 'contains', 'room.workshop', 'fixture.workshop_shelves', null, null],
  ['edge.contains.workshop.workbench', 'contains', 'room.workshop', 'fixture.workshop_workbench', null, null],
  ['edge.contains.workshop.kiln', 'contains', 'room.workshop', 'fixture.workshop_kiln', null, null],
  ['edge.contains.workshop.ledger', 'contains', 'room.workshop', 'fixture.workshop_ledger', null, null],
  ['edge.contains.workshop.clipboard', 'contains', 'room.workshop', 'fixture.workshop_clipboard', null, null],
]);

export function installedTopologyManifest() {
  return {
    nodes: INSTALLED_WORLD_NODES.map(([id, nodeType, residentText, state, lifecycle]) => ({
      id, nodeType, residentText, state, lifecycle, revision: 1,
    })),
    edges: INSTALLED_WORLD_EDGES.map(([id, edgeType, fromNodeId, toNodeId, doorIdentity, label]) => ({
      id, edgeType, fromNodeId, toNodeId, doorIdentity, label,
    })),
  };
}

export function installedTopologyHash() {
  return sha256(canonicalize(installedTopologyManifest()));
}

export function topologyEventPayload() {
  return { manifestSha256: installedTopologyHash(), ...installedTopologyManifest() };
}
