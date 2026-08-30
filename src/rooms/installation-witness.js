import { canonicalize, sha256 } from '../core/hash.js';
import { assertValidRoomInstallationManifest } from './installation-contract.js';

export const ROOM_INSTALLATION_WITNESS_VERSION = 'room-installation-witness.v1';

export function buildRoomInstallationWitness({ manifest, manifestBytes, topology, fixtures, tools, sockets, custody }) {
  assertValidRoomInstallationManifest(manifest);
  const gaps = [];
  if (!topology?.roomInstalled) gaps.push('topology.room_missing');
  if (!topology?.parentInstalled) gaps.push('topology.parent_missing');
  if (!topology?.parentEdgeInstalled) gaps.push('topology.parent_edge_missing');
  const entrancePolicy = manifest.placement.entrancePolicy || 'installed';
  if (entrancePolicy === 'installed' && !topology?.entranceInstalled) gaps.push('topology.entrance_missing');
  if (entrancePolicy === 'withheld' && topology?.entranceInstalled) gaps.push('topology.entrance_unexpected');

  const installedFixtures = new Set(fixtures || []);
  const declaredFixtures = [...new Set(manifest.affordanceGroups.map(group => group.fixtureId))].sort();
  for (const fixtureId of declaredFixtures) if (!installedFixtures.has(fixtureId)) gaps.push(`fixture.missing:${fixtureId}`);

  const toolFacts = new Map((tools || []).map(tool => [tool.name, tool]));
  const declaredTools = manifest.affordanceGroups.flatMap(group => group.tools).sort();
  for (const name of declaredTools) {
    const fact = toolFacts.get(name);
    if (!fact?.ceiling) gaps.push(`ceiling.missing:${name}`);
    if (!fact?.mounted) gaps.push(`mount.missing:${name}`);
    if (!fact?.schemaHash) gaps.push(`schema.missing:${name}`);
    if (!fact?.handler) gaps.push(`handler.missing:${name}`);
    if (!['auto','confirm'].includes(fact?.approvalClass)) gaps.push(`approval.missing:${name}`);
  }
  for (const name of toolFacts.keys()) if (!declaredTools.includes(name)) gaps.push(`tool.undeclared:${name}`);

  const socketFacts = new Map((sockets || []).map(socket => [socket.id, socket]));
  for (const declared of manifest.sockets) {
    const fact = socketFacts.get(declared.id);
    if (!fact || fact.capability !== declared.capability || fact.owner !== 'host' || !['installed','optional_unwired'].includes(fact.state)) gaps.push(`socket.unfitted:${declared.id}`);
    if (!declared.optional && fact?.state !== 'installed') gaps.push(`socket.required_unwired:${declared.id}`);
  }
  for (const id of socketFacts.keys()) if (!manifest.sockets.some(socket => socket.id === id)) gaps.push(`socket.undeclared:${id}`);

  const custodyFacts = new Map((custody || []).map(route => [route.id, route]));
  for (const declared of manifest.custody) {
    const fact = custodyFacts.get(declared.id);
    if (!fact || fact.owner !== 'host' || !['installed','optional_unwired'].includes(fact.state)) gaps.push(`custody.unfitted:${declared.id}`);
    if (!declared.optional && fact?.state !== 'installed') gaps.push(`custody.required_unwired:${declared.id}`);
  }
  for (const id of custodyFacts.keys()) if (!manifest.custody.some(route => route.id === id)) gaps.push(`custody.undeclared:${id}`);

  const body = {
    version: ROOM_INSTALLATION_WITNESS_VERSION,
    roomId: manifest.identity.id,
    packageVersion: manifest.identity.version,
    manifestHash: sha256(manifestBytes),
    ...(manifest.placement.entrancePolicy ? { entrancePolicy } : {}),
    topology,
    fixtures: declaredFixtures.map(id => ({ id, installed: installedFixtures.has(id) })),
    affordances: manifest.affordanceGroups.map(group => ({
      id: group.id,
      fixtureId: group.fixtureId,
      effect: group.effect,
      tools: group.tools.map(name => ({ name, ...toolFacts.get(name) })),
    })),
    sockets: manifest.sockets.map(declared => ({ ...declared, binding: socketFacts.get(declared.id) || null })),
    custody: manifest.custody.map(declared => ({ ...declared, binding: custodyFacts.get(declared.id) || null })),
    gaps: [...new Set(gaps)].sort(),
  };
  const witness = { ...body, verified: body.gaps.length === 0, witnessHash: sha256(canonicalize(body)) };
  return deepFreeze(witness);
}

export function assertVerifiedRoomInstallation(witness) {
  const { witnessHash, verified, ...body } = witness || {};
  if (!verified || witness?.gaps?.length || witnessHash !== sha256(canonicalize(body))) {
    throw new Error(`Room installation is not verified: ${(witness?.gaps || ['invalid_witness']).join(', ')}`);
  }
  return witness;
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}
