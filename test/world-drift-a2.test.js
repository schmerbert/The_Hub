import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { WorldGraphStore, KILN_FIXTURE_ID } from '../src/world/graph.js';
import { canonicalize, sha256 } from '../src/core/hash.js';
import { computeWorldEventHash, verifyWorldA2Sqlite, WORLD_A2_PROJECTION_TABLE_SQL, WORLD_INTEGRITY_TRIGGER_SQL } from '../src/world/events.js';
import { WorldActionGateway } from '../src/world/gateway.js';
import { WorkshopAdapter } from '../src/places/hub/workshop/index.js';

async function fixture(options) {
  const dir = await mkdtemp(join(tmpdir(), 'hub-world-a2-'));
  const path = join(dir, 'world.sqlite');
  const world = new WorldGraphStore(path, { topologyVersion: 'b1', ...options });
  return { dir, path, world, close: async () => { world.close(); await rm(dir, { recursive: true, force: true }); } };
}

function downgradeOperationalTablesToA1(sqlite) {
  sqlite.exec(`PRAGMA foreign_keys=OFF;
    DROP TRIGGER IF EXISTS world_event_journal_append_only_update;
    DROP TRIGGER IF EXISTS world_event_journal_append_only_delete;
    DROP TRIGGER IF EXISTS world_nodes_append_only_update;
    DROP TRIGGER IF EXISTS world_nodes_append_only_delete;
    DROP TRIGGER IF EXISTS world_edges_append_only_update;
    DROP TRIGGER IF EXISTS world_edges_append_only_delete;
    DROP TRIGGER IF EXISTS world_passages_append_only_update;
    DROP TRIGGER IF EXISTS world_passages_append_only_delete;`);
  const extension = sqlite.prepare("SELECT * FROM world_event_journal WHERE event_kind='topology.extended/v1'").get();
  if (extension) {
    sqlite.prepare('DELETE FROM world_event_journal WHERE sequence=?').run(extension.sequence);
    let previous = sqlite.prepare('SELECT event_hash FROM world_event_journal WHERE sequence=?').get(extension.sequence - 1).event_hash;
    for (const original of sqlite.prepare('SELECT * FROM world_event_journal WHERE sequence>? ORDER BY sequence').all(extension.sequence)) {
      const event = { ...original, sequence: original.sequence - 1, previous_event_hash: previous }; event.event_hash = computeWorldEventHash(event);
      sqlite.prepare('UPDATE world_event_journal SET sequence=?,previous_event_hash=?,event_hash=? WHERE sequence=?').run(event.sequence, event.previous_event_hash, event.event_hash, original.sequence);
      for (const table of ['world_locations', 'world_fixture_runtime', 'world_timers', 'world_work_briefs', 'world_approvals']) {
        if (sqlite.prepare("SELECT 1 ok FROM sqlite_master WHERE type='table' AND name=?").get(table)) sqlite.prepare(`UPDATE ${table} SET last_event_sequence=?,last_event_hash=? WHERE last_event_sequence=? AND last_event_hash=?`).run(event.sequence, event.event_hash, original.sequence, original.event_hash);
      }
      previous = event.event_hash;
    }
    sqlite.exec("DELETE FROM world_edges WHERE edge_type IN ('passage','boundary') OR from_node_id='place.hub'; DELETE FROM world_edges WHERE last_event_sequence=2; DELETE FROM world_nodes WHERE last_event_sequence=2; DROP TABLE world_passages; DROP TABLE world_object_states;");
    const nodeSql = WORLD_A2_PROJECTION_TABLE_SQL.world_nodes.replace('CREATE TABLE IF NOT EXISTS world_nodes', 'CREATE TABLE world_nodes_a2');
    const edgeSql = WORLD_A2_PROJECTION_TABLE_SQL.world_edges.replace('CREATE TABLE IF NOT EXISTS world_edges', 'CREATE TABLE world_edges_a2');
    sqlite.exec(nodeSql); sqlite.exec('INSERT INTO world_nodes_a2 SELECT * FROM world_nodes'); sqlite.exec(edgeSql); sqlite.exec('INSERT INTO world_edges_a2 SELECT * FROM world_edges');
    sqlite.exec('DROP TABLE world_edges; DROP TABLE world_nodes; ALTER TABLE world_nodes_a2 RENAME TO world_nodes; ALTER TABLE world_edges_a2 RENAME TO world_edges;');
  }
  for (const trigger of ['world_event_journal_append_only_update', 'world_event_journal_append_only_delete', 'world_nodes_append_only_update', 'world_nodes_append_only_delete', 'world_edges_append_only_update', 'world_edges_append_only_delete']) sqlite.exec(WORLD_INTEGRITY_TRIGGER_SQL[trigger]);
  sqlite.exec(`PRAGMA foreign_keys=OFF;
    DROP TRIGGER IF EXISTS world_action_receipts_append_only_update;
    DROP TRIGGER IF EXISTS world_action_receipts_append_only_delete;
    DROP TRIGGER IF EXISTS world_approval_receipts_append_only_update;
    DROP TRIGGER IF EXISTS world_approval_receipts_append_only_delete;
    ALTER TABLE world_fixture_runtime RENAME TO world_fixture_runtime_a2;
    CREATE TABLE world_fixture_runtime (fixture_id TEXT PRIMARY KEY, state_json TEXT NOT NULL, updated_at TEXT NOT NULL);
    INSERT INTO world_fixture_runtime SELECT fixture_id,state_json,updated_at FROM world_fixture_runtime_a2;
    DROP TABLE world_fixture_runtime_a2;
    ALTER TABLE world_timers RENAME TO world_timers_a2;
    CREATE TABLE world_timers (session_id TEXT PRIMARY KEY, seconds INTEGER NOT NULL CHECK(seconds>=1 AND seconds<=3600), due_at TEXT NOT NULL, created_at TEXT NOT NULL);
    INSERT INTO world_timers SELECT session_id,seconds,due_at,created_at FROM world_timers_a2;
    DROP TABLE world_timers_a2;
    ALTER TABLE world_work_briefs RENAME TO world_work_briefs_a2;
    CREATE TABLE world_work_briefs (brief_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0), objective TEXT NOT NULL, scope_paths_json TEXT NOT NULL, acceptance_json TEXT NOT NULL, non_goals_json TEXT NOT NULL, field_hashes_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    INSERT INTO world_work_briefs SELECT brief_id,session_id,revision,objective,scope_paths_json,acceptance_json,non_goals_json,field_hashes_json,created_at,updated_at FROM world_work_briefs_a2;
    DROP TABLE world_work_briefs_a2;
    ALTER TABLE world_approvals RENAME TO world_approvals_a2;
    CREATE TABLE world_approvals (approval_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, wake_id TEXT, kind TEXT NOT NULL CHECK(kind IN ('patch','unified_diff','write_file','create_path','delete_path','rename_path','git_add','commit','git_checkout','sandbox_promotion')), status TEXT NOT NULL CHECK(status IN ('pending','confirmed','rejected','cancelled')), payload_json TEXT NOT NULL, preview_json TEXT NOT NULL, outcome_json TEXT, created_at TEXT NOT NULL, decided_at TEXT);
    INSERT INTO world_approvals SELECT approval_id,session_id,wake_id,kind,status,payload_json,preview_json,outcome_json,created_at,decided_at FROM world_approvals_a2;
    DROP TABLE world_approvals_a2;
    ALTER TABLE world_action_receipts RENAME TO world_action_receipts_a2;
    CREATE TABLE world_action_receipts (receipt_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, wake_id TEXT, room_node_id TEXT NOT NULL REFERENCES world_nodes(id), tool_name TEXT NOT NULL, arguments_json TEXT NOT NULL, result_json TEXT NOT NULL, outcome TEXT NOT NULL CHECK(outcome IN ('committed','refused')), request_record_id TEXT, spine_record_id TEXT, created_at TEXT NOT NULL);
    INSERT INTO world_action_receipts SELECT receipt_id,session_id,wake_id,room_node_id,tool_name,arguments_json,result_json,outcome,request_record_id,spine_record_id,created_at FROM world_action_receipts_a2;
    DROP TABLE world_action_receipts_a2;
    ALTER TABLE world_approval_receipts RENAME TO world_approval_receipts_a2;
    CREATE TABLE world_approval_receipts (receipt_id TEXT PRIMARY KEY, approval_id TEXT NOT NULL REFERENCES world_approvals(approval_id), session_id TEXT NOT NULL, wake_id TEXT, phase TEXT NOT NULL CHECK(phase IN ('pending','confirmed','rejected','cancelled')), action_receipt_id TEXT NOT NULL REFERENCES world_action_receipts(receipt_id), result_json TEXT NOT NULL, host_return_scrub_json TEXT NOT NULL, created_at TEXT NOT NULL);
    INSERT INTO world_approval_receipts SELECT receipt_id,approval_id,session_id,wake_id,phase,action_receipt_id,result_json,host_return_scrub_json,created_at FROM world_approval_receipts_a2;
    DROP TABLE world_approval_receipts_a2;
    CREATE TRIGGER world_action_receipts_append_only_update BEFORE UPDATE ON world_action_receipts BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
    CREATE TRIGGER world_action_receipts_append_only_delete BEFORE DELETE ON world_action_receipts BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
    CREATE TRIGGER world_approval_receipts_append_only_update BEFORE UPDATE ON world_approval_receipts BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
    CREATE TRIGGER world_approval_receipts_append_only_delete BEFORE DELETE ON world_approval_receipts BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
    PRAGMA foreign_keys=ON;`);
}

