import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHub } from '../src/server/app.js';
import { HubDatabase } from '../src/ledger/source.js';
import { FakeResidentProvider } from '../src/providers/fake.js';
import { autonomousToolAllowed, AUTONOMOUS_WORLD_TOOLS, REST_FOR_TOOL_NAME, renderAutonomousWakeGround } from '../src/runtime/autonomous-wakes.js';

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'hub-autonomous-wakes-'));
  const provider = new FakeResidentProvider();
  const hub = createHub({
    env: { HUB_RESIDENT_MODE: 'fake', HUB_RUNTIME_ROOT: dir, HUB_DB_PATH: join(dir, 'hub.sqlite'), HUB_SPINE_PATH: join(dir, 'spine.jsonl'), HUB_WORLD_PATH: join(dir, 'world.sqlite'), HUB_RESULT_PATH: join(dir, 'results.sqlite'), HUB_WORKSHOP_ROOT: process.cwd() },
    provider,
  });
  await new Promise(resolve => hub.server.listen(0, '127.0.0.1', resolve));
  return { dir, hub, provider, base: `http://127.0.0.1:${hub.server.address().port}`, async close() { await hub.close(); await rm(dir, { recursive: true, force: true }); } };
}

async function post(base, path, value) {
  const response = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });
  return { response, body: await response.json() };
}

async function eventually(read, accept, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (accept(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('Timed out waiting for autonomous wake completion.');
}

test('autonomous wake ledger is append-only, replaces pending rest, and verifies its hashes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-autonomous-ledger-'));
  const db = new HubDatabase(join(dir, 'hub.sqlite'));
  try {
    const seat = { world: { roomId: 'place.house', engagedFixtureId: null, revision: 1 }, forest: { active: false } };
    const restedAt = new Date().toISOString();
    const first = db.autonomous.schedule({ sessionId: db.session.id, lifeId: db.session.id, contextGeneration: 1, planKind: 'bench_rest', restedAt, requestedDurationMs: 60_000, dueAt: new Date(Date.parse(restedAt) + 60_000).toISOString(), intention: 'listen', seat });
    const second = db.autonomous.schedule({ sessionId: db.session.id, lifeId: db.session.id, contextGeneration: 1, planKind: 'bench_rest', restedAt, requestedDurationMs: 120_000, dueAt: new Date(Date.parse(restedAt) + 120_000).toISOString(), intention: 'wander', seat });
    assert.equal(db.autonomous.recent(db.session.id).find(plan => plan.planId === first.planId).status, 'cancelled');
    assert.equal(db.autonomous.pending(db.session.id).planId, second.planId);
    assert.equal(db.autonomous.claim(second.planId).eventKind, 'claimed');
    assert.equal(db.autonomous.claim(second.planId), null);
    db.autonomous.settle(second.planId, null, 'failed', { code: 'proof' });
    assert.equal(db.autonomous.verify().verified, true);
    assert.throws(() => db.sqlite.prepare('UPDATE autonomous_wake_plans SET intention=? WHERE plan_id=?').run('changed', first.planId), /append-only/);
  } finally { db.close(); await rm(dir, { recursive: true, force: true }); }
});

