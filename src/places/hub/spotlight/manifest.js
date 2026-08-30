import { readFileSync } from 'node:fs';
import { deepFreeze } from './canonical.js';

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
  if (manifest.placement?.entrancePolicy !== 'withheld') errors.push('Spotlight entrance must remain withheld');
  if (manifest.authority?.selfInstall !== false || manifest.authority?.selfAuthorize !== false || manifest.authority?.ambientAuthority !== false) errors.push('authority must remain explicitly false');
  const fixtures = new Set(SPOTLIGHT_FIXTURE_IDS);
  for (const group of manifest.affordanceGroups || []) if (!fixtures.has(group.fixtureId)) errors.push(`affordance references undeclared fixture ${group.fixtureId}`);
  if ((manifest.affordanceGroups || []).some(group => group.effect !== 'observe' || group.tools?.length)) errors.push('v1 must not declare executable Spotlight tools');
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
