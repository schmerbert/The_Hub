import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, realpathSync, rmSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { canonicalize, sha256 } from './canonical.js';

function fail(code, message) { throw Object.assign(new Error(message), { code }); }

export const SANDBOX_ENV_ALLOWLIST = Object.freeze([
  'PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP',
  'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ', 'TERM', 'COLORTERM',
  'NO_COLOR', 'FORCE_COLOR', 'CI',
  'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT',
  'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH',
]);

export const DEFAULT_SANDBOX_RESOURCES = Object.freeze({
  timeoutMs: 120000,
  maxOutputBytes: 120000,
  pidsLimit: 128,
  memoryBytes: 536870912,
  cpus: 1,
  tmpfsBytes: 67108864,
});

const SECRET_ENV = /(?:^|_)(?:API_?KEY|AUTH|BEARER|CREDENTIALS?|PASSWORD|PRIVATE_?KEY|SECRET|TOKEN)(?:_|$)/i;
const PROVIDER_ENV = /^(?:DEEPSEEK|OPENAI|ANTHROPIC|GEMINI|GOOGLE)_/i;

function assertObject(value, label) {
  if (!value || Array.isArray(value) || typeof value !== 'object') fail('sandbox_invalid_argument', `${label} must be an object.`);
}

function validateResources(input = {}) {
  assertObject(input, 'Sandbox resources');
  const resources = { ...DEFAULT_SANDBOX_RESOURCES, ...input };
  for (const key of ['timeoutMs', 'maxOutputBytes', 'pidsLimit', 'memoryBytes', 'tmpfsBytes']) {
    if (!Number.isInteger(resources[key]) || resources[key] < 1) fail('sandbox_invalid_argument', `Sandbox ${key} must be a positive integer.`);
  }
  if (typeof resources.cpus !== 'number' || !Number.isFinite(resources.cpus) || resources.cpus <= 0) fail('sandbox_invalid_argument', 'Sandbox cpus must be positive.');
  return resources;
}

function isSecretEnvironmentKey(key) { return SECRET_ENV.test(key) || PROVIDER_ENV.test(key); }

export function buildSandboxEnvironment(source = process.env, allowlist = SANDBOX_ENV_ALLOWLIST, overrides = {}) {
  assertObject(source, 'Environment source');
  assertObject(overrides, 'Environment overrides');
  const allowed = new Set(allowlist.map(key => String(key).toUpperCase()));
  const environment = {};
  for (const [key, value] of Object.entries(source)) {
    if (allowed.has(key.toUpperCase()) && !isSecretEnvironmentKey(key) && typeof value === 'string') environment[key] = value;
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (isSecretEnvironmentKey(key)) fail('sandbox_env_denied', `Sandbox environment key ${key} is secret-bearing and denied.`);
    if (!allowed.has(key.toUpperCase())) fail('sandbox_env_not_allowed', `Sandbox environment key ${key} is not allowlisted.`);
    if (typeof value !== 'string' || value.includes('\0')) fail('sandbox_invalid_argument', `Sandbox environment value ${key} must be a NUL-free string.`);
    environment[key] = value;
  }
  return environment;
}

function assertWithin(root, target, code = 'sandbox_path_escape') {
  const rel = relative(root, target);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) fail(code, 'Sandbox path escapes its disposable workspace.');
}

function normalizedRoot(path) {
  if (typeof path !== 'string' || !path) fail('sandbox_invalid_argument', 'A repository root is required.');
  return realpathSync(path);
}

function validateRevision(revision) {
  if (typeof revision !== 'string' || !revision || revision.length > 200 || revision.startsWith('-') || revision.includes('..') || /[\0\r\n]/.test(revision)) fail('sandbox_invalid_argument', 'Sandbox base revision is invalid.');
  return revision;
}

function runSync(command, args, { cwd, env = process.env, maxBytes = 1024 * 1024, runner = spawnSync } = {}) {
  const result = runner(command, args, { cwd, env, encoding: 'utf8', windowsHide: true, maxBuffer: maxBytes });
  if (result.error) fail('sandbox_backend_unavailable', result.error.message || `${command} is unavailable.`);
  return { code: result.status, signal: result.signal, stdout: result.stdout || '', stderr: result.stderr || '' };
}