test('manual self-directed wake resumes the same session and seat without inventing a user turn', async () => {
  const f = await fixture();
  try {
    const arrival = await post(f.base, '/api/wakes', { content: 'Please tend the Hearth.' });
    assert.equal(arrival.response.status, 200);
    const before = f.hub.world.projection(f.hub.db.session.id);
    const scheduled = await post(f.base, '/api/autonomous-wakes/run', { intention: 'Take a gentle look around.' });
    assert.equal(scheduled.response.status, 202);
    const status = await eventually(
      () => fetch(`${f.base}/api/autonomous-wakes`).then(response => response.json()),
      value => value.recent.some(plan => plan.planId === scheduled.body.plan.planId && ['completed', 'failed'].includes(plan.status)),
    );
    const plan = status.recent.find(item => item.planId === scheduled.body.plan.planId);
    assert.equal(plan.status, 'completed');
    const wake = f.hub.db.getWake(plan.wakeId);
    assert.equal(wake.sessionId, f.hub.db.session.id);
    assert.equal(wake.origin.origin, 'self_directed');
    assert.equal(wake.origin.planId, plan.planId);
    assert.equal(wake.events.some(event => event.actorKind === 'user'), false);
    assert.equal(wake.events.some(event => event.actorKind === 'resident' && event.eventKind === 'utterance'), true);
    assert.equal(f.hub.db.verifyGlassTrace().verified, true);
    assert.deepEqual({ roomId: f.hub.world.projection(f.hub.db.session.id).roomId, engagedFixtureId: f.hub.world.projection(f.hub.db.session.id).engagedFixtureId }, { roomId: before.roomId, engagedFixtureId: before.engagedFixtureId });

    const autonomousCall = f.provider.calls.find(call => call.phase === 'ordinary' && call.messages.some(message => String(message.content).includes('Autonomous wake ground:')));
    assert.ok(autonomousCall);
    const request = JSON.parse(autonomousCall.requestBodyString);
    const names = request.tools.map(tool => tool.function.name);
    assert.ok(names.includes(REST_FOR_TOOL_NAME));
    assert.ok(names.includes('operate_passage'));
    assert.equal(names.includes('write_journal'), false);
    assert.equal(names.includes('workshop_apply_patch'), false);
    assert.equal(names.includes('spotlight_observe'), false);
    assert.match(JSON.stringify(request.messages), /context generation 1/);
    assert.match(JSON.stringify(request.messages), /exactly 0 milliseconds of rest/);
    assert.match(JSON.stringify(request.messages), /up to 24 tool rounds|24 tool rounds|24/);

    const bench = f.hub.autonomousWakes.schedule({ sessionId: f.hub.db.session.id, seconds: 3600, intention: 'Continue from this exact seat.' });
    assert.equal(bench.lifeId, f.hub.db.session.id);
    assert.equal(bench.contextGeneration, 1);
    assert.equal(bench.planKind, 'bench_rest');
    assert.equal(bench.requestedDurationMs, 3_600_000);
    assert.equal(Date.parse(bench.dueAt) - Date.parse(bench.restedAt), 3_600_000);
    assert.deepEqual(bench.seat.world.roomId, before.roomId);
  } finally { await f.close(); }
});

test('bench timing distinguishes the exact promise, elapsed rest, and scheduler lateness', () => {
  const ground = renderAutonomousWakeGround({
    kind: 'self_directed',
    plan: { lifeId: 'life-1', contextGeneration: 7, intention: 'continue the path' },
    timing: { restedAt: '2026-09-12T19:00:00.000Z', requestedDurationMs: 3_600_000, dueAt: '2026-09-12T20:00:00.000Z', wokeAt: '2026-09-12T20:00:03.125Z', elapsedMs: 3_603_125, latenessMs: 3_125 },
  });
  assert.match(ground, /life life-1, context generation 7/);
  assert.match(ground, /requested exactly 3600000 milliseconds/);
  assert.match(ground, /exactly 3603125 milliseconds elapsed/);
  assert.match(ground, /3125 milliseconds after the due time/);
  assert.match(ground, /continue the path/);
});

test('autonomous authority is a narrow reusable capability gate', () => {
  assert.ok(AUTONOMOUS_WORLD_TOOLS.has('workshop_read'));
  assert.equal(autonomousToolAllowed('walk_forest', { forestToolNames: ['walk_forest'] }), true);
  assert.equal(autonomousToolAllowed('workshop_apply_patch'), false);
  assert.equal(autonomousToolAllowed('spotlight_observe'), false);
  assert.equal(autonomousToolAllowed('write_journal'), false);
});
