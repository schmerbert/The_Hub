import { buildRecipeInvocation } from './recipes.js';

// Executes adopted Workshop recipes through a Sandbox Bay backend.

function fail(code, message) { throw Object.assign(new Error(message), { code }); }

function assertSandboxBay(sandboxBay) {
  const required = ['create', 'exec', 'collect', 'diff', 'cancel', 'promotionPlan', 'destroy'];
  if (!sandboxBay || required.some(method => typeof sandboxBay[method] !== 'function')) {
    fail('sandbox_backend_invalid', 'SandboxRecipeRunner requires an injected SandboxBay.');
  }
}

function failedResult(recipeId, argv, jobId, error, cancelled = null) {
  return {
    kind: 'workshop_recipe',
    status: cancelled ? 'cancelled' : 'failed',
    recipe: recipeId,
    argv,
    ok: false,
    code: null,
    signal: null,
    cancelled,
    error: error?.message || String(error || 'Sandbox recipe failed.'),
    stdout: '',
    stderr: '',
    truncated: false,
    sandboxJobId: jobId,
  };
}

function mapExecution(recipeId, argv, jobId, execution, cancelled = null) {
  const timedOut = Boolean(execution.timedOut);
  const cancellation = cancelled || (timedOut ? 'cancelled_timeout' : null);
  const failed = Boolean(execution.spawnError) || execution.exitCode !== 0;
  return {
    kind: 'workshop_recipe',
    status: cancellation ? 'cancelled' : failed ? 'failed' : 'settled',
    recipe: recipeId,
    argv,
    ok: !cancellation && !failed,
    code: execution.exitCode,
    signal: execution.signal,
    cancelled: cancellation,
    ...(execution.spawnError ? { error: execution.spawnError } : {}),
    stdout: execution.stdout,
    stderr: execution.stderr,
    truncated: execution.stdoutExact === false || execution.stderrExact === false,
    sandboxJobId: jobId,
    executionHash: execution.executionHash,
    stdoutHash: execution.stdoutHash,
    stderrHash: execution.stderrHash,
    stdoutBytes: execution.stdoutBytes,
    stderrBytes: execution.stderrBytes,
    stdoutExact: execution.stdoutExact,
    stderrExact: execution.stderrExact,
  };
}

export class SandboxRecipeRunner {
  constructor(root, { sandboxBay, sandboxOptions = {}, timeoutMs } = {}) {
    assertSandboxBay(sandboxBay);
    this.root = root;
    this.sandboxBay = sandboxBay;
    this.sandboxOptions = { ...sandboxOptions };
    this.timeoutMs = timeoutMs;
    this.jobId = null;
    this.jobPromise = null;
    this.active = null;
    this.lastRecipe = null;
    this.lastResult = null;
    this.lastExecutionPromise = null;
    this.closed = false;
  }

