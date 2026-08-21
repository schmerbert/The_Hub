import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkshopAdapter } from '../src/places/hub/workshop/index.js';
import { schemasForTools, WORKSHOP_TOOLS } from '../src/world/tools.js';

async function fixture(prefix = 'hub-workshop-ergonomics-') {
  const root = await mkdtemp(join(tmpdir(), prefix));
  return { root, close: () => rm(root, { recursive: true, force: true }) };
}

test('search streams ordinary large scopes and returns an honest file boundary', async () => {
  const f = await fixture();
  try {
    for (let index = 0; index < 25; index += 1) await writeFile(join(f.root, `file-${String(index).padStart(2, '0')}.txt`), `needle ${index}\n`, 'utf8');
    await mkdir(join(f.root, 'node_modules', 'dep'), { recursive: true });
    await writeFile(join(f.root, 'node_modules', 'dep', 'hidden.txt'), 'needle hidden\n', 'utf8');
    const result = new WorkshopAdapter(f.root, { maxFiles: 5, maxResults: 20 }).search('needle');
    assert.equal(result.filesExamined, 5);
    assert.equal(result.matches.length, 5);
    assert.equal(result.truncated, true);
    assert.equal(result.complete, false);
    assert.equal(result.boundary.kind, 'max_files');
    assert.equal(result.boundary.limit, 5);
    assert.ok(result.continuation.action.includes('Narrow path'));
    assert.equal(result.exact, true);
  } finally { await f.close(); }
});

test('search and glob skip practical dependency/build/cache directories without losing exact matches', async () => {
  const f = await fixture();
  try {
    for (const directory of ['node_modules', 'build', 'dist', 'coverage', '.cache', 'cache', '.next', 'out', 'target']) {
      await mkdir(join(f.root, directory), { recursive: true });
      await writeFile(join(f.root, directory, 'hidden.js'), 'needle hidden\n', 'utf8');
    }
    await writeFile(join(f.root, 'visible.js'), 'needle visible\n', 'utf8');
    const workshop = new WorkshopAdapter(f.root, { maxFiles: 3, maxResults: 20 });
    const search = workshop.search('needle');
    const glob = workshop.glob('**/*.js');
    assert.deepEqual(search.matches.map(match => match.path), ['visible.js']);
    assert.deepEqual(glob.matches, ['visible.js']);
    assert.equal(search.truncated, false);
    assert.equal(glob.truncated, false);
    assert.ok(search.directoriesSkipped >= 9);
    assert.ok(glob.directoriesSkipped >= 9);
  } finally { await f.close(); }
});

test('search and glob disclose result-bound truncation separately from file bounds', async () => {
  const f = await fixture();
  try {
    for (let index = 0; index < 5; index += 1) await writeFile(join(f.root, `${index}.js`), 'needle\n', 'utf8');
    const workshop = new WorkshopAdapter(f.root, { maxFiles: 20, maxResults: 10 });
    const search = workshop.search('needle', '.', 2);
    const glob = workshop.glob('*.js', '.', 2);
    assert.equal(search.matches.length, 2);
    assert.equal(search.boundary.kind, 'max_results');
    assert.equal(search.boundary.limit, 2);
    assert.equal(glob.matches.length, 2);
    assert.equal(glob.boundary.kind, 'max_results');
    assert.equal(glob.boundary.limit, 2);
  } finally { await f.close(); }
});

test('bounded reads expose continuation facts and teach the configured maximum on refusal', async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.root, 'long.txt'), 'one\ntwo\nthree\nfour\n', 'utf8');
    const workshop = new WorkshopAdapter(f.root, { maxLines: 2 });
    const first = workshop.read('long.txt', 1, 2);
    assert.equal(first.totalLines, 4);
    assert.equal(first.nextStartLine, 3);
    assert.equal(first.hasMore, true);
    const last = workshop.read('long.txt', 3, 2);
    assert.equal(last.nextStartLine, null);
    assert.equal(last.hasMore, false);
    assert.throws(() => workshop.read('long.txt', 1, 3), error => error.code === 'workshop_limit' && /maximum of 2/.test(error.message) && /no file content was evaluated/i.test(error.message));
  } finally { await f.close(); }
});

test('overview is bounded root-relative orientation and manifest metadata, not a content summary', async () => {
  const f = await fixture();
  try {
    await mkdir(join(f.root, 'docs'), { recursive: true });
    await mkdir(join(f.root, 'src'), { recursive: true });
    await writeFile(join(f.root, 'AGENTS.md'), 'orientation\n', 'utf8');
    await writeFile(join(f.root, 'docs', 'ORIENTATION.md'), 'orientation\n', 'utf8');
    await writeFile(join(f.root, 'package.json'), '{"name":"fixture"}\n', 'utf8');
    await writeFile(join(f.root, 'src', 'main.js'), 'export const ok = true;\n', 'utf8');
    const overview = new WorkshopAdapter(f.root).overview();
    assert.equal(overview.kind, 'workshop_overview');
    assert.equal(overview.root, '.');
    assert.ok(overview.topLevel.some(entry => entry.path === 'src' && entry.type === 'directory'));
    assert.deepEqual(overview.orientation, ['AGENTS.md', 'docs/ORIENTATION.md']);
    assert.deepEqual(overview.manifests, ['package.json']);
    assert.ok(overview.languages.includes('JavaScript'));
    assert.ok(overview.limits.maxLines);
    assert.ok(overview.exclusions.includes('node_modules'));
    assert.equal(overview.worktree.rootRelative, '.');
    assert.equal(overview.worktree.gitStatus, 'not_read');
    assert.equal(JSON.stringify(overview).includes('orientation\n'), false);
  } finally { await f.close(); }
});

test('workshop read schema advertises the bounded default and continuation arguments remain optional', () => {
  const schema = WORKSHOP_TOOLS.find(tool => tool.function.name === 'workshop_read').function;
  assert.equal(schema.parameters.properties.line_count.maximum, 160);
  assert.equal(schema.parameters.properties.start_line.minimum, 1);
  assert.match(schema.description, /maximum/i);
  const configured = schemasForTools(['workshop_read', 'workshop_search'], { workshopMaxLines: 23, workshopMaxResults: 7 });
  assert.equal(configured[0].function.parameters.properties.line_count.maximum, 23);
  assert.equal(configured[1].function.parameters.properties.max_results.maximum, 7);
});
