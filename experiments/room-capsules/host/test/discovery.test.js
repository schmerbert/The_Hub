import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { discoverCapsules } from '../src/discovery.js';
import { baseManifest, createSyntheticCapsule, standardSource } from './helpers.js';

function temporaryRoot(t) {
  const root = mkdtempSync(join(tmpdir(), 'capsule-host-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test('discovery is inert and does not execute an entrypoint', (t) => {
  const root = temporaryRoot(t);
  const marker = join(root, 'executed.marker');
  const manifest = baseManifest('room.inert', 'operation.observe');
  const source = `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(marker)}, 'executed');\n${standardSource(manifest)}`;
  createSyntheticCapsule(root, 'inert-room', manifest, source);
  const [descriptor] = discoverCapsules(root);
  assert.equal(descriptor.identity, 'room.inert');
  assert.equal(descriptor.state, 'discovered_inert');
  assert.match(descriptor.manifestHash, /^sha256:/);
  assert.match(descriptor.entrypointHash, /^sha256:/);
  assert.equal(existsSync(marker), false);
});

test('two unrelated synthetic capsules are discovered generically', (t) => {
  const root = temporaryRoot(t);
  createSyntheticCapsule(root, 'alpha', baseManifest('room.alpha', 'operation.observe_alpha'));
  createSyntheticCapsule(root, 'beta', baseManifest('room.beta', 'operation.observe_beta'));
  assert.deepEqual(discoverCapsules(root).map(({ identity }) => identity), ['room.alpha', 'room.beta']);
});

test('malformed and oversized manifests are refused', async (t) => {
  await t.test('malformed', (t) => {
    const root = temporaryRoot(t);
    const capsule = join(root, 'bad');
    mkdirSync(capsule);
    writeFileSync(join(capsule, 'room.json'), '{oops', 'utf8');
    assert.throws(() => discoverCapsules(root), /Malformed JSON manifest/);
  });
  await t.test('oversized', (t) => {
    const root = temporaryRoot(t);
    createSyntheticCapsule(root, 'large');
    assert.throws(() => discoverCapsules(root, { limits: { manifestBytes: 20, entrypointBytes: 1024 * 1024 } }), /manifest exceeds/);
  });
});

test('path traversal, symlinks, duplicate identities, and conflicting authority are refused', async (t) => {
  await t.test('traversal', (t) => {
    const root = temporaryRoot(t);
    createSyntheticCapsule(root, 'escape', { ...baseManifest(), entrypoint: '../outside.mjs' });
    assert.throws(() => discoverCapsules(root), /safe relative/);
  });
  await t.test('symlink', (t) => {
    const root = temporaryRoot(t);
    const capsule = createSyntheticCapsule(root, 'linked');
    const linkPath = join(capsule, 'linked-src');
    try {
      symlinkSync(join(capsule, 'src'), linkPath, 'junction');
    } catch (error) {
      if (error.code === 'EPERM') return t.skip('filesystem does not permit symlink creation');
      throw error;
    }
    const manifest = baseManifest();
    manifest.entrypoint = 'linked-src/entry.mjs';
    writeFileSync(join(capsule, 'room.json'), JSON.stringify(manifest), 'utf8');
    assert.throws(() => discoverCapsules(root), /Symlink entrypoint refused/);
  });
  await t.test('duplicate identity', (t) => {
    const root = temporaryRoot(t);
    createSyntheticCapsule(root, 'one', baseManifest('room.same'));
    createSyntheticCapsule(root, 'two', baseManifest('room.same'));
    assert.throws(() => discoverCapsules(root), /Duplicate room identity/);
  });
  await t.test('conflicting operation authority', (t) => {
    const root = temporaryRoot(t);
    const manifest = baseManifest();
    manifest.operations[0].externalEffects = true;
    createSyntheticCapsule(root, 'conflict', manifest);
    assert.throws(() => discoverCapsules(root), /externalEffects false/);
  });
});
