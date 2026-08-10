import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveRepositoryPath } from './graph.js';

function fail(code, message) { throw Object.assign(new Error(message), { code }); }

const BASE_RECIPES = Object.freeze({
  npm_test: { id: 'npm_test', command: 'npm', args: ['test'], allowPath: false, allowScript: false, shell: process.platform === 'win32' },
  node_test: { id: 'node_test', command: process.execPath, args: ['--test'], allowPath: true, allowScript: false, shell: false },
  npm_run: { id: 'npm_run', command: 'npm', args: ['run'], allowPath: false, allowScript: true, shell: process.platform === 'win32' },
  node_file: { id: 'node_file', command: process.execPath, args: [], allowPath: true, allowScript: false, requirePath: true, shell: false },
});

const RECIPE_ENVIRONMENT_KEYS = new Set([
  'PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP',
  'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ', 'TERM', 'COLORTERM',
  'NO_COLOR', 'FORCE_COLOR', 'CI',
]);
const WINDOWS_RECIPE_ENVIRONMENT_KEYS = new Set([
  ...RECIPE_ENVIRONMENT_KEYS,
  'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT',
  'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH',
  'APPDATA', 'LOCALAPPDATA', 'PROGRAMDATA',
  'PROGRAMFILES', 'PROGRAMFILES(X86)',
  'COMMONPROGRAMFILES', 'COMMONPROGRAMFILES(X86)',
  'OS', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE',
]);

export function buildRecipeEnvironment(source = process.env, platform = process.platform) {
  const allowed = platform === 'win32' ? WINDOWS_RECIPE_ENVIRONMENT_KEYS : RECIPE_ENVIRONMENT_KEYS;
  const result = {};
  for (const [key, value] of Object.entries(source || {})) {
    const candidate = platform === 'win32' ? key.toUpperCase() : key;
    if (allowed.has(candidate) && typeof value === 'string') result[key] = value;
  }
  return result;
}

function terminateProcessTree(child) {
  if (!child || !Number.isInteger(child.pid)) return false;
  if (process.platform === 'win32') {
    const systemRoot = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows';
    const taskkill = join(systemRoot, 'System32', 'taskkill.exe');
    const killed = spawnSync(taskkill, ['/pid', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
      timeout: 5000,
    });
    if (!killed.error && killed.status === 0) return true;
    try { return child.kill(); } catch { return false; }
  }
  try {
    process.kill(-child.pid, 'SIGTERM');
    return true;
  } catch {
    try { return child.kill(); } catch { return false; }
  }
}

export function listRecipes() {
  return Object.values(BASE_RECIPES).map(recipe => ({
    id: recipe.id,
    allowPath: Boolean(recipe.allowPath),
    allowScript: Boolean(recipe.allowScript),
    requirePath: Boolean(recipe.requirePath),
  }));
}

function packageScripts(root) {
  try {
    const raw = readFileSync(join(root, 'package.json'), 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.scripts !== 'object' || !parsed.scripts) return {};
    return parsed.scripts;
  } catch {
    return {};
  }
}

