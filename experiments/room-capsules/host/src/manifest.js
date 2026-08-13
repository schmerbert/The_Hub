const TYPE_FIRST = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;
const API_VERSION = 'room-capsule.v1';

export function validateRoomManifest(manifest) {
  const errors = [];
  if (!plainObject(manifest)) return { ok: false, errors: ['manifest must be an object'] };
  if (manifest.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  if (manifest.apiVersion !== API_VERSION) errors.push(`apiVersion must be ${API_VERSION}`);
  if (!plainObject(manifest.identity) || !TYPE_FIRST.test(manifest.identity?.id ?? '') || !manifest.identity.id.startsWith('room.')) errors.push('identity.id must be a type-first room.* identifier');
  if (manifest.identity?.kind !== 'room') errors.push('identity.kind must be room');
  if (typeof manifest.identity?.version !== 'string' || manifest.identity.version.length === 0) errors.push('identity.version is required');
  if (manifest.status?.classification !== 'experimental' || manifest.status?.activation !== 'inert' || manifest.status?.standing !== false || manifest.status?.autoInstall !== false) errors.push('lab capsules must be experimental, inert, non-standing, and non-auto-installing');
  if (manifest.authority?.selfAuthorization !== false) errors.push('selfAuthorization must be false');
  if (manifest.authority?.financialExecution !== false) errors.push('financialExecution must be false');
  if (manifest.authority?.externalEffects !== false) errors.push('manifest externalEffects must be false');
  if (!safeEntrypoint(manifest.entrypoint)) errors.push('entrypoint must be a safe relative in-capsule .js or .mjs path');

  const sockets = Array.isArray(manifest.sockets) ? manifest.sockets : [];
  if (!Array.isArray(manifest.sockets)) errors.push('sockets must be an array');
  unique(sockets.map(({ id }) => id), 'socket id', errors);
  unique(sockets.map(({ capability }) => capability), 'socket capability', errors);
  for (const socket of sockets) {
    if (!TYPE_FIRST.test(socket?.id ?? '') || !socket.id.startsWith('socket.')) errors.push(`invalid socket id: ${socket?.id}`);
    if (!TYPE_FIRST.test(socket?.capability ?? '')) errors.push(`invalid capability id: ${socket?.capability}`);
  }
  const capabilities = new Set(sockets.map(({ capability }) => capability));
  const modes = plainObject(manifest.modes) ? manifest.modes : {};
  if (!plainObject(manifest.modes) || !modes.bare || modes.bare.alwaysAvailable !== true) errors.push('bare mode must always be available');
  for (const [modeId, mode] of Object.entries(modes)) {
    if (!/^[a-z][a-z0-9_]*$/.test(modeId) || !plainObject(mode)) errors.push(`invalid mode: ${modeId}`);
    for (const capability of mode?.requires ?? []) if (!capabilities.has(capability)) errors.push(`mode ${modeId} requires undeclared capability ${capability}`);
  }

  const operations = Array.isArray(manifest.operations) ? manifest.operations : [];
  if (!Array.isArray(manifest.operations)) errors.push('operations must be an array');
  unique(operations.map(({ id }) => id), 'operation id', errors);
  for (const operation of operations) {
    if (!TYPE_FIRST.test(operation?.id ?? '') || !operation.id.startsWith('operation.')) errors.push(`invalid operation id: ${operation?.id}`);
    if (!Object.hasOwn(modes, operation?.requiredMode)) errors.push(`operation ${operation?.id} requires unknown mode ${operation?.requiredMode}`);
    if (operation?.observationalOnly !== true) errors.push(`operation ${operation?.id} must be observationalOnly`);
    if (operation?.externalEffects !== false) errors.push(`operation ${operation?.id} must set externalEffects false`);
  }
  return { ok: errors.length === 0, errors };
}

export function assertValidRoomManifest(manifest) {
  const result = validateRoomManifest(manifest);
  if (!result.ok) throw new Error(`Invalid room manifest:\n- ${result.errors.join('\n- ')}`);
  return manifest;
}

export function safeEntrypoint(value) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\\') || value.includes('\0')) return false;
  if (value.startsWith('/') || /^[A-Za-z]:/.test(value) || !/\.(?:m?js)$/.test(value)) return false;
  const parts = value.split('/');
  return parts.every((part) => part && part !== '.' && part !== '..');
}

function unique(values, label, errors) {
  const seen = new Set();
  for (const value of values) {
    if (seen.has(value)) errors.push(`duplicate ${label}: ${value}`);
    seen.add(value);
  }
}

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