  async #ensureJob() {
    if (this.jobId) return this.jobId;
    if (!this.jobPromise) {
      this.jobPromise = this.sandboxBay.create(this.sandboxOptions)
        .then(created => {
          if (!created?.jobId) fail('sandbox_job_unavailable', 'Sandbox Bay did not return a job identity.');
          this.jobId = created.jobId;
          return this.jobId;
        })
        .finally(() => { this.jobPromise = null; });
    }
    return this.jobPromise;
  }

  /** Creates the job lazily, then starts execution without awaiting its completion. */
  async start(recipeId, { path, script } = {}, { onComplete = null } = {}) {
    if (this.closed) fail('sandbox_recipe_closed', 'Sandbox recipe runner is closed.');
    if (this.active) fail('workshop_recipe_busy', 'A Workshop recipe is already running.');
    const invocation = buildRecipeInvocation(this.root, recipeId, { path, script }, { runtime: 'container' });
    const token = { recipeId, argv: invocation.argv, onComplete, cancelled: null, promise: null, state: 'provisioning' };
    this.active = token;
    this.lastRecipe = recipeId;
    this.lastResult = null;
    let jobId;
    try {
      jobId = await this.#ensureJob();
    } catch (error) {
      if (this.active === token) this.active = null;
      throw error;
    }
    if (this.closed) {
      if (this.active === token) this.active = null;
      fail('sandbox_recipe_closed', 'Sandbox recipe runner closed while provisioning.');
    }
    token.state = 'running';
    const request = { command: invocation.command, args: invocation.args, cwd: '.' };
    if (this.timeoutMs !== undefined) request.timeoutMs = this.timeoutMs;
    token.promise = this.sandboxBay.exec(jobId, request)
      .then(result => mapExecution(recipeId, invocation.argv, jobId, result.execution, token.cancelled))
      .catch(error => failedResult(recipeId, invocation.argv, jobId, error, token.cancelled))
      .then(result => {
        this.lastResult = result;
        if (!this.closed && typeof token.onComplete === 'function') {
          try { token.onComplete(result); } catch {}
        }
        return result;
      })
      .finally(() => {
        if (this.active === token) this.active = null;
      });
    this.lastExecutionPromise = token.promise;
    return {
      kind: 'workshop_recipe',
      status: 'started',
      recipe: recipeId,
      argv: invocation.argv,
      ok: true,
      sandboxJobId: jobId,
    };
  }

  async run(recipeId, options = {}) {
    await this.start(recipeId, options);
    return this.lastExecutionPromise;
  }

  status() {
    if (this.active) {
      return {
        kind: 'workshop_recipe_status',
        running: true,
        recipe: this.active.recipeId,
        argv: this.active.argv,
        lastResult: this.lastResult,
        sandboxJobId: this.jobId,
        state: this.active.state,
      };
    }
    return {
      kind: 'workshop_recipe_status',
      running: false,
      recipe: this.lastRecipe,
      argv: null,
      lastResult: this.lastResult,
      sandboxJobId: this.jobId,
      state: this.closed ? 'closed' : this.jobId ? 'ready' : 'not_created',
    };
  }

  async cancel(reason = 'cancelled_by_tool') {
    if (!this.active || !this.jobId) return { kind: 'workshop_recipe_cancel', cancelled: false, reason: 'not_running' };
    const token = this.active;
    token.cancelled = reason;
    const result = await this.sandboxBay.cancel(this.jobId);
    if (!result.cancelled) token.cancelled = null;
    if (!result.cancelled) return { kind: 'workshop_recipe_cancel', cancelled: false, reason: 'termination_failed', sandboxJobId: this.jobId };
    const settlement = await token.promise;
    return { kind: 'workshop_recipe_cancel', cancelled: true, reason, sandboxJobId: this.jobId, result: settlement };
  }

  async diff() {
    if (!this.jobId) fail('sandbox_job_not_found', 'Sandbox recipe job has not been created.');
    return this.sandboxBay.diff(this.jobId);
  }

  async promotionPlan() {
    if (!this.jobId) fail('sandbox_job_not_found', 'Sandbox recipe job has not been created.');
    return this.sandboxBay.promotionPlan(this.jobId);
  }

  async collect() {
    if (!this.jobId) fail('sandbox_job_not_found', 'Sandbox recipe job has not been created.');
    return this.sandboxBay.collect(this.jobId);
  }

  async close(reason = 'hub_close') {
    if (this.closed) return { kind: 'workshop_recipe_close', closed: true, cancelled: false, reason: 'already_closed' };
    this.closed = true;
    if (!this.jobId && this.jobPromise) await this.jobPromise.catch(() => {});
    if (!this.active || !this.jobId) return { kind: 'workshop_recipe_close', closed: true, cancelled: false, reason };
    const token = this.active;
    token.cancelled = reason;
    const result = await this.sandboxBay.cancel(this.jobId);
    return { kind: 'workshop_recipe_close', closed: true, cancelled: Boolean(result.cancelled), reason, sandboxJobId: this.jobId };
  }

  async destroy(reason = 'sandbox_destroyed') {
    const activePromise = this.active?.promise || null;
    if (!this.closed) await this.close(reason);
    if (!this.jobId && this.jobPromise) await this.jobPromise.catch(() => {});
    if (activePromise) await activePromise.catch(() => {});
    if (!this.jobId) return { destroyed: false, reason: 'not_created' };
    const jobId = this.jobId;
    const result = await this.sandboxBay.destroy(jobId);
    this.jobId = null;
    return { ...result, sandboxJobId: jobId };
  }

  async reset(reason = 'sandbox_reset') {
    const result = await this.destroy(reason);
    this.closed = false;
    this.active = null;
    this.jobPromise = null;
    this.lastExecutionPromise = null;
    return { ...result, reset: true };
  }
}