test('A2 runtime, timer, brief history, and approval state replay exactly', async () => {
  const f = await fixture({ now: () => Date.parse('2026-08-11T12:00:00.000Z') });
  try {
    f.world.ensureLifespan('life');
    f.world.setFixtureRuntime(KILN_FIXTURE_ID, { status: 'running', recipe: 'node_test' }, { sessionId: 'life', wakeId: 'wake', action: 'recipe_started' });
    f.world.setFixtureRuntime(KILN_FIXTURE_ID, { status: 'settled', recipe: 'node_test', code: 0 }, { sessionId: 'life', wakeId: 'wake', action: 'recipe_completed' });
    f.world.setTimer('life', 60, { wakeId: 'wake' });
    f.world.setTimer('life', 90, { wakeId: 'wake' });
    f.world.cancelTimer('life', { wakeId: 'wake' });
    f.world.upsertBrief({ sessionId: 'life', wakeId: 'wake', objective: 'first' });
    f.world.upsertBrief({ sessionId: 'life', wakeId: 'wake', objective: 'second' });
    const opened = f.world.createApproval({ sessionId: 'life', wakeId: 'wake', kind: 'write_file', payload: { path: 'a', content: 'b' }, preview: { path: 'a' } });
    f.world.decideApproval(opened.approvalId, 'reject', { rejected: true });
    assert.deepEqual(f.world.listBriefRevisions('life').map(row => [row.revision, row.objective]), [[1, 'first'], [2, 'second']]);
    assert.equal(f.world.sqlite.prepare('SELECT COUNT(*) AS count FROM world_timers').get().count, 0);
    assert.equal(f.world.getFixtureRuntime(KILN_FIXTURE_ID).status, 'settled');
    assert.equal(f.world.getApproval(opened.approvalId).status, 'rejected');
    assert.equal(f.world.verification().verified, true);
  } finally { await f.close(); }
});

