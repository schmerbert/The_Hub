import { pathToFileURL } from 'node:url';
import { reverifyDescriptor } from './discovery.js';
import { deepFreeze } from './immutable.js';

export async function activateCapsule(descriptor, { approvedRoomId } = {}) {
  if (approvedRoomId !== descriptor.identity) throw new Error(`Explicit approval required for ${descriptor.identity}`);
  reverifyDescriptor(descriptor);
  const moduleUrl = pathToFileURL(descriptor.entrypointPath);
  moduleUrl.searchParams.set('verified', descriptor.entrypointHash.slice(7));
  const namespace = await import(moduleUrl.href);
  if (typeof namespace.createRoomCapsule !== 'function') throw new Error(`Capsule ${descriptor.identity} lacks createRoomCapsule()`);
  const capsule = namespace.createRoomCapsule();
  if (!capsule || typeof capsule !== 'object') throw new Error(`Capsule ${descriptor.identity} returned no interface`);
  if (capsule.apiVersion !== descriptor.apiVersion) throw new Error(`Capsule API mismatch for ${descriptor.identity}`);
  if (capsule.manifest?.identity?.id !== descriptor.identity || capsule.manifest?.identity?.version !== descriptor.version) throw new Error(`Capsule manifest identity/version mismatch for ${descriptor.identity}`);
  if (typeof capsule.inspect !== 'function' || typeof capsule.invoke !== 'function') throw new Error(`Capsule ${descriptor.identity} lacks standard inspect/invoke methods`);
  return deepFreeze({ descriptor, capsule, state: 'activated_in_process' });
}
