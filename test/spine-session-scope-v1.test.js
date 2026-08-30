import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { SpineStore, readSpineLedgerFrames, sessionSpinePath, verifySpine } from '../src/spine/store.js';
import { createHub } from '../src/server/app.js';

test('default runtime Spine opens one independent ledger per process-lived session', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-spine-session-'));
  const dbPath = join(dir, 'hub.sqlite');
  const basePath = join(dir, 'spine.jsonl');
  let first = createHub({ env: { HUB_RESIDENT_MODE: 'fake' }, dbPath });
  try {
    await first.wake('first session');
    assert.equal(first.spine.path, sessionSpinePath(basePath, first.db.session.id));
  } finally { await first.close(); }

  let second = createHub({ env: { HUB_RESIDENT_MODE: 'fake' }, dbPath });
  try {
    assert.notEqual(second.spine.path, first.spine.path);
    assert.equal(second.spine.frames().length, 0);
    await second.wake('second session');
    assert.equal(verifySpine(basePath).ledgerCount, 2);
    assert.equal(readSpineLedgerFrames(basePath).filter(frame => frame.frame_type === 'request_prepared').length, 4);
  } finally {
    await second.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('an explicitly configured Spine path retains single-ledger compatibility', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-spine-explicit-'));
  const path = join(dir, 'exact.jsonl');
  const spine = new SpineStore(path);
  try { assert.equal(spine.path, path); }
  finally { spine.close(); await rm(dir, { recursive: true, force: true }); }
});