test('A1 journal upgrade is explicit, backup-gated, transactional, and admits legacy custody by boundary', async () => {
  const f = await fixture();
  f.world.ensureLifespan('life');
  f.world.actionReceipt({ sessionId: 'life', roomNodeId: 'room.center', toolName: 'workshop_list', arguments: {}, result: { kind: 'workshop_list' }, outcome: 'committed' });
  f.world.close();
  const sqlite = new DatabaseSync(f.path); downgradeOperationalTablesToA1(sqlite); sqlite.close();
  const upgrade = new WorldGraphStore(f.path, { topologyVersion: 'b1' });
  try {
    assert.equal(upgrade.inspectA2Upgrade().status, 'upgrade_required');
    assert.throws(() => upgrade.migrateA2(), error => error.code === 'world_a2_backup_required');
    const result = upgrade.migrateA2({ backupConfirmed: true });
    assert.equal(result.status, 'migrated');
    assert.equal(verifyWorldA2Sqlite(upgrade.sqlite).verified, true);
    assert.equal(upgrade.sqlite.prepare("SELECT COUNT(*) AS count FROM world_event_journal WHERE event_kind='operational_snapshot.imported/v1'").get().count, 1);
    const receipt = upgrade.sqlite.prepare('SELECT world_event_sequence,world_event_hash FROM world_action_receipts').get();
    assert.equal(receipt.world_event_sequence, null); assert.equal(receipt.world_event_hash, null);
  } finally { upgrade.close(); await rm(f.dir, { recursive: true, force: true }); }
});

test('A2 event and projection failures roll back, including the explicit schema upgrade', async () => {
  for (const phase of ['after_event_append', 'after_projection_apply']) {
    const f = await fixture();
    try {
      f.world.ensureLifespan('life');
      const before = f.world.verification().eventCount;
      f.world.eventFailureInjector = ({ phase: actual }) => { if (actual === phase) throw new Error(`fail ${phase}`); };
      assert.throws(() => f.world.setFixtureRuntime(KILN_FIXTURE_ID, { status: 'running', recipe: 'node_test' }, { sessionId: 'life', action: 'recipe_started' }), new RegExp(phase));
      f.world.eventFailureInjector = null;
      assert.equal(f.world.verification().eventCount, before);
      assert.equal(f.world.getFixtureRuntime(KILN_FIXTURE_ID), null);
    } finally { await f.close(); }
  }

  const f = await fixture(); f.world.ensureLifespan('life'); f.world.close();
  const sqlite = new DatabaseSync(f.path); downgradeOperationalTablesToA1(sqlite); sqlite.close();
  const upgrade = new WorldGraphStore(f.path, { eventFailureInjector: ({ phase }) => { if (phase === 'after_projection_apply') throw new Error('upgrade rollback'); } });
  try {
    assert.throws(() => upgrade.migrateA2({ backupConfirmed: true }), /upgrade rollback/);
    upgrade.eventFailureInjector = null;
    assert.equal(upgrade.inspectA2Upgrade().status, 'upgrade_required');
    assert.equal(upgrade.sqlite.prepare("SELECT COUNT(*) AS count FROM world_event_journal WHERE event_kind='operational_snapshot.imported/v1'").get().count, 0);
    assert.deepEqual(upgrade.sqlite.prepare('PRAGMA table_info(world_timers)').all().map(row => row.name), ['session_id', 'seconds', 'due_at', 'created_at']);
  } finally { upgrade.close(); await rm(f.dir, { recursive: true, force: true }); }
});

test('Gateway state events, projections, and required custody roll back as one World transaction', async () => {
  const f = await fixture(); const root = join(f.dir, 'repo'); await mkdir(root);
  f.world.ensureLifespan('life'); f.world.move({ sessionId: 'life', wakeId: 'wake', doorId: 'door.workshop' });
  const recipes = {
    active: null,
    start: async recipe => ({ kind: 'workshop_recipe_started', status: 'running', recipe }),
    status: () => ({ running: false }),
    cancel: async () => ({ cancelled: false }),
    close: () => ({ cancelled: false }),
  };
  const gateway = new WorldActionGateway({ world: f.world, workshop: new WorkshopAdapter(root), recipeRunner: recipes });
  const call = (id, name, args) => gateway.execute({ sessionId: 'life', wakeId: 'wake', intent: { id, type: 'function', function: { name, arguments: JSON.stringify(args) } } });
  try {
    const originalActionReceipt = f.world.actionReceipt;
    const beforeTimer = f.world.verification().eventCount;
    f.world.actionReceipt = () => { throw new Error('injected action custody failure'); };
    await assert.rejects(call('timer', 'workshop_timer_set', { seconds: 20 }), /injected action custody failure/);
    f.world.actionReceipt = originalActionReceipt;
    assert.equal(f.world.verification().eventCount, beforeTimer);
    assert.equal(f.world.getTimer('life').status, 'none');

    const beforeAsync = f.world.verification().eventCount;
    f.world.actionReceipt = () => { throw new Error('injected async custody failure'); };
    await assert.rejects(call('recipe', 'workshop_run_recipe', { recipe: 'node_test', path: 'test/example.test.js' }), /injected async custody failure/);
    f.world.actionReceipt = originalActionReceipt;
    assert.equal(f.world.verification().eventCount, beforeAsync);
    assert.equal(f.world.getFixtureRuntime(KILN_FIXTURE_ID), null);

    const originalApprovalReceipt = f.world.recordApprovalReceipt;
    const beforeApproval = f.world.verification().eventCount;
    f.world.recordApprovalReceipt = () => { throw new Error('injected approval custody failure'); };
    await assert.rejects(call('write', 'workshop_write_file', { path: 'new.txt', content: 'exact\n' }), /injected approval custody failure/);
    f.world.recordApprovalReceipt = originalApprovalReceipt;
    assert.equal(f.world.verification().eventCount, beforeApproval + 1);
    assert.equal(f.world.sqlite.prepare("SELECT COUNT(*) AS count FROM world_approvals WHERE status='pending'").get().count, 1);
    assert.equal(f.world.sqlite.prepare("SELECT COUNT(*) AS count FROM world_event_journal WHERE event_kind='approval.applying/v1'").get().count, 0);
    assert.equal(f.world.sqlite.prepare('SELECT COUNT(*) AS count FROM world_action_receipts').get().count, 0);
    assert.equal(f.world.verification().verified, true);
  } finally { gateway.close(); await f.close(); }
});

