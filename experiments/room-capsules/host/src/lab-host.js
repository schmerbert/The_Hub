import { deepFreeze } from './immutable.js';

export function createLabHost(manifest) {
  const declared = new Map(manifest.sockets.map((socket) => [socket.id, socket.capability]));
  const declaredCapabilities = new Set(declared.values());
  const capabilities = new Map();
  const bindings = new Map();

  function attach(capabilityId, implementation) {
    if (!declaredCapabilities.has(capabilityId)) throw new Error(`Capability not declared by capsule: ${capabilityId}`);
    if (!implementation || typeof implementation !== 'object') throw new Error(`Capability implementation must be an object: ${capabilityId}`);
    if (capabilities.has(capabilityId)) throw new Error(`Capability already supplied: ${capabilityId}`);
    capabilities.set(capabilityId, implementation);
  }

  function bind(socketId, capabilityId) {
    if (!declared.has(socketId)) throw new Error(`Unknown socket: ${socketId}`);
    if (declared.get(socketId) !== capabilityId) throw new Error(`Socket ${socketId} does not accept ${capabilityId}`);
    if (!capabilities.has(capabilityId)) throw new Error(`Cannot bind unsupplied capability: ${capabilityId}`);
    if (bindings.has(socketId)) throw new Error(`Socket already bound: ${socketId}`);
    bindings.set(socketId, capabilityId);
  }

  function view() {
    return deepFreeze({
      capabilities: deepFreeze(Object.fromEntries(capabilities)),
      bindings: deepFreeze(Object.fromEntries(bindings))
    });
  }

  return deepFreeze({ attach, bind, view });
}
