import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHub } from '../src/server/app.js';
import { FakeResidentProvider } from '../src/providers/fake.js';

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'hub-hearth-wakes-'));
  const provider = new FakeResidentProvider();
  const hub = createHub({
    env: { HUB_RESIDENT_MODE: 'fake', HUB_RUNTIME_ROOT: dir, HUB_DB_PATH: join(dir, 'hub.sqlite'), HUB_SPINE_PATH: join(dir, 'spine.jsonl'), HUB_WORLD_PATH: join(dir, 'world.sqlite'), HUB_RESULT_PATH: join(dir, 'results.sqlite'), HUB_WORKSHOP_ROOT: process.cwd() },
    provider,
  });
  return { dir, hub, provider, async close() { await hub.close(); await rm(dir, { recursive: true, force: true }); } };
}

test('manual proving wake opens a fresh Hearth lifespan with reduced autonomous authority', async () => {
  const f = await fixture();
  try {
    const prior = await f.hub.wake('Let this become prior-session continuity.');
    const result = await f.hub.hearthWakes.runNow();
    assert.equal(result.status, 'completed');
    assert.notEqual(result.sessionId, prior.sessionId);
    assert.equal(f.hub.db.getActiveSession().id, result.sessionId);
    assert.equal(f.hub.db.listSessions().find(session => session.id === prior.sessionId).status, 'closed');

    const wake = f.hub.db.getWake(result.wakeId);
    assert.equal(wake.origin.origin, 'hearth_origin');
    assert.deepEqual(wake.phases.map(phase => phase.phase), ['orientation', 'response']);
    assert.equal(wake.events.some(event => event.actorKind === 'user'), false);
    assert.equal(wake.events.some(event => event.actorKind === 'resident' && event.eventKind === 'utterance'), true);
    assert.equal(f.hub.world.projection(result.sessionId).roomId, 'place.house');

    const responseCall = f.provider.calls.findLast(call => call.phase === 'response');
    const request = JSON.parse(responseCall.requestBodyString);
    const names = request.tools.map(tool => tool.function.name);
    assert.ok(names.includes('rest_for'));
    assert.ok(names.includes('move_through_passage'));
    assert.equal(names.includes('spotlight_observe'), false);
    assert.equal(names.includes('write_journal'), false);
    assert.match(JSON.stringify(request.messages), /Hearth-origin wake ground/);
    assert.match(JSON.stringify(request.messages), /nothing calls for attention/i);
  } finally { await f.close(); }
});

test('a pending bench promise prevents a manual ordinary wake from ending that lifespan', async () => {
  const f = await fixture();
  try {
    await f.hub.wake('Please tend the Hearth.');
    const sessionId = f.hub.db.session.id;
    f.hub.autonomousWakes.schedule({ sessionId, seconds: 3600, intention: 'Wake here.' });
    await assert.rejects(() => f.hub.hearthWakes.runNow(), error => error.code === 'hearth_wake_bench_pending');
    assert.equal(f.hub.db.session.id, sessionId);
    assert.equal(f.hub.db.getActiveSession().status, 'open');
  } finally { await f.close(); }
});
