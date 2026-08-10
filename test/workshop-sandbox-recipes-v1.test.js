import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildRecipeInvocation, RecipeRunner } from '../src/world/recipes.js';
import { SandboxRecipeRunner } from '../src/world/sandbox-recipes.js';
import { HostTestSandboxBackend, SandboxBay } from '../src/world/sandbox.js';

function git(root, args) {
  const result = spawnSync('git', ['-c', `safe.directory=${root.replaceAll('\\', '/')}`, ...args], { cwd: root, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'git failed');
  return result.stdout.trim();
}

async function repository(prefix = 'hub-sandbox-recipes-') {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  const repo = join(dir, 'repo');
  git(dir, ['init', repo]);
  git(repo, ['config', 'user.email', 'hub@example.com']);
  git(repo, ['config', 'user.name', 'Hub']);
  await writeFile(join(repo, 'tracked.txt'), 'canonical\n', 'utf8');
  await writeFile(join(repo, 'mutate.js'), [
    "const fs = require('node:fs');",
    "const path = 'sandbox-count.txt';",
    "const count = fs.existsSync(path) ? Number(fs.readFileSync(path, 'utf8')) : 0;",
    "fs.writeFileSync(path, String(count + 1));",
    "fs.writeFileSync('tracked.txt', `sandbox ${count + 1}\\n`);",
    "process.stdout.write(`count=${count + 1}`);",
  ].join('\n'), 'utf8');
  await writeFile(join(repo, 'slow.js'), [
    "const fs = require('node:fs');",
    "setTimeout(() => fs.writeFileSync('late.txt', 'escaped'), 800);",
    'setInterval(() => {}, 1000);',
  ].join('\n'), 'utf8');
  await writeFile(join(repo, 'fallback.js'), "require('node:fs').writeFileSync('host-fallback.txt', 'bad');\n", 'utf8');
  await writeFile(join(repo, 'package.json'), JSON.stringify({ name: 'sandbox-recipes', private: true, scripts: { test: 'node mutate.js', check: 'node mutate.js' } }), 'utf8');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-m', 'seed']);
  const backend = new HostTestSandboxBackend({ testOnly: true });
  const bay = new SandboxBay({
    repoRoot: repo,
    jobsRoot: join(dir, 'jobs'),
    backend,
    resources: { timeoutMs: 10000, maxOutputBytes: 20000 },
  });
  const runner = new SandboxRecipeRunner(repo, { sandboxBay: bay, timeoutMs: 5000 });
  return { dir, repo, bay, runner };
}

test('shared invocation validation preserves host commands and emits shell-free container commands', async () => {
  const f = await repository('hub-recipe-invocation-');
  try {
    const hostNode = buildRecipeInvocation(f.repo, 'node_file', { path: 'mutate.js' }, { runtime: 'host' });
    assert.equal(hostNode.command, process.execPath);
    assert.equal(hostNode.shell, false);
    assert.deepEqual(hostNode.args, ['mutate.js']);

    const containerNode = buildRecipeInvocation(f.repo, 'node_test', { path: 'mutate.js' }, { runtime: 'container' });
    assert.equal(containerNode.command, 'node');
    assert.equal(containerNode.shell, false);
    assert.deepEqual(containerNode.args, ['--test', 'mutate.js']);
    const containerWindowsPath = buildRecipeInvocation(f.repo, 'node_file', { path: '.\\mutate.js' }, { runtime: 'container' });
    assert.deepEqual(containerWindowsPath.args, ['./mutate.js']);

    const containerNpm = buildRecipeInvocation(f.repo, 'npm_run', { script: 'check' }, { runtime: 'container' });
    assert.equal(containerNpm.command, 'npm');
    assert.equal(containerNpm.shell, false);
    assert.deepEqual(containerNpm.args, ['run', 'check']);

    const hostRunner = new RecipeRunner(f.repo);
    assert.equal(hostRunner.status().running, false);
  } finally {
    await f.runner.destroy().catch(() => {});
    await rm(f.dir, { recursive: true, force: true });
  }
});

test('sandbox recipes reuse one job, keep canonical files unchanged, and expose diff and promotion plan', async () => {
  const f = await repository();
  const completions = [];
  try {
    const first = await f.runner.start('node_file', { path: 'mutate.js' }, { onComplete: result => completions.push(result) });
    assert.equal(first.status, 'started');
    assert.equal(first.argv[0], 'node');
    assert.ok(first.sandboxJobId);
    const firstResult = await f.runner.lastExecutionPromise;
    assert.equal(firstResult.status, 'settled');
    assert.equal(firstResult.ok, true);
    assert.equal(firstResult.stdout, 'count=1');
    assert.equal(firstResult.sandboxJobId, first.sandboxJobId);
    assert.equal(completions.length, 1);

    const secondResult = await f.runner.run('node_file', { path: 'mutate.js' });
    assert.equal(secondResult.status, 'settled');
    assert.equal(secondResult.stdout, 'count=2');
    assert.equal(secondResult.sandboxJobId, first.sandboxJobId);
    assert.equal(f.runner.status().sandboxJobId, first.sandboxJobId);
    assert.equal(f.bay.jobs.size, 1);

    assert.equal(await readFile(join(f.repo, 'tracked.txt'), 'utf8'), 'canonical\n');
    await assert.rejects(access(join(f.repo, 'sandbox-count.txt')), error => error.code === 'ENOENT');
    const diff = await f.runner.diff();
    assert.match(diff.patch, /sandbox 2/);
    assert.match(diff.patch, /sandbox-count\.txt/);
    assert.equal(diff.exact, true);
    const plan = await f.runner.promotionPlan();
    assert.equal(plan.jobId, first.sandboxJobId);
    assert.equal(plan.promotable, true);
    assert.equal(plan.canonicalMutationPerformed, false);
    assert.equal(await readFile(join(f.repo, 'tracked.txt'), 'utf8'), 'canonical\n');

    const destroyed = await f.runner.destroy();
    assert.equal(destroyed.destroyed, true);
    assert.equal(destroyed.sandboxJobId, first.sandboxJobId);
    assert.equal(f.bay.jobs.size, 0);
    assert.equal(f.runner.status().sandboxJobId, null);
  } finally {
    await f.runner.destroy().catch(() => {});
    await rm(f.dir, { recursive: true, force: true });
  }
});

test('cancel completes as cancelled, and close suppresses late onComplete before destroy', async () => {
  const cancelledFixture = await repository('hub-sandbox-recipe-cancel-');
  const cancelledCompletions = [];
  try {
    await cancelledFixture.runner.start('node_file', { path: 'slow.js' }, { onComplete: result => cancelledCompletions.push(result) });
    await assert.rejects(cancelledFixture.runner.start('node_file', { path: 'mutate.js' }), error => error.code === 'workshop_recipe_busy');
    await new Promise(resolve => setTimeout(resolve, 150));
    const cancelled = await cancelledFixture.runner.cancel('cancelled_by_test');
    assert.equal(cancelled.cancelled, true);
    const result = await cancelledFixture.runner.lastExecutionPromise;
    assert.equal(result.status, 'cancelled');
    assert.equal(result.cancelled, 'cancelled_by_test');
    assert.equal(cancelledCompletions.length, 1);
    await new Promise(resolve => setTimeout(resolve, 900));
    const collected = await cancelledFixture.runner.collect();
    await assert.rejects(access(join(collected.manifest.workspacePath, 'late.txt')), error => error.code === 'ENOENT');
    assert.equal(await readFile(join(cancelledFixture.repo, 'tracked.txt'), 'utf8'), 'canonical\n');
  } finally {
    await cancelledFixture.runner.destroy().catch(() => {});
    await rm(cancelledFixture.dir, { recursive: true, force: true });
  }

  const closedFixture = await repository('hub-sandbox-recipe-close-');
  let lateCompletionCount = 0;
  try {
    await closedFixture.runner.start('node_file', { path: 'slow.js' }, { onComplete: () => { lateCompletionCount += 1; } });
    await new Promise(resolve => setTimeout(resolve, 150));
    const closed = await closedFixture.runner.close('hub_close');
    assert.equal(closed.closed, true);
    assert.equal(closed.cancelled, true);
    const result = await closedFixture.runner.lastExecutionPromise;
    assert.equal(result.status, 'cancelled');
    assert.equal(result.cancelled, 'hub_close');
    assert.equal(lateCompletionCount, 0);
    assert.equal(closedFixture.runner.status().state, 'closed');
    assert.equal(existsSync(join(closedFixture.repo, 'late.txt')), false);
  } finally {
    await closedFixture.runner.destroy().catch(() => {});
    await rm(closedFixture.dir, { recursive: true, force: true });
  }
});

test('invalid recipes and paths reject before sandbox creation and create failure never falls back to host', async () => {
  const f = await repository('hub-sandbox-recipe-refusal-');
  try {
    await assert.rejects(f.runner.start('unknown_recipe'), error => error.code === 'workshop_recipe_unknown');
    await assert.rejects(f.runner.start('node_file', { path: '../escape.js' }), error => error.code === 'workshop_path_invalid');
    await assert.rejects(f.runner.start('node_file', {}), error => error.code === 'workshop_invalid_argument');
    await assert.rejects(f.runner.start('npm_run', { script: 'missing' }), error => error.code === 'workshop_recipe_script_missing');
    assert.equal(f.bay.jobs.size, 0);

    f.bay.create = async () => { throw Object.assign(new Error('sandbox unavailable'), { code: 'sandbox_backend_unavailable' }); };
    await assert.rejects(f.runner.start('node_file', { path: 'fallback.js' }), error => error.code === 'sandbox_backend_unavailable');
    assert.equal(existsSync(join(f.repo, 'host-fallback.txt')), false);
    assert.equal(f.bay.jobs.size, 0);
    assert.equal(f.runner.status().running, false);
  } finally {
    await f.runner.destroy().catch(() => {});
    await rm(f.dir, { recursive: true, force: true });
  }
});
