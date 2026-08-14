import { canonicalize, sha256 } from '../core/hash.js';
import { CENTER } from '../places/hub/center.js';
import { WORKSHOP } from '../places/hub/workshop.js';

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

export const INSTALLED_WORLD_NODES = deepFreeze([
  CENTER.nodes[0], WORKSHOP.nodes[0], ...CENTER.nodes.slice(1), ...WORKSHOP.nodes.slice(1),
]);

export const INSTALLED_WORLD_EDGES = deepFreeze([
  ['edge.door.workshop.center_to_workshop', 'door', 'room.center', 'room.workshop', 'door.workshop', 'Workshop'],
  ['edge.door.workshop.workshop_to_center', 'door', 'room.workshop', 'room.center', 'door.workshop', 'Center'],
  ...CENTER.edges, ...WORKSHOP.edges,
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
