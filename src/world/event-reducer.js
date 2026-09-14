import { canonicalize, sha256 } from '../core/hash.js';
import { installedTopologyHash, installedTopologyManifest } from './topology.js';
import { extendedTopologyHash, extendedTopologyManifest } from './topology-b1.js';
import { hearthTopologyHash, hearthTopologyManifest } from './topology-hearth.js';
import { forestTopologyHash, forestTopologyManifest } from './topology-forest.js';
import { binderWindowTopologyHash, binderWindowTopologyManifest } from './topology-binder-window.js';
import { spotlightTopologyHash, spotlightTopologyManifest } from './topology-spotlight.js';
import { spotlightDoorTopologyHash, spotlightDoorTopologyManifest } from './topology-spotlight-door.js';
import {
  WORLD_EVENT_KINDS,
  NODE_COLUMNS,
  EDGE_COLUMNS,
  LOCATION_COLUMNS,
  FIXTURE_RUNTIME_COLUMNS,
  TIMER_COLUMNS,
  BRIEF_COLUMNS,
  APPROVAL_COLUMNS,
} from './event-contract.js';

export function emptyWorldState() { return { nodes: [], edges: [], locations: [], fixtureRuntimes: [], timers: [], briefs: [], approvals: [], passages: [], objectStates: [], legacyCustody: { actionReceipts: [], approvalReceipts: [] }, rootBoundary: null, operationalBoundary: null, topologyExtension: null, hearthExtension: null, forestExtension: null, binderWindowExtension: null, spotlightExtension: null, spotlightDoorExtension: null }; }
function copyState(state) {
  return {
    nodes: state.nodes.map(row => ({ ...row })), edges: state.edges.map(row => ({ ...row })), locations: state.locations.map(row => ({ ...row })),
    fixtureRuntimes: state.fixtureRuntimes.map(row => ({ ...row })), timers: state.timers.map(row => ({ ...row })), briefs: state.briefs.map(row => ({ ...row })), approvals: state.approvals.map(row => ({ ...row })),
    passages: (state.passages || []).map(row => ({ ...row })), objectStates: (state.objectStates || []).map(row => ({ ...row })),
    legacyCustody: { actionReceipts: state.legacyCustody.actionReceipts.map(row => ({ ...row })), approvalReceipts: state.legacyCustody.approvalReceipts.map(row => ({ ...row })) },
    operationalBoundary: state.operationalBoundary ? { ...state.operationalBoundary } : null,
    topologyExtension: state.topologyExtension ? { ...state.topologyExtension } : null,
    hearthExtension: state.hearthExtension ? { ...state.hearthExtension } : null,
    forestExtension: state.forestExtension ? { ...state.forestExtension } : null,
    binderWindowExtension: state.binderWindowExtension ? { ...state.binderWindowExtension } : null,
    spotlightExtension: state.spotlightExtension ? { ...state.spotlightExtension } : null,
    spotlightDoorExtension: state.spotlightDoorExtension ? { ...state.spotlightDoorExtension } : null,
    rootBoundary: state.rootBoundary || null,
  };
}
function canonicalObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value;
}
function exactKeys(value, keys, label) {
  const actual = Object.keys(value).sort(); const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new Error(`${label} fields are not installed.`);
}
function requiredString(value, label, { nullable = false } = {}) {
  if (nullable && value === null) return;
  if (typeof value !== 'string' || !value) throw new Error(`${label} must be a non-empty string.`);
}
function pointer(event) { return { last_event_sequence: event.sequence, last_event_hash: event.event_hash }; }
function findBy(rows, column, value) { return rows.find(row => row[column] === value); }
function replaceBy(rows, column, value, next) { return rows.map(row => row[column] === value ? next : row); }

function topologyRows(payload, event) {
  exactKeys(payload, ['manifestSha256', 'nodes', 'edges'], 'topology payload');
  if (!Array.isArray(payload.nodes) || !Array.isArray(payload.edges)) throw new Error('Topology payload rows are invalid.');
  const nodes = payload.nodes.map(node => {
    exactKeys(node, ['id', 'nodeType', 'residentText', 'state', 'lifecycle', 'revision'], 'topology node');
    canonicalObject(node, 'topology node'); requiredString(node.id, 'topology node id'); requiredString(node.nodeType, 'topology node type'); requiredString(node.residentText, 'topology resident text');
    if (!node.state || typeof node.state !== 'object' || Array.isArray(node.state)) throw new Error('Topology node state is invalid.');
    if (!['standing', 'retired'].includes(node.lifecycle) || node.revision !== 1) throw new Error('Topology node lifecycle or revision is invalid.');
    return { id: node.id, node_type: node.nodeType, resident_text: node.residentText, state_json: canonicalize(node.state), lifecycle: node.lifecycle, revision: 1, created_at: event.occurred_at, ...pointer(event) };
  });
  const edges = payload.edges.map(edge => {
    exactKeys(edge, ['id', 'edgeType', 'fromNodeId', 'toNodeId', 'doorIdentity', 'label'], 'topology edge');
    canonicalObject(edge, 'topology edge'); requiredString(edge.id, 'topology edge id'); requiredString(edge.edgeType, 'topology edge type'); requiredString(edge.fromNodeId, 'topology edge source'); requiredString(edge.toNodeId, 'topology edge target');
    if (edge.doorIdentity !== null) requiredString(edge.doorIdentity, 'topology door identity');
    if (edge.label !== null) requiredString(edge.label, 'topology edge label');
    return { id: edge.id, edge_type: edge.edgeType, from_node_id: edge.fromNodeId, to_node_id: edge.toNodeId, door_identity: edge.doorIdentity, label: edge.label, created_at: event.occurred_at, ...pointer(event) };
  });
  const manifest = { nodes: payload.nodes, edges: payload.edges };
  if (payload.manifestSha256 !== sha256(canonicalize(manifest))) throw new Error('Installed topology manifest hash is invalid.');
  if (payload.manifestSha256 !== installedTopologyHash()) throw new Error('Installed topology does not match the code-owned manifest.');
  if (new Set(nodes.map(row => row.id)).size !== nodes.length || new Set(edges.map(row => row.id)).size !== edges.length) throw new Error('Topology contains duplicate identities.');
  const ids = new Set(nodes.map(row => row.id));
  if (edges.some(row => !ids.has(row.from_node_id) || !ids.has(row.to_node_id))) throw new Error('Topology edge references an absent node.');
  return { nodes: nodes.sort((a, b) => a.id.localeCompare(b.id)), edges: edges.sort((a, b) => a.id.localeCompare(b.id)) };
}

function topologyExtensionRows(payload, event, priorState) {
  exactKeys(payload, ['manifestSha256', 'nodes', 'edges', 'passages', 'objectStates'], 'topology extension payload');
  if (!Array.isArray(payload.nodes) || !Array.isArray(payload.edges) || !Array.isArray(payload.passages) || !Array.isArray(payload.objectStates)) throw new Error('Topology extension payload rows are invalid.');
  const manifest = { nodes: payload.nodes, edges: payload.edges, passages: payload.passages, objectStates: payload.objectStates };
  if (payload.manifestSha256 !== sha256(canonicalize(manifest)) || payload.manifestSha256 !== extendedTopologyHash()) throw new Error('Topology extension does not match the code-owned manifest.');
  if (canonicalize(manifest) !== canonicalize(extendedTopologyManifest())) throw new Error('Topology extension manifest bytes are not installed.');
  const installedIds = new Set(priorState.nodes.map(row => row.id));
  const nodes = payload.nodes.map(node => {
    exactKeys(node, ['id', 'nodeType', 'residentText', 'state', 'lifecycle', 'revision'], 'extension node');
    requiredString(node.id, 'extension node id'); requiredString(node.nodeType, 'extension node type'); requiredString(node.residentText, 'extension resident text'); canonicalObject(node.state, 'extension node state');
    if (!['place', 'boundary', 'fixture', 'object'].includes(node.nodeType) || node.lifecycle !== 'standing' || node.revision !== 1 || installedIds.has(node.id)) throw new Error('Extension node identity, kind, lifecycle, or revision is invalid.');
    installedIds.add(node.id);
    return { id: node.id, node_type: node.nodeType, resident_text: node.residentText, state_json: canonicalize(node.state), lifecycle: node.lifecycle, revision: 1, created_at: event.occurred_at, ...pointer(event) };
  });
  const edgeIds = new Set(priorState.edges.map(row => row.id));
  const edges = payload.edges.map(edge => {
    exactKeys(edge, ['id', 'edgeType', 'fromNodeId', 'toNodeId', 'doorIdentity', 'label'], 'extension edge');
    requiredString(edge.id, 'extension edge id'); requiredString(edge.edgeType, 'extension edge type'); requiredString(edge.fromNodeId, 'extension edge source'); requiredString(edge.toNodeId, 'extension edge target');
    if (!['contains', 'passage', 'boundary'].includes(edge.edgeType) || edgeIds.has(edge.id) || !installedIds.has(edge.fromNodeId) || !installedIds.has(edge.toNodeId)) throw new Error('Extension edge identity, kind, or endpoint is invalid.');
    if (edge.doorIdentity !== null) requiredString(edge.doorIdentity, 'extension door identity');
    if (edge.label !== null) requiredString(edge.label, 'extension edge label');
    edgeIds.add(edge.id);
    return { id: edge.id, edge_type: edge.edgeType, from_node_id: edge.fromNodeId, to_node_id: edge.toNodeId, door_identity: edge.doorIdentity, label: edge.label, created_at: event.occurred_at, ...pointer(event) };
  });
  const edgeById = new Map(edges.map(row => [row.id, row]));
  const passages = payload.passages.map(row => {
    exactKeys(row, ['edgeId', 'passageId', 'passageKind', 'fromNodeId', 'toNodeId', 'governedObjectId'], 'extension passage');
    requiredString(row.edgeId, 'passage edge'); requiredString(row.passageId, 'passage identity'); requiredString(row.passageKind, 'passage kind'); requiredString(row.fromNodeId, 'passage source'); requiredString(row.toNodeId, 'passage target');
    if (row.governedObjectId !== null) requiredString(row.governedObjectId, 'passage governed object');
    const edge = edgeById.get(row.edgeId);
    if (!edge || edge.edge_type !== 'passage' || edge.from_node_id !== row.fromNodeId || edge.to_node_id !== row.toNodeId || !['opening', 'door', 'threshold'].includes(row.passageKind) || (row.governedObjectId !== null && !installedIds.has(row.governedObjectId))) throw new Error('Passage definition does not match its installed edge.');
    return { edge_id: row.edgeId, passage_id: row.passageId, passage_kind: row.passageKind, from_node_id: row.fromNodeId, to_node_id: row.toNodeId, governed_object_id: row.governedObjectId, ...pointer(event) };
  });
  if (new Set(passages.map(row => row.edge_id)).size !== passages.length) throw new Error('Topology extension contains duplicate passage routes.');
  const objectStates = payload.objectStates.map(row => {
    exactKeys(row, ['objectId', 'state', 'revision'], 'extension object state'); requiredString(row.objectId, 'object state identity'); canonicalObject(row.state, 'object state');
    if (row.revision !== 1 || !installedIds.has(row.objectId)) throw new Error('Extension object state identity or revision is invalid.');
    return { object_id: row.objectId, state_json: canonicalize(row.state), revision: 1, updated_at: event.occurred_at, ...pointer(event) };
  });
  if (new Set(objectStates.map(row => row.object_id)).size !== objectStates.length) throw new Error('Topology extension contains duplicate object states.');
  return { nodes, edges, passages, objectStates };
}