test('timer firing is injected read-only observation and refusals append no state event', async () => {
  let now = Date.parse('2026-08-11T12:00:00.000Z');
  const f = await fixture({ now: () => now });
  try {
    f.world.ensureLifespan('life'); f.world.setTimer('life', 10);
    const count = f.world.verification().eventCount;
    now += 11_000;
    assert.equal(f.world.getTimer('life').status, 'fired');
    assert.equal(f.world.getTimer('life').remainingSeconds, 0);
    assert.equal(f.world.verification().eventCount, count);
    f.world.actionReceipt({ sessionId: 'life', roomNodeId: 'room.center', toolName: 'workshop_timer_set', arguments: { seconds: 0 }, result: { ok: false, error: 'workshop_invalid_argument' }, outcome: 'refused' });
    assert.equal(f.world.verification().eventCount, count);
    assert.equal(f.world.verification().verified, true);
  } finally { await f.close(); }
});

test('timer reducer refuses a canonical rehashed interval that differs from exact seconds', async () => {
  const f = await fixture({ now: () => Date.parse('2026-08-11T12:00:00.000Z') });
  try {
    f.world.ensureLifespan('life'); const timer = f.world.setTimer('life', 10);
    const event = f.world.sqlite.prepare('SELECT * FROM world_event_journal WHERE sequence=?').get(timer.worldEventSequence);
    const payload = JSON.parse(event.payload_json); payload.dueAt = '2026-08-11T12:00:11.000Z';
    event.payload_json = canonicalize(payload); event.payload_sha256 = sha256(event.payload_json); event.event_hash = computeWorldEventHash(event);
    f.world.sqlite.exec('DROP TRIGGER world_event_journal_append_only_update');
    f.world.sqlite.prepare('UPDATE world_event_journal SET payload_json=?,payload_sha256=?,event_hash=? WHERE sequence=?').run(event.payload_json, event.payload_sha256, event.event_hash, event.sequence);
    f.world.sqlite.prepare('UPDATE world_timers SET due_at=?,last_event_hash=? WHERE session_id=?').run(payload.dueAt, event.event_hash, 'life');
    f.world.sqlite.exec(WORLD_INTEGRITY_TRIGGER_SQL.world_event_journal_append_only_update);
    const verification = f.world.verification(); assert.equal(verification.verified, false);
    assert.ok(verification.mismatches.some(row => row.code === 'replay_error' && /Timer timing/.test(row.message)));
  } finally { await f.close(); }
});

