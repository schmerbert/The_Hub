import { canonicalize, sha256 } from '../core/hash.js';

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

// The door is a host-owned World crossing.  It is deliberately separate from
// the Spotlight shell event so the room can become enterable without rewriting
// the exact shell ancestry already installed in older Worlds.
export const SPOTLIGHT_DOOR_WORLD_EDGES = deepFreeze([
  ['edge.door.spotlight.center_to_spotlight', 'door', 'room.center', 'room.spotlight', 'door.spotlight', 'Spotlight Observatory'],
  ['edge.door.spotlight.spotlight_to_center', 'door', 'room.spotlight', 'room.center', 'door.spotlight', 'Center'],
]);

export function spotlightDoorTopologyManifest() {
  return {
    edges: SPOTLIGHT_DOOR_WORLD_EDGES.map(([id, edgeType, fromNodeId, toNodeId, doorIdentity, label]) => ({
      id, edgeType, fromNodeId, toNodeId, doorIdentity, label,
    })),
  };
}

export function spotlightDoorTopologyHash() {
  return sha256(canonicalize(spotlightDoorTopologyManifest()));
}

export function spotlightDoorTopologyEventPayload() {
  return { manifestSha256: spotlightDoorTopologyHash(), ...spotlightDoorTopologyManifest() };
}
