import { canonicalize, sha256 } from '../core/hash.js';
import { SPOTLIGHT } from '../places/hub/spotlight/index.js';

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

// The observatory is deliberately a World shell.  These declarations describe
// material presence only; they do not mount a socket, tool, passage, or door.
export const SPOTLIGHT_WORLD_NODES = deepFreeze(SPOTLIGHT.nodes.map(node => [...node, 1]));

export const SPOTLIGHT_WORLD_EDGES = deepFreeze([
  ['edge.contains.hub_spotlight', 'contains', 'place.hub', 'room.spotlight', null, 'Spotlight observatory'],
  ...SPOTLIGHT.edges,
]);

export function spotlightTopologyManifest() {
  return {
    nodes: SPOTLIGHT_WORLD_NODES.map(([id, nodeType, residentText, state, lifecycle, revision]) => ({
      id, nodeType, residentText, state: structuredClone(state), lifecycle, revision,
    })),
    edges: SPOTLIGHT_WORLD_EDGES.map(([id, edgeType, fromNodeId, toNodeId, doorIdentity, label]) => ({
      id, edgeType, fromNodeId, toNodeId, doorIdentity, label,
    })),
  };
}

export function spotlightTopologyHash() {
  return sha256(canonicalize(spotlightTopologyManifest()));
}

export function spotlightTopologyEventPayload() {
  return { manifestSha256: spotlightTopologyHash(), ...spotlightTopologyManifest() };
}