function git(root, args, { allowFailure = false, maxBytes } = {}) {
  const result = runSync('git', ['-c', `safe.directory=${root.replaceAll('\\', '/')}`, ...args], { cwd: root, maxBytes });
  if (!allowFailure && result.code !== 0) fail('sandbox_git_failed', result.stderr || result.stdout || 'Sandbox git operation failed.');
  return result;
}

function createDisposableWorktree(repoRoot, jobsRoot, jobId, revision) {
  const root = normalizedRoot(repoRoot);
  const jobs = resolve(jobsRoot);
  const jobsRelative = relative(root, jobs);
  if (jobsRelative === '' || (jobsRelative !== '..' && !jobsRelative.startsWith(`..${sep}`) && !isAbsolute(jobsRelative))) fail('sandbox_invalid_argument', 'Sandbox jobs root must be outside the canonical checkout.');
  const base = git(root, ['rev-parse', '--verify', `${validateRevision(revision)}^{commit}`]).stdout.trim();
  if (!/^[0-9a-f]{40,64}$/i.test(base)) fail('sandbox_git_failed', 'Sandbox base did not resolve to a commit.');
  const jobRoot = join(jobs, jobId);
  const workspacePath = join(jobRoot, 'worktree');
  mkdirSync(jobRoot, { recursive: true });
  try {
    git(root, ['worktree', 'add', '--detach', workspacePath, base]);
  } catch (error) {
    rmSync(jobRoot, { recursive: true, force: true });
    throw error;
  }
  return { baseCommit: base, jobRoot, workspacePath: realpathSync(workspacePath) };
}

function removeDisposableWorktree(job) {
  if (existsSync(job.workspacePath)) git(job.repoRoot, ['worktree', 'remove', '--force', job.workspacePath], { allowFailure: true });
  rmSync(job.jobRoot, { recursive: true, force: true });
  git(job.repoRoot, ['worktree', 'prune'], { allowFailure: true });
}

function outputCollector(maxBytes) {
  const hash = createHash('sha256');
  let bytes = 0;
  let retained = Buffer.alloc(0);
  let truncated = false;
  return {
    append(chunk) {
      const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      hash.update(value);
      bytes += value.length;
      if (retained.length < maxBytes) retained = Buffer.concat([retained, value.subarray(0, maxBytes - retained.length)]);
      if (bytes > maxBytes) truncated = true;
    },
    finish() { return { text: retained.toString('utf8'), byteLength: bytes, sha256: hash.digest('hex'), truncated, exact: !truncated }; },
  };
}

function killProcessTree(child) {
  if (!child?.pid) return false;
  if (process.platform === 'win32') {
    const systemRoot = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows';
    const taskkill = join(systemRoot, 'System32', 'taskkill.exe');
    const killed = spawnSync(taskkill, ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 5000 });
    if (!killed.error && killed.status === 0) return true;
    try { return child.kill(); } catch { return false; }
  }
  try { process.kill(-child.pid, 'SIGKILL'); return true; } catch { try { return child.kill('SIGKILL'); } catch { return false; } }
}

function runCaptured(command, args, options) {
  const { cwd, env, timeoutMs, maxOutputBytes, onSpawn, onFinish, onTimeout } = options;
  return new Promise(resolvePromise => {
    const startedMs = Date.now();
    const startedAt = new Date(startedMs).toISOString();
    const stdout = outputCollector(maxOutputBytes);
    const stderr = outputCollector(maxOutputBytes);
    let timedOut = false;
    let finished = false;
    let child;
    let timer = null;
    const finish = (code, signal, spawnError = null) => {
      if (finished) return;
      finished = true;
      if (timer) clearTimeout(timer);
      onFinish?.(child);
      const finishedMs = Date.now();
      resolvePromise({
        code, signal, timedOut, spawnError,
        startedAt, finishedAt: new Date(finishedMs).toISOString(), durationMs: finishedMs - startedMs,
        stdout: stdout.finish(), stderr: stderr.finish(),
      });
    };
    try {
      child = spawn(command, args, { cwd, env, shell: false, windowsHide: true, detached: process.platform !== 'win32' });
    } catch (error) {
      finish(null, null, error.message);
      return;
    }
    onSpawn?.(child);
    child.stdout?.on('data', chunk => stdout.append(chunk));
    child.stderr?.on('data', chunk => stderr.append(chunk));
    child.on('error', error => finish(null, null, error.message));
    child.on('close', (code, signal) => finish(code, signal));
    timer = setTimeout(() => {
      timedOut = true;
      try { onTimeout?.(child); } finally { killProcessTree(child); }
    }, timeoutMs);
  });
}

