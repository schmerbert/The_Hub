import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHub } from '../src/server/app.js';
import { KILN_FIXTURE_ID, WorldGraphStore } from '../src/world/graph.js';
import { WorkshopAdapter } from '../src/world/workshop.js';
import { WorldActionGateway } from '../src/world/gateway.js';
import { schemasForSession } from '../src/world/tools.js';

const WORKSHOP_FIXTURES = [
  'fixture.workshop_clipboard',
  'fixture.workshop_kiln',
  'fixture.workshop_ledger',
  'fixture.workshop_shelves',
  'fixture.workshop_workbench',
];

async function fixture(provider, extra = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'hub-fixtures-'));
  const workshopRoot = join(dir, 'repo');
  await mkdir(join(workshopRoot, 'src'), { recursive: true });
  await writeFile(join(workshopRoot, 'src', 'sample.txt'), 'alpha\nbeta\n', 'utf8');
  await writeFile(join(workshopRoot, 'package.json'), JSON.stringify({ name: 'fixture', private: true, scripts: { test: 'node -e "process.exit(0)"' } }), 'utf8');
  const hub = createHub({ env: { HUB_RESIDENT_MODE: 'fake', HUB_DB_PATH: join(dir, 'hub.sqlite'), HUB_SPINE_PATH: join(dir, 'spine.jsonl'), HUB_WORLD_PATH: join(dir, 'world.sqlite'), HUB_WORKSHOP_ROOT: workshopRoot, HUB_APPROVAL_MODE: 'confirm', ...extra }, provider });
  await new Promise(resolve => hub.server.listen(0, resolve));
  const base = `http://127.0.0.1:${hub.server.address().port}`;
  return { dir, hub, base, workshopRoot, close: async () => { await new Promise(resolve => hub.server.close(resolve)); hub.close(); await rm(dir, { recursive: true, force: true }); } };
}
async function post(base, content) { const response = await fetch(`${base}/api/wakes`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content }) }); return { response, body: await response.json() }; }