test('state action and approval custody require one exact compatible event link', async () => {
  const f = await fixture();
  try {
    f.world.ensureLifespan('life');
    const timer = f.world.setTimer('life', 20, { wakeId: 'wake' });
    const action = f.world.actionReceipt({ sessionId: 'life', wakeId: 'wake', roomNodeId: 'room.center', toolName: 'workshop_timer_set', arguments: { seconds: 20 }, result: timer, outcome: 'committed', worldEventSequence: timer.worldEventSequence, worldEventHash: timer.worldEventHash });
    const approval = f.world.createApproval({ sessionId: 'life', wakeId: 'wake', kind: 'write_file', payload: { path: 'a', content: 'b' }, preview: { path: 'a' } });
    const approvalAction = f.world.actionReceipt({ sessionId: 'life', wakeId: 'wake', roomNodeId: 'room.center', toolName: 'workshop_write_file', arguments: { path: 'a' }, result: { status: 'pending_approval', approvalId: approval.approvalId }, outcome: 'committed', worldEventSequence: approval.worldEventSequence, worldEventHash: approval.worldEventHash });
    f.world.recordApprovalReceipt({ approvalId: approval.approvalId, phase: 'pending', actionReceiptId: approvalAction.receiptId, result: { status: 'pending_approval' }, hostReturnScrub: { receiptId: 'scrub-test' }, worldEventSequence: approval.worldEventSequence, worldEventHash: approval.worldEventHash });
    assert.equal(f.world.verification().verified, true);
    f.world.sqlite.exec('DROP TRIGGER world_action_receipts_append_only_update');
    f.world.sqlite.prepare('UPDATE world_action_receipts SET world_event_sequence=?,world_event_hash=? WHERE receipt_id=?').run(approval.worldEventSequence, approval.worldEventHash, action.receiptId);
    const verification = f.world.verification();
    assert.equal(verification.verified, false);
    assert.ok(verification.mismatches.some(row => row.code === 'state_action_event_incompatible'));
    assert.equal(f.world.sqlite.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type='trigger' AND name='world_action_receipts_append_only_update'").get(), undefined);
  } finally { await f.close(); }
});

test('inverse command custody rejects missing and duplicate action receipts', async () => {
  for (const mode of ['missing', 'duplicate']) {
    const f = await fixture(); const root = join(f.dir, 'repo'); await mkdir(root);
    f.world.ensureLifespan('life'); f.world.move({ sessionId: 'life', doorId: 'door.workshop' });
    const gateway = new WorldActionGateway({ world: f.world, workshop: new WorkshopAdapter(root) });
    try {
      const crossing = await gateway.execute({ sessionId: 'life', wakeId: 'wake', intent: { id: `timer-${mode}`, type: 'function', function: { name: 'workshop_timer_set', arguments: '{"seconds":30}' } } });
      const sequence = crossing.actionReceipt.worldEventSequence;
      if (mode === 'missing') {
        f.world.sqlite.exec('DROP TRIGGER world_action_receipts_append_only_delete');
        f.world.sqlite.prepare('DELETE FROM world_action_receipts WHERE receipt_id=?').run(crossing.actionReceipt.receiptId);
        f.world.sqlite.exec(WORLD_INTEGRITY_TRIGGER_SQL.world_action_receipts_append_only_delete);
      } else {
        f.world.sqlite.prepare(`INSERT INTO world_action_receipts
          SELECT 'action_duplicate',session_id,wake_id,room_node_id,tool_name,arguments_json,result_json,outcome,request_record_id,spine_record_id,world_event_sequence,world_event_hash,created_at
          FROM world_action_receipts WHERE receipt_id=?`).run(crossing.actionReceipt.receiptId);
      }
      const verification = f.world.verification(); assert.equal(verification.verified, false);
      assert.ok(verification.mismatches.some(row => row.code === `command_event_action_receipt_${mode}` && row.sequence === sequence));
    } finally { await gateway.close().catch(() => {}); await f.close(); }
  }
});

test('inverse approval custody rejects missing and duplicate approval receipts', async () => {
  for (const mode of ['missing', 'duplicate']) {
    const f = await fixture(); const root = join(f.dir, 'repo'); await mkdir(root);
    f.world.ensureLifespan('life'); f.world.move({ sessionId: 'life', doorId: 'door.workshop' });
    const gateway = new WorldActionGateway({ world: f.world, workshop: new WorkshopAdapter(root) });
    try {
      const crossing = await gateway.execute({ sessionId: 'life', wakeId: 'wake', intent: { id: `write-${mode}`, type: 'function', function: { name: 'workshop_write_file', arguments: '{"path":"a.txt","content":"exact\\n"}' } } });
      const sequence = crossing.approvalReceipt.worldEventSequence;
      if (mode === 'missing') {
        f.world.sqlite.exec('DROP TRIGGER world_approval_receipts_append_only_delete');
        f.world.sqlite.prepare('DELETE FROM world_approval_receipts WHERE receipt_id=?').run(crossing.approvalReceipt.receiptId);
        f.world.sqlite.exec(WORLD_INTEGRITY_TRIGGER_SQL.world_approval_receipts_append_only_delete);
      } else {
        f.world.sqlite.prepare(`INSERT INTO world_approval_receipts
          SELECT 'approval_duplicate',approval_id,session_id,wake_id,phase,action_receipt_id,result_json,host_return_scrub_json,world_event_sequence,world_event_hash,created_at
          FROM world_approval_receipts WHERE receipt_id=?`).run(crossing.approvalReceipt.receiptId);
      }
      const verification = f.world.verification(); assert.equal(verification.verified, false);
      assert.ok(verification.mismatches.some(row => row.code === `command_event_approval_receipt_${mode}` && row.sequence === sequence));
    } finally { await gateway.close().catch(() => {}); await f.close(); }
  }
});

test('A1 to A2 migration refuses orphan custody, weakened schemas, and altered integrity triggers', async () => {
  for (const mode of ['orphan', 'schema', 'trigger']) {
    const f = await fixture();
    f.world.ensureLifespan('life');
    f.world.close();
    const sqlite = new DatabaseSync(f.path); downgradeOperationalTablesToA1(sqlite);
    sqlite.prepare("INSERT INTO world_approvals VALUES('legacy_approval','life','wake','write_file','pending',?,?,?,?,?)").run(canonicalize({ path: 'a', content: 'b' }), canonicalize({ path: 'a' }), null, '2026-08-11T12:00:00.000Z', null);
    sqlite.prepare("INSERT INTO world_action_receipts VALUES('legacy_action','life','wake','room.center','workshop_write_file',?,?, 'committed',NULL,NULL,?)").run(canonicalize({ path: 'a' }), canonicalize({ status: 'pending_approval', approvalId: 'legacy_approval' }), '2026-08-11T12:00:00.000Z');
    sqlite.prepare("INSERT INTO world_approval_receipts VALUES('legacy_approval_receipt','legacy_approval','life','wake','pending','legacy_action',?,?,?)").run(canonicalize({ status: 'pending_approval' }), canonicalize({ receiptId: 'legacy-scrub' }), '2026-08-11T12:00:00.000Z');
    if (mode === 'orphan') {
      sqlite.exec('PRAGMA foreign_keys=OFF; DROP TRIGGER world_approval_receipts_append_only_update;');
      sqlite.prepare("UPDATE world_approval_receipts SET action_receipt_id='missing_action'").run();
      sqlite.exec(`${WORLD_INTEGRITY_TRIGGER_SQL.world_approval_receipts_append_only_update} PRAGMA foreign_keys=ON;`);
    } else if (mode === 'schema') {
      sqlite.exec(`ALTER TABLE world_timers RENAME TO world_timers_exact;
        CREATE TABLE world_timers (session_id, seconds, due_at, created_at);
        INSERT INTO world_timers SELECT * FROM world_timers_exact;
        DROP TABLE world_timers_exact;`);
    } else {
      sqlite.exec(`DROP TRIGGER world_action_receipts_append_only_update;
        CREATE TRIGGER world_action_receipts_append_only_update BEFORE UPDATE ON world_action_receipts BEGIN SELECT CASE WHEN 0 THEN RAISE(ABORT, 'append-only table') END; END;`);
    }
    sqlite.close();
    const upgrade = new WorldGraphStore(f.path, { topologyVersion: 'b1' });
    try {
      const expectedCode = mode === 'orphan' ? 'world_a2_legacy_foreign_key_invalid' : mode === 'schema' ? 'world_a2_legacy_schema_invalid' : 'world_a2_legacy_trigger_invalid';
      assert.throws(() => upgrade.migrateA2({ backupConfirmed: true }), error => error.code === expectedCode);
      assert.equal(upgrade.sqlite.prepare("SELECT COUNT(*) AS count FROM world_event_journal WHERE event_kind='operational_snapshot.imported/v1'").get().count, 0);
    } finally { upgrade.close(); await rm(f.dir, { recursive: true, force: true }); }
  }
});

test('missing, extra, pointer, duplicate, and approval-count operational drift fail closed', async () => {
  const mutators = [
    world => world.sqlite.prepare("UPDATE world_fixture_runtime SET last_event_hash='bad'").run(),
    world => world.sqlite.prepare('DELETE FROM world_work_briefs').run(),
    world => world.sqlite.prepare("INSERT INTO world_fixture_runtime(fixture_id,state_json,revision,updated_at,last_event_sequence,last_event_hash) SELECT 'fixture.workshop_shelves',state_json,revision,updated_at,last_event_sequence,last_event_hash FROM world_fixture_runtime WHERE fixture_id=?").run(KILN_FIXTURE_ID),
  ];
  for (const mutate of mutators) {
    const f = await fixture();
    try {
      f.world.ensureLifespan('life'); f.world.setFixtureRuntime(KILN_FIXTURE_ID, { status: 'running', recipe: 'node_test' }, { sessionId: 'life', action: 'recipe_started' }); f.world.upsertBrief({ sessionId: 'life', objective: 'exact' });
      mutate(f.world); assert.equal(f.world.verification().verified, false); assert.throws(() => f.world.projection('life'), error => error.code === 'world_projection_drift');
    } finally { await f.close(); }
  }

  const duplicate = await fixture();
  try {
    duplicate.world.ensureLifespan('life'); duplicate.world.upsertBrief({ sessionId: 'life', objective: 'one' });
    duplicate.world.sqlite.exec(`PRAGMA foreign_keys=OFF;
      ALTER TABLE world_work_briefs RENAME TO world_work_briefs_exact;
      CREATE TABLE world_work_briefs AS SELECT * FROM world_work_briefs_exact;
      INSERT INTO world_work_briefs SELECT * FROM world_work_briefs_exact;
      DROP TABLE world_work_briefs_exact;
      PRAGMA foreign_keys=ON;`);
    const verification = duplicate.world.verification();
    assert.equal(verification.verified, false);
    assert.ok(verification.mismatches.some(row => row.code === 'schema_definition_invalid' && row.table === 'world_work_briefs'));
    assert.ok(verification.mismatches.some(row => row.code === 'projection_duplicate_row' && row.table === 'world_work_briefs'));
  } finally { await duplicate.close(); }

  const f = await fixture();
  try {
    f.world.ensureLifespan('life');
    const approvals = [
      f.world.createApproval({ sessionId: 'life', kind: 'write_file', payload: {}, preview: {} }),
      f.world.createApproval({ sessionId: 'life', kind: 'write_file', payload: {}, preview: {} }),
      f.world.createApproval({ sessionId: 'life', kind: 'write_file', payload: {}, preview: {} }),
    ];
    f.world.decideApproval(approvals[0].approvalId, 'reject', { rejected: true });
    assert.deepEqual(f.world.sqlite.prepare('SELECT status,COUNT(*) AS count FROM world_approvals GROUP BY status ORDER BY status').all().map(row => ({ ...row })), [
      { status: 'pending', count: 2 }, { status: 'rejected', count: 1 },
    ]);
    assert.equal(f.world.verification().verified, true);
  } finally { await f.close(); }
});

test('restart reconciliation replaces a running kiln with one causal cancellation event', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-world-a2-restart-')); const root = join(dir, 'repo'); await mkdir(root); const path = join(dir, 'world.sqlite');
  const first = new WorldGraphStore(path, { topologyVersion: 'b1' }); first.ensureLifespan('life'); first.setFixtureRuntime(KILN_FIXTURE_ID, { status: 'running', recipe: 'node_test' }, { sessionId: 'life', action: 'recipe_started' }); first.close();
  const second = new WorldGraphStore(path, { topologyVersion: 'b1' }); const recipes = { active: null, status: () => ({ running: false }), cancel: () => ({ cancelled: false }), close: () => ({ cancelled: false }) };
  const gateway = new WorldActionGateway({ world: second, workshop: new WorkshopAdapter(root), recipeRunner: recipes, approvalMode: 'auto' });
  try {
    const before = second.verification().eventCount; gateway.reconcileStartup('life');
    assert.equal(second.getFixtureRuntime(KILN_FIXTURE_ID).status, 'cancelled');
    assert.equal(second.verification().eventCount, before + 1);
    const event = second.sqlite.prepare('SELECT event_kind,causation_json FROM world_event_journal ORDER BY sequence DESC LIMIT 1').get();
    assert.equal(event.event_kind, 'fixture_runtime.replaced/v1'); assert.equal(JSON.parse(event.causation_json).action, 'restart_reconciled');
    assert.equal(second.verification().verified, true);
  } finally { gateway.close(); second.close(); await rm(dir, { recursive: true, force: true }); }
});

