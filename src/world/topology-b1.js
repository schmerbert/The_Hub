import { canonicalize, sha256 } from '../core/hash.js';

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

export const B1_WORLD_NODES = deepFreeze([
  ['place.hub', 'place', 'The existing Hub container; not occupiable.', { occupiable: false, place: 'hub' }, 'standing', 1],
  ['place.garden', 'place', 'An exterior junction. The House is west, the Forest north, the Road east, and the Hub south.', { occupiable: true, place: 'garden' }, 'standing', 1],
  ['place.house', 'place', 'One undivided interior space. Its front door opens to the Garden. A blank window is set inside near the door.', { occupiable: true, place: 'house' }, 'standing', 1],
  ['place.threshold', 'place', 'A threshold adjoining the House. No arrival story is implied.', { occupiable: true, place: 'threshold' }, 'standing', 1],
  ['boundary.forest', 'boundary', 'The Forest is north. Crossing is not installed.', { occupiable: false, traversable: false }, 'standing', 1],
  ['boundary.road', 'boundary', 'The Road continues east out of sight. Crossing is not installed.', { occupiable: false, traversable: false }, 'standing', 1],
  ['object.front_door', 'object', 'The front door joins the Garden and House.', { object: 'front_door' }, 'standing', 1],
  ['fixture.house_window', 'fixture', 'A blank interior window is set near the front door.', { fixture: 'house_window' }, 'standing', 1],
  ['object.marker', 'object', 'A marker is present in the Center.', { object: 'marker' }, 'standing', 1],
  ['fixture.garden_turning_stone', 'fixture', 'A stone in the Garden can be turned.', { engageable: false, turnable: true }, 'standing', 1],
]);

export const B1_WORLD_EDGES = deepFreeze([
  ['edge.contains.hub_center', 'contains', 'place.hub', 'room.center', null, 'Center'],
  ['edge.contains.hub_workshop', 'contains', 'place.hub', 'room.workshop', null, 'Workshop'],
  ['edge.contains.center_marker', 'contains', 'room.center', 'object.marker', null, 'Marker'],
  ['edge.contains.garden_stone', 'contains', 'place.garden', 'fixture.garden_turning_stone', null, 'Turning stone'],
  ['edge.contains.house_window', 'contains', 'place.house', 'fixture.house_window', null, 'Blank window'],
  ['edge.contains.garden_front_door', 'contains', 'place.garden', 'object.front_door', null, 'Front door'],
  ['edge.contains.house_front_door', 'contains', 'place.house', 'object.front_door', null, 'Front door'],
  ['edge.passage.center_garden', 'passage', 'room.center', 'place.garden', null, 'Garden opening'],
  ['edge.passage.garden_center', 'passage', 'place.garden', 'room.center', null, 'Hub opening'],
  ['edge.passage.garden_house', 'passage', 'place.garden', 'place.house', null, 'House front door'],
  ['edge.passage.house_garden', 'passage', 'place.house', 'place.garden', null, 'Garden front door'],
  ['edge.passage.house_threshold', 'passage', 'place.house', 'place.threshold', null, 'Threshold passage'],
  ['edge.passage.threshold_house', 'passage', 'place.threshold', 'place.house', null, 'House passage'],
  ['edge.boundary.garden_forest', 'boundary', 'place.garden', 'boundary.forest', null, 'Forest boundary'],
  ['edge.boundary.garden_road', 'boundary', 'place.garden', 'boundary.road', null, 'Road boundary'],
]);

export const B1_WORLD_PASSAGES = deepFreeze([
  { edgeId: 'edge.passage.center_garden', passageId: 'passage.center_garden', passageKind: 'opening', fromNodeId: 'room.center', toNodeId: 'place.garden', governedObjectId: null },
  { edgeId: 'edge.passage.garden_center', passageId: 'passage.center_garden', passageKind: 'opening', fromNodeId: 'place.garden', toNodeId: 'room.center', governedObjectId: null },
  { edgeId: 'edge.passage.garden_house', passageId: 'passage.garden_house', passageKind: 'door', fromNodeId: 'place.garden', toNodeId: 'place.house', governedObjectId: 'object.front_door' },
  { edgeId: 'edge.passage.house_garden', passageId: 'passage.garden_house', passageKind: 'door', fromNodeId: 'place.house', toNodeId: 'place.garden', governedObjectId: 'object.front_door' },
  { edgeId: 'edge.passage.house_threshold', passageId: 'passage.house_threshold', passageKind: 'threshold', fromNodeId: 'place.house', toNodeId: 'place.threshold', governedObjectId: null },
  { edgeId: 'edge.passage.threshold_house', passageId: 'passage.house_threshold', passageKind: 'threshold', fromNodeId: 'place.threshold', toNodeId: 'place.house', governedObjectId: null },
]);

export const B1_WORLD_OBJECT_STATES = deepFreeze([
  { objectId: 'fixture.garden_turning_stone', state: { turnCount: 0 }, revision: 1 },
  { objectId: 'object.front_door', state: { locked: false, open: false }, revision: 1 },
]);

export function extendedTopologyManifest() {
  return {
    nodes: B1_WORLD_NODES.map(([id, nodeType, residentText, state, lifecycle, revision]) => ({ id, nodeType, residentText, state: structuredClone(state), lifecycle, revision })),
    edges: B1_WORLD_EDGES.map(([id, edgeType, fromNodeId, toNodeId, doorIdentity, label]) => ({ id, edgeType, fromNodeId, toNodeId, doorIdentity, label })),
    passages: B1_WORLD_PASSAGES.map(row => ({ ...row })),
    objectStates: B1_WORLD_OBJECT_STATES.map(row => ({ ...row, state: structuredClone(row.state) })),
  };
}

export function extendedTopologyHash() { return sha256(canonicalize(extendedTopologyManifest())); }

export function topologyExtensionEventPayload() {
  return { manifestSha256: extendedTopologyHash(), ...extendedTopologyManifest() };
}