test('fixtures seed, engage, and presence omit tool scaffolding', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-fixture-seed-'));
  const path = join(dir, 'world.sqlite');
  try {
    const world = new WorldGraphStore(path);
    assert.equal(world.sqlite.prepare('SELECT COUNT(*) AS count FROM world_nodes').get().count, 12);
    assert.equal(world.sqlite.prepare('SELECT COUNT(*) AS count FROM world_edges').get().count, 10);
    assert.deepEqual(world.sqlite.prepare("SELECT id FROM world_nodes WHERE node_type='fixture' AND lifecycle='standing' AND id LIKE 'fixture.workshop_%' ORDER BY id").all().map(row => row.id), WORKSHOP_FIXTURES);
    assert.deepEqual(world.sqlite.prepare("SELECT id FROM world_nodes WHERE lifecycle='retired' ORDER BY id").all().map(row => row.id), ['station.control_panel', 'station.spec_table']);
    world.ensureLifespan('life');
    assert.equal(world.current('life').engaged_fixture_id, null);
    assert.deepEqual(world.availableTools('life'), ['move_through_door']);
    const centerPresence = world.presenceMessage('life');
    assert.equal(centerPresence.includes('Available native tools'), false);
    assert.equal(centerPresence.includes('workshop_'), false);
    world.move({ sessionId: 'life', doorId: 'door.workshop' });
    assert.ok(world.availableTools('life').includes('workshop_list'));
    assert.ok(world.availableTools('life').includes('engage_fixture'));
    assert.equal(world.availableTools('life').includes('engage_station'), false);
    const presence = world.presenceMessage('life');
    assert.match(presence, /fixture\.workshop_kiln/);
    assert.equal(presence.includes('Available native tools'), false);
    assert.equal(presence.includes('workshop_apply_patch'), false);
    world.engageFixture({ sessionId: 'life', fixtureId: 'fixture.workshop_shelves' });
    assert.equal(world.current('life').engaged_fixture_id, 'fixture.workshop_shelves');
    world.engageFixture({ sessionId: 'life', fixtureId: 'fixture.workshop_workbench' });
    assert.equal(world.current('life').engaged_fixture_id, 'fixture.workshop_workbench');
    assert.throws(() => world.engageFixture({ sessionId: 'life', fixtureId: 'fixture.packed_sand' }), error => error.code === 'world_fixture_not_engageable' || error.code === 'world_fixture_unreachable');
    world.disengageFixture({ sessionId: 'life' });
    assert.equal(world.current('life').engaged_fixture_id, null);
    world.engageFixture({ sessionId: 'life', fixtureId: 'fixture.workshop_kiln' });
    world.move({ sessionId: 'life', doorId: 'door.workshop' });
    assert.equal(world.current('life').room_node_id, 'room.center');
    assert.equal(world.current('life').engaged_fixture_id, null);
    world.close();
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('ceiling flat mount auto-applies patch; delete waits on workbench', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-fixture-patch-'));
  const root = join(dir, 'repo');
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src', 'sample.txt'), 'alpha\nbeta\n', 'utf8');
  const world = new WorldGraphStore(join(dir, 'world.sqlite'));
  world.ensureLifespan('life');
  world.move({ sessionId: 'life', doorId: 'door.workshop' });
  const workshop = new WorkshopAdapter(root, { maxBytes: 10000, maxLines: 40 });
  const gateway = new WorldActionGateway({ world, workshop, approvalMode: 'confirm' });
  try {
    assert.equal(world.current('life').engaged_fixture_id, null);
    assert.ok(world.availableTools('life').includes('workshop_apply_patch'));
    const applied = await gateway.execute({ sessionId: 'life', wakeId: 'w', intent: { id: 'p', type: 'function', function: { name: 'workshop_apply_patch', arguments: JSON.stringify({ path: 'src/sample.txt', old_text: 'alpha\n', new_text: 'ALPHA\n' }) } } });
    assert.equal(applied.result.kind, 'workshop_approval_confirmed');
    assert.equal(await readFile(join(root, 'src', 'sample.txt'), 'utf8'), 'ALPHA\nbeta\n');
    assert.doesNotMatch(world.presenceMessage('life'), /work waiting on the workbench/i);

    const pending = await gateway.execute({ sessionId: 'life', wakeId: 'w2', intent: { id: 'd', type: 'function', function: { name: 'workshop_delete_path', arguments: JSON.stringify({ path: 'src/sample.txt' }) } } });
    assert.equal(pending.result.status, 'pending_approval');
    assert.match(world.presenceMessage('life'), /work waiting on the workbench/i);
    assert.equal(await readFile(join(root, 'src', 'sample.txt'), 'utf8'), 'ALPHA\nbeta\n');
    const rejected = gateway.rejectApproval(pending.result.approvalId, 'life');
    assert.equal(rejected.approval.status, 'rejected');
    assert.equal(await readFile(join(root, 'src', 'sample.txt'), 'utf8'), 'ALPHA\nbeta\n');
    const pending2 = await gateway.execute({ sessionId: 'life', wakeId: 'w3', intent: { id: 'd2', type: 'function', function: { name: 'workshop_delete_path', arguments: JSON.stringify({ path: 'src/sample.txt' }) } } });
    const confirmed = gateway.confirmApproval(pending2.result.approvalId, 'life');
    assert.equal(confirmed.outcome.kind, 'workshop_delete_applied');
    assert.equal(existsSync(join(root, 'src', 'sample.txt')), false);
  } finally { world.close(); await rm(dir, { recursive: true, force: true }); }
});

test('clipboard brief tools and kiln ambient state after recipe', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-fixture-kiln-'));
  const root = join(dir, 'repo');
  await mkdir(join(root, 'test'), { recursive: true });
  await writeFile(join(root, 'test', 'ok.test.js'), "const test = require('node:test');\ntest('ok', () => {});", 'utf8');
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'fixture', private: true }), 'utf8');
  const world = new WorldGraphStore(join(dir, 'world.sqlite'));
  world.ensureLifespan('life');
  world.move({ sessionId: 'life', doorId: 'door.workshop' });
  world.engageFixture({ sessionId: 'life', fixtureId: 'fixture.workshop_clipboard' });
  const workshop = new WorkshopAdapter(root);
  const gateway = new WorldActionGateway({ world, workshop, approvalMode: 'auto', recipeTimeoutMs: 30000 });
  try {
    const brief = await gateway.execute({ sessionId: 'life', wakeId: 'w', intent: { id: 'b', type: 'function', function: { name: 'workshop_brief_upsert', arguments: JSON.stringify({ objective: 'Ship fixtures', scope_paths: ['src/world'], acceptance: ['tests pass'], non_goals: ['cloud'] }) } } });
    assert.equal(brief.result.present, true);
    assert.equal(brief.result.objective, 'Ship fixtures');
    world.engageFixture({ sessionId: 'life', fixtureId: 'fixture.workshop_shelves' });
    const recipe = await gateway.execute({ sessionId: 'life', wakeId: 'w2', intent: { id: 'r', type: 'function', function: { name: 'workshop_run_recipe', arguments: JSON.stringify({ recipe: 'node_test', path: 'test/ok.test.js' }) } } });
    assert.equal(recipe.result.kind, 'workshop_recipe');
    assert.equal(recipe.result.status, 'started');
    const deadline = Date.now() + 30000;
    while (gateway.recipes.active && Date.now() < deadline) await new Promise(r => setTimeout(r, 20));
    const kiln = world.getFixtureRuntime(KILN_FIXTURE_ID);
    assert.equal(kiln.status, 'settled', JSON.stringify(kiln));
    assert.equal(kiln.recipe, 'node_test');
    const projection = world.projection('life');
    const kilnFixture = projection.fixtures.find(item => item.id === KILN_FIXTURE_ID);
    assert.equal(kilnFixture.state.status, 'settled');
    assert.match(world.presenceMessage('life'), /fixture\.workshop_kiln \[settled:node_test\]/);
    assert.match(world.presenceMessage('life'), /Heartbeat: kiln settled:node_test/);
    const status = await gateway.execute({ sessionId: 'life', wakeId: 'w3', intent: { id: 'g', type: 'function', function: { name: 'workshop_git_status', arguments: '{}' } } });
    assert.equal(status.result.kind, 'workshop_git_status');
  } finally { world.close(); await rm(dir, { recursive: true, force: true }); }
});

