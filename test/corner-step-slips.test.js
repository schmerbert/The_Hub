import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHub } from '../src/server/app.js';
import { WorldGraphStore } from '../src/world/graph.js';
import { WorkshopAdapter } from '../src/world/workshop.js';
import { WorldActionGateway } from '../src/world/gateway.js';
import { projectWakeSlips } from '../src/corner/slips.js';

async function fixture(provider) {
  const dir = await mkdtemp(join(tmpdir(), 'hub-slips-'));
  const hub = createHub({ env: { HUB_RESIDENT_MODE: 'fake', HUB_DB_PATH: join(dir, 'hub.sqlite'), HUB_SPINE_PATH: join(dir, 'spine.jsonl'), HUB_WORLD_PATH: join(dir, 'world.sqlite'), HUB_WORKSHOP_ROOT: process.cwd() }, provider });
  await new Promise(resolve => hub.server.listen(0, resolve));
  const base = `http://127.0.0.1:${hub.server.address().port}`;
  return { hub, base, close: async () => { await new Promise(resolve => hub.server.close(resolve)); hub.close(); await rm(dir, { recursive: true, force: true }); } };
}

async function post(base, content) {
  const response = await fetch(`${base}/api/wakes`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content }) });
  return { response, body: await response.json() };
}

test('health exposes active wake only while calling', async () => {
  let release;
  const provider = {
    async complete({ phase }) {
      if (phase === 'orientation') return { message: { role: 'assistant', content: null, reasoning_content: 'steadying the first breath', tool_calls: [{ id: 'hearth', type: 'function', function: { name: 'tend_hearth', arguments: '{}' } }] }, content: null, resolvedModel: 'test-model', finishReason: 'tool_calls' };
      await new Promise(resolve => { release = resolve; });
      return { message: { role: 'assistant', content: 'Done.' }, content: 'Done.', resolvedModel: 'test-model', finishReason: 'stop' };
    },
  };
  const f = await fixture(provider);
  try {
    const pending = post(f.base, 'Begin.');
    for (let attempt = 0; attempt < 20 && !release; attempt += 1) await new Promise(resolve => setTimeout(resolve, 5));
    const active = await (await fetch(`${f.base}/api/health`)).json();
    assert.equal(active.wakeInProgress, true);
    assert.match(active.activeWakeId, /^wake_/);
    release();
    await pending;
    const idle = await (await fetch(`${f.base}/api/health`)).json();
    assert.equal(idle.activeWakeId, null);
  } finally { await f.close(); }
});

test('slips project thinking and multi-tool actions without polluting utterances', async () => {
  let round = 0;
  const provider = {
    async complete({ phase }) {
      if (phase === 'orientation') return { message: { role: 'assistant', content: null, reasoning_content: 'checking the hearth before speaking', tool_calls: [{ id: 'hearth', type: 'function', function: { name: 'tend_hearth', arguments: '{}' } }] }, content: null, resolvedModel: 'test-model', finishReason: 'tool_calls' };
      round += 1;
      if (round === 1) return { message: { role: 'assistant', content: null, tool_calls: [{ id: 'move', type: 'function', function: { name: 'move_through_door', arguments: '{"door_id":"door.workshop"}' } }] }, content: null, resolvedModel: 'test-model', finishReason: 'tool_calls' };
      if (round === 2) return { message: { role: 'assistant', content: null, tool_calls: [{ id: 'engage', type: 'function', function: { name: 'engage_fixture', arguments: '{"fixture_id":"fixture.workshop_shelves"}' } }] }, content: null, resolvedModel: 'test-model', finishReason: 'tool_calls' };
      return { message: { role: 'assistant', content: 'The shelves are engaged.' }, content: 'The shelves are engaged.', resolvedModel: 'test-model', finishReason: 'stop' };
    },
  };
  const f = await fixture(provider);
  try {
    const result = await post(f.base, 'Go to the Workshop.');
    assert.equal(result.response.status, 200);
    const slips = await (await fetch(`${f.base}/api/wakes/${encodeURIComponent(result.body.id)}/slips`)).json();
    assert.ok(slips.slips.some(slip => slip.kind === 'thinking' && slip.detail === 'checking the hearth before speaking' && slip.expandable));
    assert.ok(slips.slips.some(slip => slip.label === 'Steps through to Workshop'));
    assert.ok(slips.slips.some(slip => slip.label === 'Engages the shelves'));
    const indexes = Object.fromEntries(slips.slips.map((slip, index) => [slip.id, index]));
    const moveIndex = slips.slips.findIndex(slip => slip.label === 'Steps through to Workshop');
    const engageIndex = slips.slips.findIndex(slip => slip.label === 'Engages the shelves');
    assert.ok(indexes[`phase:${result.body.phases[1].id}`] < moveIndex);
    assert.ok(moveIndex < indexes[`phase:${result.body.phases[2].id}`]);
    assert.ok(indexes[`phase:${result.body.phases[2].id}`] < engageIndex);
    assert.ok(engageIndex < indexes[`phase:${result.body.phases[3].id}`]);
    const resident = result.body.events.find(event => event.actorKind === 'resident' && event.eventKind === 'utterance');
    assert.equal(resident.content, 'The shelves are engaged.');
    assert.equal(resident.content.includes('checking the hearth'), false);
    const thread = await (await fetch(`${f.base}/api/thread`)).json();
    assert.deepEqual(thread.events.filter(event => event.actorKind === 'resident' && event.eventKind === 'utterance').map(event => event.content), ['The shelves are engaged.']);
  } finally { await f.close(); }
});

