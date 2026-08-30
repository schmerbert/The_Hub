import { canonicalize, sha256 } from '../core/hash.js';
import { BINDER_WINDOW } from '../places/hub/center.js';

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

// This declaration is intentionally limited to one Center fixture and one
// containment edge. It does not reserve a Spotlight room, threshold, door,
// passage, socket, or action wire.
export const BINDER_WINDOW_WORLD_NODES = deepFreeze([...BINDER_WINDOW.nodes]);
export const BINDER_WINDOW_WORLD_EDGES = deepFreeze([...BINDER_WINDOW.edges]);

export function binderWindowTopologyManifest() {
  return {
    nodes: BINDER_WINDOW_WORLD_NODES.map(([id, nodeType, residentText, state, lifecycle, revision]) => ({
      id, nodeType, residentText, state: structuredClone(state), lifecycle, revision,
    })),
    edges: BINDER_WINDOW_WORLD_EDGES.map(([id, edgeType, fromNodeId, toNodeId, doorIdentity, label]) => ({
      id, edgeType, fromNodeId, toNodeId, doorIdentity, label,
    })),
  };
}

export function binderWindowTopologyHash() {
  return sha256(canonicalize(binderWindowTopologyManifest()));
}

export function binderWindowTopologyEventPayload() {
  return { manifestSha256: binderWindowTopologyHash(), ...binderWindowTopologyManifest() };
}
