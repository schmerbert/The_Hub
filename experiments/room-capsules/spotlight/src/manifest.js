const IDENTIFIER = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

export function validateManifest(manifest) {
  const errors = [];
  if (manifest?.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  if (manifest?.apiVersion !== 'room-capsule.v1') errors.push('apiVersion must be room-capsule.v1');
  if (manifest?.entrypoint !== 'src/capsule.js') errors.push('entrypoint must be src/capsule.js');
  if (manifest?.identity?.id !== 'room.spotlight') errors.push('identity.id must be room.spotlight');
  if (manifest?.identity?.kind !== 'room') errors.push('identity.kind must be room');
  if (manifest?.status?.classification !== 'experimental') errors.push('status must be experimental');
  if (manifest?.status?.activation !== 'inert') errors.push('activation must be inert');
  if (manifest?.status?.standing !== false) errors.push('standing must be false');
  if (manifest?.status?.autoInstall !== false) errors.push('autoInstall must be false');
  if (manifest?.lifecycle?.current === manifest?.fitOut?.current) errors.push('lifecycle and fit-out must be independent');
  if (!manifest?.expression?.clinicalDefault) errors.push('clinical expression is required');

  const fixtures = manifest?.fixtureSlots ?? [];
  const fixtureIds = new Set();
  for (const fixture of fixtures) {
    if (!IDENTIFIER.test(fixture.id) || !fixture.id.startsWith('fixture.')) errors.push(`invalid fixture id: ${fixture.id}`);
    if (fixtureIds.has(fixture.id)) errors.push(`duplicate fixture id: ${fixture.id}`);
    fixtureIds.add(fixture.id);
  }
  const expectedFixtures = ['fixture.present_window', 'fixture.past_archive', 'fixture.packet_table', 'fixture.replay_table', 'fixture.bell', 'fixture.helm'];
  for (const id of expectedFixtures) if (!fixtureIds.has(id)) errors.push(`missing fixture: ${id}`);

  const sockets = manifest?.sockets ?? [];
  const socketIds = new Set(sockets.map((socket) => socket.id));
  for (const socket of sockets) {
    if (!IDENTIFIER.test(socket.id) || !socket.id.startsWith('socket.')) errors.push(`invalid socket id: ${socket.id}`);
  }
  for (const fixture of fixtures) {
    for (const socketId of fixture.accepts ?? []) if (!socketIds.has(socketId)) errors.push(`${fixture.id} accepts undeclared ${socketId}`);
  }
  const capabilities = new Set(sockets.map((socket) => socket.capability));
  for (const capability of manifest?.modes?.replay_only?.requires ?? []) {
    if (!capabilities.has(capability)) errors.push(`replay_only requires undeclared capability: ${capability}`);
  }
  const serialized = JSON.stringify(manifest).toLowerCase();
  if (serialized.includes('financial_execution') || serialized.includes('financial-execution')) errors.push('financial execution must not be declared');
  if (manifest?.authority?.financialExecution !== false) errors.push('financial execution authority must be explicitly false');
  if (manifest?.authority?.selfAuthorization !== false) errors.push('self-authorization must be explicitly false');
  const operations = manifest?.operations ?? [];
  if (operations.length !== 1 || operations[0]?.id !== 'operation.replay_first_marble') errors.push('first marble operation must be declared exactly once');
  if (operations[0]?.requiredMode !== 'replay_only') errors.push('first marble operation requires replay_only');
  if (operations[0]?.observationalOnly !== true || operations[0]?.externalEffects !== false) errors.push('first marble operation must be observational only');
  return { ok: errors.length === 0, errors };
}

export function assertValidManifest(manifest) {
  const result = validateManifest(manifest);
  if (!result.ok) throw new Error(`Invalid Spotlight manifest:\n- ${result.errors.join('\n- ')}`);
  return manifest;
}
