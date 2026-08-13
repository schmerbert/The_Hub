import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HubDatabase } from '../src/ledger/source.js';

test('fresh Source begins in the closure era and atomically traces new human Scroll rows', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-trace-epoch-'));
  const db = new HubDatabase(join(dir, 'hub.sqlite'));
  try {
    const epoch = db.getTraceEpoch();
    assert.equal(epoch.boundaryKind, 'scroll_trace_boundary/v1');
    assert.equal(JSON.parse(epoch.preBoundaryHeadJson).historyCount, 0);
    const wake = db.createSessionWake({ provider: 'fake', model: 'test', content: 'after the boundary' });
    const history = db.getSessionHistory(wake.sessionId);
    const trace = db.sqlite.prepare('SELECT * FROM scroll_trace_manifests WHERE history_id=?').get(history[0].id);
    const manifest = JSON.parse(trace.manifest_json);
    assert.equal(manifest.source.eventId, wake.eventId);
    assert.equal(manifest.gate.kind, 'http_wake_validation+source_append');
    assert.equal(manifest.destination.authority, 'Session Scroll');
    assert.equal(manifest.disposition, 'retained_in_session_scroll');
  } finally { db.close(); await rm(dir, { recursive: true, force: true }); }
});

test('an inherited Source receives one honest boundary without backfilling old Scroll rows', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-trace-legacy-'));
  const path = join(dir, 'hub.sqlite');
  const fresh = new HubDatabase(path);
  fresh.sqlite.exec('DROP TRIGGER trace_epochs_append_only_delete; DELETE FROM scroll_trace_manifests; DELETE FROM trace_epochs;');
  const wake = fresh.createSessionWake({ provider: 'fake', model: 'test', content: 'old trail' });
  fresh.close();
  const inherited = new HubDatabase(path);
  try {
    assert.equal(inherited.getTraceEpoch(), null);
    const result = inherited.establishTraceEpoch();
    assert.equal(result.status, 'established');
    assert.equal(JSON.parse(result.epoch.preBoundaryHeadJson).historyCount, 1);
    assert.equal(inherited.sqlite.prepare('SELECT COUNT(*) AS count FROM scroll_trace_manifests').get().count, 0);
    assert.equal(inherited.establishTraceEpoch().status, 'already_established');
    assert.throws(() => inherited.sqlite.prepare('UPDATE trace_epochs SET law_hash=?').run('tamper'), /append-only/);
    assert.equal(inherited.getSessionHistory(wake.sessionId).length, 1);
  } finally { inherited.close(); await rm(dir, { recursive: true, force: true }); }
});
