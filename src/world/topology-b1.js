import { canonicalize, sha256 } from '../core/hash.js';
import { CENTER_EXTENSION, HUB_CONTAINER } from '../places/hub/center.js';
import { GARDEN } from '../places/garden/index.js';
import { HOUSE } from '../places/house/index.js';
import { THRESHOLD } from '../places/threshold/index.js';

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

export const B1_WORLD_NODES = deepFreeze([
  HUB_CONTAINER.nodes[0], GARDEN.nodes[0], HOUSE.nodes[0], THRESHOLD.nodes[0],
  GARDEN.nodes[1], GARDEN.nodes[2], HOUSE.nodes[1], HOUSE.nodes[2], CENTER_EXTENSION.nodes[0], GARDEN.nodes[3],
]);

export const B1_WORLD_EDGES = deepFreeze([
  ...HUB_CONTAINER.edges, ...CENTER_EXTENSION.edges, GARDEN.edges[0], ...HOUSE.edges,
  ['edge.passage.center_garden', 'passage', 'room.center', 'place.garden', null, 'Garden opening'],
  ['edge.passage.garden_center', 'passage', 'place.garden', 'room.center', null, 'Hub opening'],
  ['edge.passage.garden_house', 'passage', 'place.garden', 'place.house', null, 'House front door'],
  ['edge.passage.house_garden', 'passage', 'place.house', 'place.garden', null, 'Garden front door'],
  ['edge.passage.house_threshold', 'passage', 'place.house', 'place.threshold', null, 'Threshold passage'],
  ['edge.passage.threshold_house', 'passage', 'place.threshold', 'place.house', null, 'House passage'],
  ...GARDEN.edges.slice(1),
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
  ...GARDEN.objectStates, ...HOUSE.objectStates,
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
