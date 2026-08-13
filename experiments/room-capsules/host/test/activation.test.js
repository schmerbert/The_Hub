import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { activateCapsule } from '../src/activation.js';
import { discoverCapsules } from '../src/discovery.js';
import { baseManifest, createSyntheticCapsule } from './helpers.js';

function setup(t, source) {
  const root = mkdtempSync(join(tmpdir(), 'capsule-activation-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  createSyntheticCapsule(root, 'room', baseManifest('room.activation'), source);
  return discoverCapsules(root)[0];
}

test('activation requires exact explicit room approval', async (t) => {
  const descriptor = setup(t);
  await assert.rejects(() => activateCapsule(descriptor), /Explicit approval required/);
  await assert.rejects(() => activateCapsule(descriptor, { approvedRoomId: 'room.someone_else' }), /Explicit approval required/);
  const active = await activateCapsule(descriptor, { approvedRoomId: 'room.activation' });
  assert.equal(active.state, 'activated_in_process');
});

test('activation refuses entrypoint hash drift', async (t) => {
  const descriptor = setup(t);
  appendFileSync(descriptor.entrypointPath, '\n// drift\n', 'utf8');
  await assert.rejects(() => activateCapsule(descriptor, { approvedRoomId: descriptor.identity }), /Entrypoint hash drift refused/);
});

test('activation refuses manifest hash drift', async (t) => {
  const descriptor = setup(t);
  appendFileSync(descriptor.manifestPath, ' ', 'utf8');
  await assert.rejects(() => activateCapsule(descriptor, { approvedRoomId: descriptor.identity }), /Manifest hash drift refused/);
});

test('activation refuses a standard interface mismatch', async (t) => {
  const descriptor = setup(t, 'export const notTheContract = true;\n');
  await assert.rejects(() => activateCapsule(descriptor, { approvedRoomId: descriptor.identity }), /lacks createRoomCapsule/);
});
