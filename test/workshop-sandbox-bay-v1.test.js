import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sha256 } from '../src/core/hash.js';
import {
  buildDockerCreateArgs,
  buildSandboxEnvironment,
  DockerCliSandboxBackend,
  HostTestSandboxBackend,
  SandboxBay,
} from '../src/places/hub/workshop/index.js';

function git(root, args) {
  const result = spawnSync('git', ['-c', `safe.directory=${root.replaceAll('\\', '/')}`, ...args], { cwd: root, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'git failed');
  return result.stdout.trim();
}

async function repository(prefix = 'hub-sandbox-') {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  const repo = join(dir, 'repo');
  git(dir, ['init', repo]);
  git(repo, ['config', 'user.email', 'hub@example.com']);
  git(repo, ['config', 'user.name', 'Hub']);
  await writeFile(join(repo, 'tracked.txt'), 'canonical\n', 'utf8');
  git(repo, ['add', 'tracked.txt']);
  git(repo, ['commit', '-m', 'seed']);
  return { dir, repo, jobs: join(dir, 'jobs'), baseCommit: git(repo, ['rev-parse', 'HEAD']) };
}

test('sandbox environment allowlist excludes inherited and explicitly requested secrets', () => {
  const selected = buildSandboxEnvironment({ PATH: 'safe-path', CI: '1', DEEPSEEK_API_KEY: 'resident-key', RANDOM_VALUE: 'no' }, ['PATH', 'CI', 'DEEPSEEK_API_KEY']);
  assert.deepEqual(selected, { PATH: 'safe-path', CI: '1' });
  assert.throws(() => buildSandboxEnvironment({}, ['CI', 'OPENAI_API_KEY'], { OPENAI_API_KEY: 'nope' }), error => error.code === 'sandbox_env_denied');
  assert.throws(() => buildSandboxEnvironment({}, ['CI'], { UNLISTED: 'nope' }), error => error.code === 'sandbox_env_not_allowed');
});

test('Docker command is non-root, networkless, least-privilege, bounded, and mounts only the disposable Windows path', () => {
  const args = buildDockerCreateArgs({
    containerName: 'hub-sandbox-job-1', image: 'node:22-alpine', workspacePath: 'C:\\Users\\Builder\\Hub Jobs\\job-1\\worktree', platform: 'win32',
    resources: { timeoutMs: 5000, maxOutputBytes: 1000, pidsLimit: 32, memoryBytes: 134217728, cpus: 0.5, tmpfsBytes: 1048576 },
  });
  const rendered = JSON.stringify(args);
  assert.deepEqual(args.slice(0, 3), ['create', '--name', 'hub-sandbox-job-1']);
  assert.ok(args.includes('none'));
  assert.ok(args.includes('65532:65532'));
  assert.ok(args.includes('ALL'));
  assert.ok(args.includes('no-new-privileges'));
  assert.ok(args.includes('--read-only'));
  assert.ok(args.includes('--pids-limit'));
  assert.ok(args.includes('--memory'));
  assert.ok(args.includes('--cpus'));
  assert.match(rendered, /source=C:\/Users\/Builder\/Hub Jobs\/job-1\/worktree,target=\/workspace/);
  assert.doesNotMatch(rendered, /docker\.sock/i);
  assert.equal(args.filter(value => String(value).includes('target=/workspace')).length, 1);
  assert.throws(() => buildDockerCreateArgs({ containerName: 'job', image: 'node:22', workspacePath: 'C:\\tmp\\job', platform: 'win32', user: '0:0' }), /non-root/);
  assert.throws(() => buildDockerCreateArgs({ containerName: 'job', image: 'node:22', workspacePath: 'C:\\tmp\\job', platform: 'win32', network: 'bridge' }), error => error.code === 'sandbox_network_denied');
});

test('Docker capability failure is explicit and never falls back to the host backend', async () => {
  const calls = [];
  const backend = new DockerCliSandboxBackend({
    syncRunner(command, args) { calls.push([command, ...args]); return { status: 1, signal: null, stdout: '', stderr: 'daemon unavailable' }; },
  });
  assert.deepEqual(backend.probe(), { available: false, serverVersion: null, error: 'daemon unavailable' });
  assert.equal(backend.environmentSource.PATH, '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin');
  assert.equal(backend.environmentSource.HOME, '/tmp');
  assert.equal(JSON.stringify(backend.environmentSource).includes('C:\\'), false);
  await assert.rejects(backend.create({}), error => error.code === 'sandbox_backend_unavailable');
  assert.ok(calls.every(call => call[0] === 'docker'));
  assert.throws(() => new HostTestSandboxBackend(), error => error.code === 'sandbox_test_backend_denied');
});

test('host test backend executes only in a disposable worktree and produces a non-mutating promotion plan', async () => {
  const f = await repository();
  const backend = new HostTestSandboxBackend({ testOnly: true });
  const bay = new SandboxBay({
    repoRoot: f.repo, jobsRoot: f.jobs, backend,
    environmentSource: { PATH: process.env.PATH || '', CI: 'source', DEEPSEEK_API_KEY: 'must-not-cross' },
    envAllowlist: ['PATH', 'CI', 'DEEPSEEK_API_KEY'],
    resources: { timeoutMs: 10000, maxOutputBytes: 20000 },
  });
  let jobId;
  try {
    const created = await bay.create({ env: { CI: 'sandbox' } });
    jobId = created.jobId;
    assert.equal(created.manifest.baseCommit, f.baseCommit);
    assert.equal(created.manifest.canonicalMount, 'none');
    assert.equal(created.manifest.workspaceMount, 'rw_disposable');
    assert.equal(created.manifest.network, 'none');
    assert.equal(created.manifest.environment.CI, 'sandbox');
    assert.equal(Object.hasOwn(created.manifest.environment, 'DEEPSEEK_API_KEY'), false);
    assert.notEqual(created.manifest.workspacePath, f.repo);

    const script = [
      "const fs=require('node:fs');",
      "fs.writeFileSync('tracked.txt','sandbox changed\\n');",
      "fs.writeFileSync('new.txt','sandbox new\\n');",
      "process.stdout.write('stdout exact');",
      "process.stderr.write('stderr exact');",
    ].join('');
    const ran = await bay.exec(jobId, { command: process.execPath, args: ['-e', script], env: { CI: 'exec' }, timeoutMs: 5000 });
    assert.equal(ran.execution.exitCode, 0);
    assert.equal(ran.execution.command, process.execPath);
    assert.deepEqual(ran.execution.args, ['-e', script]);
    assert.equal(ran.execution.cwd, '.');
    assert.equal(ran.execution.environment.CI, 'exec');
    assert.equal(Object.hasOwn(ran.execution.environment, 'DEEPSEEK_API_KEY'), false);
    assert.equal(ran.execution.stdout, 'stdout exact');
    assert.equal(ran.execution.stderr, 'stderr exact');
    assert.equal(ran.execution.stdoutHash, sha256('stdout exact'));
    assert.equal(ran.execution.stderrHash, sha256('stderr exact'));
    assert.equal(ran.execution.stdoutExact, true);
    assert.equal(ran.execution.stderrExact, true);
    assert.ok(ran.execution.startedAt <= ran.execution.finishedAt);
    assert.ok(ran.execution.durationMs >= 0);
    assert.match(ran.execution.executionHash, /^[0-9a-f]{64}$/);

    assert.equal(await readFile(join(f.repo, 'tracked.txt'), 'utf8'), 'canonical\n');
    await assert.rejects(access(join(f.repo, 'new.txt')), error => error.code === 'ENOENT');
    const diff = await bay.diff(jobId);
    assert.match(diff.patch, /sandbox changed/);
    assert.match(diff.patch, /new\.txt/);
    assert.equal(diff.patchHash, sha256(diff.patch));
    assert.equal(diff.exact, true);

    const plan = await bay.promotionPlan(jobId);
    assert.equal(plan.baseVerified, true);
    assert.equal(plan.promotable, true);
    assert.equal(plan.canonicalMutationPerformed, false);
    assert.equal(plan.patchHash, diff.patchHash);
    assert.equal(await readFile(join(f.repo, 'tracked.txt'), 'utf8'), 'canonical\n');

    await writeFile(join(f.repo, 'canonical-next.txt'), 'next\n', 'utf8');
    const dirty = await bay.promotionPlan(jobId);
    assert.equal(dirty.baseVerified, true);
    assert.equal(dirty.canonicalDirty, true);
    assert.equal(dirty.promotable, false);
    git(f.repo, ['add', 'canonical-next.txt']);
    git(f.repo, ['commit', '-m', 'canonical advanced']);
    const stale = await bay.promotionPlan(jobId);
    assert.equal(stale.baseVerified, false);
    assert.equal(stale.promotable, false);
    const collected = await bay.collect(jobId);
    assert.equal(collected.backend.testOnly, true);
    assert.equal(collected.manifest.executions.length, 1);
    assert.match(collected.manifest.manifestHash, /^[0-9a-f]{64}$/);
    const workspacePath = collected.manifest.workspacePath;
    const destroyed = await bay.destroy(jobId);
    jobId = null;
    assert.equal(destroyed.manifest.status, 'destroyed');
    assert.equal(destroyed.manifest.diff.patchHash, diff.patchHash);
    assert.equal(destroyed.manifest.executions.length, 1);
    await assert.rejects(access(workspacePath), error => error.code === 'ENOENT');
  } finally {
    if (jobId) await bay.destroy(jobId).catch(() => {});
    await rm(f.dir, { recursive: true, force: true });
  }
});

test('host test cancellation kills the full descendant tree', async () => {
  const f = await repository('hub-sandbox-cancel-');
  const backend = new HostTestSandboxBackend({ testOnly: true });
  const bay = new SandboxBay({ repoRoot: f.repo, jobsRoot: f.jobs, backend, resources: { timeoutMs: 10000 } });
  let jobId;
  try {
    jobId = (await bay.create()).jobId;
    const descendant = "setTimeout(()=>require('node:fs').writeFileSync('descendant.txt','escaped'),700);setInterval(()=>{},1000)";
    const parent = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:'ignore'});setInterval(()=>{},1000)`;
    const running = bay.exec(jobId, { command: process.execPath, args: ['-e', parent], timeoutMs: 5000 });
    await new Promise(resolve => setTimeout(resolve, 200));
    const cancelled = await bay.cancel(jobId);
    assert.equal(cancelled.cancelled, true);
    const result = await running;
    assert.notEqual(result.execution.exitCode, 0);
    await new Promise(resolve => setTimeout(resolve, 900));
    const workspace = result.manifest.workspacePath;
    await assert.rejects(access(join(workspace, 'descendant.txt')), error => error.code === 'ENOENT');
  } finally {
    if (jobId) await bay.destroy(jobId).catch(() => {});
    await rm(f.dir, { recursive: true, force: true });
  }
});
