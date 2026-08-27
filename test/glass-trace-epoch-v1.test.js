import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHub } from '../src/server/app.js';
import { HubDatabase } from '../src/ledger/source.js';

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'hub-glass-trace-'));
  const hub = createHub({ env: { HUB_RESIDENT_MODE: 'fake', HUB_DB_PATH: join(dir, 'hub.sqlite'), HUB_SPINE_PATH: join(dir, 'spine.jsonl') } });
  return { dir, hub };
}

test('fresh Glass casts close every source into a durable witness and provider disposition', async () => {
  const f = await fixture();
  try {
    const wake = await f.hub.wake('follow this packet');
    assert.equal(wake.status, 'committed');
    assert.equal(wake.phases.length, 2);
    for (const phase of wake.phases) {
      assert.ok(phase.glassTrace?.manifestId);
      assert.equal(phase.glassGroundReceipts.length, 5);
      const manifest = phase.glassTrace.manifest;
      assert.equal(manifest.items.every(item => item.source?.authority && ['presented', 'omitted'].includes(item.disposition.kind)), true);
      assert.equal(manifest.items.filter(item => item.disposition.kind === 'presented').length, JSON.parse(phase.requestBody).messages.length);
      assert.equal(manifest.items.find(item => item.kind === 'stable_glass').source.authority, 'code_owned_glass');
      assert.equal(manifest.items.find(item => item.kind === 'crossing_ground').source.authority, 'glass_ground_receipt');
      assert.equal(manifest.items.find(item => item.kind === 'world_current_ground').source.authority, 'glass_ground_receipt');
      assert.equal(manifest.items.find(item => item.kind === 'user').source.authority, 'Session Scroll');
    }
    assert.throws(() => f.hub.db.sqlite.prepare('UPDATE glass_trace_manifests SET manifest_hash=?').run('tamper'), /append-only/);
    assert.throws(() => f.hub.db.sqlite.prepare('DELETE FROM glass_ground_receipts').run(), /append-only/);
    assert.equal(f.hub.db.verifyGlassTrace().verified, true);
    f.hub.db.sqlite.exec('DROP TRIGGER glass_trace_manifests_append_only_update');
    f.hub.db.sqlite.prepare('UPDATE glass_trace_manifests SET manifest_hash=? WHERE id=?').run('tamper', wake.phases[0].glassTrace.manifestId);
    const drift = f.hub.db.verifyGlassTrace();
    assert.equal(drift.verified, false);
    assert.equal(drift.mismatches.some(item => item.code === 'glass_trace_trigger_missing'), true);
    assert.equal(drift.mismatches.some(item => item.code === 'glass_trace_manifest_hash_mismatch'), true);
  } finally { await f.hub.close(); await rm(f.dir, { recursive: true, force: true }); }
});

test('later casts retain the exact Hearth Scroll pair until ordinary attention pressure', async () => {
  const f = await fixture();
  try {
    await f.hub.wake('first packet');
    const second = await f.hub.wake('second packet');
    const trace = second.phases[0].glassTrace.manifest;
    const hearthHistoryIds = new Set(f.hub.db.getSessionHistory(second.sessionId).filter(row => (row.messageKind === 'assistant_tool_call' || row.messageKind === 'tool_result') && (row.messageJson.includes('tend_hearth') || row.messageJson.includes('# Hearth'))).map(row => row.id));
    const hearthItems = trace.items.filter(item => hearthHistoryIds.has(item.source?.historyId));
    assert.equal(hearthItems.length, 2);
    assert.equal(hearthItems.every(item => item.disposition.kind === 'presented' && item.source.authority === 'Session Scroll' && item.source.historyId && Number.isInteger(item.source.ordinal)), true);
  } finally { await f.hub.close(); await rm(f.dir, { recursive: true, force: true }); }
});

test('an inherited database receives one Glass boundary without backfilling old casts', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-glass-trace-legacy-')); const path = join(dir, 'hub.sqlite');
  const db = new HubDatabase(path);
  try {
    db.sqlite.exec('DROP TRIGGER glass_trace_epochs_append_only_delete; DELETE FROM glass_trace_epochs;');
  } finally { db.close(); }
  const inherited = new HubDatabase(path);
  try {
    assert.equal(inherited.getGlassTraceEpoch(), null);
    const result = inherited.establishGlassTraceEpoch();
    assert.equal(result.status, 'established');
    assert.equal(JSON.parse(result.epoch.preBoundaryHeadJson).castCount, 0);
    assert.equal(inherited.sqlite.prepare('SELECT COUNT(*) AS count FROM glass_trace_manifests').get().count, 0);
    assert.equal(inherited.establishGlassTraceEpoch().status, 'already_established');
  } finally { inherited.close(); await rm(dir, { recursive: true, force: true }); }
});

test('maintenance establishment does not open, close, or insert a resident lifespan', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-glass-trace-maintenance-')); const path = join(dir, 'hub.sqlite');
  const live = new HubDatabase(path); const before = live.listSessions(); live.close();
  const maintenance = new HubDatabase(path, { openSession: false });
  try {
    assert.equal(maintenance.session, null);
    assert.equal(maintenance.establishGlassTraceEpoch().status, 'already_established');
    assert.deepEqual(maintenance.listSessions(), before);
  } finally { maintenance.close(); await rm(dir, { recursive: true, force: true }); }
});