function validateExec(job, request, resources, environmentSource, allowlist) {
  assertObject(request, 'Sandbox exec request');
  if (typeof request.command !== 'string' || !request.command || /[\0\r\n]/.test(request.command)) fail('sandbox_invalid_argument', 'Sandbox command is invalid.');
  const args = request.args || [];
  if (!Array.isArray(args) || args.length > 200 || args.some(arg => typeof arg !== 'string' || arg.includes('\0'))) fail('sandbox_invalid_argument', 'Sandbox command arguments are invalid.');
  const cwdRelative = request.cwd || '.';
  if (typeof cwdRelative !== 'string' || isAbsolute(cwdRelative) || cwdRelative.includes('\0')) fail('sandbox_invalid_argument', 'Sandbox cwd must be relative.');
  const cwd = resolve(job.workspacePath, cwdRelative);
  assertWithin(job.workspacePath, cwd);
  if (!existsSync(cwd)) fail('sandbox_path_escape', 'Sandbox cwd is unavailable or escapes the disposable workspace.');
  assertWithin(job.workspacePath, realpathSync(cwd));
  const timeoutMs = request.timeoutMs ?? resources.timeoutMs;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > resources.timeoutMs) fail('sandbox_invalid_argument', 'Sandbox command timeout exceeds the job ceiling.');
  const env = buildSandboxEnvironment(environmentSource, allowlist, { ...job.environment, ...(request.env || {}) });
  return { command: request.command, args, cwd, cwdRelative, timeoutMs, env };
}

function refreshManifest(job) {
  const basis = { ...job.manifest };
  delete basis.manifestHash;
  job.manifest.manifestHash = sha256(canonicalize(basis));
  return structuredClone(job.manifest);
}

function collectDiff(job) {
  git(job.workspacePath, ['add', '-A', '--']);
  const diff = git(job.workspacePath, ['diff', '--cached', '--binary', '--no-ext-diff', job.baseCommit, '--'], { maxBytes: Math.max(job.resources.maxOutputBytes * 8, 1024 * 1024) });
  const names = git(job.workspacePath, ['diff', '--cached', '--name-status', '-z', job.baseCommit, '--']).stdout.split('\0').filter(Boolean);
  return { baseCommit: job.baseCommit, patch: diff.stdout, patchBytes: Buffer.byteLength(diff.stdout), patchHash: sha256(diff.stdout), nameStatus: names, exact: true };
}

function dockerHostPath(path, platform = process.platform) {
  const absolute = platform === 'win32' && (/^[a-zA-Z]:[\\/]/.test(path) || /^\\\\/.test(path)) ? path : resolve(path);
  if (absolute.includes(',')) fail('sandbox_invalid_argument', 'Docker bind source may not contain a comma.');
  return platform === 'win32' ? absolute.replaceAll('\\', '/') : absolute;
}

export function buildDockerCreateArgs({ containerName, image, workspacePath, resources = DEFAULT_SANDBOX_RESOURCES, network = 'none', user = '65532:65532', platform = process.platform, idleCommand = ['sh', '-c', 'trap : TERM INT; sleep infinity & wait'] }) {
  const limits = validateResources(resources);
  if (typeof containerName !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(containerName)) fail('sandbox_invalid_argument', 'Docker container name is invalid.');
  if (typeof image !== 'string' || !image || image.startsWith('-') || /[\0\r\n]/.test(image)) fail('sandbox_invalid_argument', 'Docker image is invalid.');
  if (network !== 'none') fail('sandbox_network_denied', 'Sandbox Bay defaults to and currently requires network none.');
  if (typeof user !== 'string' || !user || /^(?:0|root)(?::|$)/i.test(user)) fail('sandbox_invalid_argument', 'Docker sandbox must run as a non-root user.');
  return [
    'create', '--name', containerName,
    '--network', 'none',
    '--user', user,
    '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges',
    '--read-only',
    '--tmpfs', `/tmp:rw,nosuid,nodev,noexec,size=${limits.tmpfsBytes}`,
    '--pids-limit', String(limits.pidsLimit),
    '--memory', String(limits.memoryBytes),
    '--cpus', String(limits.cpus),
    '--stop-timeout', '2',
    '--mount', `type=bind,source=${dockerHostPath(workspacePath, platform)},target=/workspace`,
    '--workdir', '/workspace',
    '--label', `hub.sandbox.job=${containerName}`,
    image, ...idleCommand,
  ];
}

