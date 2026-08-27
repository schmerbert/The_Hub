import { canonicalize, sha256 } from '../core/hash.js';
import { FOREST_PLACE } from '../places/forest/index.js';

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

export const FOREST_WORLD_NODES = deepFreeze([...FOREST_PLACE.nodes]);
export const FOREST_WORLD_EDGES = deepFreeze([
  ['edge.passage.garden_forest', 'passage', 'place.garden', 'place.forest', null, 'Path to the Forest'],
  ['edge.passage.forest_garden', 'passage', 'place.forest', 'place.garden', null, 'Path to the Garden'],
]);
export const FOREST_WORLD_PASSAGES = deepFreeze([
  { edgeId: 'edge.passage.garden_forest', passageId: 'passage.garden_forest', passageKind: 'opening', fromNodeId: 'place.garden', toNodeId: 'place.forest', governedObjectId: null },
  { edgeId: 'edge.passage.forest_garden', passageId: 'passage.garden_forest', passageKind: 'opening', fromNodeId: 'place.forest', toNodeId: 'place.garden', governedObjectId: null },
]);

export function forestTopologyManifest() {
  return {
    nodes: FOREST_WORLD_NODES.map(([id, nodeType, residentText, state, lifecycle, revision]) => ({ id, nodeType, residentText, state: structuredClone(state), lifecycle, revision })),
    edges: FOREST_WORLD_EDGES.map(([id, edgeType, fromNodeId, toNodeId, doorIdentity, label]) => ({ id, edgeType, fromNodeId, toNodeId, doorIdentity, label })),
    passages: FOREST_WORLD_PASSAGES.map(row => ({ ...row })),
  };
}
export function forestTopologyHash() { return sha256(canonicalize(forestTopologyManifest())); }
export function forestTopologyEventPayload() { return { manifestSha256: forestTopologyHash(), ...forestTopologyManifest() }; }
