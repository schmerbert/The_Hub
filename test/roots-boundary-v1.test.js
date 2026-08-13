import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHub } from '../src/server/app.js';
import { HubDatabase } from '../src/ledger/source.js';

test('a new Hearth packet is rooted, non-respirable, and closed into its response Glass cast', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-roots-'));
  const hub = createHub({ env: { HUB_RESIDENT_MODE: 'fake', HUB_DB_PATH: join(dir, 'hub.sqlite'), HUB_SPINE_PATH: join(dir, 'spine.jsonl') } });
  try {
    const wake = await hub.wake('root this wake');
    assert.equal(wake.status, 'committed');
    assert.equal(wake.roots.length, 1);
    const rooted = wake.roots[0];
    assert.equal(rooted.kind, 'wake_packet');
    assert.equal(rooted.payload.custody.respiration, 'prohibited');
    assert.equal(rooted.payload.custody.forestExhaleEligible, false);
    assert.equal(rooted.payload.markdown, wake.hearth.scrollMarkdown);
    assert.equal(rooted.edges.length, 1);
    assert.equal(rooted.edges[0].relation, 'presented_in_glass');
    assert.equal(rooted.edges[0].targetId, wake.phases.find(phase => phase.phase === 'response').glassCast.receiptId);
    assert.equal(hub.db.verifyRoots().verified, true);
    assert.throws(() => hub.db.sqlite.prepare('UPDATE root_artifacts SET content_hash=?').run('tamper'), /append-only/);
    assert.throws(() => hub.db.sqlite.prepare('DELETE FROM root_wake_packets').run(), /append-only/);
  } finally { await hub.close(); await rm(dir, { recursive: true, force: true }); }
});

test('Roots is a forward boundary and does not fabricate custody for inherited Hearth packets', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-roots-legacy-')); const path = join(dir, 'hub.sqlite');
  const hub = createHub({ env: { HUB_RESIDENT_MODE: 'fake', HUB_DB_PATH: path, HUB_SPINE_PATH: join(dir, 'spine.jsonl') } });
  try { await hub.wake('historical packet'); } finally { await hub.close(); }
  let db = new HubDatabase(path, { openSession: false });
  try {
    db.sqlite.exec('DROP TRIGGER root_edges_append_only_delete; DELETE FROM root_edges; DROP TRIGGER root_wake_packets_append_only_delete; DELETE FROM root_wake_packets; DROP TRIGGER root_artifacts_append_only_delete; DELETE FROM root_artifacts; DROP TRIGGER roots_epochs_append_only_delete; DELETE FROM roots_epochs;');
    db.close();
    db = new HubDatabase(path, { openSession: false });
    const result = db.establishRootsEpoch();
    assert.equal(result.status, 'established');
    assert.equal(JSON.parse(result.epoch.preBoundaryHeadJson).hearthPacketCount, 1);
    assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS count FROM root_artifacts').get().count, 0);
    assert.equal(db.verifyRoots().verified, true);
    assert.equal(db.establishRootsEpoch().status, 'already_established');
  } finally { try { db.close(); } catch {} await rm(dir, { recursive: true, force: true }); }
});

test('Roots maintenance establishment does not create a resident lifespan', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-roots-maintenance-')); const path = join(dir, 'hub.sqlite');
  const live = new HubDatabase(path); const before = live.listSessions(); live.close();
  const maintenance = new HubDatabase(path, { openSession: false });
  try { assert.equal(maintenance.session, null); assert.equal(maintenance.establishRootsEpoch().status, 'already_established'); assert.deepEqual(maintenance.listSessions(), before); }
  finally { maintenance.close(); await rm(dir, { recursive: true, force: true }); }
});
