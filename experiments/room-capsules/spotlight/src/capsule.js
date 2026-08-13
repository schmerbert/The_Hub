import { deepFreeze } from './canonical.js';
import { loadManifest, loadRecordedReplay } from './config.js';
import { assertValidManifest } from './manifest.js';
import { runFirstMarble } from './replay.js';

export function createSpotlightCapsule() {
  const manifest = deepFreeze(assertValidManifest(loadManifest()));

  function inspect(host = { capabilities: {} }) {
    const supplied = host?.capabilities ?? {};
    const bindings = host?.bindings ?? {};
    const sockets = manifest.sockets.map((socket) => ({
      id: socket.id,
      capability: socket.capability,
      state: !Object.hasOwn(supplied, socket.capability)
        ? 'capped_unwired'
        : bindings[socket.id] === socket.capability
          ? 'connected'
          : 'wire_supplied_unbound'
    }));
    const socketState = new Map(sockets.map((socket) => [socket.id, socket.state]));
    const fixtures = manifest.fixtureSlots.map((fixture) => ({
      id: fixture.id,
      state: fixture.accepts.some((socket) => socketState.get(socket) === 'connected')
        ? 'connected'
        : fixture.accepts.some((socket) => socketState.get(socket) === 'wire_supplied_unbound')
          ? 'wire_available_unbound'
          : 'empty_slot',
      sockets: fixture.accepts.map((id) => ({ id, state: socketState.get(id) }))
    }));
    const connectedCapabilities = new Set(sockets.filter(({ state }) => state === 'connected').map(({ capability }) => capability));
    const modes = Object.fromEntries(Object.entries(manifest.modes).map(([name, mode]) => [name, {
      available: mode.alwaysAvailable === true || (mode.requires ?? []).every((capability) => connectedCapabilities.has(capability)),
      missing: (mode.requires ?? []).filter((capability) => !Object.hasOwn(supplied, capability)),
      unbound: (mode.requires ?? []).filter((capability) => Object.hasOwn(supplied, capability) && !connectedCapabilities.has(capability))
    }]));
    const connectedCount = sockets.filter(({ state }) => state === 'connected').length;
    const suppliedCount = sockets.filter(({ state }) => state !== 'capped_unwired').length;
    return deepFreeze({
      identity: manifest.identity.id,
      lifecycle: structuredClone(manifest.lifecycle),
      fitOut: { ...structuredClone(manifest.fitOut), current: connectedCount > 0 || suppliedCount > 0 ? 'wired' : 'bare' },
      expression: structuredClone(manifest.expression),
      fixtures,
      sockets,
      modes,
      outbox: !Object.hasOwn(supplied, 'outbox.resident')
        ? 'dormant_unwired'
        : bindings['socket.resident_outbox'] === 'outbox.resident'
          ? 'connected'
          : 'wire_supplied_unbound',
      authority: structuredClone(manifest.authority)
    });
  }

  function replayFirstMarble(host) {
    const inspection = inspect(host);
    if (!inspection.modes.replay_only.available) {
      const reasons = [];
      if (inspection.modes.replay_only.missing.length) reasons.push(`missing: ${inspection.modes.replay_only.missing.join(', ')}`);
      if (inspection.modes.replay_only.unbound.length) reasons.push(`unbound: ${inspection.modes.replay_only.unbound.join(', ')}`);
      throw new Error(`replay_only unavailable; ${reasons.join('; ')}`);
    }
    return runFirstMarble({
      dataset: loadRecordedReplay(),
      storage: host.capabilities['storage.append_only'],
      clock: host.capabilities['clock.replay']
    });
  }

  function invoke(operationId, host, input = null) {
    const operation = manifest.operations.find(({ id }) => id === operationId);
    if (!operation) throw new Error(`Unknown or undeclared operation: ${operationId}`);
    if (operation.externalEffects !== false || operation.observationalOnly !== true) throw new Error(`Operation is not observational-only: ${operationId}`);
    if (input !== null && (typeof input !== 'object' || Array.isArray(input))) throw new Error('Operation input must be an object or null');
    if (operationId === 'operation.replay_first_marble') return replayFirstMarble(host);
    throw new Error(`Operation has no implementation: ${operationId}`);
  }

  return deepFreeze({ apiVersion: manifest.apiVersion, manifest, inspect, invoke, replayFirstMarble });
}

export function createRoomCapsule() {
  return createSpotlightCapsule();
}
