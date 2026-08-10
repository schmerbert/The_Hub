import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { HostTestSandboxBackend, SandboxBay } from '../src/world/sandbox.js';
import { applySandboxPromotion } from '../src/world/promotion.js';
import { SandboxRecipeRunner } from '../src/world/sandbox-recipes.js';
import { WorldGraphStore } from '../src/world/graph.js';
import { WorkshopAdapter } from '../src/world/workshop.js';
import { WorldActionGateway } from '../src/world/gateway.js';
import { ResultRackStore } from '../src/world/results.js';
import { canonicalize, sha256 } from '../src/core/hash.js';

function git(root, args) {
  const result = spawnSync('git', ['-c', `safe.directory=${root.replaceAll('\\', '/')}`, ...args], { cwd: root, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

async function repository() {
  const dir = await mkdtemp(join(tmpdir(), 'hub-promotion-'));
  const repo = join(dir, 'repo');
  const jobs = join(dir, 'jobs');
  await import('node:fs/promises').then(fs => fs.mkdir(repo));
  git(repo, ['init']);
  git(repo, ['config', 'user.email', 'hub@example.com']);
  git(repo, ['config', 'user.name', 'Hub']);
  await writeFile(join(repo, 'note.txt'), 'before\n', 'utf8');
  await writeFile(join(repo, '.gitignore'), '*.tmp\n', 'utf8');
  git(repo, ['add', 'note.txt', '.gitignore']);
  git(repo, ['commit', '-m', 'base']);
  const bay = new SandboxBay({ repoRoot: repo, jobsRoot: jobs, backend: new HostTestSandboxBackend({ testOnly: true }) });
  return { dir, repo, bay, close: async jobId => { if (jobId) await bay.destroy(jobId).catch(() => {}); await rm(dir, { recursive: true, force: true }); } };
}

function planForPatch(repo, patch) {
  const baseCommit = git(repo, ['rev-parse', 'HEAD']);
  const plan = {
    kind: 'sandbox_promotion_plan',
    jobId: 'protected-path-test',
    baseCommit,
    canonicalHead: baseCommit,
    baseVerified: true,
    canonicalDirty: false,
    promotable: true,
    patch,
    patchHash: sha256(patch),
  };
  plan.planHash = sha256(canonicalize(plan));
  return plan;
}

test('hash-bound promotion applies a sandbox candidate only to a clean unchanged canonical checkout', async () => {
  const f = await repository();
  let jobId;
  try {
    ({ jobId } = await f.bay.create());
    await f.bay.exec(jobId, { command: process.execPath, args: ['-e', "require('fs').writeFileSync('note.txt','after\\n')"] });
    await f.bay.diff(jobId);
    const plan = await f.bay.promotionPlan(jobId);
    assert.equal(await readFile(join(f.repo, 'note.txt'), 'utf8'), 'before\n');
    const outcome = applySandboxPromotion(f.repo, plan);
    assert.equal(outcome.promoted, true);
    assert.equal(outcome.patchHash, plan.patchHash);
    assert.equal((await readFile(join(f.repo, 'note.txt'), 'utf8')).replaceAll('\r\n', '\n'), 'after\n');
  } finally { await f.close(jobId); }
});

test('promotion refuses tampered, dirty, and symbolic-link candidates', async () => {
  const f = await repository();
  let jobId;
  try {
    ({ jobId } = await f.bay.create());
    await f.bay.exec(jobId, { command: process.execPath, args: ['-e', "require('fs').writeFileSync('note.txt','candidate\\n')"] });
    await f.bay.diff(jobId);
    const plan = await f.bay.promotionPlan(jobId);
    assert.throws(() => applySandboxPromotion(f.repo, { ...plan, patch: `${plan.patch}\n# tampered` }), error => error.code === 'sandbox_promotion_invalid');
    const symbolic = { ...plan, patch: `${plan.patch}\nnew file mode 120000\n` };
    symbolic.patchHash = sha256(symbolic.patch);
    delete symbolic.planHash;
    symbolic.planHash = sha256(canonicalize(symbolic));
    assert.throws(() => applySandboxPromotion(f.repo, symbolic), error => error.code === 'sandbox_promotion_forbidden');
    await writeFile(join(f.repo, 'local.txt'), 'human change\n', 'utf8');
    assert.throws(() => applySandboxPromotion(f.repo, plan), error => error.code === 'sandbox_promotion_stale');
  } finally { await f.close(jobId); }
});

test('promotion applies Workshop protected-path law to every old and new diff path', async () => {
  const f = await repository();
  const cases = [
    ['add .env', `diff --git a/.env b/.env\nnew file mode 100644\n--- /dev/null\n+++ b/.env\n@@ -0,0 +1 @@\n+SECRET=x\n`],
    ['modify credential path', `diff --git a/credential.txt b/credential.txt\n--- a/credential.txt\n+++ b/credential.txt\n@@ -1 +1 @@\n-old\n+new\n`],
    ['delete token path', `diff --git a/token.txt b/token.txt\ndeleted file mode 100644\n--- a/token.txt\n+++ /dev/null\n@@ -1 +0,0 @@\n-value\n`],
    ['rename into password path', `diff --git a/note.txt b/password.txt\nsimilarity index 100%\nrename from note.txt\nrename to password.txt\n`],
    ['quoted rename from secret path', `diff --git "a/old secret.txt" "b/note.txt"\nsimilarity index 100%\nrename from "old secret.txt"\nrename to note.txt\n`],
    ['quoted octal .env path', `diff --git "a/\\056env" "b/\\056env"\nnew file mode 100644\n--- /dev/null\n+++ "b/\\056env"\n@@ -0,0 +1 @@\n+SECRET=x\n`],
    ['case-insensitive Git control path', `diff --git a/.GIT/config b/.GIT/config\n--- a/.GIT/config\n+++ b/.GIT/config\n@@ -1 +1 @@\n-old\n+new\n`],
  ];
  try {
    for (const [name, patch] of cases) {
      assert.throws(() => applySandboxPromotion(f.repo, planForPatch(f.repo, patch)), error => error.code === 'sandbox_promotion_forbidden', name);
    }
    assert.equal(await readFile(join(f.repo, 'note.txt'), 'utf8'), 'before\n');
  } finally { await f.close(); }
});

test('promotion refuses changing .gitignore while adding .env', async () => {
  const f = await repository();
  const patch = `diff --git a/.gitignore b/.gitignore\n--- a/.gitignore\n+++ b/.gitignore\n@@ -1 +1,2 @@\n *.tmp\n+.env\ndiff --git a/.env b/.env\nnew file mode 100644\n--- /dev/null\n+++ b/.env\n@@ -0,0 +1 @@\n+SECRET=x\n`;
  try {
    assert.throws(() => applySandboxPromotion(f.repo, planForPatch(f.repo, patch)), error => error.code === 'sandbox_promotion_forbidden');
    assert.equal(await readFile(join(f.repo, '.gitignore'), 'utf8'), '*.tmp\n');
    await assert.rejects(readFile(join(f.repo, '.env'), 'utf8'), error => error.code === 'ENOENT');
  } finally { await f.close(); }
});

test('Gateway promotion is always confirmation-gated and appends completion custody', async () => {
  const f = await repository();
  const world = new WorldGraphStore(join(f.dir, 'world.sqlite'));
  const runner = new SandboxRecipeRunner(f.repo, { sandboxBay: f.bay, timeoutMs: 10000 });
  const gateway = new WorldActionGateway({ world, workshop: new WorkshopAdapter(f.repo), recipeRunner: runner, approvalMode: 'auto' });
  try {
    await writeFile(join(f.repo, 'mutate.js'), "require('fs').writeFileSync('note.txt','promoted\\n')\n", 'utf8');
    git(f.repo, ['add', 'mutate.js']);
    git(f.repo, ['commit', '-m', 'add recipe']);
    world.ensureLifespan('life');
    world.move({ sessionId: 'life', wakeId: 'wake', doorId: 'door.workshop' });
    await gateway.execute({ sessionId: 'life', wakeId: 'wake', intent: { id: 'run', type: 'function', function: { name: 'workshop_run_recipe', arguments: JSON.stringify({ recipe: 'node_file', path: 'mutate.js' }) } } });
    while (runner.active) await new Promise(resolve => setTimeout(resolve, 20));
    const proposed = await gateway.execute({ sessionId: 'life', wakeId: 'wake', intent: { id: 'promote', type: 'function', function: { name: 'workshop_sandbox_promote', arguments: '{}' } } });
    assert.equal(proposed.result.status, 'pending_approval');
    assert.equal(proposed.result.preview.patchExact, true);
    assert.equal(proposed.result.preview.patchOverflow, false);
    assert.match(proposed.result.preview.patch, /^diff --git /);
    assert.equal(sha256(proposed.result.preview.patch), proposed.result.preview.patchHash);
    assert.equal(world.getApproval(proposed.result.approvalId).preview.patch, proposed.result.preview.patch);
    assert.equal((await readFile(join(f.repo, 'note.txt'), 'utf8')).replaceAll('\r\n', '\n'), 'before\n');
    const originalReset = runner.reset.bind(runner);
    let resetCalls = 0;
    let releaseReset;
    runner.reset = reason => {
      resetCalls += 1;
      return new Promise((resolve, reject) => {
        releaseReset = () => originalReset(reason).then(resolve, reject);
      });
    };
    const confirmation = gateway.confirmApproval(proposed.result.approvalId, 'life');
    const duplicate = gateway.confirmApproval(proposed.result.approvalId, 'life');
    assert.strictEqual(duplicate, confirmation);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(resetCalls, 1);
    assert.equal(world.getApproval(proposed.result.approvalId).status, 'pending');
    assert.throws(() => gateway.rejectApproval(proposed.result.approvalId, 'life'), error => error.code === 'workshop_approval_in_progress');
    assert.equal((await readFile(join(f.repo, 'note.txt'), 'utf8')).replaceAll('\r\n', '\n'), 'promoted\n');
    await releaseReset();
    const confirmed = await confirmation;
    assert.equal(confirmed.outcome.promoted, true);
    assert.equal(confirmed.outcome.fullyComplete, true);
    assert.equal(confirmed.outcome.reset.ok, true);
    assert.equal(confirmed.approvalReceipt.phase, 'confirmed');
    assert.equal((await readFile(join(f.repo, 'note.txt'), 'utf8')).replaceAll('\r\n', '\n'), 'promoted\n');
  } finally { await runner.destroy().catch(() => {}); world.close(); await f.close(); }
});

test('promotion reset rejection resolves as confirmed but explicitly not fully complete', async () => {
  const f = await repository();
  const world = new WorldGraphStore(join(f.dir, 'world-reset-failure.sqlite'));
  const runner = new SandboxRecipeRunner(f.repo, { sandboxBay: f.bay, timeoutMs: 10000 });
  const gateway = new WorldActionGateway({ world, workshop: new WorkshopAdapter(f.repo), recipeRunner: runner, approvalMode: 'auto' });
  try {
    await writeFile(join(f.repo, 'mutate.js'), "require('fs').writeFileSync('note.txt','promoted-with-reset-failure\\n')\n", 'utf8');
    git(f.repo, ['add', 'mutate.js']);
    git(f.repo, ['commit', '-m', 'add reset failure recipe']);
    world.ensureLifespan('life');
    world.move({ sessionId: 'life', wakeId: 'wake', doorId: 'door.workshop' });
    await gateway.execute({ sessionId: 'life', wakeId: 'wake', intent: { id: 'run', type: 'function', function: { name: 'workshop_run_recipe', arguments: JSON.stringify({ recipe: 'node_file', path: 'mutate.js' }) } } });
    while (runner.active) await new Promise(resolve => setTimeout(resolve, 20));
    const proposed = await gateway.execute({ sessionId: 'life', wakeId: 'wake', intent: { id: 'promote', type: 'function', function: { name: 'workshop_sandbox_promote', arguments: '{}' } } });
    runner.reset = async () => { throw Object.assign(new Error('injected reset rejection'), { code: 'injected_reset_failure' }); };

    const confirmed = await gateway.confirmApproval(proposed.result.approvalId, 'life');
    assert.equal(confirmed.approval.status, 'confirmed');
    assert.equal(confirmed.outcome.promoted, true);
    assert.equal(confirmed.outcome.fullyComplete, false);
    assert.equal(confirmed.outcome.status, 'promotion_applied_reset_failed');
    assert.deepEqual(confirmed.outcome.reset, {
      kind: 'sandbox_promotion_reset', reason: 'promotion_complete', ok: false, status: 'failed',
      error: 'injected_reset_failure', message: 'injected reset rejection',
    });
    assert.equal(confirmed.approvalReceipt.phase, 'confirmed');
    const action = world.sqlite.prepare('SELECT result_json, outcome FROM world_action_receipts WHERE receipt_id=?').get(confirmed.actionReceipt.receiptId);
    assert.equal(action.outcome, 'committed');
    assert.deepEqual(JSON.parse(action.result_json).outcome.reset, confirmed.outcome.reset);
    assert.equal((await readFile(join(f.repo, 'note.txt'), 'utf8')).replaceAll('\r\n', '\n'), 'promoted-with-reset-failure\n');
  } finally { await runner.destroy().catch(() => {}); world.close(); await f.close(); }
});

test('oversized promotion preview exposes fitted content and an immutable patch-hash pointer', async () => {
  const f = await repository();
  const world = new WorldGraphStore(join(f.dir, 'world-preview-overflow.sqlite'));
  const results = new ResultRackStore(join(f.dir, 'results-preview-overflow.sqlite'), { captureMaxBytes: 512000 });
  const runner = new SandboxRecipeRunner(f.repo, { sandboxBay: f.bay, timeoutMs: 10000 });
  const gateway = new WorldActionGateway({ world, workshop: new WorkshopAdapter(f.repo), recipeRunner: runner, resultRack: results, approvalMode: 'auto' });
  try {
    await writeFile(join(f.repo, 'mutate-large.js'), "require('fs').writeFileSync('note.txt','x'.repeat(40000)+'\\n')\n", 'utf8');
    git(f.repo, ['add', 'mutate-large.js']);
    git(f.repo, ['commit', '-m', 'add large recipe']);
    world.ensureLifespan('life');
    world.move({ sessionId: 'life', wakeId: 'wake', doorId: 'door.workshop' });
    await gateway.execute({ sessionId: 'life', wakeId: 'wake', intent: { id: 'run', type: 'function', function: { name: 'workshop_run_recipe', arguments: JSON.stringify({ recipe: 'node_file', path: 'mutate-large.js' }) } } });
    while (runner.active) await new Promise(resolve => setTimeout(resolve, 20));
    const plan = await runner.promotionPlan();
    assert.ok(plan.patchBytes > 32768);

    const proposed = await gateway.execute({ sessionId: 'life', wakeId: 'wake', intent: { id: 'promote', type: 'function', function: { name: 'workshop_sandbox_promote', arguments: '{}' } } });
    const preview = proposed.result.preview;
    assert.equal(preview.patchExact, false);
    assert.equal(preview.patchOverflow.reason, 'inline_preview_limit');
    assert.equal(preview.patchOverflow.sourceHash, preview.patchHash);
    assert.match(preview.patchPreview, /Result fitted by git_diff/);
    const exact = results.readExact(preview.patchOverflow.exactPointer);
    assert.equal(exact.bodyHash, preview.patchHash);
    assert.equal(exact.body.toString('utf8'), plan.patch);
    assert.deepEqual(world.getApproval(proposed.result.approvalId).preview.patchOverflow, preview.patchOverflow);
  } finally {
    await runner.destroy().catch(() => {});
    results.close();
    world.close();
    await f.close();
  }
});
