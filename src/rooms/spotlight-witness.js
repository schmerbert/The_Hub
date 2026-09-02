import { readFileSync } from 'node:fs';
import { canonicalize, sha256 } from '../core/hash.js';
import { SPOTLIGHT } from '../places/hub/spotlight/index.js';
import { INSTALLED_WORLD_EDGES, INSTALLED_WORLD_NODES } from '../world/topology.js';
import { B1_WORLD_EDGES, B1_WORLD_NODES } from '../world/topology-b1.js';
import { HEARTH_WORLD_EDGES, HEARTH_WORLD_NODES } from '../world/topology-hearth.js';
import { FOREST_WORLD_EDGES, FOREST_WORLD_NODES } from '../world/topology-forest.js';
import { BINDER_WINDOW_WORLD_EDGES, BINDER_WINDOW_WORLD_NODES } from '../world/topology-binder-window.js';
import { SPOTLIGHT_WORLD_EDGES, SPOTLIGHT_WORLD_NODES } from '../world/topology-spotlight.js';
import { SPOTLIGHT_DOOR_WORLD_EDGES } from '../world/topology-spotlight-door.js';
import { CEILING_WIRES, mountedToolNames } from '../world/ceiling.js';
import { TOOL_APPROVAL_CLASS, SPOTLIGHT_TOOLS } from '../world/tools.js';
import { WORLD_TOOL_HANDLER_NAMES } from '../world/gateway/dispatch.js';
import { buildRoomInstallationWitness } from './installation-witness.js';

const MANIFEST_URL = new URL('../places/hub/spotlight/room.json', import.meta.url);
const MANIFEST_BYTES = readFileSync(MANIFEST_URL, 'utf8');
const MANIFEST = JSON.parse(MANIFEST_BYTES);

export function spotlightInstallationWitness(overrides = {}) {
  const nodes = [
    ...INSTALLED_WORLD_NODES, ...B1_WORLD_NODES, ...HEARTH_WORLD_NODES,
    ...FOREST_WORLD_NODES, ...BINDER_WINDOW_WORLD_NODES, ...SPOTLIGHT_WORLD_NODES,
  ];
  const edges = [
    ...INSTALLED_WORLD_EDGES, ...B1_WORLD_EDGES, ...HEARTH_WORLD_EDGES,
    ...FOREST_WORLD_EDGES, ...BINDER_WINDOW_WORLD_EDGES, ...SPOTLIGHT_WORLD_EDGES, ...SPOTLIGHT_DOOR_WORLD_EDGES,
  ];
  const ceiling = new Set(CEILING_WIRES.map(wire => wire.name));
  const mounted = new Set(mountedToolNames('room.spotlight'));
  const handlers = new Set(WORLD_TOOL_HANDLER_NAMES);
  const schemas = new Map(SPOTLIGHT_TOOLS.map(schema => [schema.function.name, schema]));
  const toolNames = MANIFEST.affordanceGroups.flatMap(group => group.tools);
  const facts = {
    manifest: MANIFEST,
    manifestBytes: MANIFEST_BYTES,
    topology: {
      roomInstalled: nodes.some(([id]) => id === 'room.spotlight'),
      parentInstalled: nodes.some(([id]) => id === 'place.hub'),
      parentEdgeInstalled: edges.some(([, type, from, to]) => type === 'contains' && from === 'place.hub' && to === 'room.spotlight'),
      entranceInstalled: edges.some(([, type, from, to]) => ['door', 'passage'].includes(type) && ((from === 'room.center' && to === 'room.spotlight') || (from === 'room.spotlight' && to === 'room.center'))),
      requestedParent: MANIFEST.placement.requestedParent,
      entranceId: 'door.spotlight',
    },
    fixtures: SPOTLIGHT.nodes.filter(([, type]) => type === 'fixture').map(([id]) => id),
    tools: toolNames.map(name => ({
      name,
      ceiling: ceiling.has(name),
      mounted: mounted.has(name),
      schemaHash: schemas.has(name) ? sha256(canonicalize(schemas.get(name))) : null,
      handler: handlers.has(name),
      approvalClass: TOOL_APPROVAL_CLASS[name] || null,
    })),
    sockets: MANIFEST.sockets.map(socket => ({
      id: socket.id, capability: socket.capability, owner: 'host', state: 'optional_unwired', implementation: null,
    })),
    custody: MANIFEST.custody.map(route => ({
      id: route.id, owner: 'host', state: 'optional_unwired', implementation: null,
    })),
  };
  return buildRoomInstallationWitness({ ...facts, ...overrides });
}
