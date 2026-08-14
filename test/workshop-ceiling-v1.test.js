import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorldGraphStore } from '../src/world/graph.js';
import { WorkshopAdapter } from '../src/places/hub/workshop/index.js';
import { WorldActionGateway } from '../src/world/gateway.js';
import { TOOL_NAMES, WORKSHOP_TOOL_NAMES } from '../src/world/tools.js';
import { APPROVAL_ANCHOR, CEILING_WIRES, ceilingCatalog, mountProfile, profilePresenceLine } from '../src/world/ceiling.js';

async function repo() {
  const dir = await mkdtemp(join(tmpdir(), 'hub-ceiling-'));
  const root = join(dir, 'repo');
  await mkdir(join(root, 'src'), { recursive: true });
  await mkdir(join(root, 'test'), { recursive: true });
  await writeFile(join(root, 'src', 'a.js'), 'const alpha = 1;\nconst beta = 2;\n', 'utf8');
  await writeFile(join(root, 'src', 'b.txt'), 'hello\nworld\n', 'utf8');
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'ceiling', private: true, scripts: { test: 'node -e "process.exit(0)"', build: 'node -e "process.exit(0)"' } }), 'utf8');
  await writeFile(join(root, 'test', 'ok.test.js'), "const test = require('node:test');\ntest('ok', () => {});", 'utf8');
  return { dir, root };
}

test('flat mount exposes full workshop catalog without station engagement', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-ceiling-mount-'));
  const world = new WorldGraphStore(join(dir, 'world.sqlite'), { topologyVersion: 'b1' });
  try {
    world.ensureLifespan('life');
    assert.deepEqual(world.availableTools('life'), ['move_through_door', 'move_through_passage', 'inspect_fixture']);
    world.move({ sessionId: 'life', doorId: 'door.workshop' });
    const tools = world.availableTools('life');
    assert.ok(tools.includes('move_through_door'));
    assert.ok(tools.includes('engage_fixture'));
    for (const name of WORKSHOP_TOOL_NAMES) assert.ok(tools.includes(name), name);
    assert.equal(tools.includes('workshop_apply_patch'), true);
    assert.equal(world.current('life').engaged_fixture_id, null);
  } finally { world.close(); await rm(dir, { recursive: true, force: true }); }
});

test('patch bay separates full ceiling catalog from room profiles and presence', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-patch-bay-'));
  const world = new WorldGraphStore(join(dir, 'world.sqlite'), { topologyVersion: 'b1' });
  try {
    world.ensureLifespan('life');
    const catalog = ceilingCatalog();
    assert.deepEqual(new Set(catalog.wires.map(wire => wire.name)), TOOL_NAMES);
    assert.ok(catalog.wires.some(wire => wire.name === 'workshop_apply_patch' && wire.groupId === 'workbench'));
    assert.equal(catalog.approvalAnchor, APPROVAL_ANCHOR);
    assert.deepEqual(world.availableTools('life'), ['move_through_door', 'move_through_passage', 'inspect_fixture']);
    assert.deepEqual(world.projection('life').mountProfile, mountProfile('room.center'));
    assert.match(profilePresenceLine('room.center'), /^Patched: move \(through_door, through_passage\); fixtures \(inspect\)\.$/);
    assert.match(world.presenceMessage('life'), /Patched: move \(through_door, through_passage\); fixtures \(inspect\)\./);

    world.move({ sessionId: 'life', doorId: 'door.workshop' });
    assert.deepEqual(world.availableTools('life'), CEILING_WIRES.map(wire => wire.name).filter(name => !['move_through_passage', 'operate_passage', 'turn_fixture'].includes(name)));
    assert.deepEqual(world.projection('life').mountProfile, mountProfile('room.workshop'));
    const presence = world.presenceMessage('life');
    assert.match(presence, /Patched: .*fixtures \(inspect, engage, disengage\); explore \(list, read, search, …\)/);
    assert.equal(presence.includes('workshop_apply_patch'), false);
    assert.equal(presence.match(/Patched:[^.]*workshop_/), null);
  } finally { world.close(); await rm(dir, { recursive: true, force: true }); }
});

