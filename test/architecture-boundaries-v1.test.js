import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { extname, relative, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const SRC = resolve(ROOT, 'src');

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true }); const files = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(path));
    else if (['.js','.cjs'].includes(extname(entry.name))) files.push(path);
  }
  return files;
}

test('place modules remain inert and cannot reach Marble machinery', async () => {
  for (const path of await filesUnder(resolve(SRC, 'places'))) {
    const source = await readFile(path, 'utf8');
    assert.doesNotMatch(source, /from ['"].*(runtime|server|providers|ledger|spine|forest|result-rack)\//, relative(ROOT, path));
    assert.doesNotMatch(source, /\b(DatabaseSync|sqlite|fetch|process\.env|child_process)\b/, relative(ROOT, path));
  }
});

test('domain stores never import presentation, transport, or composition roots', async () => {
  for (const owner of ['ledger','forest','spine','result-rack']) for (const path of await filesUnder(resolve(SRC, owner))) {
    const source = await readFile(path, 'utf8');
    assert.doesNotMatch(source, /from ['"].*(server|corner|public)\//, relative(ROOT, path));
  }
});

test('large modules have explicit cohesion standing instead of silently growing', async () => {
  const standing = new Map([
    ['src/ledger/source.js', 'stable shared-transaction facade; trace, Roots, stream, and schema owners already extracted'],
    ['src/world/graph.js', 'universal World transaction and migration facade; place behavior is prohibited here'],
    ['src/world/events.js', 'closed deterministic reducer, replay, and forensic verifier for universal World law'],
    ['src/runtime/wake-service.js', 'wake choreography; provider crossing extracts only with the adopted return-trace contract'],
  ]);
  const unaccounted = [];
  for (const path of await filesUnder(SRC)) {
    const name = relative(ROOT, path).replaceAll('\\','/');
    const lines = (await readFile(path, 'utf8')).split(/\r?\n/).length;
    if (lines >= 500 && !standing.has(name)) unaccounted.push({ name, lines });
  }
  assert.deepEqual(unaccounted, []);
  assert.equal([...standing.values()].every(reason => reason.length >= 20), true);
});