function hearthExtensionRows(payload, event, priorState) {
  exactKeys(payload, ['manifestSha256', 'nodes', 'edges'], 'Hearth topology payload');
  const manifest = { nodes: payload.nodes, edges: payload.edges };
  if (payload.manifestSha256 !== sha256(canonicalize(manifest)) || payload.manifestSha256 !== hearthTopologyHash() || canonicalize(manifest) !== canonicalize(hearthTopologyManifest())) throw new Error('Hearth topology does not match the code-owned manifest.');
  const installedIds = new Set(priorState.nodes.map(row => row.id));
  const nodes = payload.nodes.map(node => {
    exactKeys(node, ['id', 'nodeType', 'residentText', 'state', 'lifecycle', 'revision'], 'Hearth node');
    if (node.id !== 'fixture.hearth' || node.nodeType !== 'fixture' || node.lifecycle !== 'standing' || node.revision !== 1 || installedIds.has(node.id)) throw new Error('Hearth node is invalid.');
    canonicalObject(node.state, 'Hearth node state'); installedIds.add(node.id);
    return { id: node.id, node_type: node.nodeType, resident_text: node.residentText, state_json: canonicalize(node.state), lifecycle: node.lifecycle, revision: 1, created_at: event.occurred_at, ...pointer(event) };
  });
  const edgeIds = new Set(priorState.edges.map(row => row.id));
  const edges = payload.edges.map(edge => {
    exactKeys(edge, ['id', 'edgeType', 'fromNodeId', 'toNodeId', 'doorIdentity', 'label'], 'Hearth edge');
    if (edge.id !== 'edge.contains.house_hearth' || edge.edgeType !== 'contains' || edge.fromNodeId !== 'place.house' || edge.toNodeId !== 'fixture.hearth' || edge.doorIdentity !== null || edgeIds.has(edge.id) || !installedIds.has(edge.fromNodeId) || !installedIds.has(edge.toNodeId)) throw new Error('Hearth containment is invalid.');
    return { id: edge.id, edge_type: edge.edgeType, from_node_id: edge.fromNodeId, to_node_id: edge.toNodeId, door_identity: null, label: edge.label, created_at: event.occurred_at, ...pointer(event) };
  });
  return { nodes, edges };
}

function forestExtensionRows(payload, event, priorState) {
  exactKeys(payload, ['manifestSha256', 'nodes', 'edges', 'passages'], 'Forest topology payload');
  const manifest = { nodes: payload.nodes, edges: payload.edges, passages: payload.passages };
  if (payload.manifestSha256 !== sha256(canonicalize(manifest)) || payload.manifestSha256 !== forestTopologyHash() || canonicalize(manifest) !== canonicalize(forestTopologyManifest())) throw new Error('Forest topology does not match the code-owned manifest.');
  if (!priorState.hearthExtension || priorState.forestExtension) throw new Error('Forest topology requires the Hearth generation and may be installed only once.');
  const installedIds = new Set(priorState.nodes.map(row => row.id));
  const nodes = payload.nodes.map(node => {
    exactKeys(node, ['id', 'nodeType', 'residentText', 'state', 'lifecycle', 'revision'], 'Forest node');
    if (node.id !== 'place.forest' || node.nodeType !== 'place' || node.lifecycle !== 'standing' || node.revision !== 1 || installedIds.has(node.id)) throw new Error('Forest place node is invalid.');
    canonicalObject(node.state, 'Forest place state'); installedIds.add(node.id);
    return { id: node.id, node_type: node.nodeType, resident_text: node.residentText, state_json: canonicalize(node.state), lifecycle: node.lifecycle, revision: 1, created_at: event.occurred_at, ...pointer(event) };
  });
  const edgeIds = new Set(priorState.edges.map(row => row.id));
  const edges = payload.edges.map(edge => {
    exactKeys(edge, ['id', 'edgeType', 'fromNodeId', 'toNodeId', 'doorIdentity', 'label'], 'Forest edge');
    if (edge.edgeType !== 'passage' || edge.doorIdentity !== null || edgeIds.has(edge.id) || !installedIds.has(edge.fromNodeId) || !installedIds.has(edge.toNodeId)) throw new Error('Forest path edge is invalid.');
    edgeIds.add(edge.id);
    return { id: edge.id, edge_type: edge.edgeType, from_node_id: edge.fromNodeId, to_node_id: edge.toNodeId, door_identity: null, label: edge.label, created_at: event.occurred_at, ...pointer(event) };
  });
  const edgeById = new Map(edges.map(row => [row.id, row]));
  const passages = payload.passages.map(row => {
    exactKeys(row, ['edgeId', 'passageId', 'passageKind', 'fromNodeId', 'toNodeId', 'governedObjectId'], 'Forest passage');
    const edge = edgeById.get(row.edgeId);
    if (!edge || row.passageId !== 'passage.garden_forest' || row.passageKind !== 'opening' || row.governedObjectId !== null || edge.from_node_id !== row.fromNodeId || edge.to_node_id !== row.toNodeId) throw new Error('Forest passage definition is invalid.');
    return { edge_id: row.edgeId, passage_id: row.passageId, passage_kind: row.passageKind, from_node_id: row.fromNodeId, to_node_id: row.toNodeId, governed_object_id: null, ...pointer(event) };
  });
  return { nodes, edges, passages };
}

function binderWindowExtensionRows(payload, event, priorState) {
  exactKeys(payload, ['manifestSha256', 'nodes', 'edges'], 'Binder Window topology payload');
  if (!Array.isArray(payload.nodes) || !Array.isArray(payload.edges)) throw new Error('Binder Window topology payload rows are invalid.');
  const manifest = { nodes: payload.nodes, edges: payload.edges };
  if (payload.manifestSha256 !== sha256(canonicalize(manifest)) || payload.manifestSha256 !== binderWindowTopologyHash() || canonicalize(manifest) !== canonicalize(binderWindowTopologyManifest())) throw new Error('Binder Window topology does not match the code-owned manifest.');
  if (!priorState.forestExtension || priorState.binderWindowExtension) throw new Error('Binder Window topology requires the Forest generation and may be installed only once.');
  const installedIds = new Set(priorState.nodes.map(row => row.id));
  const nodes = payload.nodes.map(node => {
    exactKeys(node, ['id', 'nodeType', 'residentText', 'state', 'lifecycle', 'revision'], 'Binder Window node');
    if (node.id !== 'fixture.binder_window' || node.nodeType !== 'fixture' || node.lifecycle !== 'standing' || node.revision !== 1 || installedIds.has(node.id)) throw new Error('Binder Window node is invalid.');
    canonicalObject(node.state, 'Binder Window node state'); installedIds.add(node.id);
    return { id: node.id, node_type: node.nodeType, resident_text: node.residentText, state_json: canonicalize(node.state), lifecycle: node.lifecycle, revision: 1, created_at: event.occurred_at, ...pointer(event) };
  });
  const edgeIds = new Set(priorState.edges.map(row => row.id));
  const edges = payload.edges.map(edge => {
    exactKeys(edge, ['id', 'edgeType', 'fromNodeId', 'toNodeId', 'doorIdentity', 'label'], 'Binder Window edge');
    if (edge.id !== 'edge.contains.center_binder_window' || edge.edgeType !== 'contains' || edge.fromNodeId !== 'room.center' || edge.toNodeId !== 'fixture.binder_window' || edge.doorIdentity !== null || edgeIds.has(edge.id) || !installedIds.has(edge.fromNodeId) || !installedIds.has(edge.toNodeId)) throw new Error('Binder Window containment is invalid.');
    return { id: edge.id, edge_type: edge.edgeType, from_node_id: edge.fromNodeId, to_node_id: edge.toNodeId, door_identity: null, label: edge.label, created_at: event.occurred_at, ...pointer(event) };
  });
  return { nodes, edges };
}