export class HostTestSandboxBackend {
  constructor({ testOnly = false } = {}) {
    if (testOnly !== true) fail('sandbox_test_backend_denied', 'The host sandbox backend is test-only and must be explicitly enabled.');
    this.id = 'host-test';
    this.running = new Map();
  }
  async create(job) { return { backend: this.id, testOnly: true, networkEnforced: false, resourceEnforcement: { timeout: true, fullTreeCancel: true, pids: false, memory: false, cpu: false }, workspace: 'disposable_git_worktree' }; }
  async exec(job, request) {
    return runCaptured(request.command, request.args, {
      cwd: request.cwd, env: request.env, timeoutMs: request.timeoutMs, maxOutputBytes: job.resources.maxOutputBytes,
      onSpawn: child => this.running.set(job.id, child),
      onFinish: () => this.running.delete(job.id),
    });
  }
  async collect(job) { return { backend: this.id, running: this.running.has(job.id), testOnly: true }; }
  async diff(job) { return collectDiff(job); }
  async cancel(job) { const child = this.running.get(job.id); if (!child) return { cancelled: false }; return { cancelled: killProcessTree(child) }; }
  async destroy(job) { await this.cancel(job); return { destroyed: true }; }
}

export class DockerCliSandboxBackend {
  constructor({ dockerBinary = 'docker', image = 'node:22-alpine', user, syncRunner = spawnSync, containerEnvironment } = {}) {
    this.id = 'docker-cli';
    this.dockerBinary = dockerBinary;
    this.image = image;
    const hostUid = typeof process.getuid === 'function' ? process.getuid() : null;
    const hostGid = typeof process.getgid === 'function' ? process.getgid() : null;
    this.user = user || (Number.isInteger(hostUid) && hostUid > 0 ? `${hostUid}:${hostGid}` : '65532:65532');
    this.environmentSource = containerEnvironment || {
      PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
      HOME: '/tmp', TMPDIR: '/tmp', CI: 'true',
    };
    this.syncRunner = syncRunner;
    this.containers = new Map();
  }
  #sync(args, allowFailure = false) {
    const result = runSync(this.dockerBinary, args, { runner: this.syncRunner });
    if (!allowFailure && result.code !== 0) fail('sandbox_docker_failed', result.stderr || result.stdout || 'Docker command failed.');
    return result;
  }
  probe() {
    const result = this.#sync(['version', '--format', '{{.Server.Version}}'], true);
    return { available: result.code === 0, serverVersion: result.code === 0 ? result.stdout.trim() : null, error: result.code === 0 ? null : (result.stderr || result.stdout || 'docker_unavailable').trim() };
  }
  async create(job) {
    const capability = this.probe();
    if (!capability.available) fail('sandbox_backend_unavailable', `Docker backend is unavailable: ${capability.error}`);
    const containerName = `hub-sandbox-${job.id.replace(/[^a-zA-Z0-9_.-]/g, '-').slice(0, 80)}`;
    const args = buildDockerCreateArgs({ containerName, image: this.image, workspacePath: job.workspacePath, resources: job.resources, network: job.network, user: this.user });
    this.#sync(args);
    try {
      this.#sync(['start', containerName]);
      const writable = this.#sync(['exec', containerName, 'sh', '-c', 'test -w /workspace'], true);
      if (writable.code !== 0) fail('sandbox_workspace_not_writable', 'The configured non-root Docker user cannot write the disposable workspace mount.');
    }
    catch (error) { this.#sync(['rm', '-f', containerName], true); throw error; }
    this.containers.set(job.id, containerName);
    return { backend: this.id, capability, containerName, createArgs: args, networkEnforced: true, workspaceWritable: true, user: this.user, resourceEnforcement: { timeout: true, fullTreeCancel: true, pids: true, memory: true, cpu: true }, workspace: 'disposable_git_worktree' };
  }
  async exec(job, request) {
    const container = this.containers.get(job.id);
    if (!container) fail('sandbox_job_unavailable', 'Docker sandbox container is not active.');
    const relativeCwd = relative(job.workspacePath, request.cwd).replaceAll('\\', '/');
    const args = ['exec', '--workdir', relativeCwd ? `/workspace/${relativeCwd}` : '/workspace'];
    for (const [key, value] of Object.entries(request.env)) args.push('--env', `${key}=${value}`);
    args.push(container, request.command, ...request.args);
    return runCaptured(this.dockerBinary, args, {
      cwd: job.repoRoot, env: process.env, timeoutMs: request.timeoutMs, maxOutputBytes: job.resources.maxOutputBytes,
      onTimeout: () => { this.#sync(['kill', container], true); },
    });
  }
  async collect(job) { return { backend: this.id, running: this.containers.has(job.id), containerName: this.containers.get(job.id) || null }; }
  async diff(job) { return collectDiff(job); }
  async cancel(job) { const container = this.containers.get(job.id); if (!container) return { cancelled: false }; this.#sync(['kill', container], true); return { cancelled: true }; }
  async destroy(job) { const container = this.containers.get(job.id); if (container) this.#sync(['rm', '-f', container], true); this.containers.delete(job.id); return { destroyed: true }; }
}

export class SandboxBay {
  constructor({ repoRoot, backend, jobsRoot = join(tmpdir(), 'hub-sandbox-bay'), envAllowlist = SANDBOX_ENV_ALLOWLIST, environmentSource, resources = {} } = {}) {
    if (!backend || ['create', 'exec', 'collect', 'diff', 'cancel', 'destroy'].some(method => typeof backend[method] !== 'function')) fail('sandbox_backend_invalid', 'Sandbox backend must implement create/exec/collect/diff/cancel/destroy.');
    this.repoRoot = normalizedRoot(repoRoot);
    this.backend = backend;
    this.jobsRoot = resolve(jobsRoot);
    const rel = relative(this.repoRoot, this.jobsRoot);
    if (rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))) fail('sandbox_invalid_argument', 'Sandbox jobs root must be outside the canonical checkout.');
    this.envAllowlist = [...envAllowlist];
    this.environmentSource = environmentSource || backend.environmentSource || process.env;
    this.resources = validateResources(resources);
    this.jobs = new Map();
  }
  async create({ baseRevision = 'HEAD', env = {}, network = 'none', resources = {} } = {}) {
    if (network !== 'none') fail('sandbox_network_denied', 'Sandbox jobs default to and currently require network none.');
    const id = `sandbox_${randomUUID()}`;
    const limits = validateResources({ ...this.resources, ...resources });
    const disposable = createDisposableWorktree(this.repoRoot, this.jobsRoot, id, baseRevision);
    const environment = buildSandboxEnvironment(this.environmentSource, this.envAllowlist, env);
    const job = { id, repoRoot: this.repoRoot, ...disposable, network, environment, resources: limits, executions: [], status: 'creating' };
    job.manifest = {
      schemaVersion: 1, jobId: id, backend: this.backend.id || 'custom', status: 'creating',
      baseCommit: job.baseCommit, workspacePath: job.workspacePath, canonicalRepoPath: this.repoRoot,
      canonicalMount: 'none', workspaceMount: 'rw_disposable', network,
      environment, environmentKeys: Object.keys(environment).sort(),
      resources: limits,
      controls: { timeout: true, fullTreeCancel: true, processLimit: limits.pidsLimit, memoryBytes: limits.memoryBytes, cpus: limits.cpus, readOnlyRoot: this.backend.id === 'docker-cli' },
      createdAt: new Date().toISOString(), backendReceipt: null, executions: [], diff: null, destroyedAt: null,
    };
    this.jobs.set(id, job);
    try {
      job.manifest.backendReceipt = await this.backend.create(job);
      job.manifest.controls.enforcement = job.manifest.backendReceipt.resourceEnforcement || null;
      job.manifest.controls.networkEnforced = Boolean(job.manifest.backendReceipt.networkEnforced);
      job.status = 'ready'; job.manifest.status = 'ready';
      return { jobId: id, manifest: refreshManifest(job) };
    } catch (error) {
      this.jobs.delete(id);
      removeDisposableWorktree(job);
      throw error;
    }
  }
  job(jobId) { const job = this.jobs.get(jobId); if (!job) fail('sandbox_job_not_found', 'Sandbox job was not found.'); return job; }
  async exec(jobId, request) {
    const job = this.job(jobId);
    if (job.status !== 'ready') fail('sandbox_job_unavailable', 'Sandbox job is not ready.');
    const validated = validateExec(job, request, job.resources, this.environmentSource, this.envAllowlist);
    const commandRecord = { command: validated.command, args: [...validated.args], cwd: validated.cwdRelative, environment: validated.env, timeoutMs: validated.timeoutMs };
    const result = await this.backend.exec(job, validated);
    const execution = {
      ordinal: job.executions.length + 1, ...commandRecord,
      exitCode: result.code, signal: result.signal, timedOut: Boolean(result.timedOut), spawnError: result.spawnError || null,
      startedAt: result.startedAt, finishedAt: result.finishedAt, durationMs: result.durationMs,
      stdout: result.stdout.text, stdoutBytes: result.stdout.byteLength, stdoutHash: result.stdout.sha256, stdoutExact: result.stdout.exact,
      stderr: result.stderr.text, stderrBytes: result.stderr.byteLength, stderrHash: result.stderr.sha256, stderrExact: result.stderr.exact,
    };
    execution.executionHash = sha256(canonicalize(execution));
    job.executions.push(execution); job.manifest.executions.push(execution);
    return { execution: structuredClone(execution), manifest: refreshManifest(job) };
  }
  async collect(jobId) { const job = this.job(jobId); return { backend: await this.backend.collect(job), manifest: refreshManifest(job) }; }
  async diff(jobId) { const job = this.job(jobId); const diff = await this.backend.diff(job); job.manifest.diff = diff; return { ...structuredClone(diff), manifest: refreshManifest(job) }; }
  async cancel(jobId) { const job = this.job(jobId); const result = await this.backend.cancel(job); job.status = 'cancelled'; job.manifest.status = 'cancelled'; job.manifest.cancelledAt = new Date().toISOString(); return { ...result, manifest: refreshManifest(job) }; }
  async promotionPlan(jobId) {
    const job = this.job(jobId);
    const diff = job.manifest.diff || await this.backend.diff(job);
    job.manifest.diff = diff;
    const canonicalHead = git(this.repoRoot, ['rev-parse', 'HEAD']).stdout.trim();
    const workspaceHead = git(job.workspacePath, ['rev-parse', 'HEAD']).stdout.trim();
    const status = git(this.repoRoot, ['status', '--porcelain=v1']).stdout;
    const baseVerified = canonicalHead === job.baseCommit && workspaceHead === job.baseCommit;
    const canonicalDirty = Boolean(status.trim());
    const plan = {
      kind: 'sandbox_promotion_plan', jobId, baseCommit: job.baseCommit, canonicalHead, workspaceHead,
      baseVerified, promotable: baseVerified && !canonicalDirty, canonicalDirty, canonicalStatus: status,
      patch: diff.patch, patchHash: diff.patchHash, patchBytes: diff.patchBytes, nameStatus: diff.nameStatus,
      canonicalMutationPerformed: false,
    };
    plan.planHash = sha256(canonicalize(plan));
    return plan;
  }
  async destroy(jobId) {
    const job = this.job(jobId);
    await this.backend.destroy(job);
    job.status = 'destroyed'; job.manifest.status = 'destroyed'; job.manifest.destroyedAt = new Date().toISOString();
    const manifest = refreshManifest(job);
    removeDisposableWorktree(job);
    this.jobs.delete(jobId);
    return { destroyed: true, manifest };
  }
}
