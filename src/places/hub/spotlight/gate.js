import { deepFreeze, isPlainObject } from './canonical.js';
import { SPOTLIGHT_TOOL_APPROVAL_CLASS, SPOTLIGHT_TOOL_NAMES } from './tools.js';

export const SPOTLIGHT_GATE_API = 'spotlight-capability-gate.v1';
export const SPOTLIGHT_ACTIVATION_LAW = 'law.spotlight_hands_activation';

// This is the portable room's capability matrix. A later host revision may
// replace the room-owned service with a verified adapter without changing the
// World handler registry or the provider-facing names.
export const SPOTLIGHT_CAPABILITY_MATRIX = deepFreeze({
  spotlight_capability_status: { requires: [], fixtureId: 'fixture.spotlight_bell' },
  spotlight_observation_list: { requires: ['socket.observation_custody', 'custody.spotlight_observations', 'law.observation_list'], fixtureId: 'fixture.spotlight_landscape' },
  spotlight_observation_read: { requires: ['socket.observation_custody', 'custody.spotlight_observations', 'law.observation_read'], fixtureId: 'fixture.spotlight_landscape' },
  spotlight_observe: { requires: ['socket.observation_source', 'socket.observation_custody', 'custody.spotlight_observations', 'law.observation'], fixtureId: 'fixture.spotlight_telescope' },
  spotlight_packet_build: { requires: ['socket.observation_custody', 'socket.packet_custody', 'custody.spotlight_observations', 'custody.spotlight_packets', 'law.packet_build'], fixtureId: 'fixture.spotlight_table' },
  spotlight_replay: { requires: ['socket.replay_clock', 'socket.observation_custody', 'socket.packet_custody', 'custody.spotlight_observations', 'custody.spotlight_packets', 'law.replay'], fixtureId: 'fixture.spotlight_archive' },
  spotlight_trade_propose: { requires: ['socket.strategy', 'custody.spotlight_packets', 'law.trade_propose'], fixtureId: 'fixture.spotlight_table' },
  spotlight_trade_execute: { requires: ['socket.strategy', 'socket.trade_account', 'socket.trade_approval', 'socket.trade_execution', 'custody.spotlight_packets', 'law.trade_execute'], fixtureId: 'fixture.spotlight_table' },
  spotlight_ring_propose: { requires: ['socket.strategy', 'custody.spotlight_packets', 'law.ring_propose'], fixtureId: 'fixture.spotlight_table' },
  spotlight_ring_adjust: { requires: ['socket.strategy', 'socket.trade_account', 'socket.ring_approval', 'socket.ring_execution', 'custody.spotlight_packets', 'law.ring_adjust'], fixtureId: 'fixture.spotlight_table' },
});

function bindingReady(binding, kind) {
  if (typeof binding === 'function') return true;
  if (binding === true) return true;
  if (!isPlainObject(binding)) return false;
  if (binding.owner !== undefined && binding.owner !== 'host') return false;
  if (binding.state !== undefined && binding.state !== 'installed') return false;
  if (binding.installed !== undefined && binding.installed !== true) return false;
  return binding.ready === true || binding.state === 'installed' || binding.installed === true || binding.enabled === true;
}

function normalizeBindings(bindings = {}) {
  const source = isPlainObject(bindings) ? bindings : {};
  return {
    sockets: isPlainObject(source.sockets) ? source.sockets : {},
    custody: isPlainObject(source.custody) ? source.custody : {},
    laws: isPlainObject(source.laws) ? source.laws : {},
  };
}

function lookup(bindings, requirement) {
  const [kind, ...rest] = requirement.split('.');
  const key = `${kind}.${rest.join('.')}`;
  if (kind === 'socket') return bindings.sockets[key];
  if (kind === 'custody') return bindings.custody[key];
  if (kind === 'law') return bindings.laws[key];
  return undefined;
}