export class RecipeRunner {
  constructor(root, { timeoutMs = 120000, maxOutputBytes = 120000, env = process.env } = {}) {
    this.root = root;
    this.timeoutMs = timeoutMs;
    this.maxOutputBytes = maxOutputBytes;
    this.env = buildRecipeEnvironment(env);
    this.active = null;
    this.lastRecipe = null;
    this.lastResult = null;
  }
  #buildArgs(recipeId, { path, script } = {}) {
    const recipe = BASE_RECIPES[recipeId];
    if (!recipe) fail('workshop_recipe_unknown', 'That Workshop recipe is not installed.');
    const args = [...recipe.args];
    if (recipe.allowScript) {
      if (typeof script !== 'string' || !script || script.length > 80 || !/^[A-Za-z0-9:_-]+$/.test(script)) fail('workshop_invalid_argument', 'Recipe script name is invalid.');
      const scripts = packageScripts(this.root);
      if (!Object.hasOwn(scripts, script)) fail('workshop_recipe_script_missing', 'That npm script is not listed in package.json.');
      args.push(script);
    }
    if (path !== undefined || recipe.requirePath) {
      if (recipe.requirePath && (typeof path !== 'string' || !path)) fail('workshop_invalid_argument', 'That recipe requires a path.');
      if (path !== undefined) {
        if (!recipe.allowPath) fail('workshop_invalid_argument', 'That recipe does not accept a path.');
        resolveRepositoryPath(this.root, path);
        if (recipeId === 'node_file' && !path.endsWith('.js')) fail('workshop_invalid_argument', 'node_file requires a .js path.');
        args.push(path);
      }
    }
    return { recipe, args };
  }
  /** Non-blocking start; completion invokes onComplete with the final recipe result. */
  start(recipeId, { path, script } = {}, { onComplete = null } = {}) {
    if (this.active) fail('workshop_recipe_busy', 'A Workshop recipe is already running.');
    const { recipe, args } = this.#buildArgs(recipeId, { path, script });
    this.lastRecipe = recipeId;
    this.lastResult = null;
    const command = recipe.command;
    const child = spawn(command, args, {
      cwd: this.root,
      env: this.env,
      windowsHide: true,
      shell: recipe.shell,
      detached: process.platform !== 'win32',
    });
    const job = { child, cancelled: null, recipeId, argv: [command, ...args], onComplete };
    this.active = job;
    let stdout = Buffer.alloc(0); let stderr = Buffer.alloc(0); let truncated = false;
    const append = (current, chunk) => {
      if (current.length >= this.maxOutputBytes) { truncated = true; return current; }
      const next = Buffer.concat([current, chunk]);
      if (next.length > this.maxOutputBytes) { truncated = true; return next.subarray(0, this.maxOutputBytes); }
      return next;
    };
    child.stdout.on('data', chunk => { stdout = append(stdout, chunk); });
    child.stderr.on('data', chunk => { stderr = append(stderr, chunk); });
    const timer = setTimeout(() => {
      if (terminateProcessTree(child)) job.cancelled = 'cancelled_timeout';
    }, this.timeoutMs);
    const finish = (result) => {
      clearTimeout(timer);
      if (this.active === job) this.active = null;
      this.lastResult = result;
      if (typeof job.onComplete === 'function') {
        try { job.onComplete(result); } catch {}
      }
    };
    child.on('error', error => {
      finish({
        kind: 'workshop_recipe', status: 'failed', recipe: recipeId, argv: [command, ...args],
        ok: false, code: null, signal: null, cancelled: job.cancelled, error: error.message,
        stdout: stdout.toString('utf8'), stderr: stderr.toString('utf8'), truncated,
      });
    });
    child.on('close', (code, signal) => {
      const cancelled = job.cancelled;
      finish({
        kind: 'workshop_recipe',
        status: cancelled ? 'cancelled' : (code === 0 ? 'settled' : 'failed'),
        recipe: recipeId,
        argv: [command, ...args],
        ok: !cancelled && code === 0,
        code,
        signal,
        cancelled,
        stdout: stdout.toString('utf8'),
        stderr: stderr.toString('utf8'),
        truncated,
      });
    });
    return {
      kind: 'workshop_recipe',
      status: 'started',
      recipe: recipeId,
      argv: [command, ...args],
      ok: true,
    };
  }
  /** @deprecated Prefer start() for heartbeat; still awaits completion for callers that need it. */
  async run(recipeId, { path, script } = {}) {
    return new Promise((resolve, reject) => {
      try {
        this.start(recipeId, { path, script }, {
          onComplete: (result) => resolve(result),
        });
      } catch (error) {
        reject(error);
      }
    });
  }
  status() {
    if (this.active) {
      return {
        kind: 'workshop_recipe_status',
        running: true,
        recipe: this.active.recipeId,
        argv: this.active.argv,
        lastResult: this.lastResult,
      };
    }
    return {
      kind: 'workshop_recipe_status',
      running: false,
      recipe: this.lastRecipe,
      argv: null,
      lastResult: this.lastResult,
    };
  }
  cancel(reason = 'cancelled_by_tool') {
    if (!this.active) return { kind: 'workshop_recipe_cancel', cancelled: false, reason: 'not_running' };
    const job = this.active;
    const requested = terminateProcessTree(job.child);
    if (requested) job.cancelled = reason;
    return { kind: 'workshop_recipe_cancel', cancelled: requested, reason: requested ? reason : 'termination_failed' };
  }
}