function spotlightExtensionRows(payload, event, priorState) {
  exactKeys(payload, ['manifestSha256', 'nodes', 'edges'], 'Spotlight topology payload');
  if (!Array.isArray(payload.nodes) || !Array.isArray(payload.edges)) throw new Error('Spotlight topology payload rows are invalid.');
  const manifest = { nodes: payload.nodes, edges: payload.edges };
  if (payload.manifestSha256 !== sha256(canonicalize(manifest)) || payload.manifestSha256 !== spotlightTopologyHash() || canonicalize(manifest) !== canonicalize(spotlightTopologyManifest())) throw new Error('Spotlight topology does not match the code-owned manifest.');
  if (!priorState.binderWindowExtension || priorState.spotlightExtension) throw new Error('Spotlight topology requires the Binder Window generation and may be installed only once.');

  const expectedNodeIds = new Set(['room.spotlight', 'fixture.spotlight_landscape', 'fixture.spotlight_telescope', 'fixture.spotlight_archive', 'fixture.spotlight_table', 'fixture.spotlight_bell']);
  const installedIds = new Set(priorState.nodes.map(row => row.id));
  const nodes = payload.nodes.map(node => {
    exactKeys(node, ['id', 'nodeType', 'residentText', 'state', 'lifecycle', 'revision'], 'Spotlight node');
    if (!expectedNodeIds.has(node.id) || node.lifecycle !== 'standing' || node.revision !== 1 || installedIds.has(node.id)) throw new Error('Spotlight node identity, lifecycle, or revision is invalid.');
    if (node.id === 'room.spotlight' && node.nodeType !== 'room') throw new Error('Spotlight room node is invalid.');
    if (node.id !== 'room.spotlight' && node.nodeType !== 'fixture') throw new Error('Spotlight fixture node is invalid.');
    canonicalObject(node.state, 'Spotlight node state'); installedIds.add(node.id);
    return { id: node.id, node_type: node.nodeType, resident_text: node.residentText, state_json: canonicalize(node.state), lifecycle: 'standing', revision: 1, created_at: event.occurred_at, ...pointer(event) };
  });
  if (new Set(nodes.map(row => row.id)).size !== expectedNodeIds.size || nodes.length !== expectedNodeIds.size) throw new Error('Spotlight topology must install exactly one room and five fixtures.');

  const expectedEdgeIds = new Set(['edge.contains.hub_spotlight', 'edge.contains.spotlight_landscape', 'edge.contains.spotlight_telescope', 'edge.contains.spotlight_archive', 'edge.contains.spotlight_table', 'edge.contains.spotlight_bell']);
  const edgeIds = new Set(priorState.edges.map(row => row.id));
  const edges = payload.edges.map(edge => {
    exactKeys(edge, ['id', 'edgeType', 'fromNodeId', 'toNodeId', 'doorIdentity', 'label'], 'Spotlight edge');
    if (!expectedEdgeIds.has(edge.id) || edge.edgeType !== 'contains' || edge.doorIdentity !== null || edgeIds.has(edge.id) || !installedIds.has(edge.fromNodeId) || !installedIds.has(edge.toNodeId)) throw new Error('Spotlight containment edge is invalid.');
    if (edge.id === 'edge.contains.hub_spotlight' && (edge.fromNodeId !== 'place.hub' || edge.toNodeId !== 'room.spotlight')) throw new Error('Spotlight Hub containment is invalid.');
    if (edge.id !== 'edge.contains.hub_spotlight' && (edge.fromNodeId !== 'room.spotlight' || !edge.toNodeId.startsWith('fixture.spotlight_'))) throw new Error('Spotlight fixture containment is invalid.');
    edgeIds.add(edge.id);
    return { id: edge.id, edge_type: 'contains', from_node_id: edge.fromNodeId, to_node_id: edge.toNodeId, door_identity: null, label: edge.label, created_at: event.occurred_at, ...pointer(event) };
  });
  if (new Set(edges.map(row => row.id)).size !== expectedEdgeIds.size || edges.length !== expectedEdgeIds.size) throw new Error('Spotlight topology must install exactly six containment edges.');
  return { nodes: nodes.sort((a, b) => a.id.localeCompare(b.id)), edges: edges.sort((a, b) => a.id.localeCompare(b.id)) };
}

function spotlightDoorExtensionRows(payload, event, priorState) {
  exactKeys(payload, ['manifestSha256', 'edges'], 'Spotlight door topology payload');
  if (!Array.isArray(payload.edges)) throw new Error('Spotlight door topology payload rows are invalid.');
  const manifest = { edges: payload.edges };
  if (payload.manifestSha256 !== sha256(canonicalize(manifest)) || payload.manifestSha256 !== spotlightDoorTopologyHash() || canonicalize(manifest) !== canonicalize(spotlightDoorTopologyManifest())) throw new Error('Spotlight door topology does not match the code-owned manifest.');
  if (!priorState.spotlightExtension || priorState.spotlightDoorExtension) throw new Error('Spotlight door topology requires the Observatory shell and may be installed only once.');

  const expectedEdgeIds = new Set(['edge.door.spotlight.center_to_spotlight', 'edge.door.spotlight.spotlight_to_center']);
  const installedIds = new Set(priorState.nodes.map(row => row.id));
  const edgeIds = new Set(priorState.edges.map(row => row.id));
  const edges = payload.edges.map(edge => {
    exactKeys(edge, ['id', 'edgeType', 'fromNodeId', 'toNodeId', 'doorIdentity', 'label'], 'Spotlight door edge');
    requiredString(edge.id, 'Spotlight door edge identity'); requiredString(edge.edgeType, 'Spotlight door edge type');
    requiredString(edge.fromNodeId, 'Spotlight door source'); requiredString(edge.toNodeId, 'Spotlight door target');
    requiredString(edge.doorIdentity, 'Spotlight door identity'); requiredString(edge.label, 'Spotlight door label');
    if (!expectedEdgeIds.has(edge.id) || edge.edgeType !== 'door' || edge.doorIdentity !== 'door.spotlight' || edgeIds.has(edge.id) || !installedIds.has(edge.fromNodeId) || !installedIds.has(edge.toNodeId)) throw new Error('Spotlight door edge identity, kind, or endpoint is invalid.');
    if (!['room.center', 'room.spotlight'].includes(edge.fromNodeId) || !['room.center', 'room.spotlight'].includes(edge.toNodeId) || edge.fromNodeId === edge.toNodeId) throw new Error('Spotlight door endpoints are invalid.');
    edgeIds.add(edge.id);
    return { id: edge.id, edge_type: edge.edgeType, from_node_id: edge.fromNodeId, to_node_id: edge.toNodeId, door_identity: edge.doorIdentity, label: edge.label, created_at: event.occurred_at, ...pointer(event) };
  });
  if (new Set(edges.map(row => row.id)).size !== expectedEdgeIds.size || edges.length !== expectedEdgeIds.size) throw new Error('Spotlight door topology must install exactly two directed door edges.');
  const endpoints = new Set(edges.map(row => `${row.from_node_id}->${row.to_node_id}`));
  if (!endpoints.has('room.center->room.spotlight') || !endpoints.has('room.spotlight->room.center')) throw new Error('Spotlight door topology must be bidirectional.');
  return { edges: edges.sort((a, b) => a.id.localeCompare(b.id)) };
}

function legacyRows(payload, event) {
  exactKeys(payload, ['projectionSha256', 'nodes', 'edges', 'locations'], 'legacy snapshot payload');
  if (!Array.isArray(payload.nodes) || !Array.isArray(payload.edges) || !Array.isArray(payload.locations)) throw new Error('Legacy snapshot rows are invalid.');
  const exact = { nodes: payload.nodes, edges: payload.edges, locations: payload.locations };
  if (payload.projectionSha256 !== sha256(canonicalize(exact))) throw new Error('Legacy snapshot projection hash is invalid.');
  const nodes = payload.nodes.map(row => ({ ...row, ...pointer(event) }));
  const edges = payload.edges.map(row => ({ ...row, ...pointer(event) }));
  const locations = payload.locations.map(row => ({ ...row, ...pointer(event) }));
  for (const row of nodes) exactKeys(row, NODE_COLUMNS, 'legacy node');
  for (const row of edges) exactKeys(row, EDGE_COLUMNS, 'legacy edge');
  for (const row of locations) exactKeys(row, LOCATION_COLUMNS, 'legacy location');
  if (new Set(nodes.map(row => row.id)).size !== nodes.length || new Set(edges.map(row => row.id)).size !== edges.length || new Set(locations.map(row => row.session_id)).size !== locations.length) throw new Error('Legacy snapshot contains duplicate identities.');
  const installed = installedTopologyManifest(); const nodeById = new Map(nodes.map(row => [row.id, row])); const edgeById = new Map(edges.map(row => [row.id, row]));
  if (nodeById.size !== installed.nodes.length || edgeById.size !== installed.edges.length) throw new Error('Legacy snapshot topology does not match the code-owned manifest.');
  for (const expected of installed.nodes) {
    const actual = nodeById.get(expected.id);
    if (!actual || actual.node_type !== expected.nodeType || actual.resident_text !== expected.residentText || actual.lifecycle !== expected.lifecycle || canonicalize(JSON.parse(actual.state_json)) !== canonicalize(expected.state)) throw new Error(`Legacy snapshot node does not match the code-owned manifest: ${expected.id}.`);
  }
  for (const expected of installed.edges) {
    const actual = edgeById.get(expected.id);
    if (!actual || actual.edge_type !== expected.edgeType || actual.from_node_id !== expected.fromNodeId || actual.to_node_id !== expected.toNodeId || actual.door_identity !== expected.doorIdentity || actual.label !== expected.label) throw new Error(`Legacy snapshot edge does not match the code-owned manifest: ${expected.id}.`);
  }
  return { nodes: nodes.sort((a, b) => a.id.localeCompare(b.id)), edges: edges.sort((a, b) => a.id.localeCompare(b.id)), locations: locations.sort((a, b) => a.session_id.localeCompare(b.session_id)) };
}