test('HTTP world and approvals expose fixture mount state', async () => {
  let round = 0;
  const provider = {
    async complete({ phase }) {
      if (phase === 'orientation') return { message: { role: 'assistant', content: null, tool_calls: [{ id: 'hearth', type: 'function', function: { name: 'tend_hearth', arguments: '{}' } }] }, content: null, resolvedModel: 'test-model', finishReason: 'tool_calls' };
      round += 1;
      if (round === 1) return { message: { role: 'assistant', content: null, tool_calls: [{ id: 'move', type: 'function', function: { name: 'move_through_door', arguments: '{"door_id":"door.workshop"}' } }] }, content: null, resolvedModel: 'test-model', finishReason: 'tool_calls' };
      if (round === 2) return { message: { role: 'assistant', content: null, tool_calls: [{ id: 'engage', type: 'function', function: { name: 'engage_fixture', arguments: '{"fixture_id":"fixture.workshop_workbench"}' } }] }, content: null, resolvedModel: 'test-model', finishReason: 'tool_calls' };
      return { message: { role: 'assistant', content: 'At the workbench.' }, content: 'At the workbench.', resolvedModel: 'test-model', finishReason: 'stop' };
    },
  };
  const f = await fixture(provider);
  try {
    const result = await post(f.base, 'Enter Workshop and engage the workbench.');
    assert.equal(result.response.status, 200);
    assert.equal(f.hub.world.current(result.body.sessionId).engaged_fixture_id, 'fixture.workshop_workbench');
    const world = await (await fetch(`${f.base}/api/world`)).json();
    assert.equal(world.projection.engagedFixtureId, 'fixture.workshop_workbench');
    assert.ok(world.tools.map(tool => tool.function.name).includes('workshop_apply_patch'));
    assert.ok(schemasForSession(f.hub.world, result.body.sessionId).map(tool => tool.function.name).includes('workshop_tool_catalog'));
    const health = await (await fetch(`${f.base}/api/health`)).json();
    assert.equal(health.engagedFixtureId, 'fixture.workshop_workbench');
    assert.ok(health.mountedTools.includes('workshop_run_recipe'));
  } finally { await f.close(); }
});