test('restart reconciliation gives an imported legacy-running kiln one deterministic boundary run identity', async () => {
  const f = await fixture();
  f.world.ensureLifespan('life'); f.world.close();
  const sqlite = new DatabaseSync(f.path); downgradeOperationalTablesToA1(sqlite);
  sqlite.prepare('INSERT INTO world_fixture_runtime(fixture_id,state_json,updated_at) VALUES(?,?,?)').run(KILN_FIXTURE_ID, canonicalize({ status: 'running', recipe: 'node_test' }), '2026-08-11T12:00:00.000Z');
  sqlite.close();
  const upgrade = new WorldGraphStore(f.path, { topologyVersion: 'b1' }); const root = join(f.dir, 'repo'); await mkdir(root);
  try {
    upgrade.migrateA2({ backupConfirmed: true });
    upgrade.migrateB1({ backupConfirmed: true });
    const boundary = upgrade.sqlite.prepare("SELECT sequence,event_hash FROM world_event_journal WHERE event_kind='operational_snapshot.imported/v1'").get();
    const imported = upgrade.getFixtureRuntime(KILN_FIXTURE_ID); assert.equal(imported.runId, undefined);
    const gateway = new WorldActionGateway({ world: upgrade, workshop: new WorkshopAdapter(root), recipeRunner: { active: null, status: () => ({ running: false }), cancel: async () => ({ cancelled: false }), close: async () => ({ cancelled: false }) } });
    const headBeforeReconcile = upgrade.eventHead();
    const physical = upgrade.sqlite.prepare('SELECT state_json,last_event_hash FROM world_fixture_runtime WHERE fixture_id=?').get(KILN_FIXTURE_ID);
    const expectedRunId = `legacy_run_${sha256(canonicalize({ fixtureId: KILN_FIXTURE_ID, boundaryEventHash: physical.last_event_hash, stateSha256: sha256(physical.state_json) }))}`;
    gateway.reconcileStartup('life');
    const reconciled = upgrade.getFixtureRuntime(KILN_FIXTURE_ID);
    assert.equal(reconciled.status, 'cancelled'); assert.match(reconciled.runId, /^legacy_run_[a-f0-9]{64}$/);
    const event = upgrade.sqlite.prepare('SELECT previous_event_hash,causation_json FROM world_event_journal ORDER BY sequence DESC LIMIT 1').get();
    assert.equal(event.previous_event_hash, headBeforeReconcile.event_hash); assert.equal(JSON.parse(event.causation_json).action, 'restart_reconciled');
    assert.equal(upgrade.verification().verified, true);
    await gateway.close();
  } finally { upgrade.close(); await rm(f.dir, { recursive: true, force: true }); }
});

