import { canonicalize, sha256 } from '../core/hash.js';
import { HEARTH } from '../places/house/index.js';

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

export const HEARTH_WORLD_NODES = deepFreeze([
  ...HEARTH.nodes,
]);

export const HEARTH_WORLD_EDGES = deepFreeze([
  ...HEARTH.edges,
]);

export function hearthTopologyManifest() {
  return {
    nodes: HEARTH_WORLD_NODES.map(([id, nodeType, residentText, state, lifecycle, revision]) => ({ id, nodeType, residentText, state: structuredClone(state), lifecycle, revision })),
    edges: HEARTH_WORLD_EDGES.map(([id, edgeType, fromNodeId, toNodeId, doorIdentity, label]) => ({ id, edgeType, fromNodeId, toNodeId, doorIdentity, label })),
  };
}

export function hearthTopologyHash() { return sha256(canonicalize(hearthTopologyManifest())); }

export function hearthTopologyEventPayload() {
  return { manifestSha256: hearthTopologyHash(), ...hearthTopologyManifest() };
}
