import { readFileSync } from 'node:fs';
import { canonicalize, sha256 } from '../core/hash.js';
import { WORKSHOP } from '../places/hub/workshop/index.js';
import { INSTALLED_WORLD_EDGES, INSTALLED_WORLD_NODES } from '../world/topology.js';
import { B1_WORLD_EDGES, B1_WORLD_NODES } from '../world/topology-b1.js';
import { CEILING_WIRES, mountedToolNames } from '../world/ceiling.js';
import { TOOL_APPROVAL_CLASS, WORKSHOP_TOOLS } from '../world/tools.js';
import { WORLD_TOOL_HANDLER_NAMES } from '../world/gateway/dispatch.js';
import { buildRoomInstallationWitness } from './installation-witness.js';

const MANIFEST_URL = new URL('../places/hub/workshop/room.json', import.meta.url);
const MANIFEST_BYTES = readFileSync(MANIFEST_URL, 'utf8');
const MANIFEST = JSON.parse(MANIFEST_BYTES);

export function workshopInstallationWitness(overrides = {}) {
  const nodes = [...INSTALLED_WORLD_NODES, ...B1_WORLD_NODES];
  const edges = [...INSTALLED_WORLD_EDGES, ...B1_WORLD_EDGES];
  const ceiling = new Set(CEILING_WIRES.map(wire => wire.name));
  const mounted = new Set(mountedToolNames('room.workshop'));
  const handlers = new Set(WORLD_TOOL_HANDLER_NAMES);
  const schemas = new Map(WORKSHOP_TOOLS.map(schema => [schema.function.name, schema]));
  const toolNames = MANIFEST.affordanceGroups.flatMap(group => group.tools);
  const facts = {
    manifest: MANIFEST,
    manifestBytes: MANIFEST_BYTES,
    topology: {
      roomInstalled: nodes.some(([id]) => id === 'room.workshop'),
      parentInstalled: nodes.some(([id]) => id === 'place.hub'),
      parentEdgeInstalled: edges.some(([, type, from, to]) => type === 'contains' && from === 'place.hub' && to === 'room.workshop'),
      entranceInstalled: edges.some(([, type, from, to, door]) => type === 'door' && from === 'room.center' && to === 'room.workshop' && door === 'door.workshop'),
      requestedParent: MANIFEST.placement.requestedParent,
      entranceId: 'door.workshop',
    },
    fixtures: WORKSHOP.nodes.filter(([, type]) => type === 'fixture').map(([id]) => id),
    tools: toolNames.map(name => ({
      name,
      ceiling: ceiling.has(name),
      mounted: mounted.has(name),
      schemaHash: schemas.has(name) ? sha256(canonicalize(schemas.get(name))) : null,
      handler: handlers.has(name),
      approvalClass: TOOL_APPROVAL_CLASS[name] || null,
    })),
    sockets: [
      { id: 'socket.repository_root', capability: 'repository.local', owner: 'host', state: 'installed', implementation: 'WorkshopAdapter' },
      { id: 'socket.world_crossing', capability: 'world.event_crossing', owner: 'host', state: 'installed', implementation: 'WorldActionGateway + WorldGraphStore' },
      { id: 'socket.result_custody', capability: 'custody.result_rack', owner: 'host', state: 'installed', implementation: 'ResultRackStore' },
      { id: 'socket.forest_admission', capability: 'custody.forest_wild', owner: 'host', state: 'optional_unwired', implementation: 'ForestStore when active' },
      { id: 'socket.builder_approval', capability: 'approval.builder', owner: 'host', state: 'installed', implementation: 'World approval ledger + Gateway' },
      { id: 'socket.recipe_execution', capability: 'execution.recipe', owner: 'host', state: 'installed', implementation: 'RecipeRunner or SandboxRecipeRunner' },
    ],
    custody: [
      { id: 'custody.world_receipts', owner: 'host', state: 'installed', implementation: 'World action/event receipts' },
      { id: 'custody.result_rack', owner: 'host', state: 'installed', implementation: 'ResultRackStore + host-return Scrub' },
      { id: 'custody.forest_wild', owner: 'host', state: 'optional_unwired', implementation: 'Forest Wild admission when active' },
    ],
  };
  return buildRoomInstallationWitness({ ...facts, ...overrides });
}