test('journal-bearing sensory drift is not silently normalized', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-sensory-seed-'));
  const path = join(dir, 'world.sqlite');
  try {
    const first = new WorldGraphStore(path);
    first.withNodeMutations(() => first.sqlite.prepare('UPDATE world_nodes SET resident_text=? WHERE id=?').run('old workshop text', 'room.workshop'));
    first.close();
    const migrated = new WorldGraphStore(path);
    assert.equal(migrated.node('room.workshop').resident_text, 'old workshop text');
    assert.equal(migrated.verification().verified, false);
    assert.throws(() => migrated.ensureLifespan('life'), error => error.code === 'world_projection_drift');
    migrated.close();
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }).catch(error => {
      if (error.code !== 'EBUSY') throw error;
    });
  }
});

test('resolved approvals no longer project stale decidable pending slips', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-slips-approval-'));
  const root = join(dir, 'repo');
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src', 'reject.txt'), 'reject me\n', 'utf8');
  await writeFile(join(root, 'src', 'confirm.txt'), 'confirm me\n', 'utf8');
  const world = new WorldGraphStore(join(dir, 'world.sqlite'));
  const gateway = new WorldActionGateway({ world, workshop: new WorkshopAdapter(root), approvalMode: 'confirm' });
  world.ensureLifespan('life');
  world.move({ sessionId: 'life', wakeId: 'wake', doorId: 'door.workshop' });
  const wake = { id: 'wake', status: 'committed', phases: [{ id: 'provider-1', phase: 'ordinary', createdAt: '2026-08-10T00:00:00.000Z', completedAt: '2026-08-10T00:00:00.001Z' }] };
  const requestDelete = async (callId, path) => gateway.execute({
    sessionId: 'life',
    wakeId: 'wake',
    requestRecordId: 'provider-1',
    intent: { id: callId, type: 'function', function: { name: 'workshop_delete_path', arguments: JSON.stringify({ path }) } },
  });
  try {
    const rejected = await requestDelete('reject', 'src/reject.txt');
    let slips = projectWakeSlips({ wake, world, pendingApprovals: world.listApprovals('life', { pendingOnly: true }) }).slips;
    assert.equal(slips.filter(slip => slip.kind === 'pending' && slip.decidable).length, 1);
    gateway.rejectApproval(rejected.result.approvalId, 'life');
    slips = projectWakeSlips({ wake, world, pendingApprovals: world.listApprovals('life', { pendingOnly: true }) }).slips;
    assert.equal(slips.some(slip => slip.kind === 'pending'), false);
    await access(join(root, 'src', 'reject.txt'));

    const confirmed = await requestDelete('confirm', 'src/confirm.txt');
    assert.equal(projectWakeSlips({ wake, world, pendingApprovals: world.listApprovals('life', { pendingOnly: true }) }).slips.filter(slip => slip.kind === 'pending').length, 1);
    gateway.confirmApproval(confirmed.result.approvalId, 'life');
    slips = projectWakeSlips({ wake, world, pendingApprovals: world.listApprovals('life', { pendingOnly: true }) }).slips;
    assert.equal(slips.some(slip => slip.kind === 'pending'), false);
    await assert.rejects(access(join(root, 'src', 'confirm.txt')), error => error.code === 'ENOENT');
  } finally {
    gateway.close('test_close');
    world.close();
    await rm(dir, { recursive: true, force: true });
  }
});
