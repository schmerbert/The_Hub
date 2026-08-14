import { realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { canonicalize, sha256 } from './canonical.js';
import { assertWorkshopRepositoryPath } from './path-law.js';

function fail(code, message) { throw Object.assign(new Error(message), { code }); }

function git(root, args, input = undefined) {
  const result = spawnSync('git', ['-c', `safe.directory=${root.replaceAll('\\', '/')}`, ...args], {
    cwd: root,
    input,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) fail('sandbox_promotion_failed', result.error?.message || result.stderr || result.stdout || 'Sandbox promotion Git operation failed.');
  return result.stdout || '';
}

function verifyPlanHash(plan) {
  const basis = structuredClone(plan);
  delete basis.planHash;
  return sha256(canonicalize(basis)) === plan.planHash;
}

function decodeGitPath(raw, { fileHeader = false } = {}) {
  let value = raw;
  if (value.startsWith('"')) {
    const bytes = [];
    let index = 1;
    let closed = false;
    const escapes = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, '\\': 92 };
    while (index < value.length) {
      const character = value[index++];
      if (character === '"') { closed = true; break; }
      if (character !== '\\') { bytes.push(...Buffer.from(character, 'utf8')); continue; }
      if (index >= value.length) fail('sandbox_promotion_invalid', 'Promotion patch contains a malformed quoted path.');
      const escaped = value[index++];
      if (/[0-7]/.test(escaped)) {
        let octal = escaped;
        while (octal.length < 3 && index < value.length && /[0-7]/.test(value[index])) octal += value[index++];
        bytes.push(Number.parseInt(octal, 8));
      } else if (Object.hasOwn(escapes, escaped)) bytes.push(escapes[escaped]);
      else fail('sandbox_promotion_invalid', 'Promotion patch contains an unsupported quoted-path escape.');
    }
    if (!closed || (!fileHeader && value.slice(index).trim())) fail('sandbox_promotion_invalid', 'Promotion patch contains a malformed quoted path.');
    value = Buffer.from(bytes).toString('utf8');
    if (value.includes('\uFFFD')) fail('sandbox_promotion_invalid', 'Promotion patch path is not valid UTF-8.');
  } else if (fileHeader) value = value.split('\t', 1)[0];
  return value;
}

function validatePatchPath(raw, { fileHeader = false } = {}) {
  let path = decodeGitPath(raw, { fileHeader });
  if (path === '/dev/null') return;
  path = path.replace(/^[ab]\//, '');
  try { assertWorkshopRepositoryPath(path); }
  catch (error) {
    if (['workshop_path_forbidden', 'workshop_path_invalid'].includes(error?.code)) fail('sandbox_promotion_forbidden', `Promotion refuses protected path: ${path}`);
    throw error;
  }
}

function validateDiffGitHeader(payload) {
  const quoted = /^("(?:\\.|[^"\\])*") ("(?:\\.|[^"\\])*")$/.exec(payload);
  if (quoted) {
    validatePatchPath(quoted[1]);
    validatePatchPath(quoted[2]);
    return;
  }
  let found = false;
  for (let index = payload.indexOf(' b/'); index >= 0; index = payload.indexOf(' b/', index + 1)) {
    const oldPath = payload.slice(0, index);
    const newPath = payload.slice(index + 1);
    if (!oldPath.startsWith('a/') || !newPath.startsWith('b/')) continue;
    found = true;
    validatePatchPath(oldPath);
    validatePatchPath(newPath);
  }
  if (!found) fail('sandbox_promotion_invalid', 'Promotion patch contains a malformed diff path header.');
}

function assertSafePatch(root, patch) {
  if (typeof patch !== 'string') fail('sandbox_promotion_invalid', 'Promotion patch is missing.');
  if (/^(?:new file|deleted file|old|new) mode (?:120000|160000)$/m.test(patch)) fail('sandbox_promotion_forbidden', 'Promotion refuses symbolic-link and submodule entries.');
  for (const line of patch.split(/\r?\n/)) {
    if (line.startsWith('diff --git ')) validateDiffGitHeader(line.slice('diff --git '.length));
    else if (line.startsWith('--- ') || line.startsWith('+++ ')) validatePatchPath(line.slice(4), { fileHeader: true });
    else if (line.startsWith('rename from ')) validatePatchPath(line.slice('rename from '.length));
    else if (line.startsWith('rename to ')) validatePatchPath(line.slice('rename to '.length));
    else if (line.startsWith('copy from ')) validatePatchPath(line.slice('copy from '.length));
    else if (line.startsWith('copy to ')) validatePatchPath(line.slice('copy to '.length));
  }
  const numstat = git(root, ['apply', '--numstat', '-z', '--'], patch);
  for (const record of numstat.split('\0')) {
    if (!record) continue;
    const fields = record.split('\t');
    if (fields.length < 3) fail('sandbox_promotion_invalid', 'Promotion patch produced malformed path statistics.');
    validatePatchPath(fields.slice(2).join('\t'));
  }
}

/** Applies one hash-bound candidate to a clean canonical checkout. */
export function applySandboxPromotion(repoRoot, plan) {
  if (!plan || plan.kind !== 'sandbox_promotion_plan' || plan.promotable !== true || plan.baseVerified !== true || plan.canonicalDirty !== false) fail('sandbox_promotion_stale', 'Sandbox promotion plan is not promotable.');
  if (!verifyPlanHash(plan) || sha256(plan.patch) !== plan.patchHash) fail('sandbox_promotion_invalid', 'Sandbox promotion candidate hash does not match its approval plan.');
  const root = realpathSync(repoRoot);
  assertSafePatch(root, plan.patch);
  const head = git(root, ['rev-parse', 'HEAD']).trim();
  const statusBefore = git(root, ['status', '--porcelain=v1']);
  if (head !== plan.baseCommit || head !== plan.canonicalHead || statusBefore.trim()) fail('sandbox_promotion_stale', 'Canonical checkout changed after the promotion candidate was approved.');
  if (!plan.patch.length) return { kind: 'sandbox_promotion', promoted: false, reason: 'no_changes', jobId: plan.jobId, baseCommit: head, patchHash: plan.patchHash, planHash: plan.planHash };
  git(root, ['apply', '--check', '--whitespace=nowarn', '--'], plan.patch);
  git(root, ['apply', '--whitespace=nowarn', '--'], plan.patch);
  const statusAfter = git(root, ['status', '--porcelain=v1']);
  if (!statusAfter.trim()) fail('sandbox_promotion_failed', 'Promotion applied no observable canonical change.');
  return {
    kind: 'sandbox_promotion',
    promoted: true,
    jobId: plan.jobId,
    baseCommit: head,
    patchHash: plan.patchHash,
    planHash: plan.planHash,
    canonicalStatus: statusAfter,
  };
}
