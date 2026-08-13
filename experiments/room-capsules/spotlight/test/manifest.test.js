import test from 'node:test';
import assert from 'node:assert/strict';
import { loadManifest } from '../src/config.js';
import { validateManifest } from '../src/manifest.js';

test('manifest is valid, inert, and separates its three state axes', () => {
  const manifest = loadManifest();
  assert.deepEqual(validateManifest(manifest), { ok: true, errors: [] });
  assert.equal(manifest.identity.id, 'room.spotlight');
  assert.equal(manifest.status.classification, 'experimental');
  assert.equal(manifest.status.activation, 'inert');
  assert.equal(manifest.status.standing, false);
  assert.equal(manifest.status.autoInstall, false);
  assert.equal(manifest.lifecycle.current, 'discovered');
  assert.equal(manifest.fitOut.current, 'bare');
  assert.equal(manifest.expression.current, 'expression.spotlight.clinical');
});

test('manifest exposes no execution authority or financial socket', () => {
  const manifest = loadManifest();
  assert.equal(manifest.authority.selfAuthorization, false);
  assert.equal(manifest.authority.financialExecution, false);
  assert.equal(manifest.authority.externalEffects, false);
  assert.equal(manifest.sockets.some(({ id, capability }) => /execut|broker|wallet|order/i.test(`${id} ${capability}`)), false);
});
