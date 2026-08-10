import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sanitizeGitStderr, WorkshopGit } from '../src/world/git.js';
import { WorkshopAdapter } from '../src/world/workshop.js';

function git(root, args) {
  const result = spawnSync('git', ['-c', `safe.directory=${root.replaceAll('\\', '/')}`, ...args], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `git ${args.join(' ')} failed`);
}

test('sanitizeGitStderr strips LF/CRLF conversion warnings', () => {
  const cleaned = sanitizeGitStderr([
    'warning: LF will be replaced by CRLF the next time Git touches it',
    'warning: CRLF will be replaced by LF the next time Git touches it',
    'real problem on the ledger',
  ].join('\n'));
  assert.equal(cleaned, 'real problem on the ledger');
});

test('workshop_git_diff truncates oversized output with a path note instead of ENOBUFS', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-git-diff-'));
  try {
    git(dir, ['init']);
    git(dir, ['config', 'user.email', 'hub@example.com']);
    git(dir, ['config', 'user.name', 'Hub']);
    await mkdir(join(dir, 'src'), { recursive: true });
    const chunk = `${'x'.repeat(4000)}\n`;
    for (let index = 0; index < 40; index += 1) {
      await writeFile(join(dir, 'src', `file-${index}.txt`), chunk.repeat(5), 'utf8');
    }
    git(dir, ['add', '.']);
    git(dir, ['commit', '-m', 'seed']);
    for (let index = 0; index < 40; index += 1) {
      await writeFile(join(dir, 'src', `file-${index}.txt`), `${chunk.repeat(8)}changed-${index}\n`, 'utf8');
    }
    const gitAdapter = new WorkshopGit(dir, { maxBytes: 8000 });
    const result = gitAdapter.diff();
    assert.equal(result.kind, 'workshop_git_diff');
    assert.equal(result.truncated, true);
    assert.match(result.note, /scope with a path|truncated/i);
    assert.equal(JSON.stringify(result).includes('ENOBUFS'), false);
    assert.ok(Buffer.byteLength(result.stdout, 'utf8') <= 8000);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

test('workshop_tree defaults to 120 entries and still discloses truncation', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-tree-breath-'));
  try {
    for (let index = 0; index < 150; index += 1) {
      await writeFile(join(dir, `n${String(index).padStart(3, '0')}.txt`), 'x\n', 'utf8');
    }
    const workshop = new WorkshopAdapter(dir);
    assert.equal(workshop.limits.defaultTreeEntries, 120);
    assert.equal(workshop.limits.maxTreeEntries, 400);
    const result = workshop.tree('.', 1);
    assert.equal(result.maxEntries, 120);
    assert.equal(result.truncated, true);
    assert.equal(result.entries.length, 120);
    assert.match(result.note, /Tree truncated/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('workshop_git_show rejects revision-shaped Git options before execution', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-git-show-'));
  try {
    git(dir, ['init']);
    git(dir, ['config', 'user.email', 'hub@example.com']);
    git(dir, ['config', 'user.name', 'Hub']);
    await writeFile(join(dir, 'seed.txt'), 'seed\n', 'utf8');
    git(dir, ['add', 'seed.txt']);
    git(dir, ['commit', '-m', 'seed']);
    const adapter = new WorkshopGit(dir);
    for (const revision of ['--output=hostile-output.txt', '--help', '-p']) {
      assert.throws(() => adapter.show(revision), error => error.code === 'workshop_invalid_argument');
    }
    await assert.rejects(access(join(dir, 'hostile-output.txt')), error => error.code === 'ENOENT');
    assert.equal(adapter.show('HEAD').ok, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('commit preview discloses unrelated staged changes and requested paths that will land', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-git-preview-'));
  try {
    git(dir, ['init']);
    git(dir, ['config', 'user.email', 'hub@example.com']);
    git(dir, ['config', 'user.name', 'Hub']);
    await writeFile(join(dir, 'requested.txt'), 'requested v1\n', 'utf8');
    await writeFile(join(dir, 'already-staged.txt'), 'staged v1\n', 'utf8');
    git(dir, ['add', '.']);
    git(dir, ['commit', '-m', 'seed']);
    await writeFile(join(dir, 'requested.txt'), 'requested v2\n', 'utf8');
    await writeFile(join(dir, 'already-staged.txt'), 'staged v2\n', 'utf8');
    await writeFile(join(dir, 'new-requested.txt'), 'new requested content\n', 'utf8');
    git(dir, ['add', 'already-staged.txt']);

    const preview = new WorkshopGit(dir).previewCommit({ message: 'land all', paths: ['requested.txt', 'new-requested.txt'] });
    assert.match(preview.stagedDiffPreview, /already-staged\.txt/);
    assert.match(preview.stagedDiffPreview, /staged v2/);
    assert.match(preview.requestedPathDiffPreview, /requested\.txt/);
    assert.match(preview.requestedPathDiffPreview, /requested v2/);
    assert.match(preview.requestedPathDiffPreview, /new-requested\.txt/);
    assert.match(preview.requestedPathDiffPreview, /new requested content/);
    assert.match(preview.diffPreview, /Already staged \(will be committed\):/);
    assert.match(preview.diffPreview, /Requested paths \(will be staged, then committed\):/);
    assert.match(preview.diffPreview, /already-staged\.txt/);
    assert.match(preview.diffPreview, /requested\.txt/);
    assert.match(preview.diffPreview, /new-requested\.txt/);
    assert.equal(preview.truncated, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