test('post-start World custody failure compensates an active runner and suppresses duplicate completion callbacks', async () => {
  const f = await fixture(); const root = join(f.dir, 'repo'); await mkdir(root);
  f.world.ensureLifespan('life'); f.world.move({ sessionId: 'life', doorId: 'door.workshop' });
  const runner = {
    active: null, lastRecipe: null, lastResult: null, callbackCount: 0, cancelCount: 0,
    async start(recipe, _args, { onComplete }) { this.lastRecipe = recipe; this.active = { recipe }; this.onComplete = onComplete; return { kind: 'workshop_recipe', status: 'started', recipe, ok: true }; },
    async cancel(reason) {
      this.cancelCount += 1; const result = { kind: 'workshop_recipe', status: 'cancelled', recipe: this.lastRecipe, ok: false, cancelled: reason, code: null, signal: null, stdout: '', stderr: '' };
      this.active = null; this.lastResult = result; this.callbackCount += 2; this.onComplete(result); this.onComplete(result);
      return { kind: 'workshop_recipe_cancel', cancelled: true, reason, result };
    },
    status() { return { running: Boolean(this.active) }; },
  };
  const gateway = new WorldActionGateway({ world: f.world, workshop: new WorkshopAdapter(root), recipeRunner: runner });
  const original = f.world.actionReceipt;
  try {
    const before = f.world.verification().eventCount;
    f.world.actionReceipt = () => { throw new Error('injected post-start custody failure'); };
    await assert.rejects(gateway.execute({ sessionId: 'life', wakeId: 'wake', intent: { id: 'run-fail', type: 'function', function: { name: 'workshop_run_recipe', arguments: '{"recipe":"node_test","path":"test/example.test.js"}' } } }), /post-start custody failure/);
    f.world.actionReceipt = original;
    assert.equal(runner.cancelCount, 1); assert.equal(runner.callbackCount, 2); assert.equal(runner.active, null);
    assert.equal(f.world.getFixtureRuntime(KILN_FIXTURE_ID), null);
    assert.equal(f.world.verification().eventCount, before);
    assert.equal(f.world.sqlite.prepare("SELECT COUNT(*) AS count FROM world_event_journal WHERE event_kind='fixture_runtime.replaced/v1'").get().count, 0);
    assert.equal(f.world.verification().verified, true);
  } finally { f.world.actionReceipt = original; await gateway.close().catch(() => {}); await f.close(); }
});

test('kiln reducer closes actions and run identity transitions', async () => {
  const f = await fixture();
  try {
    f.world.ensureLifespan('life');
    assert.throws(() => f.world.setFixtureRuntime(KILN_FIXTURE_ID, { status: 'settled', runId: 'never', recipe: 'node_test', code: 0 }, { action: 'recipe_completed' }), /transition is not installed/);
    const running = f.world.setFixtureRuntime(KILN_FIXTURE_ID, { status: 'running', recipe: 'node_test' }, { sessionId: 'life', action: 'recipe_started' });
    const current = f.world.getFixtureRuntime(KILN_FIXTURE_ID); assert.match(current.runId, /^kiln_run_/);
    assert.throws(() => f.world.setFixtureRuntime(KILN_FIXTURE_ID, { status: 'settled', runId: 'different', recipe: 'other', code: 0 }, { action: 'recipe_completed' }), /changed run or recipe identity/);
    assert.throws(() => f.world.setFixtureRuntime(KILN_FIXTURE_ID, { status: 'failed', runId: current.runId, recipe: current.recipe }, { action: 'invented_terminal' }), /not installed/);
    assert.equal(f.world.verification().eventCount, running.worldEventSequence);
    f.world.setFixtureRuntime(KILN_FIXTURE_ID, { status: 'settled', runId: current.runId, recipe: current.recipe, code: 0 }, { action: 'recipe_completed' });
    assert.equal(f.world.getFixtureRuntime(KILN_FIXTURE_ID).status, 'settled'); assert.equal(f.world.verification().verified, true);
  } finally { await f.close(); }
});

