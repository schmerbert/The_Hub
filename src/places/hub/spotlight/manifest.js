import { readFileSync } from 'node:fs';
import { deepFreeze } from './canonical.js';
import { SPOTLIGHT_TOOL_NAMES } from './tools.js';

const MANIFEST_URL = new URL('./room.json', import.meta.url);

export function loadSpotlightManifest() {
  return deepFreeze(JSON.parse(readFileSync(MANIFEST_URL, 'utf8')));
}

export function validateSpotlightManifest(manifest = loadSpotlightManifest()) {
  const errors = [];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return { ok: false, errors: ['manifest must be an object'] };
  if (manifest.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  if (manifest.apiVersion !== 'room-installation.v1') errors.push('apiVersion must be room-installation.v1');
  if (manifest.identity?.id !== 'room.spotlight' || manifest.identity?.kind !== 'room') errors.push('identity must be room.spotlight room');
  if (manifest.status?.classification !== 'standing' || manifest.status?.autoInstall !== false) errors.push('manifest must be standing and non-auto-installing');
  if (manifest.package?.entrypoint !== 'index.js' || manifest.package?.declarationExport !== 'SPOTLIGHT') errors.push('package entrypoint/export is invalid');
  if (manifest.placement?.requestedParent !== 'place.hub' || manifest.placement?.hostOwnsDoor !== true) errors.push('placement must remain host-owned');
  if (manifest.placement?.entrancePolicy !== 'installed') errors.push('Spotlight entrance must be host-installed');
  if (manifest.authority?.selfInstall !== false || manifest.authority?.selfAuthorize !== false || manifest.authority?.ambientAuthority !== false) errors.push('authority must remain explicitly false');
  const fixtures = new Set(SPOTLIGHT_FIXTURE_IDS);
  for (const group of manifest.affordanceGroups || []) if (!fixtures.has(group.fixtureId)) errors.push(`affordance references undeclared fixture ${group.fixtureId}`);
  const effects = new Map((manifest.affordanceGroups || []).flatMap(group => (group.tools || []).map(name => [name, group.effect])));
  const expectedEffects = {
    spotlight_capability_status: 'observe', spotlight_observation_list: 'observe', spotlight_observation_read: 'observe', spotlight_observe: 'observe', spotlight_packet_build: 'observe', spotlight_replay: 'observe',
    spotlight_trade_propose: 'govern', spotlight_trade_execute: 'execute', spotlight_ring_propose: 'govern', spotlight_ring_adjust: 'execute',
  };
  const declaredTools = (manifest.affordanceGroups || []).flatMap(group => group.tools || []);
  const expectedTools = [...SPOTLIGHT_TOOL_NAMES].sort();
  if (JSON.stringify([...declaredTools].sort()) !== JSON.stringify(expectedTools)) errors.push('Spotlight affordances must declare every installed hand exactly once');
  if (declaredTools.some(name => !SPOTLIGHT_TOOL_NAMES.includes(name))) errors.push('Spotlight affordances contain an unknown hand');
  for (const [name, effect] of Object.entries(expectedEffects)) if (effects.get(name) !== effect) errors.push(`Spotlight hand ${name} must retain effect ${effect}`);
  return { ok: errors.length === 0, errors };
}

export const assertValidSpotlightManifest = manifest => {
  const result = validateSpotlightManifest(manifest);
  if (!result.ok) throw new Error(`Invalid Spotlight manifest:\n- ${result.errors.join('\n- ')}`);
  return manifest;
};

export const SPOTLIGHT_FIXTURE_IDS = Object.freeze([
  'fixture.spotlight_landscape',
  'fixture.spotlight_telescope',
  'fixture.spotlight_archive',
  'fixture.spotlight_table',
  'fixture.spotlight_bell',
]);
