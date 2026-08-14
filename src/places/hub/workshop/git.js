import { spawnSync } from 'node:child_process';
import { resolveRepositoryPath } from './path-law.js';

function fail(code, message) { throw Object.assign(new Error(message), { code }); }

const CRLF_NOISE = /^\s*warning:\s*LF will be replaced by CRLF.*$/i;
const CRLF_NOISE_ALT = /^\s*warning:\s*CRLF will be replaced by LF.*$/i;

export function sanitizeGitStderr(stderr) {
  if (typeof stderr !== 'string' || !stderr) return '';
  return stderr
    .split(/\r?\n/)
    .filter(line => line && !CRLF_NOISE.test(line) && !CRLF_NOISE_ALT.test(line))
    .join('\n');
}

function isBufferOverflow(error) {
  if (!error) return false;
  const message = error.message || '';
  return error.code === 'ENOBUFS'
    || error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
    || /ENOBUFS|maxBuffer/i.test(message);
}

function clipText(value, maxBytes) {
  const text = value || '';
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return { text, truncated: false };
  return { text: Buffer.from(text, 'utf8').subarray(0, maxBytes).toString('utf8'), truncated: true };
}

function runGit(root, args, { maxBytes = 120000 } = {}) {
  // Capture more than the resident-facing budget so overflow can truncate gracefully.
  const captureBytes = Math.max(maxBytes * 4, 512000);
  const result = spawnSync('git', ['-c', `safe.directory=${root.replaceAll('\\', '/')}`, ...args], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: captureBytes,
  });
  const overflow = isBufferOverflow(result.error);
  if (result.error && !overflow) fail('workshop_git_unavailable', result.error.message);
  const stdoutClip = clipText(result.stdout || '', maxBytes);
  const stderrClip = clipText(sanitizeGitStderr(result.stderr || ''), maxBytes);
  const truncated = stdoutClip.truncated || stderrClip.truncated || overflow;
  return {
    code: overflow && result.status == null ? 1 : result.status,
    signal: result.signal,
    stdout: stdoutClip.text,
    stderr: stderrClip.text,
    truncated,
    overflow,
  };
}

function diffNote({ path, truncated, overflow }) {
  if (!truncated && !overflow) return undefined;
  if (!path || path === '.') return 'Diff output too large; scope with a path or accept this truncated result.';
  return 'Diff output truncated; narrow the path further if you need a smaller slice.';
}

function untrackedDiff(root, paths, maxBytes) {
  if (!paths.length) return { stdout: '', truncated: false };
  const listing = runGit(root, ['ls-files', '-z', '--others', '--exclude-standard', '--', ...paths], { maxBytes });
  const pieces = [];
  let truncated = listing.truncated;
  const listedPaths = listing.stdout.split('\0').filter(Boolean);
  if (listing.truncated && !listing.stdout.endsWith('\0')) listedPaths.pop();
  for (const path of listedPaths) {
    const result = runGit(root, ['diff', '--no-index', '--', '/dev/null', path], { maxBytes });
    if (result.code !== 0 && result.code !== 1 && !result.overflow) fail('workshop_git_failed', result.stderr || 'git diff for an untracked path failed.');
    pieces.push(result.stdout);
    truncated ||= result.truncated;
  }
  const combined = clipText(pieces.filter(Boolean).join('\n'), maxBytes);
  return { stdout: combined.text, truncated: truncated || combined.truncated };
}