function requirementState(bindings, requirement) {
  const kind = requirement.startsWith('socket.') ? 'socket' : requirement.startsWith('custody.') ? 'custody' : 'law';
  const binding = lookup(bindings, requirement);
  const ready = bindingReady(binding, kind);
  return { id: requirement, kind, state: ready ? 'installed' : 'optional_unwired', ready };
}

function missingRequirements(bindings, name) {
  const matrix = SPOTLIGHT_CAPABILITY_MATRIX[name];
  const missing = (matrix?.requires || []).map(requirement => requirementState(bindings, requirement)).filter(item => !item.ready);
  // No generic callable escape hatch exists in this revision. The activation
  // law remains absent even when a caller supplies placeholder bindings. A
  // future typed implementation must replace this room-owned service
  // alongside its validator and custody protocol.
  if (name !== 'spotlight_capability_status') missing.push({ id: SPOTLIGHT_ACTIVATION_LAW, kind: 'law', state: 'optional_unwired', ready: false });
  return missing;
}

function handStatus(bindings, name) {
  const matrix = SPOTLIGHT_CAPABILITY_MATRIX[name];
  const missing = missingRequirements(bindings, name);
  return {
    name,
    fixtureId: matrix?.fixtureId || null,
    approvalClass: SPOTLIGHT_TOOL_APPROVAL_CLASS[name] || 'auto',
    requirements: [...(matrix?.requires || [])],
    usable: name === 'spotlight_capability_status' || missing.length === 0,
    status: name === 'spotlight_capability_status' || missing.length === 0 ? 'available' : 'withheld',
    missingRequirements: missing,
  };
}

function capabilityStatus(bindings) {
  const hands = SPOTLIGHT_TOOL_NAMES.map(name => handStatus(bindings, name));
  return {
    kind: 'spotlight_capability_status',
    apiVersion: SPOTLIGHT_GATE_API,
    roomId: 'room.spotlight',
    status: 'available',
    availability: 'available',
    capped: hands.some(hand => !hand.usable),
    hands,
    missingRequirements: hands.flatMap(hand => hand.missingRequirements.map(requirement => ({ hand: hand.name, ...requirement }))),
    network: false,
    mutated: false,
  };
}

function withheld(name, bindings) {
  const missing = missingRequirements(bindings, name);
  return {
    kind: 'spotlight_hand_result',
    apiVersion: SPOTLIGHT_GATE_API,
    roomId: 'room.spotlight',
    toolName: name,
    status: 'withheld',
    availability: 'unavailable',
    reason: 'missing_requirements',
    missingRequirements: missing,
    missing: missing.map(item => item.id),
    attempted: false,
    network: false,
    mutated: false,
    approvalCreated: false,
  };
}

export class SpotlightCapabilityService {
  constructor({ bindings = {}, ...direct } = {}) {
    const normalized = normalizeBindings({ ...bindings, ...direct });
    this.bindings = normalized;
    Object.freeze(this.bindings);
  }

  status() { return deepFreeze(capabilityStatus(this.bindings)); }
  capabilityStatus() { return this.status(); }
  requirements(name) { return [...(SPOTLIGHT_CAPABILITY_MATRIX[name]?.requires || [])]; }

  invoke(name, args = {}, context = {}) {
    if (!SPOTLIGHT_CAPABILITY_MATRIX[name]) {
      return withheld(name, this.bindings);
    }
    if (name === 'spotlight_capability_status') return this.status();
    const missing = missingRequirements(this.bindings, name);
    if (missing.length) return deepFreeze(withheld(name, this.bindings));
    // The default room service is intentionally a gate only. It never calls a
    // provider, writes custody, or creates approval. A future typed service
    // implementation may be injected after its own protocol is adopted.
    return deepFreeze(withheld(name, this.bindings));
  }

  execute(name, args = {}, context = {}) { return this.invoke(name, args, context); }
}

export function createSpotlightCapabilityService(options = {}) {
  return new SpotlightCapabilityService(options);
}

export function defaultSpotlightCapabilityMatrix() {
  return structuredClone(SPOTLIGHT_CAPABILITY_MATRIX);
}