function validJsonText(value, label) {
  requiredString(value, label);
  try { JSON.parse(value); } catch { throw new Error(`${label} is not valid JSON.`); }
}
function validIso(value, label) {
  requiredString(value, label);
  if (Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) throw new Error(`${label} is not an exact ISO timestamp.`);
}
function validateRuntimeState(state) {
  canonicalObject(state, 'fixture runtime state');
  exactKeys(state, ['status', 'runId', 'recipe', 'code', 'signal', 'reason', 'summaryTail'], 'fixture runtime state');
  if (!['running', 'stopping', 'settled', 'failed', 'cancelled'].includes(state.status)) throw new Error('Fixture runtime status is not installed.');
  for (const key of ['runId', 'recipe', 'signal', 'reason', 'summaryTail']) if (state[key] !== null && typeof state[key] !== 'string') throw new Error(`Fixture runtime ${key} is invalid.`);
  requiredString(state.runId, 'fixture runtime run identity'); requiredString(state.recipe, 'fixture runtime recipe');
  if (state.code !== null && !Number.isInteger(state.code)) throw new Error('Fixture runtime code is invalid.');
}
function legacyBoundaryRunId(fixtureId, row) {
  return `legacy_run_${sha256(canonicalize({ fixtureId, boundaryEventHash: row.last_event_hash, stateSha256: sha256(row.state_json) }))}`;
}
const APPROVAL_KINDS = new Set(['patch', 'unified_diff', 'write_file', 'create_path', 'delete_path', 'rename_path', 'git_add', 'commit', 'git_checkout', 'sandbox_promotion']);
function operationalRows(payload, event, priorState) {
  exactKeys(payload, ['projectionSha256', 'fixtureRuntimes', 'timers', 'briefs', 'approvals', 'legacyCustody'], 'operational snapshot payload');
  for (const key of ['fixtureRuntimes', 'timers', 'briefs', 'approvals']) if (!Array.isArray(payload[key])) throw new Error(`Operational snapshot ${key} rows are invalid.`);
  canonicalObject(payload.legacyCustody, 'legacy custody'); exactKeys(payload.legacyCustody, ['actionReceipts', 'approvalReceipts'], 'legacy custody');
  for (const key of ['actionReceipts', 'approvalReceipts']) {
    if (!Array.isArray(payload.legacyCustody[key])) throw new Error(`Legacy custody ${key} is invalid.`);
    for (const row of payload.legacyCustody[key]) {
      canonicalObject(row, 'legacy custody row'); exactKeys(row, ['receiptId', 'rowSha256'], 'legacy custody row');
      requiredString(row.receiptId, 'legacy receipt identity');
      if (!/^[0-9a-f]{64}$/.test(row.rowSha256)) throw new Error('Legacy receipt row hash is invalid.');
    }
    if (new Set(payload.legacyCustody[key].map(row => row.receiptId)).size !== payload.legacyCustody[key].length) throw new Error('Legacy custody contains duplicate receipt identities.');
  }
  const exact = { fixtureRuntimes: payload.fixtureRuntimes, timers: payload.timers, briefs: payload.briefs, approvals: payload.approvals, legacyCustody: payload.legacyCustody };
  if (payload.projectionSha256 !== sha256(canonicalize(exact))) throw new Error('Operational snapshot projection hash is invalid.');
  const fixtureRuntimes = payload.fixtureRuntimes.map(row => ({ ...row, ...pointer(event) }));
  const timers = payload.timers.map(row => ({ ...row, ...pointer(event) }));
  const briefs = payload.briefs.map(row => ({ ...row, ...pointer(event) }));
  const approvals = payload.approvals.map(row => ({ ...row, ...pointer(event) }));
  for (const row of fixtureRuntimes) {
    exactKeys(row, FIXTURE_RUNTIME_COLUMNS, 'legacy fixture runtime'); requiredString(row.fixture_id, 'fixture runtime identity'); validJsonText(row.state_json, 'fixture runtime state');
    if (!Number.isInteger(row.revision) || row.revision < 1) throw new Error('Fixture runtime revision is invalid.'); validIso(row.updated_at, 'fixture runtime update time');
    const fixture = findBy(priorState.nodes, 'id', row.fixture_id); if (!fixture || fixture.node_type !== 'fixture' || fixture.lifecycle !== 'standing') throw new Error('Fixture runtime references an unavailable fixture.');
  }
  for (const row of timers) {
    exactKeys(row, TIMER_COLUMNS, 'legacy timer'); requiredString(row.session_id, 'timer session');
    if (!Number.isInteger(row.seconds) || row.seconds < 1 || row.seconds > 3600 || !Number.isInteger(row.revision) || row.revision < 1) throw new Error('Timer value or revision is invalid.');
    validIso(row.due_at, 'timer due time'); validIso(row.created_at, 'timer created time');
    if (!findBy(priorState.locations, 'session_id', row.session_id)) throw new Error('Timer references an unavailable lifespan.');
  }
  for (const row of briefs) {
    exactKeys(row, BRIEF_COLUMNS, 'legacy brief'); requiredString(row.brief_id, 'brief identity'); requiredString(row.session_id, 'brief session'); requiredString(row.objective, 'brief objective');
    if (!Number.isInteger(row.revision) || row.revision < 1) throw new Error('Brief revision is invalid.');
    for (const key of ['scope_paths_json', 'acceptance_json', 'non_goals_json', 'field_hashes_json']) validJsonText(row[key], `brief ${key}`);
    validIso(row.created_at, 'brief created time'); validIso(row.updated_at, 'brief updated time');
    if (!findBy(priorState.locations, 'session_id', row.session_id)) throw new Error('Brief references an unavailable lifespan.');
  }
  for (const row of approvals) {
    exactKeys(row, APPROVAL_COLUMNS, 'legacy approval'); requiredString(row.approval_id, 'approval identity'); requiredString(row.session_id, 'approval session'); requiredString(row.kind, 'approval kind');
    if (!APPROVAL_KINDS.has(row.kind) || !['pending', 'applying', 'reconciliation_required', 'confirmed', 'rejected', 'cancelled'].includes(row.status) || !Number.isInteger(row.revision) || row.revision < 1) throw new Error('Approval kind, status, or revision is invalid.');
    validJsonText(row.payload_json, 'approval payload'); validJsonText(row.preview_json, 'approval preview'); if (row.application_json !== null) validJsonText(row.application_json, 'approval application'); if (row.outcome_json !== null) validJsonText(row.outcome_json, 'approval outcome');
    validIso(row.created_at, 'approval created time'); if (row.decided_at !== null) validIso(row.decided_at, 'approval decision time');
    if (!findBy(priorState.locations, 'session_id', row.session_id)) throw new Error('Approval references an unavailable lifespan.');
  }
  if (new Set(fixtureRuntimes.map(row => row.fixture_id)).size !== fixtureRuntimes.length || new Set(timers.map(row => row.session_id)).size !== timers.length || new Set(briefs.map(row => `${row.session_id}:${row.revision}`)).size !== briefs.length || new Set(approvals.map(row => row.approval_id)).size !== approvals.length) throw new Error('Operational snapshot contains duplicate identities.');
  return {
    fixtureRuntimes: fixtureRuntimes.sort((a, b) => a.fixture_id.localeCompare(b.fixture_id)), timers: timers.sort((a, b) => a.session_id.localeCompare(b.session_id)),
    briefs: briefs.sort((a, b) => a.session_id.localeCompare(b.session_id) || a.revision - b.revision), approvals: approvals.sort((a, b) => a.approval_id.localeCompare(b.approval_id)),
    legacyCustody: { actionReceipts: payload.legacyCustody.actionReceipts.map(row => ({ ...row })), approvalReceipts: payload.legacyCustody.approvalReceipts.map(row => ({ ...row })) },
    operationalBoundary: { sequence: event.sequence, eventHash: event.event_hash },
  };
}