export class WorkshopGit {
  constructor(root, limits = {}) { this.root = root; this.maxBytes = limits.maxBytes || 120000; }
  status() {
    const result = runGit(this.root, ['status', '--porcelain=v1', '-b'], { maxBytes: this.maxBytes });
    return { kind: 'workshop_git_status', ok: result.code === 0, code: result.code, stdout: result.stdout, stderr: result.stderr, truncated: result.truncated, exact: true };
  }
  diff(path) {
    const args = ['diff', '--'];
    if (path) {
      resolveRepositoryPath(this.root, path);
      args.push(path);
    }
    const result = runGit(this.root, args, { maxBytes: this.maxBytes });
    const scopedPath = path || '.';
    const note = diffNote({ path: scopedPath, truncated: result.truncated, overflow: result.overflow });
    return {
      kind: 'workshop_git_diff',
      path: scopedPath,
      ok: result.code === 0 || result.overflow,
      code: result.code,
      stdout: result.stdout,
      stderr: result.stderr,
      truncated: result.truncated,
      exact: true,
      ...(note ? { note } : {}),
    };
  }
  log(maxCount = 20) {
    if (!Number.isInteger(maxCount) || maxCount < 1 || maxCount > 100) fail('workshop_limit', 'Git log max_count is outside the bounded limit.');
    const result = runGit(this.root, ['log', `-n${maxCount}`, '--pretty=format:%H%x09%an%x09%ad%x09%s', '--date=iso-strict'], { maxBytes: this.maxBytes });
    return { kind: 'workshop_git_log', maxCount, ok: result.code === 0, code: result.code, stdout: result.stdout, stderr: result.stderr, truncated: result.truncated, exact: true };
  }
  show(revision, path) {
    if (typeof revision !== 'string' || !revision || revision.length > 200 || revision.includes('..') || revision.startsWith('-')) fail('workshop_invalid_argument', 'Git revision is invalid.');
    const args = path ? ['show', `${revision}:${path}`] : ['show', '--stat', '--pretty=fuller', revision, '--'];
    if (path) resolveRepositoryPath(this.root, path);
    const result = runGit(this.root, args, { maxBytes: this.maxBytes });
    return { kind: 'workshop_git_show', revision, path: path || null, ok: result.code === 0, code: result.code, stdout: result.stdout, stderr: result.stderr, truncated: result.truncated, exact: true };
  }
  branchList() {
    const result = runGit(this.root, ['branch', '--list', '--format=%(refname:short)%09%(HEAD)'], { maxBytes: this.maxBytes });
    return { kind: 'workshop_git_branch_list', ok: result.code === 0, code: result.code, stdout: result.stdout, stderr: result.stderr, truncated: result.truncated, exact: true };
  }
  previewAdd({ paths = [], update = false } = {}) {
    if (!Array.isArray(paths) || paths.length > 40 || paths.some(item => typeof item !== 'string' || !item)) fail('workshop_invalid_argument', 'Git add paths are invalid.');
    for (const path of paths) resolveRepositoryPath(this.root, path);
    const status = this.status();
    return { kind: 'workshop_git_add_preview', paths, update: Boolean(update), statusPreview: status.stdout, exact: true };
  }
  add({ paths = [], update = false } = {}) {
    const preview = this.previewAdd({ paths, update });
    let args;
    if (update && !paths.length) args = ['add', '-u'];
    else if (paths.length) args = ['add', '--', ...paths];
    else fail('workshop_invalid_argument', 'Git add requires paths or update:true.');
    const result = runGit(this.root, args, { maxBytes: this.maxBytes });
    if (result.code !== 0) fail('workshop_git_failed', result.stderr || 'git add failed.');
    return { kind: 'workshop_git_add', paths, update: Boolean(update), ok: true, stdout: result.stdout, stderr: result.stderr, preview, exact: true };
  }
  previewCommit({ message, paths = [] }) {
    if (typeof message !== 'string' || !message.trim() || message.length > 2000) fail('workshop_invalid_argument', 'Commit message is invalid.');
    if (!Array.isArray(paths) || paths.length > 40 || paths.some(item => typeof item !== 'string' || !item)) fail('workshop_invalid_argument', 'Commit paths are invalid.');
    for (const path of paths) resolveRepositoryPath(this.root, path);
    const status = this.status();
    const staged = runGit(this.root, ['diff', '--cached', '--'], { maxBytes: this.maxBytes });
    const requested = paths.length
      ? runGit(this.root, ['diff', '--', ...paths], { maxBytes: this.maxBytes })
      : { stdout: '', stderr: '', truncated: false, overflow: false, code: 0 };
    const untracked = untrackedDiff(this.root, paths, this.maxBytes);
    const requestedCombined = clipText([requested.stdout, untracked.stdout].filter(Boolean).join('\n'), this.maxBytes);
    const sections = [];
    if (staged.stdout) sections.push(`Already staged (will be committed):\n${staged.stdout}`);
    if (requestedCombined.text) sections.push(`Requested paths (will be staged, then committed):\n${requestedCombined.text}`);
    const combined = clipText(sections.join('\n'), this.maxBytes);
    return {
      kind: 'workshop_git_commit_preview',
      message,
      paths,
      statusPreview: status.stdout,
      diffPreview: combined.text,
      stagedDiffPreview: staged.stdout,
      requestedPathDiffPreview: requestedCombined.text,
      truncated: status.truncated || staged.truncated || requested.truncated || untracked.truncated || requestedCombined.truncated || combined.truncated,
      exact: true,
    };
  }
  commit({ message, paths = [] }) {
    const preview = this.previewCommit({ message, paths });
    if (paths.length) {
      const add = runGit(this.root, ['add', '--', ...paths], { maxBytes: this.maxBytes });
      if (add.code !== 0) fail('workshop_git_failed', add.stderr || 'git add failed.');
    }
    const commit = runGit(this.root, ['commit', '-m', message], { maxBytes: this.maxBytes });
    if (commit.code !== 0) fail('workshop_git_failed', commit.stderr || commit.stdout || 'git commit failed.');
    return { kind: 'workshop_git_commit', message, paths, ok: true, stdout: commit.stdout, stderr: commit.stderr, preview, exact: true };
  }
  previewCheckout(branch) {
    if (typeof branch !== 'string' || !branch.trim() || branch.length > 200 || branch.startsWith('-')) fail('workshop_invalid_argument', 'Git branch is invalid.');
    const branches = this.branchList();
    const names = branches.stdout.split(/\r?\n/).map(line => line.split('\t')[0]).filter(Boolean);
    if (!names.includes(branch)) fail('workshop_git_branch_missing', 'That local branch does not exist.');
    return { kind: 'workshop_git_checkout_preview', branch, branches: names, exact: true };
  }
  checkout(branch) {
    const preview = this.previewCheckout(branch);
    const result = runGit(this.root, ['checkout', branch], { maxBytes: this.maxBytes });
    if (result.code !== 0) fail('workshop_git_failed', result.stderr || 'git checkout failed.');
    return { kind: 'workshop_git_checkout', branch, ok: true, stdout: result.stdout, stderr: result.stderr, preview, exact: true };
  }
}