test('patch bay specification and adoption ledger record HUB-023', async () => {
  const spec = await readFile(join(process.cwd(), 'docs', 'specs', 'CEILING_PATCH_BAY_V1.md'), 'utf8');
  const ledger = await readFile(join(process.cwd(), 'docs', 'lineage', 'ADOPTION_LEDGER.md'), 'utf8');
  assert.match(spec, /fixture\.workshop_workbench/);
  assert.match(spec, /Backpack remains outside/i);
  assert.match(ledger, /HUB-023 — Ceiling Patch Bay/);
});

test('explore wires: glob, tree, stat, hash, regex', async () => {
  const { dir, root } = await repo();
  try {
    const workshop = new WorkshopAdapter(root, { maxResults: 20, maxFiles: 50 });
    assert.deepEqual(workshop.glob('src/*.js').matches.sort(), ['src/a.js']);
    assert.ok(workshop.tree('src', 2).entries.some(entry => entry.path === 'src/a.js'));
    assert.equal(workshop.stat('src/b.txt').type, 'file');
    assert.equal(workshop.fileHash('src/b.txt').hash.length, 64);
    assert.equal(workshop.searchRegex('alpha', 'src').matches[0].path, 'src/a.js');
    assert.throws(() => workshop.stat('../secret'), error => error.code === 'workshop_path_invalid');
    assert.throws(() => workshop.searchRegex('(', 'src'), error => error.code === 'workshop_invalid_argument');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('mutate wires auto-apply write/create/rename/diff; delete stays confirm', async () => {
  const { dir, root } = await repo();
  const world = new WorldGraphStore(join(dir, 'world.sqlite'), { topologyVersion: 'b1' });
  world.ensureLifespan('life');
  world.move({ sessionId: 'life', doorId: 'door.workshop' });
  const workshop = new WorkshopAdapter(root);
  const gateway = new WorldActionGateway({ world, workshop, approvalMode: 'confirm' });
  try {
    const write = await gateway.execute({ sessionId: 'life', wakeId: 'w', intent: { id: '1', type: 'function', function: { name: 'workshop_write_file', arguments: JSON.stringify({ path: 'src/new.js', content: 'export const x = 1;\n' }) } } });
    assert.equal(write.result.kind, 'workshop_approval_confirmed');
    assert.equal(await readFile(join(root, 'src', 'new.js'), 'utf8'), 'export const x = 1;\n');

    const create = await gateway.execute({ sessionId: 'life', wakeId: 'w2', intent: { id: '2', type: 'function', function: { name: 'workshop_create_path', arguments: JSON.stringify({ path: 'src/empty', kind: 'directory' }) } } });
    assert.equal(create.result.kind, 'workshop_approval_confirmed');

    const rename = await gateway.execute({ sessionId: 'life', wakeId: 'w3', intent: { id: '3', type: 'function', function: { name: 'workshop_rename_path', arguments: JSON.stringify({ from_path: 'src/b.txt', to_path: 'src/c.txt' }) } } });
    assert.equal(rename.result.kind, 'workshop_approval_confirmed');
    assert.equal(await readFile(join(root, 'src', 'c.txt'), 'utf8'), 'hello\nworld\n');

    const del = await gateway.execute({ sessionId: 'life', wakeId: 'w4', intent: { id: '4', type: 'function', function: { name: 'workshop_delete_path', arguments: JSON.stringify({ path: 'src/c.txt' }) } } });
    assert.equal(del.result.status, 'pending_approval');
    assert.ok(del.result.approvalId);
    assert.equal(await readFile(join(root, 'src', 'c.txt'), 'utf8'), 'hello\nworld\n');
    gateway.confirmApproval(del.result.approvalId, 'life');
    assert.equal(existsSync(join(root, 'src', 'c.txt')), false);

    const diff = await gateway.execute({ sessionId: 'life', wakeId: 'w5', intent: { id: '5', type: 'function', function: { name: 'workshop_apply_unified_diff', arguments: JSON.stringify({ diff: `--- a/src/a.js\n+++ b/src/a.js\n@@ -1,2 +1,2 @@\n-const alpha = 1;\n+const alpha = 9;\n const beta = 2;\n` }) } } });
    assert.equal(diff.result.kind, 'workshop_approval_confirmed');
    assert.match(await readFile(join(root, 'src', 'a.js'), 'utf8'), /alpha = 9/);

    const catalog = await gateway.execute({ sessionId: 'life', wakeId: 'w6', intent: { id: '6', type: 'function', function: { name: 'workshop_tool_catalog', arguments: '{}' } } });
    const byName = Object.fromEntries(catalog.result.tools.map(tool => [tool.name, tool.approvalClass]));
    assert.equal(byName.workshop_write_file, 'auto');
    assert.equal(byName.workshop_git_commit, 'auto');
    assert.equal(byName.workshop_delete_path, 'confirm');
    assert.equal(byName.workshop_git_checkout, 'confirm');
  } finally { world.close(); await rm(dir, { recursive: true, force: true }); }
});

test('recipes list/run/cancel and catalog/approval_list', async () => {
  const { dir, root } = await repo();
  await mkdir(join(root, 'test'), { recursive: true });
  await writeFile(join(root, 'test', 'ok.test.js'), "const test = require('node:test');\ntest('ok', () => {});", 'utf8');
  const world = new WorldGraphStore(join(dir, 'world.sqlite'), { topologyVersion: 'b1' });
  world.ensureLifespan('life');
  world.move({ sessionId: 'life', doorId: 'door.workshop' });
  const workshop = new WorkshopAdapter(root);
  const gateway = new WorldActionGateway({ world, workshop, approvalMode: 'auto', recipeTimeoutMs: 30000 });
  try {
    const listed = await gateway.execute({ sessionId: 'life', wakeId: 'w', intent: { id: '1', type: 'function', function: { name: 'workshop_recipe_list', arguments: '{}' } } });
    assert.ok(listed.result.recipes.some(item => item.id === 'npm_run'));
    const run = await gateway.execute({ sessionId: 'life', wakeId: 'w2', intent: { id: '2', type: 'function', function: { name: 'workshop_run_recipe', arguments: JSON.stringify({ recipe: 'node_test', path: 'test/ok.test.js' }) } } });
    assert.equal(run.result.status, 'started');
    const deadline = Date.now() + 30000;
    while (gateway.recipes.active && Date.now() < deadline) await new Promise(r => setTimeout(r, 20));
    assert.equal(gateway.recipes.active, null);
    assert.equal(world.getFixtureRuntime('fixture.workshop_kiln')?.status, 'settled');
    const cancel = await gateway.execute({ sessionId: 'life', wakeId: 'w3', intent: { id: '3', type: 'function', function: { name: 'workshop_recipe_cancel', arguments: '{}' } } });
    assert.equal(cancel.result.cancelled, false);
    const catalog = await gateway.execute({ sessionId: 'life', wakeId: 'w4', intent: { id: '4', type: 'function', function: { name: 'workshop_tool_catalog', arguments: '{}' } } });
    assert.ok(catalog.result.tools.length >= WORKSHOP_TOOL_NAMES.length);
    const approvals = await gateway.execute({ sessionId: 'life', wakeId: 'w5', intent: { id: '5', type: 'function', function: { name: 'workshop_approval_list', arguments: '{}' } } });
    assert.equal(approvals.result.kind, 'workshop_approval_list');
  } finally { world.close(); await rm(dir, { recursive: true, force: true }); }
});