test('explicit cancel owns one terminal event while timeout callback is one deduped system terminal', async () => {
  const f = await fixture(); const root = join(f.dir, 'repo'); await mkdir(root);
  f.world.ensureLifespan('life'); f.world.move({ sessionId: 'life', doorId: 'door.workshop' });
  const runner = {
    active: null, lastRecipe: null, lastResult: null,
    async start(recipe, _args, { onComplete }) { this.lastRecipe = recipe; this.active = { recipe }; this.onComplete = onComplete; return { kind: 'workshop_recipe', status: 'started', recipe, ok: true }; },
    async cancel(reason) {
      if (!this.active) return { cancelled: false, reason: 'not_running' };
      const result = { kind: 'workshop_recipe', status: 'cancelled', recipe: this.lastRecipe, ok: false, cancelled: reason, code: null, signal: null, stdout: '', stderr: '' };
      this.active = null; this.lastResult = result; this.onComplete(result); this.onComplete(result);
      return { kind: 'workshop_recipe_cancel', cancelled: true, reason, result };
    },
    timeout() {
      const result = { kind: 'workshop_recipe', status: 'cancelled', recipe: this.lastRecipe, ok: false, cancelled: 'cancelled_timeout', code: null, signal: null, stdout: '', stderr: '' };
      this.active = null; this.lastResult = result; this.onComplete(result); this.onComplete(result);
    },
    status() { return { running: Boolean(this.active) }; },
  };
  const gateway = new WorldActionGateway({ world: f.world, workshop: new WorkshopAdapter(root), recipeRunner: runner });
  const call = (id, name, args = {}) => gateway.execute({ sessionId: 'life', wakeId: `wake-${id}`, intent: { id, type: 'function', function: { name, arguments: JSON.stringify(args) } } });
  try {
    await call('start-one', 'workshop_run_recipe', { recipe: 'node_test', path: 'test/example.test.js' });
    const cancelled = await call('cancel-one', 'workshop_recipe_cancel'); assert.equal(cancelled.result.cancelled, true);
    let terminals = f.world.sqlite.prepare("SELECT sequence,actor,command_id,causation_json FROM world_event_journal WHERE event_kind='fixture_runtime.replaced/v1' ORDER BY sequence").all();
    assert.equal(terminals.length, 2); assert.equal(JSON.parse(terminals[1].causation_json).action, 'recipe_cancelled'); assert.equal(terminals[1].actor, 'resident_tool'); assert.equal(terminals[1].command_id, 'cancel-one');
    assert.equal(f.world.sqlite.prepare('SELECT COUNT(*) AS count FROM world_action_receipts WHERE world_event_sequence=?').get(terminals[1].sequence).count, 1);

    await call('start-two', 'workshop_run_recipe', { recipe: 'node_test', path: 'test/example.test.js' }); runner.timeout();
    terminals = f.world.sqlite.prepare("SELECT sequence,actor,command_id,causation_json FROM world_event_journal WHERE event_kind='fixture_runtime.replaced/v1' ORDER BY sequence").all();
    assert.equal(terminals.length, 4); assert.equal(JSON.parse(terminals[3].causation_json).action, 'recipe_timeout'); assert.equal(terminals[3].actor, 'world_runtime'); assert.equal(terminals[3].command_id, null);
    assert.equal(f.world.sqlite.prepare('SELECT COUNT(*) AS count FROM world_action_receipts WHERE world_event_sequence=?').get(terminals[3].sequence).count, 0);
    assert.equal(f.world.verification().verified, true);
  } finally { await gateway.close().catch(() => {}); await f.close(); }
});

test('gateway close awaits confirmed recipe settlement and otherwise preserves honest stopping state', async () => {
  for (const confirmed of [true, false]) {
    const f = await fixture(); const root = join(f.dir, 'repo'); await mkdir(root);
    f.world.ensureLifespan('life');
    const started = f.world.setFixtureRuntime(KILN_FIXTURE_ID, { status: 'running', recipe: 'node_test' }, { sessionId: 'life', action: 'recipe_started' });
    let release;
    const wait = new Promise(resolve => { release = resolve; });
    const finalResult = { kind: 'workshop_recipe', status: 'cancelled', recipe: 'node_test', ok: false, cancelled: 'hub_close', code: null, signal: null, stdout: '', stderr: '' };
    const runner = {
      active: { recipe: 'node_test' }, lastResult: null,
      async destroy(reason) {
        assert.equal(reason, 'hub_close'); await wait; this.active = null;
        if (confirmed) { this.lastResult = finalResult; return { cancelled: true, reason, result: finalResult }; }
        return { cancelled: false, reason: 'not_confirmed' };
      },
      status() { return { running: Boolean(this.active) }; },
    };
    const gateway = new WorldActionGateway({ world: f.world, workshop: new WorkshopAdapter(root), recipeRunner: runner });
    try {
      const closing = gateway.close();
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(f.world.getFixtureRuntime(KILN_FIXTURE_ID).status, 'stopping');
      assert.equal(f.world.sqlite.prepare("SELECT COUNT(*) AS count FROM world_event_journal WHERE event_kind='fixture_runtime.replaced/v1'").get().count, 2);
      release(); await closing;
      const runtime = f.world.getFixtureRuntime(KILN_FIXTURE_ID);
      assert.equal(runtime.status, confirmed ? 'cancelled' : 'stopping');
      const rows = f.world.sqlite.prepare("SELECT causation_json FROM world_event_journal WHERE event_kind='fixture_runtime.replaced/v1' ORDER BY sequence").all();
      assert.deepEqual(rows.map(row => JSON.parse(row.causation_json).action), confirmed ? ['recipe_started', 'hub_close_requested', 'hub_closed'] : ['recipe_started', 'hub_close_requested']);
      assert.equal(runtime.runId, started.runId); assert.equal(f.world.verification().verified, true);
    } finally { release(); await f.close(); }
  }
});
