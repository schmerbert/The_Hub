import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { HubDatabase } from '../src/ledger/source.js';

test('Source waits through bounded transient external write contention', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-source-busy-'));
  const path = join(dir, 'hub.sqlite');
  const db = new HubDatabase(path, { busyTimeoutMs: 2000 });
  const holderCode = `
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(process.argv[1]);
    db.exec('BEGIN EXCLUSIVE');
    process.stdout.write('locked\\n');
    setTimeout(() => { db.exec('ROLLBACK'); db.close(); }, 350);
  `;
  const holder = spawn(process.execPath, ['-e', holderCode, path], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  try {
    await once(holder.stdout, 'data');
    const started = Date.now();
    const wake = db.createSessionWake({ provider: 'fake', model: 'test-model', content: 'wait for custody' });
    assert.ok(Date.now() - started >= 200);
    assert.equal(db.getWake(wake.wakeId).status, 'assembling');
    assert.equal(db.sqlite.prepare('PRAGMA busy_timeout').get().timeout, 2000);
    const exitCode = holder.exitCode === null ? (await once(holder, 'exit'))[0] : holder.exitCode;
    assert.equal(exitCode, 0);
  } finally {
    if (holder.exitCode === null) holder.kill();
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
