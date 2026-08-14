import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rename, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readConfig } from '../src/core/config.js';
import { createHub } from '../src/server/app.js';
import { KILN_FIXTURE_ID, WorldGraphStore } from '../src/world/graph.js';
import { buildRecipeEnvironment, buildRecipeInvocation, RecipeRunner } from '../src/places/hub/workshop/index.js';
import { WorkshopAdapter } from '../src/places/hub/workshop/index.js';
import { WorldActionGateway } from '../src/world/gateway.js';
import { placeInWorkshopFromHouse } from './support/house-navigation.js';

function hubEnv(dir, workshopRoot) {
  return {
    HUB_RESIDENT_MODE: 'fake',
    HUB_APPROVAL_MODE: 'auto',
    HUB_DB_PATH: join(dir, 'hub.sqlite'),
    HUB_WORLD_PATH: join(dir, 'world.sqlite'),
    HUB_SPINE_PATH: join(dir, 'spine.jsonl'),
    HUB_WORKSHOP_ROOT: workshopRoot,
  };
}

async function waitForRecipe(runner, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (runner.active && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
}

function processExists(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

test('approval auto override is fake-only', () => {
  assert.equal(readConfig({ HUB_RESIDENT_MODE: 'live', HUB_APPROVAL_MODE: 'auto' }).approvalMode, 'confirm');
  assert.equal(readConfig({ HUB_RESIDENT_MODE: 'fake', HUB_APPROVAL_MODE: 'auto' }).approvalMode, 'auto');
  assert.equal(readConfig({ HUB_RESIDENT_MODE: 'fake' }).approvalMode, 'confirm');
});

test('recipe environment is an operational allowlist, not inherited credentials', async () => {
  const windows = buildRecipeEnvironment({
    Path: 'C:\\Tools', SystemRoot: 'C:\\Windows', ComSpec: 'cmd.exe',
    ELECTRON_RUN_AS_NODE: 'untrusted', DEEPSEEK_API_KEY: 'provider', SERVICE_TOKEN: 'token', DB_SECRET: 'secret', LOGIN_PASSWORD: 'password', PROXY_AUTH: 'auth',
  }, 'win32');
  assert.deepEqual(windows, { Path: 'C:\\Tools', SystemRoot: 'C:\\Windows', ComSpec: 'cmd.exe' });
  const electronWindows = buildRecipeEnvironment({ Path: 'C:\\Tools', ELECTRON_RUN_AS_NODE: '0', DEEPSEEK_API_KEY: 'provider' }, 'win32');
  assert.deepEqual(electronWindows, { Path: 'C:\\Tools' });
  const unix = buildRecipeEnvironment({
    PATH: '/usr/bin', HOME: '/home/test',
    DEEPSEEK_API_KEY: 'provider', SERVICE_TOKEN: 'token', DB_SECRET: 'secret', LOGIN_PASSWORD: 'password', PROXY_AUTH: 'auth',
  }, 'linux');
  assert.deepEqual(unix, { PATH: '/usr/bin', HOME: '/home/test' });

  const dir = await mkdtemp(join(tmpdir(), 'hub-recipe-env-'));
  try {
    await writeFile(join(dir, 'inspect.js'), `console.log(JSON.stringify({
      path: Boolean(process.env.PATH || process.env.Path),
      systemRoot: process.env.SystemRoot || process.env.SYSTEMROOT || null,
      electronRunAsNode: process.env.ELECTRON_RUN_AS_NODE || null,
      deepseek: process.env.DEEPSEEK_API_KEY || null,
      token: process.env.SERVICE_TOKEN || null,
      secret: process.env.DB_SECRET || null,
      password: process.env.LOGIN_PASSWORD || null,
      auth: process.env.PROXY_AUTH || null
    }));`, 'utf8');
    await writeFile(join(dir, 'package.json'), JSON.stringify({
      scripts: { inspect_env: 'node inspect.js' },
    }), 'utf8');
    await writeFile(join(dir, 'inspect-node.test.js'), `import test from 'node:test';
import assert from 'node:assert/strict';
test('Electron-backed node_test receives its node-mode flag', () => {
  assert.equal(process.env.ELECTRON_RUN_AS_NODE, '1');
});`, 'utf8');
    const sourceEnv = {
      PATH: process.env.PATH || process.env.Path || '',
      ...(process.platform === 'win32' ? {
        SystemRoot: process.env.SystemRoot || 'C:\\Windows',
        ComSpec: process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe',
        PATHEXT: process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD',
      } : { HOME: process.env.HOME || tmpdir() }),
      ELECTRON_RUN_AS_NODE: 'untrusted', DEEPSEEK_API_KEY: 'provider', SERVICE_TOKEN: 'token', DB_SECRET: 'secret', LOGIN_PASSWORD: 'password', PROXY_AUTH: 'auth',
    };
    const result = await new RecipeRunner(dir, { env: sourceEnv, timeoutMs: 5000 }).run('node_file', { path: 'inspect.js' });
    assert.equal(result.status, 'settled', result.stderr);
    const observed = JSON.parse(result.stdout.trim());
    assert.equal(observed.path, true);
    if (process.platform === 'win32') assert.ok(observed.systemRoot);
    assert.deepEqual({ ...observed, path: undefined, systemRoot: undefined }, {
      path: undefined, systemRoot: undefined, electronRunAsNode: null, deepseek: null, token: null, secret: null, password: null, auth: null,
    });

    const injectedElectronPath = process.platform === 'win32' ? 'C:\\Electron\\electron.exe' : '/opt/electron/electron';
    const electronInvocation = buildRecipeInvocation(dir, 'node_file', { path: 'inspect.js' }, { runtime: 'host', execPath: injectedElectronPath, platform: process.platform });
    assert.equal(electronInvocation.command, injectedElectronPath);
    const containerInvocation = buildRecipeInvocation(dir, 'node_file', { path: 'inspect.js' }, { runtime: 'container', execPath: injectedElectronPath, platform: process.platform });
    assert.equal(containerInvocation.command, 'node');

    const electronResult = await new RecipeRunner(dir, {
      env: sourceEnv,
      execPath: process.execPath,
      electronRuntime: true,
      timeoutMs: 5000,
    }).run('node_file', { path: 'inspect.js' });
    assert.equal(electronResult.status, 'settled', electronResult.stderr);
    const electronObserved = JSON.parse(electronResult.stdout.trim());
    assert.equal(electronObserved.electronRunAsNode, '1');
    assert.deepEqual({ deepseek: electronObserved.deepseek, token: electronObserved.token, secret: electronObserved.secret }, { deepseek: null, token: null, secret: null });

    const electronTestResult = await new RecipeRunner(dir, {
      env: sourceEnv,
      execPath: process.execPath,
      electronRuntime: true,
      timeoutMs: 5000,
    }).run('node_test', { path: 'inspect-node.test.js' });
    assert.equal(electronTestResult.status, 'settled', electronTestResult.stderr || electronTestResult.stdout);

    const npmResult = await new RecipeRunner(dir, {
      env: sourceEnv,
      execPath: process.execPath,
      electronRuntime: true,
      timeoutMs: 5000,
    }).run('npm_run', { script: 'inspect_env' });
    assert.equal(npmResult.status, 'settled', npmResult.stderr);
    const npmObserved = JSON.parse(npmResult.stdout.trim().split(/\r?\n/).at(-1));
    assert.equal(npmObserved.electronRunAsNode, null);
    assert.deepEqual({ deepseek: npmObserved.deepseek, token: npmObserved.token, secret: npmObserved.secret }, { deepseek: null, token: null, secret: null });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('startup cancels prior-lifespan approvals and reconciles a running kiln', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-restart-custody-'));
  const repo = join(dir, 'repo');
  await mkdir(repo);
  await writeFile(join(repo, 'kept.txt'), 'kept', 'utf8');
  const env = hubEnv(dir, repo);
  let first = createHub({ env });
  const priorSessionId = first.db.session.id;
  const approval = first.world.createApproval({
    sessionId: priorSessionId,
    wakeId: 'wake-prior',
    kind: 'delete_path',
    payload: { path: 'kept.txt' },
    preview: { path: 'kept.txt' },
  });
  first.world.setFixtureRuntime(KILN_FIXTURE_ID, { status: 'running', recipe: 'node_file' });
  first.close();
  first = null;

  const second = createHub({ env });
  try {
    assert.notEqual(second.db.session.id, priorSessionId);
    const cancelled = second.world.getApproval(approval.approvalId);
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(cancelled.outcome.reason, 'server_restart');
    assert.equal(existsSync(join(repo, 'kept.txt')), true);
    const kiln = second.world.getFixtureRuntime(KILN_FIXTURE_ID);
    assert.equal(kiln.status, 'cancelled');
    assert.equal(kiln.reason, 'server_restart');
    assert.equal(kiln.recipe, 'node_file');
  } finally {
    second.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('HTTP approval decisions cannot mutate another lifespan approval', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-approval-custody-'));
  const repo = join(dir, 'repo');
  await mkdir(repo);
  await writeFile(join(repo, 'kept.txt'), 'kept', 'utf8');
  const hub = createHub({ env: hubEnv(dir, repo) });
  const approval = hub.world.createApproval({
    sessionId: 'another-lifespan',
    wakeId: 'wake-other',
    kind: 'delete_path',
    payload: { path: 'kept.txt' },
    preview: { path: 'kept.txt' },
  });
  await new Promise(resolve => hub.server.listen(0, '127.0.0.1', resolve));
  const address = hub.server.address();
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/approvals/${approval.approvalId}/decide`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision: 'confirm' }),
    });
    const result = await response.json();
    assert.equal(response.status, 400);
    assert.equal(result.error.code, 'workshop_approval_not_found');
    assert.equal(hub.world.getApproval(approval.approvalId).status, 'pending');
    assert.equal(await readFile(join(repo, 'kept.txt'), 'utf8'), 'kept');
  } finally {
    await new Promise(resolve => hub.server.close(resolve));
    hub.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('graceful Hub close cancels an active recipe and persists kiln cancellation', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-close-kiln-'));
  const repo = join(dir, 'repo');
  await mkdir(repo);
  await writeFile(join(repo, 'slow.js'), 'setTimeout(() => {}, 10000);', 'utf8');
  const env = hubEnv(dir, repo);
  const hub = createHub({ env });
  const sessionId = hub.db.session.id;
  await placeInWorkshopFromHouse(hub.world, hub.gateway, sessionId, 'wake-move');
  const started = await hub.gateway.execute({
    sessionId,
    wakeId: 'wake-recipe',
    intent: { id: 'recipe', type: 'function', function: { name: 'workshop_run_recipe', arguments: JSON.stringify({ recipe: 'node_file', path: 'slow.js' }) } },
  });
  assert.equal(started.result.status, 'started');
  assert.ok(hub.gateway.recipes.active);
  const runner = hub.gateway.recipes;
  await hub.close();

  const reopened = new WorldGraphStore(env.HUB_WORLD_PATH);
  try {
    const kiln = reopened.getFixtureRuntime(KILN_FIXTURE_ID);
    assert.equal(kiln.status, 'cancelled');
    assert.equal(kiln.reason, 'hub_close');
    assert.equal(kiln.recipe, 'node_file');
  } finally {
    reopened.close();
    await waitForRecipe(runner);
    await rm(dir, { recursive: true, force: true });
  }
});

test('recipe cancellation terminates a long-lived descendant process', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-recipe-tree-'));
  await writeFile(join(dir, 'tree.js'), `const { spawn } = require('node:child_process');
const { writeFileSync } = require('node:fs');
const descendant = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
writeFileSync('descendant.pid', String(descendant.pid));
setInterval(() => {}, 1000);`, 'utf8');
  const runner = new RecipeRunner(dir, { timeoutMs: 30000 });
  try {
    runner.start('node_file', { path: 'tree.js' });
    const pidPath = join(dir, 'descendant.pid');
    const pidDeadline = Date.now() + 5000;
    while (!existsSync(pidPath) && Date.now() < pidDeadline) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(existsSync(pidPath), true);
    const descendantPid = Number(await readFile(pidPath, 'utf8'));
    assert.equal(processExists(descendantPid), true);
    const cancellation = runner.cancel('test_tree_cancel');
    assert.equal(cancellation.cancelled, true);
    await waitForRecipe(runner);
    const exitDeadline = Date.now() + 5000;
    while (processExists(descendantPid) && Date.now() < exitDeadline) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(processExists(descendantPid), false);
  } finally {
    if (runner.active) runner.cancel('test_cleanup');
    await waitForRecipe(runner);
    await rm(dir, { recursive: true, force: true });
  }
});

test('missing-leaf mutations reject an existing symlink or junction parent', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-missing-link-'));
  const root = join(dir, 'repo');
  const outside = join(dir, 'outside');
  await mkdir(root);
  await mkdir(outside);
  await writeFile(join(root, 'source.txt'), 'source', 'utf8');
  try {
    try { await symlink(outside, join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir'); }
    catch (error) { t.skip(`symlink/junction unavailable: ${error.code || error.message}`); return; }
    const workshop = new WorkshopAdapter(root);
    const forbidden = error => error.code === 'workshop_path_forbidden';
    assert.throws(() => workshop.previewWriteFile('escape/write.txt', 'no'), forbidden);
    assert.throws(() => workshop.previewCreatePath('escape/create.txt', 'file'), forbidden);
    assert.throws(() => workshop.previewRenamePath('source.txt', 'escape/renamed.txt'), forbidden);
    assert.throws(() => workshop.previewUnifiedDiff(`--- /dev/null
+++ b/escape/diff.txt
@@ -0,0 +1 @@
+no
`), forbidden);
    assert.equal(existsSync(join(outside, 'write.txt')), false);
    assert.equal(existsSync(join(outside, 'create.txt')), false);
    assert.equal(existsSync(join(outside, 'renamed.txt')), false);
    assert.equal(existsSync(join(outside, 'diff.txt')), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('confirmed delete is bound to approved identity, hash, and type', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-delete-binding-'));
  const root = join(dir, 'repo');
  await mkdir(root);
  const target = join(root, 'target.txt');
  await writeFile(target, 'approved', 'utf8');
  const world = new WorldGraphStore(join(dir, 'world.sqlite'), { topologyVersion: 'b1' });
  world.ensureLifespan('life');
  world.move({ sessionId: 'life', wakeId: 'move', doorId: 'door.workshop' });
  const workshop = new WorkshopAdapter(root);
  const gateway = new WorldActionGateway({ world, workshop, approvalMode: 'confirm' });
  try {
    const pending = await gateway.execute({
      sessionId: 'life',
      wakeId: 'delete',
      intent: { id: 'delete', type: 'function', function: { name: 'workshop_delete_path', arguments: JSON.stringify({ path: 'target.txt' }) } },
    });
    const approved = world.getApproval(pending.result.approvalId).preview;
    assert.equal(approved.type, 'file');
    assert.match(approved.hash, /^[a-f0-9]{64}$/);
    assert.ok(approved.identity.device);
    assert.ok(approved.identity.inode);

    await writeFile(target, 'changed after approval', 'utf8');
    assert.throws(() => gateway.confirmApproval(pending.result.approvalId, 'life'), error => error.code === 'workshop_patch_stale');
    assert.equal(await readFile(target, 'utf8'), 'changed after approval');
    const applying = world.getApproval(pending.result.approvalId);
    assert.equal(applying.status, 'applying');
    assert.match(applying.application.attemptId, /^approval_attempt_/);

    const identityPreview = workshop.previewDeletePath('target.txt');
    await rename(target, join(root, 'replaced.txt'));
    await writeFile(target, 'changed after approval', 'utf8');
    assert.throws(() => workshop.deletePath('target.txt', identityPreview), error => error.code === 'workshop_patch_stale');

    const typePreview = workshop.previewDeletePath('target.txt');
    await unlink(target);
    await mkdir(target);
    assert.throws(() => workshop.deletePath('target.txt', typePreview), error => error.code === 'workshop_patch_stale');
    assert.equal(existsSync(target), true);
  } finally {
    world.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('unified diff rejects normalized duplicates and validates every section before writing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-diff-atomic-'));
  await writeFile(join(dir, 'a.txt'), 'one\n', 'utf8');
  await writeFile(join(dir, 'b.txt'), 'two\n', 'utf8');
  const workshop = new WorkshopAdapter(dir);
  try {
    const duplicate = `--- a/a.txt
+++ b/a.txt
@@ -1 +1 @@
-one
+first
--- a/./a.txt
+++ b/./a.txt
@@ -1 +1 @@
-one
+second
`;
    assert.throws(() => workshop.applyUnifiedDiff(duplicate), error => error.code === 'workshop_diff_invalid');
    assert.equal(await readFile(join(dir, 'a.txt'), 'utf8'), 'one\n');

    const invalidLaterSection = `--- a/a.txt
+++ b/a.txt
@@ -1 +1 @@
-one
+first
--- a/b.txt
+++ b/b.txt
@@ -1 +1 @@
-not-two
+second
`;
    assert.throws(() => workshop.applyUnifiedDiff(invalidLaterSection), error => error.code === 'workshop_diff_mismatch');
    assert.equal(await readFile(join(dir, 'a.txt'), 'utf8'), 'one\n');
    assert.equal(await readFile(join(dir, 'b.txt'), 'utf8'), 'two\n');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
