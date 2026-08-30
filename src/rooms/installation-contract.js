const TYPE_FIRST = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;
const TOOL_NAME = /^[a-z][a-z0-9_]*$/;

export const ROOM_INSTALLATION_API = 'room-installation.v1';

export function validateRoomInstallationManifest(manifest) {
  const errors = [];
  if (!plainObject(manifest)) return { ok: false, errors: ['manifest must be an object'] };
  if (manifest.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  if (manifest.apiVersion !== ROOM_INSTALLATION_API) errors.push(`apiVersion must be ${ROOM_INSTALLATION_API}`);
  if (!TYPE_FIRST.test(manifest.identity?.id ?? '') || !manifest.identity.id.startsWith('room.')) errors.push('identity.id must be a type-first room.* identifier');
  if (manifest.identity?.kind !== 'room') errors.push('identity.kind must be room');
  if (typeof manifest.identity?.version !== 'string' || !manifest.identity.version) errors.push('identity.version is required');
  if (!['standing','experimental'].includes(manifest.status?.classification)) errors.push('status.classification must be standing or experimental');
  if (manifest.status?.autoInstall !== false) errors.push('status.autoInstall must be false');
  if (manifest.authority?.selfInstall !== false) errors.push('authority.selfInstall must be false');
  if (manifest.authority?.selfAuthorize !== false) errors.push('authority.selfAuthorize must be false');
  if (manifest.authority?.ambientAuthority !== false) errors.push('authority.ambientAuthority must be false');
  if (!safeRelativeModule(manifest.package?.entrypoint)) errors.push('package.entrypoint must be a safe relative .js module');
  if (!safeExportName(manifest.package?.declarationExport)) errors.push('package.declarationExport must be a safe export name');
  if (!TYPE_FIRST.test(manifest.placement?.requestedParent ?? '') || !manifest.placement.requestedParent.startsWith('place.')) errors.push('placement.requestedParent must be a place.* identifier');
  if (manifest.placement?.hostOwnsDoor !== true) errors.push('placement.hostOwnsDoor must be true');
  if (manifest.placement?.entrancePolicy !== undefined && !['installed','withheld'].includes(manifest.placement.entrancePolicy)) errors.push('placement.entrancePolicy must be installed or withheld');

  const sockets = array(manifest.sockets, 'sockets', errors);
  unique(sockets.map(item => item?.id), 'socket id', errors);
  for (const socket of sockets) {
    if (!TYPE_FIRST.test(socket?.id ?? '') || !socket.id.startsWith('socket.')) errors.push(`invalid socket id: ${socket?.id}`);
    if (!TYPE_FIRST.test(socket?.capability ?? '')) errors.push(`invalid socket capability: ${socket?.capability}`);
    if (socket?.suppliedBy !== 'host') errors.push(`socket ${socket?.id} must be supplied by host`);
  }

  const socketIds = new Set(sockets.map(item => item.id));
  const groups = array(manifest.affordanceGroups, 'affordanceGroups', errors);
  unique(groups.map(item => item?.id), 'affordance group id', errors);
  const tools = [];
  for (const group of groups) {
    if (!TYPE_FIRST.test(group?.id ?? '') || !group.id.startsWith('affordance.')) errors.push(`invalid affordance group id: ${group?.id}`);
    if (!TYPE_FIRST.test(group?.fixtureId ?? '') || !group.fixtureId.startsWith('fixture.')) errors.push(`invalid fixture id: ${group?.fixtureId}`);
    if (!['observe','mutate','execute','govern'].includes(group?.effect)) errors.push(`invalid effect for ${group?.id}`);
    if (group?.approvalPolicy !== 'host_owned') errors.push(`${group?.id} approvalPolicy must be host_owned`);
    for (const socketId of group?.requires ?? []) if (!socketIds.has(socketId)) errors.push(`${group?.id} requires undeclared ${socketId}`);
    for (const tool of group?.tools ?? []) {
      if (!TOOL_NAME.test(tool)) errors.push(`invalid tool name: ${tool}`);
      tools.push(tool);
    }
  }
  unique(tools, 'tool name', errors);

  const custody = array(manifest.custody, 'custody', errors);
  for (const route of custody) {
    if (!TYPE_FIRST.test(route?.id ?? '') || !route.id.startsWith('custody.')) errors.push(`invalid custody route id: ${route?.id}`);
    if (route?.installedBy !== 'host') errors.push(`${route?.id} must be installed by host`);
  }
  if (manifest.removal?.hostDecision !== true || manifest.removal?.preserveCustody !== true) errors.push('removal must be host-decided and preserve custody');
  return { ok: errors.length === 0, errors };
}

export function assertValidRoomInstallationManifest(manifest) {
  const result = validateRoomInstallationManifest(manifest);
  if (!result.ok) throw new Error(`Invalid room installation manifest:\n- ${result.errors.join('\n- ')}`);
  return manifest;
}

export function safeRelativeModule(value) {
  if (typeof value !== 'string' || !value.endsWith('.js') || value.includes('\\') || value.includes('\0') || value.startsWith('/') || /^[A-Za-z]:/.test(value)) return false;
  return value.split('/').every(part => part && part !== '.' && part !== '..');
}

function safeExportName(value) { return typeof value === 'string' && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value); }
function plainObject(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function array(value, label, errors) { if (!Array.isArray(value)) { errors.push(`${label} must be an array`); return []; } return value; }
function unique(values, label, errors) { const seen = new Set(); for (const value of values) { if (seen.has(value)) errors.push(`duplicate ${label}: ${value}`); seen.add(value); } }