test('fixture inspection is read-only and exposes bounded fixture truth', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-fixture-truth-'));
  const root = join(dir, 'repo');
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src', 'sample.txt'), 'alpha\n', 'utf8');
  const world = new WorldGraphStore(join(dir, 'world.sqlite'));
  world.ensureLifespan('life');
  const workshop = new WorkshopAdapter(root);
  const gateway = new WorldActionGateway({ world, workshop, approvalMode: 'confirm' });
  const call = (id, name, args) => gateway.execute({ sessionId: 'life', wakeId: 'wake', intent: { id, type: 'function', function: { name, arguments: JSON.stringify(args) } } });
  try {
    assert.equal(world.availableTools('life').includes('inspect_fixture'), false);
    world.move({ sessionId: 'life', doorId: 'door.workshop' });
    assert.ok(world.availableTools('life').includes('inspect_fixture'));
    const beforeEvents = world.listLocationEvents('life').length;
    const inspected = await call('inspect', 'inspect_fixture', { fixture_id: 'fixture.workshop_clipboard' });
    assert.equal(inspected.result.kind, 'fixture_inspect');
    assert.equal(inspected.result.contents.kind, 'clipboard');
    assert.equal(world.current('life').engaged_fixture_id, null);
    assert.equal(world.listLocationEvents('life').length, beforeEvents);
    const engaged = await call('engage', 'engage_fixture', { fixture_id: 'fixture.workshop_clipboard' });
    assert.equal(engaged.result.fixtureId, 'fixture.workshop_clipboard');
    assert.equal(engaged.result.contents.kind, 'clipboard');
    assert.equal(world.current('life').engaged_fixture_id, 'fixture.workshop_clipboard');

    await call('brief', 'workshop_brief_upsert', { objective: 'Expose the clipboard' });
    const clipboard = await call('clipboard', 'inspect_fixture', { fixture_id: 'fixture.workshop_clipboard' });
    assert.equal(clipboard.result.contents.brief.objective, 'Expose the clipboard');

    const pending = await call('delete', 'workshop_delete_path', { path: 'src/sample.txt' });
    assert.equal(pending.result.status, 'pending_approval');
    const workbench = await call('workbench', 'inspect_fixture', { fixture_id: 'fixture.workshop_workbench' });
    assert.equal(workbench.result.state.pendingApprovals, 1);
    assert.equal(workbench.result.projection.pendingApprovals, 1);
    assert.deepEqual(workbench.result.contents.pending, [{ approvalId: pending.result.approvalId, kind: 'delete_path', status: 'pending' }]);

    const { projectWakeSlips } = await import('../src/corner/slips.js');
    const slips = projectWakeSlips({
      wake: { id: 'wake', phases: [] },
      world,
      pendingApprovals: world.listApprovals('life', { pendingOnly: true }),
    }).slips;
    const pendingSlip = slips.find(slip => slip.kind === 'pending');
    assert.equal(pendingSlip?.approvalId, pending.result.approvalId);
    assert.equal(pendingSlip?.decidable, true);
    assert.match(pendingSlip?.label || '', /Delete waiting/);

    const presence = world.presenceMessage('life');
    assert.match(presence, /Engageable:/);
    assert.match(presence, /Workshop tools are mounted without engaging; engage is orientation only\./);
  } finally {
    world.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('tree truncation, Control Panel supersession, and inspect slips are explicit', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-fixture-tree-'));
  const root = join(dir, 'repo');
  await mkdir(root, { recursive: true });
  await writeFile(join(root, 'a.txt'), 'a', 'utf8');
  await writeFile(join(root, 'b.txt'), 'b', 'utf8');
  try {
    const tree = new WorkshopAdapter(root).tree('.', 1, 1);
    assert.equal(tree.truncated, true);
    assert.equal(tree.note, 'Tree truncated; narrow path or raise max_entries.');
    const controlPanel = await readFile(join(process.cwd(), 'docs', 'specs', 'WORKSHOP_CONTROL_PANEL_V1.md'), 'utf8');
    assert.match(controlPanel.slice(0, 250), /superseded.*HUB-016/i);

    const world = new WorldGraphStore(join(dir, 'world.sqlite'));
    world.ensureLifespan('life');
    world.move({ sessionId: 'life', doorId: 'door.workshop' });
    const gateway = new WorldActionGateway({ world, workshop: new WorkshopAdapter(root) });
    const inspection = await gateway.execute({ sessionId: 'life', wakeId: 'wake', intent: { id: 'inspect', type: 'function', function: { name: 'inspect_fixture', arguments: '{"fixture_id":"fixture.workshop_shelves"}' } } });
    const { projectWakeSlips } = await import('../src/corner/slips.js');
    const slips = projectWakeSlips({ wake: { id: 'wake', phases: [] }, world }).slips;
    assert.equal(inspection.result.contents.kind, 'shelves');
    assert.ok(slips.some(slip => slip.label === 'Looks at the shelves'));
    world.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