export function reduceWorldEvent(priorState, event) {
  const registration = WORLD_EVENT_KINDS[event.event_kind];
  if (!registration || registration.installed === false) throw new Error(`World event kind is not installed: ${event.event_kind}`);
  if (event.event_schema_version !== registration.schemaVersion) throw new Error(`World event schema version is not installed: ${event.event_kind}@${event.event_schema_version}`);
  const payload = typeof event.payload_json === 'string' ? JSON.parse(event.payload_json) : event.payload;
  const causation = typeof event.causation_json === 'string' ? JSON.parse(event.causation_json) : event.causation;
  canonicalObject(payload, 'event payload');
  canonicalObject(causation, 'event causation');
  requiredString(event.event_id, 'event identity'); requiredString(event.actor, 'event actor'); requiredString(event.aggregate_kind, 'aggregate kind'); requiredString(event.aggregate_id, 'aggregate identity');
  if (event.session_id !== null) requiredString(event.session_id, 'event session');
  if (event.wake_id !== null) requiredString(event.wake_id, 'event wake identity');
  if (event.command_id !== null) requiredString(event.command_id, 'event command identity');
  if (!Number.isInteger(event.sequence) || event.sequence < 1 || !Number.isInteger(event.aggregate_revision) || event.aggregate_revision < 1) throw new Error('Event sequence or aggregate revision is invalid.');
  if (typeof event.occurred_at !== 'string' || Number.isNaN(Date.parse(event.occurred_at)) || new Date(event.occurred_at).toISOString() !== event.occurred_at) throw new Error('Event occurrence time is invalid.');
  if (event.event_kind === 'topology.installed/v1') {
    exactKeys(causation, ['boundary'], 'topology causation');
    if (causation.boundary !== 'fresh_database') throw new Error('Topology causation boundary is invalid.');
    if (event.aggregate_kind !== 'topology' || event.aggregate_id !== 'installed' || event.aggregate_revision !== 1 || event.session_id !== null) throw new Error('Topology event aggregate envelope is invalid.');
    if (priorState.nodes.length || priorState.edges.length || priorState.locations.length) throw new Error('Topology can only be installed into an empty projection.');
    return { ...emptyWorldState(), ...topologyRows(payload, event), rootBoundary: 'fresh' };
  }
  if (event.event_kind === 'legacy_snapshot.imported/v1') {
    exactKeys(causation, ['boundary'], 'legacy causation');
    if (causation.boundary !== 'pre_journal_projection') throw new Error('Legacy causation boundary is invalid.');
    if (event.aggregate_kind !== 'world_snapshot' || event.aggregate_id !== 'legacy_boundary' || event.aggregate_revision !== 1 || event.session_id !== null) throw new Error('Legacy boundary aggregate envelope is invalid.');
    if (priorState.nodes.length || priorState.edges.length || priorState.locations.length) throw new Error('A legacy boundary can only be imported into an empty replay.');
    return { ...emptyWorldState(), ...legacyRows(payload, event), rootBoundary: 'legacy' };
  }
  const state = copyState(priorState);
  if (event.event_kind === 'room.installation.revised/v1') {
    exactKeys(causation, ['boundary', 'physicalHeadHash', 'physicalHeadSequence'], 'room installation revision causation');
    if (causation.boundary !== 'room_installation_revision_v1' || causation.physicalHeadSequence !== event.sequence - 1 || causation.physicalHeadHash !== event.previous_event_hash) throw new Error('Room installation revision causation is invalid.');
    if (event.aggregate_kind !== 'room_installation' || !['room.workshop', 'room.spotlight'].includes(event.aggregate_id) || event.session_id !== null || event.wake_id !== null || event.command_id !== null || event.actor !== 'world_migration') throw new Error('Room installation revision aggregate envelope is invalid.');
    exactKeys(payload, ['roomId', 'priorReceiptId', 'priorReceiptHash', 'priorPackageVersion', 'priorManifestHash', 'priorWitnessHash', 'newPackageVersion', 'newManifestHash', 'newWitnessHash', 'reason', 'admission'], 'room installation revision payload');
    if (payload.roomId !== event.aggregate_id) throw new Error('Room installation revision room identity is invalid.');
    for (const [value, label] of [[payload.priorReceiptId, 'prior receipt identity'], [payload.priorPackageVersion, 'prior package version'], [payload.priorManifestHash, 'prior manifest hash'], [payload.priorWitnessHash, 'prior witness hash'], [payload.newPackageVersion, 'new package version'], [payload.newManifestHash, 'new manifest hash'], [payload.newWitnessHash, 'new witness hash'], [payload.reason, 'revision reason']]) requiredString(value, label);
    for (const hash of [payload.priorReceiptHash, payload.priorManifestHash, payload.priorWitnessHash, payload.newManifestHash, payload.newWitnessHash]) if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('Room installation revision hash is invalid.');
    if (!payload.priorReceiptId.startsWith('room_installation_')) throw new Error('Room installation prior receipt identity is invalid.');
    if (payload.priorPackageVersion === payload.newPackageVersion || payload.priorManifestHash === payload.newManifestHash || payload.priorWitnessHash === payload.newWitnessHash) throw new Error('Room installation revision must advance package, manifest, and witness identity.');
    canonicalObject(payload.admission, 'room installation revision admission');
    return state;
  } else if (event.event_kind === 'topology.extended/v1') {
    exactKeys(causation, ['boundary', 'physicalHeadHash', 'physicalHeadSequence'], 'topology extension causation');
    if (causation.boundary !== 'b1_topology_extension' || causation.physicalHeadSequence !== event.sequence - 1 || causation.physicalHeadHash !== event.previous_event_hash) throw new Error('Topology extension boundary causation is invalid.');
    if (event.aggregate_kind !== 'topology_extension' || event.aggregate_id !== 'installed' || event.aggregate_revision !== 1 || event.session_id !== null || event.wake_id !== null || event.command_id !== null || !['world_bootstrap', 'world_migration'].includes(event.actor)) throw new Error('Topology extension aggregate envelope is invalid.');
    if (state.topologyExtension) throw new Error('Topology extension can only be installed once.');
    if (state.rootBoundary === 'legacy' && !state.operationalBoundary) throw new Error('A legacy topology requires its A2 operational boundary before extension.');
    const installed = installedTopologyManifest();
    if (state.nodes.length !== installed.nodes.length || state.edges.length !== installed.edges.length) throw new Error('Topology extension requires the exact A1 topology projection.');
    const extension = topologyExtensionRows(payload, event, state);
    state.nodes.push(...extension.nodes); state.edges.push(...extension.edges); state.passages = extension.passages; state.objectStates = extension.objectStates;
    state.topologyExtension = { sequence: event.sequence, eventHash: event.event_hash };
  } else if (event.event_kind === 'topology.hearth_installed/v1') {
    exactKeys(causation, ['boundary', 'physicalHeadHash', 'physicalHeadSequence'], 'Hearth topology causation');
    if (causation.boundary !== 'house_hearth_wake_v1' || causation.physicalHeadSequence !== event.sequence - 1 || causation.physicalHeadHash !== event.previous_event_hash) throw new Error('Hearth topology boundary causation is invalid.');
    if (event.aggregate_kind !== 'topology_extension' || event.aggregate_id !== 'hearth' || event.aggregate_revision !== 1 || event.session_id !== null || event.wake_id !== null || event.command_id !== null || !['world_bootstrap', 'world_migration'].includes(event.actor)) throw new Error('Hearth topology aggregate envelope is invalid.');
    if (!state.topologyExtension || state.hearthExtension) throw new Error('Hearth topology requires B1 and may be installed only once.');
    const extension = hearthExtensionRows(payload, event, state);
    state.nodes.push(...extension.nodes); state.edges.push(...extension.edges);
    state.hearthExtension = { sequence: event.sequence, eventHash: event.event_hash };
  } else if (event.event_kind === 'topology.forest_installed/v1') {
    exactKeys(causation, ['boundary', 'physicalHeadHash', 'physicalHeadSequence'], 'Forest topology causation');
    if (causation.boundary !== 'forest_place_v1' || causation.physicalHeadSequence !== event.sequence - 1 || causation.physicalHeadHash !== event.previous_event_hash) throw new Error('Forest topology boundary causation is invalid.');
    if (event.aggregate_kind !== 'topology_extension' || event.aggregate_id !== 'forest' || event.aggregate_revision !== 1 || event.session_id !== null || event.wake_id !== null || event.command_id !== null || !['world_bootstrap', 'world_migration'].includes(event.actor)) throw new Error('Forest topology aggregate envelope is invalid.');
    const extension = forestExtensionRows(payload, event, state);
    state.nodes.push(...extension.nodes); state.edges.push(...extension.edges); state.passages.push(...extension.passages);
    state.forestExtension = { sequence: event.sequence, eventHash: event.event_hash };
  } else if (event.event_kind === 'topology.binder_window_installed/v1') {
    exactKeys(causation, ['boundary', 'physicalHeadHash', 'physicalHeadSequence'], 'Binder Window topology causation');
    if (causation.boundary !== 'binder_window_v1' || causation.physicalHeadSequence !== event.sequence - 1 || causation.physicalHeadHash !== event.previous_event_hash) throw new Error('Binder Window topology boundary causation is invalid.');
    if (event.aggregate_kind !== 'topology_extension' || event.aggregate_id !== 'binder_window' || event.aggregate_revision !== 1 || event.session_id !== null || event.wake_id !== null || event.command_id !== null || !['world_bootstrap', 'world_migration'].includes(event.actor)) throw new Error('Binder Window topology aggregate envelope is invalid.');
    const extension = binderWindowExtensionRows(payload, event, state);
    state.nodes.push(...extension.nodes); state.edges.push(...extension.edges);
    state.binderWindowExtension = { sequence: event.sequence, eventHash: event.event_hash };
  } else if (event.event_kind === 'topology.spotlight_installed/v1') {
    exactKeys(causation, ['boundary', 'physicalHeadHash', 'physicalHeadSequence'], 'Spotlight topology causation');
    if (causation.boundary !== 'spotlight_observatory_v1' || causation.physicalHeadSequence !== event.sequence - 1 || causation.physicalHeadHash !== event.previous_event_hash) throw new Error('Spotlight topology boundary causation is invalid.');
    if (event.aggregate_kind !== 'topology_extension' || event.aggregate_id !== 'spotlight' || event.aggregate_revision !== 1 || event.session_id !== null || event.wake_id !== null || event.command_id !== null || !['world_bootstrap', 'world_migration'].includes(event.actor)) throw new Error('Spotlight topology aggregate envelope is invalid.');
    const extension = spotlightExtensionRows(payload, event, state);
    state.nodes.push(...extension.nodes); state.edges.push(...extension.edges);
    state.spotlightExtension = { sequence: event.sequence, eventHash: event.event_hash };
  } else if (event.event_kind === 'topology.spotlight_door_installed/v1') {
    exactKeys(causation, ['boundary', 'physicalHeadHash', 'physicalHeadSequence'], 'Spotlight door topology causation');
    if (causation.boundary !== 'spotlight_observatory_door_v1' || causation.physicalHeadSequence !== event.sequence - 1 || causation.physicalHeadHash !== event.previous_event_hash) throw new Error('Spotlight door topology boundary causation is invalid.');
    if (event.aggregate_kind !== 'topology_extension' || event.aggregate_id !== 'spotlight_door' || event.aggregate_revision !== 1 || event.session_id !== null || event.wake_id !== null || event.command_id !== null || !['world_bootstrap', 'world_migration'].includes(event.actor)) throw new Error('Spotlight door topology aggregate envelope is invalid.');
    const extension = spotlightDoorExtensionRows(payload, event, state);
    state.edges.push(...extension.edges);
    state.spotlightDoorExtension = { sequence: event.sequence, eventHash: event.event_hash };
  } else if (event.event_kind === 'operational_snapshot.imported/v1') {
    exactKeys(causation, ['boundary', 'physicalHeadHash', 'physicalHeadSequence'], 'operational snapshot causation');
    if (causation.boundary !== 'pre_a2_operational_projection' || causation.physicalHeadSequence !== event.sequence - 1 || causation.physicalHeadHash !== event.previous_event_hash) throw new Error('Operational snapshot boundary causation is invalid.');
    if (event.aggregate_kind !== 'operational_snapshot' || event.aggregate_id !== 'installed' || event.aggregate_revision !== 1 || event.session_id !== null) throw new Error('Operational snapshot aggregate envelope is invalid.');
    if (state.topologyExtension || state.operationalBoundary || state.fixtureRuntimes.length || state.timers.length || state.briefs.length || state.approvals.length || state.legacyCustody.actionReceipts.length || state.legacyCustody.approvalReceipts.length) throw new Error('Operational snapshot can only be imported before the topology extension and only once.');
    Object.assign(state, operationalRows(payload, event, state));
  } else if (event.event_kind === 'lifespan.started/v1') {
    exactKeys(causation, ['reason'], 'lifespan causation');
    if (causation.reason !== 'lifespan_initialized') throw new Error('Lifespan causation reason is invalid.');
    exactKeys(payload, ['roomNodeId'], 'lifespan payload');
    if (event.aggregate_kind !== 'lifespan' || event.aggregate_id !== event.session_id || event.aggregate_revision !== 1) throw new Error('Lifespan event aggregate envelope is invalid.');
    requiredString(event.session_id, 'lifespan session'); requiredString(payload.roomNodeId, 'starting room');
    if (findBy(state.locations, 'session_id', event.session_id)) throw new Error('Lifespan is already initialized.');
    const startingRoom = findBy(state.nodes, 'id', payload.roomNodeId);
    const expectedStart = state.hearthExtension ? 'place.house' : 'room.center';
    const occupiable = startingRoom && startingRoom.lifecycle === 'standing' && (startingRoom.node_type === 'room' || (startingRoom.node_type === 'place' && JSON.parse(startingRoom.state_json).occupiable === true));
    if (!occupiable || payload.roomNodeId !== expectedStart) throw new Error('Starting location does not match the installed lifespan law.');
    state.locations.push({ session_id: event.session_id, room_node_id: payload.roomNodeId, inspected_source: null, engaged_fixture_id: null, revision: event.aggregate_revision, started_at: event.occurred_at, updated_at: event.occurred_at, ...pointer(event) });
  } else if (WORLD_EVENT_KINDS[event.event_kind].stretch === 'A1') {
    requiredString(event.session_id, 'event session');
    if (event.aggregate_kind !== 'lifespan' || event.aggregate_id !== event.session_id) throw new Error('Physical event aggregate envelope is invalid.');
    const current = findBy(state.locations, 'session_id', event.session_id);
    if (!current) throw new Error('Lifespan is not initialized.');
    if (current.revision + 1 !== event.aggregate_revision) throw new Error('Lifespan aggregate revision is not contiguous.');
    let next;
    if (event.event_kind === 'location.moved/v1') {
      exactKeys(causation, ['doorIdentity', 'edgeId'], 'movement causation');
      exactKeys(payload, ['fromRoomId', 'toRoomId', 'edgeId', 'doorIdentity', 'clearedFixtureId'], 'movement payload');
      requiredString(payload.fromRoomId, 'movement source'); requiredString(payload.toRoomId, 'movement target'); requiredString(payload.edgeId, 'movement edge'); requiredString(payload.doorIdentity, 'movement door');
      if (current.room_node_id !== payload.fromRoomId) throw new Error('Movement source does not match the prior location.');
      const fromRoom = findBy(state.nodes, 'id', payload.fromRoomId); const toRoom = findBy(state.nodes, 'id', payload.toRoomId);
      if (!fromRoom || fromRoom.node_type !== 'room' || fromRoom.lifecycle !== 'standing' || !toRoom || toRoom.node_type !== 'room' || toRoom.lifecycle !== 'standing') throw new Error('Movement endpoints must be installed standing rooms.');
      const edge = findBy(state.edges, 'id', payload.edgeId);
      if (!edge || edge.edge_type !== 'door' || edge.from_node_id !== payload.fromRoomId || edge.to_node_id !== payload.toRoomId || edge.door_identity !== payload.doorIdentity) throw new Error('Movement does not follow an installed door.');
      if (causation.edgeId !== payload.edgeId || causation.doorIdentity !== payload.doorIdentity) throw new Error('Movement causation does not match its payload.');
      const leavingWorkshop = current.room_node_id === 'room.workshop' && payload.toRoomId !== 'room.workshop';
      const expectedClearedFixtureId = leavingWorkshop ? (current.engaged_fixture_id ?? null) : null;
      if (payload.clearedFixtureId !== expectedClearedFixtureId) throw new Error('Movement fixture clearing is not exact.');
      next = { ...current, room_node_id: payload.toRoomId, inspected_source: null, engaged_fixture_id: leavingWorkshop ? null : current.engaged_fixture_id, revision: event.aggregate_revision, updated_at: event.occurred_at, ...pointer(event) };
    } else if (event.event_kind === 'source.inspected/v1') {
      exactKeys(causation, ['action'], 'inspection causation');
      if (causation.action !== 'inspect_source') throw new Error('Inspection causation action is invalid.');
      exactKeys(payload, ['source'], 'inspection payload');
      if (payload.source !== null) requiredString(payload.source, 'inspected source');
      next = { ...current, inspected_source: payload.source, revision: event.aggregate_revision, updated_at: event.occurred_at, ...pointer(event) };
    } else if (event.event_kind === 'fixture.engaged/v1') {
      exactKeys(causation, ['action'], 'fixture engagement causation');
      if (causation.action !== 'engage_fixture') throw new Error('Fixture engagement causation action is invalid.');
      exactKeys(payload, ['fixtureId', 'previousFixtureId'], 'fixture engagement payload');
      requiredString(payload.fixtureId, 'fixture identity');
      if ((payload.previousFixtureId ?? null) !== (current.engaged_fixture_id ?? null)) throw new Error('Prior fixture engagement does not match.');
      if (current.room_node_id !== 'room.workshop') throw new Error('Fixture engagement is outside the Workshop.');
      const fixture = findBy(state.nodes, 'id', payload.fixtureId);
      const fixtureState = fixture ? JSON.parse(fixture.state_json) : null;
      const contains = state.edges.some(row => row.edge_type === 'contains' && row.from_node_id === current.room_node_id && row.to_node_id === payload.fixtureId);
      if (!fixture || fixture.node_type !== 'fixture' || fixture.lifecycle !== 'standing' || !fixtureState?.engageable || !contains) throw new Error('Fixture is not lawfully engageable.');
      next = { ...current, engaged_fixture_id: payload.fixtureId, revision: event.aggregate_revision, updated_at: event.occurred_at, ...pointer(event) };
    } else if (event.event_kind === 'fixture.disengaged/v1') {
      exactKeys(causation, ['action'], 'fixture disengagement causation');
      if (causation.action !== 'disengage_fixture') throw new Error('Fixture disengagement causation action is invalid.');
      exactKeys(payload, ['fixtureId'], 'fixture disengagement payload');
      requiredString(payload.fixtureId, 'fixture identity');
      if (current.room_node_id !== 'room.workshop' || current.engaged_fixture_id !== payload.fixtureId) throw new Error('Fixture disengagement does not match current state.');
      next = { ...current, engaged_fixture_id: null, revision: event.aggregate_revision, updated_at: event.occurred_at, ...pointer(event) };
    }
    state.locations = replaceBy(state.locations, 'session_id', event.session_id, next);
  } else if (event.event_kind === 'location.crossed/v1') {
    exactKeys(causation, ['action', 'passageId'], 'passage crossing causation');
    if (causation.action !== 'move_through_passage') throw new Error('Passage crossing causation action is invalid.');
    exactKeys(payload, ['fromLocationId', 'toLocationId', 'edgeId', 'passageId', 'passageKind', 'governedObjectId', 'clearedFixtureId'], 'passage crossing payload');
    requiredString(event.session_id, 'passage crossing session'); requiredString(payload.fromLocationId, 'passage source'); requiredString(payload.toLocationId, 'passage target'); requiredString(payload.edgeId, 'passage edge'); requiredString(payload.passageId, 'passage identity'); requiredString(payload.passageKind, 'passage kind');
    if (payload.governedObjectId !== null) requiredString(payload.governedObjectId, 'passage governed object');
    if (event.aggregate_kind !== 'lifespan' || event.aggregate_id !== event.session_id || causation.passageId !== payload.passageId || event.command_id === null || event.actor !== 'resident_tool') throw new Error('Passage crossing aggregate, causation, or command envelope is invalid.');
    const current = findBy(state.locations, 'session_id', event.session_id);
    if (!current || current.revision + 1 !== event.aggregate_revision || current.room_node_id !== payload.fromLocationId) throw new Error('Passage crossing does not continue the current lifespan location.');
    const occupiable = node => node?.lifecycle === 'standing' && (node.node_type === 'room' || node.node_type === 'place' && JSON.parse(node.state_json).occupiable === true);
    if (!occupiable(findBy(state.nodes, 'id', payload.fromLocationId)) || !occupiable(findBy(state.nodes, 'id', payload.toLocationId))) throw new Error('Passage crossing endpoints are not occupiable installed locations.');
    const passage = findBy(state.passages, 'edge_id', payload.edgeId);
    if (!passage || passage.passage_id !== payload.passageId || passage.passage_kind !== payload.passageKind || passage.from_node_id !== payload.fromLocationId || passage.to_node_id !== payload.toLocationId || passage.governed_object_id !== payload.governedObjectId) throw new Error('Passage crossing does not follow an installed route.');
    if (passage.passage_kind === 'door') {
      const objectState = findBy(state.objectStates, 'object_id', passage.governed_object_id);
      if (!objectState || JSON.parse(objectState.state_json).open !== true) throw new Error('Passage door is not open.');
    }
    const leavingWorkshop = current.room_node_id === 'room.workshop' && payload.toLocationId !== 'room.workshop';
    const expectedCleared = leavingWorkshop ? (current.engaged_fixture_id ?? null) : null;
    if (payload.clearedFixtureId !== expectedCleared) throw new Error('Passage crossing fixture clearing is not exact.');
    state.locations = replaceBy(state.locations, 'session_id', event.session_id, { ...current, room_node_id: payload.toLocationId, inspected_source: null, engaged_fixture_id: leavingWorkshop ? null : current.engaged_fixture_id, revision: event.aggregate_revision, updated_at: event.occurred_at, ...pointer(event) });
  } else if (event.event_kind === 'passage.operated/v1') {
    exactKeys(causation, ['action', 'passageId'], 'passage operation causation');
    if (causation.action !== 'operate_passage') throw new Error('Passage operation causation action is invalid.');
    exactKeys(payload, ['passageId', 'objectId', 'fromLocationId', 'operation', 'priorState', 'nextState'], 'passage operation payload');
    requiredString(event.session_id, 'passage operation session'); requiredString(payload.passageId, 'passage identity'); requiredString(payload.objectId, 'passage object'); requiredString(payload.fromLocationId, 'passage operation location'); requiredString(payload.operation, 'passage operation');
    canonicalObject(payload.priorState, 'prior passage state'); canonicalObject(payload.nextState, 'next passage state');
    if (event.aggregate_kind !== 'world_object' || event.aggregate_id !== payload.objectId || causation.passageId !== payload.passageId || event.command_id === null || event.actor !== 'resident_tool') throw new Error('Passage operation aggregate, causation, or command envelope is invalid.');
    const location = findBy(state.locations, 'session_id', event.session_id);
    if (!location || location.room_node_id !== payload.fromLocationId) throw new Error('Passage operation location is not current.');
    const routes = state.passages.filter(row => row.passage_id === payload.passageId && row.governed_object_id === payload.objectId);
    if (!routes.some(row => row.from_node_id === payload.fromLocationId) || payload.objectId !== 'object.front_door') throw new Error('Passage operation is not available from this side.');
    const current = findBy(state.objectStates, 'object_id', payload.objectId);
    if (!current || current.revision + 1 !== event.aggregate_revision || canonicalize(payload.priorState) !== current.state_json) throw new Error('Passage operation prior state or revision is invalid.');
    exactKeys(payload.priorState, ['locked', 'open'], 'front door prior state'); exactKeys(payload.nextState, ['locked', 'open'], 'front door next state');
    if (typeof payload.priorState.locked !== 'boolean' || typeof payload.priorState.open !== 'boolean' || typeof payload.nextState.locked !== 'boolean' || typeof payload.nextState.open !== 'boolean') throw new Error('Front door state is invalid.');
    const transitions = {
      open: { allowed: !payload.priorState.open && !payload.priorState.locked, next: { locked: false, open: true } },
      close: { allowed: payload.priorState.open, next: { locked: false, open: false } },
      lock: { allowed: payload.fromLocationId === 'place.house' && !payload.priorState.open && !payload.priorState.locked, next: { locked: true, open: false } },
      unlock: { allowed: payload.fromLocationId === 'place.house' && !payload.priorState.open && payload.priorState.locked, next: { locked: false, open: false } },
    }[payload.operation];
    if (!transitions || !transitions.allowed || canonicalize(payload.nextState) !== canonicalize(transitions.next)) throw new Error('Front door transition is not installed.');
    state.objectStates = replaceBy(state.objectStates, 'object_id', payload.objectId, { object_id: payload.objectId, state_json: canonicalize(payload.nextState), revision: event.aggregate_revision, updated_at: event.occurred_at, ...pointer(event) });
  } else if (event.event_kind === 'fixture.turned/v1') {
    exactKeys(causation, ['action'], 'fixture turn causation'); if (causation.action !== 'turn_fixture') throw new Error('Fixture turn causation action is invalid.');
    exactKeys(payload, ['fixtureId', 'fromLocationId', 'priorTurnCount', 'nextTurnCount'], 'fixture turn payload');
    requiredString(event.session_id, 'fixture turn session'); requiredString(payload.fixtureId, 'turned fixture'); requiredString(payload.fromLocationId, 'fixture turn location');
    if (event.aggregate_kind !== 'world_object' || event.aggregate_id !== payload.fixtureId || payload.fixtureId !== 'fixture.garden_turning_stone' || payload.fromLocationId !== 'place.garden' || event.command_id === null || event.actor !== 'resident_tool') throw new Error('Fixture turn aggregate, target, or command envelope is invalid.');
    const location = findBy(state.locations, 'session_id', event.session_id); const current = findBy(state.objectStates, 'object_id', payload.fixtureId);
    if (!location || location.room_node_id !== payload.fromLocationId || !current || current.revision + 1 !== event.aggregate_revision) throw new Error('Fixture turn location or revision is invalid.');
    const prior = JSON.parse(current.state_json); exactKeys(prior, ['turnCount'], 'turning stone state');
    if (!Number.isInteger(payload.priorTurnCount) || payload.priorTurnCount < 0 || payload.priorTurnCount !== prior.turnCount || payload.nextTurnCount !== payload.priorTurnCount + 1) throw new Error('Fixture turn count is not an exact increment.');
    state.objectStates = replaceBy(state.objectStates, 'object_id', payload.fixtureId, { object_id: payload.fixtureId, state_json: canonicalize({ turnCount: payload.nextTurnCount }), revision: event.aggregate_revision, updated_at: event.occurred_at, ...pointer(event) });
  } else if (event.event_kind === 'fixture_runtime.replaced/v1') {
    exactKeys(causation, ['action'], 'fixture runtime causation'); requiredString(causation.action, 'fixture runtime action');
    exactKeys(payload, ['fixtureId', 'state'], 'fixture runtime payload'); requiredString(payload.fixtureId, 'fixture runtime identity'); validateRuntimeState(payload.state);
    if (event.aggregate_kind !== 'fixture_runtime' || event.aggregate_id !== payload.fixtureId) throw new Error('Fixture runtime aggregate envelope is invalid.');
    const transition = {
      recipe_started: { from: ['absent', 'settled', 'failed', 'cancelled'], to: 'running', origin: 'command_or_internal' },
      recipe_completed: { from: ['running', 'stopping'], to: 'settled', origin: 'system' },
      recipe_failed: { from: ['running', 'stopping'], to: 'failed', origin: 'system' },
      recipe_timeout: { from: ['running', 'stopping'], to: 'cancelled', origin: 'system' },
      recipe_runtime_cancelled: { from: ['running', 'stopping'], to: 'cancelled', origin: 'system' },
      recipe_cancelled: { from: ['running'], to: 'cancelled', origin: 'command_or_internal' },
      hub_close_requested: { from: ['running'], to: 'stopping', origin: 'system' },
      hub_closed: { from: ['running', 'stopping'], to: 'cancelled', origin: 'system' },
      restart_reconciled: { from: ['running', 'stopping'], to: 'cancelled', origin: 'system' },
    }[causation.action];
    if (!transition) throw new Error('Fixture runtime causation action is not installed.');
    const fixture = findBy(state.nodes, 'id', payload.fixtureId); if (!fixture || fixture.node_type !== 'fixture' || fixture.lifecycle !== 'standing') throw new Error('Fixture runtime target is unavailable.');
    const current = findBy(state.fixtureRuntimes, 'fixture_id', payload.fixtureId);
    if (current && current.revision + 1 !== event.aggregate_revision) throw new Error('Fixture runtime aggregate revision is not contiguous.');
    const currentState = current ? JSON.parse(current.state_json) : null; const fromStatus = currentState?.status || 'absent';
    if (!transition.from.includes(fromStatus) || transition.to !== payload.state.status) throw new Error('Fixture runtime transition is not installed.');
    const legacyRunningReconciliation = causation.action === 'restart_reconciled' && fromStatus === 'running' && currentState?.runId == null && current?.last_event_sequence === state.operationalBoundary?.sequence;
    const expectedRunId = legacyRunningReconciliation ? legacyBoundaryRunId(payload.fixtureId, current) : currentState?.runId;
    if (causation.action !== 'recipe_started' && (expectedRunId !== payload.state.runId || currentState?.recipe !== payload.state.recipe)) {
      throw Object.assign(new Error('Fixture runtime transition changed run or recipe identity.'), {
        code: 'world_runtime_identity_mismatch', expectedRunId, actualRunId: payload.state.runId,
        expectedRecipe: currentState?.recipe ?? null, actualRecipe: payload.state.recipe,
      });
    }
    if (transition.origin === 'system' && (event.command_id !== null || event.actor !== 'world_runtime')) throw new Error('Fixture runtime system transition envelope is invalid.');
    if (transition.origin === 'command_or_internal' && !((event.command_id !== null && event.actor === 'resident_tool') || (event.command_id === null && event.actor === 'world_internal'))) throw new Error('Fixture runtime command transition envelope is invalid.');
    const next = { fixture_id: payload.fixtureId, state_json: canonicalize(payload.state), revision: event.aggregate_revision, updated_at: event.occurred_at, ...pointer(event) };
    state.fixtureRuntimes = current ? replaceBy(state.fixtureRuntimes, 'fixture_id', payload.fixtureId, next) : [...state.fixtureRuntimes, next];
  } else if (event.event_kind === 'timer.set/v1') {
    exactKeys(causation, ['action'], 'timer set causation'); if (causation.action !== 'timer_set') throw new Error('Timer set causation is invalid.');
    exactKeys(payload, ['seconds', 'dueAt', 'createdAt'], 'timer set payload');
    if (event.aggregate_kind !== 'timer' || event.aggregate_id !== event.session_id) throw new Error('Timer aggregate envelope is invalid.');
    requiredString(event.session_id, 'timer session'); if (!findBy(state.locations, 'session_id', event.session_id)) throw new Error('Timer lifespan is unavailable.');
    if (!Number.isInteger(payload.seconds) || payload.seconds < 1 || payload.seconds > 3600) throw new Error('Timer seconds are invalid.'); validIso(payload.createdAt, 'timer created time'); validIso(payload.dueAt, 'timer due time');
    const createdMs = Date.parse(payload.createdAt); const dueMs = Date.parse(payload.dueAt);
    if (payload.createdAt !== event.occurred_at || !Number.isInteger(createdMs) || !Number.isInteger(dueMs) || dueMs - createdMs !== payload.seconds * 1000) throw new Error('Timer timing is invalid.');
    const current = findBy(state.timers, 'session_id', event.session_id); if (current && current.revision + 1 !== event.aggregate_revision) throw new Error('Timer aggregate revision is not contiguous.');
    const next = { session_id: event.session_id, seconds: payload.seconds, due_at: payload.dueAt, created_at: payload.createdAt, revision: event.aggregate_revision, ...pointer(event) };
    state.timers = current ? replaceBy(state.timers, 'session_id', event.session_id, next) : [...state.timers, next];
  } else if (event.event_kind === 'timer.cleared/v1') {
    exactKeys(causation, ['action'], 'timer clear causation'); if (causation.action !== 'timer_cleared') throw new Error('Timer clear causation is invalid.');
    exactKeys(payload, ['priorDueAt', 'reason'], 'timer clear payload'); requiredString(payload.priorDueAt, 'prior timer due time'); requiredString(payload.reason, 'timer clear reason');
    if (event.aggregate_kind !== 'timer' || event.aggregate_id !== event.session_id) throw new Error('Timer aggregate envelope is invalid.');
    const current = findBy(state.timers, 'session_id', event.session_id); if (!current || current.due_at !== payload.priorDueAt || current.revision + 1 !== event.aggregate_revision) throw new Error('Timer clear does not match current state.');
    state.timers = state.timers.filter(row => row.session_id !== event.session_id);
  } else if (event.event_kind === 'brief.revised/v1') {
    exactKeys(causation, ['action'], 'brief causation'); if (causation.action !== 'brief_revised') throw new Error('Brief causation is invalid.');
    exactKeys(payload, ['briefId', 'objective', 'scopePaths', 'acceptance', 'nonGoals', 'fieldHashes', 'createdAt'], 'brief payload');
    if (event.aggregate_kind !== 'brief' || event.aggregate_id !== event.session_id) throw new Error('Brief aggregate envelope is invalid.'); requiredString(event.session_id, 'brief session'); requiredString(payload.briefId, 'brief identity'); requiredString(payload.objective, 'brief objective');
    for (const key of ['scopePaths', 'acceptance', 'nonGoals']) if (!Array.isArray(payload[key]) || payload[key].some(item => typeof item !== 'string')) throw new Error(`Brief ${key} is invalid.`);
    canonicalObject(payload.fieldHashes, 'brief field hashes'); exactKeys(payload.fieldHashes, ['objective', 'scopePaths', 'acceptance', 'nonGoals'], 'brief field hashes');
    for (const value of Object.values(payload.fieldHashes)) if (!/^[0-9a-f]{64}$/.test(value)) throw new Error('Brief field hash is invalid.'); validIso(payload.createdAt, 'brief created time');
    const expectedFieldHashes = { objective: sha256(payload.objective), scopePaths: sha256(canonicalize(payload.scopePaths)), acceptance: sha256(canonicalize(payload.acceptance)), nonGoals: sha256(canonicalize(payload.nonGoals)) };
    if (canonicalize(payload.fieldHashes) !== canonicalize(expectedFieldHashes)) throw new Error('Brief field hashes do not match the revision.');
    const prior = state.briefs.filter(row => row.session_id === event.session_id).sort((a, b) => b.revision - a.revision)[0];
    if (prior && (prior.brief_id !== payload.briefId || prior.revision + 1 !== event.aggregate_revision || prior.created_at !== payload.createdAt)) throw new Error('Brief revision does not continue current state.');
    if (!prior && event.aggregate_revision !== 1) throw new Error('Brief first revision is invalid.');
    state.briefs.push({ brief_id: payload.briefId, session_id: event.session_id, revision: event.aggregate_revision, objective: payload.objective, scope_paths_json: canonicalize(payload.scopePaths), acceptance_json: canonicalize(payload.acceptance), non_goals_json: canonicalize(payload.nonGoals), field_hashes_json: canonicalize(payload.fieldHashes), created_at: payload.createdAt, updated_at: event.occurred_at, ...pointer(event) });
  } else if (event.event_kind === 'approval.opened/v1') {
    exactKeys(causation, ['action'], 'approval open causation'); if (causation.action !== 'approval_opened') throw new Error('Approval open causation is invalid.');
    exactKeys(payload, ['approvalId', 'kind', 'payload', 'preview'], 'approval open payload'); requiredString(payload.approvalId, 'approval identity'); requiredString(payload.kind, 'approval kind'); canonicalObject(payload.payload, 'approval payload'); canonicalObject(payload.preview, 'approval preview');
    if (!APPROVAL_KINDS.has(payload.kind)) throw new Error('Approval kind is not installed.');
    if (event.aggregate_kind !== 'approval' || event.aggregate_id !== payload.approvalId || event.aggregate_revision !== 1) throw new Error('Approval open aggregate envelope is invalid.'); requiredString(event.session_id, 'approval session');
    if (findBy(state.approvals, 'approval_id', payload.approvalId)) throw new Error('Approval is already open.');
    state.approvals.push({ approval_id: payload.approvalId, session_id: event.session_id, wake_id: event.wake_id, kind: payload.kind, status: 'pending', payload_json: canonicalize(payload.payload), preview_json: canonicalize(payload.preview), application_json: null, outcome_json: null, created_at: event.occurred_at, decided_at: null, revision: 1, ...pointer(event) });
  } else if (event.event_kind === 'approval.applying/v1') {
    exactKeys(causation, ['action'], 'approval applying causation'); if (causation.action !== 'approval_applying') throw new Error('Approval applying causation is invalid.');
    exactKeys(payload, ['attemptId', 'evidence'], 'approval applying payload'); requiredString(payload.attemptId, 'approval attempt identity'); canonicalObject(payload.evidence, 'approval application evidence'); exactKeys(payload.evidence, ['preimage', 'postcondition'], 'approval application evidence');
    if (event.aggregate_kind !== 'approval' || event.command_id === null || event.actor !== 'builder') throw new Error('Approval applying aggregate envelope is invalid.');
    const current = findBy(state.approvals, 'approval_id', event.aggregate_id); if (!current || current.status !== 'pending' || current.revision + 1 !== event.aggregate_revision || current.session_id !== event.session_id) throw new Error('Approval application does not match pending state.');
    const next = { ...current, status: 'applying', application_json: canonicalize({ attemptId: payload.attemptId, evidence: payload.evidence }), revision: event.aggregate_revision, ...pointer(event) };
    state.approvals = replaceBy(state.approvals, 'approval_id', event.aggregate_id, next);
  } else if (event.event_kind === 'approval.resolved/v1') {
    exactKeys(causation, ['action'], 'approval resolve causation'); if (!['approval_confirmed', 'approval_rejected'].includes(causation.action)) throw new Error('Approval resolve causation is invalid.');
    exactKeys(payload, ['status', 'attemptId', 'outcome'], 'approval resolve payload'); if (!['confirmed', 'rejected'].includes(payload.status) || (payload.status === 'confirmed') !== (causation.action === 'approval_confirmed')) throw new Error('Approval resolution status is invalid.');
    if (payload.outcome !== null) canonicalObject(payload.outcome, 'approval outcome');
    if (event.aggregate_kind !== 'approval') throw new Error('Approval resolve aggregate envelope is invalid.');
    const current = findBy(state.approvals, 'approval_id', event.aggregate_id); const application = current?.application_json ? JSON.parse(current.application_json) : null;
    const expectedPriorStatus = payload.status === 'confirmed' ? 'applying' : 'pending';
    if (!current || current.status !== expectedPriorStatus || current.revision + 1 !== event.aggregate_revision || current.session_id !== event.session_id) throw new Error('Approval resolution does not match current state.');
    if (payload.status === 'confirmed' ? payload.attemptId !== application?.attemptId : payload.attemptId !== null) throw new Error('Approval resolution attempt identity is invalid.');
    const next = { ...current, status: payload.status, outcome_json: payload.outcome === null ? null : canonicalize(payload.outcome), decided_at: event.occurred_at, revision: event.aggregate_revision, ...pointer(event) };
    state.approvals = replaceBy(state.approvals, 'approval_id', event.aggregate_id, next);
  } else if (event.event_kind === 'approval.cancelled/v1') {
    exactKeys(causation, ['action'], 'approval cancellation causation'); if (causation.action !== 'approval_cancelled') throw new Error('Approval cancellation causation is invalid.');
    exactKeys(payload, ['reason'], 'approval cancellation payload'); requiredString(payload.reason, 'approval cancellation reason');
    if (event.aggregate_kind !== 'approval') throw new Error('Approval cancellation aggregate envelope is invalid.');
    const current = findBy(state.approvals, 'approval_id', event.aggregate_id); if (!current || current.status !== 'pending' || current.revision + 1 !== event.aggregate_revision || current.session_id !== event.session_id) throw new Error('Approval cancellation does not match current state.');
    const next = { ...current, status: 'cancelled', outcome_json: canonicalize({ reason: payload.reason }), decided_at: event.occurred_at, revision: event.aggregate_revision, ...pointer(event) };
    state.approvals = replaceBy(state.approvals, 'approval_id', event.aggregate_id, next);
  } else if (event.event_kind === 'approval.reconciliation_required/v1') {
    exactKeys(causation, ['action'], 'approval reconciliation causation'); if (causation.action !== 'approval_reconciliation_required') throw new Error('Approval reconciliation causation is invalid.');
    exactKeys(payload, ['attemptId', 'reason'], 'approval reconciliation payload'); requiredString(payload.attemptId, 'approval attempt identity'); requiredString(payload.reason, 'approval reconciliation reason');
    if (event.aggregate_kind !== 'approval' || event.command_id !== null || event.actor !== 'world_runtime') throw new Error('Approval reconciliation aggregate envelope is invalid.');
    const current = findBy(state.approvals, 'approval_id', event.aggregate_id); const application = current?.application_json ? JSON.parse(current.application_json) : null;
    if (!current || current.status !== 'applying' || current.revision + 1 !== event.aggregate_revision || current.session_id !== event.session_id || application?.attemptId !== payload.attemptId) throw new Error('Approval reconciliation does not match applying state.');
    const next = { ...current, status: 'reconciliation_required', outcome_json: canonicalize({ reason: payload.reason }), decided_at: event.occurred_at, revision: event.aggregate_revision, ...pointer(event) };
    state.approvals = replaceBy(state.approvals, 'approval_id', event.aggregate_id, next);
  }
  state.locations.sort((a, b) => a.session_id.localeCompare(b.session_id));
  state.fixtureRuntimes.sort((a, b) => a.fixture_id.localeCompare(b.fixture_id)); state.timers.sort((a, b) => a.session_id.localeCompare(b.session_id));
  state.briefs.sort((a, b) => a.session_id.localeCompare(b.session_id) || a.revision - b.revision); state.approvals.sort((a, b) => a.approval_id.localeCompare(b.approval_id));
  state.nodes.sort((a, b) => a.id.localeCompare(b.id)); state.edges.sort((a, b) => a.id.localeCompare(b.id)); state.passages.sort((a, b) => a.edge_id.localeCompare(b.edge_id)); state.objectStates.sort((a, b) => a.object_id.localeCompare(b.object_id));
  return state;
}
