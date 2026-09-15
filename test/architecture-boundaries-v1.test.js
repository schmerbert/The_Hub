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

test('place declarations remain inert and cannot reach Marble machinery', async () => {
  for (const path of await filesUnder(resolve(SRC, 'places'))) {
    const source = await readFile(path, 'utf8');
    if (!/\bplaceModule\b/.test(source)) continue;
    assert.doesNotMatch(source, /from ['"].*(runtime|server|providers|ledger|spine|forest|result-rack)\//, relative(ROOT, path));
    assert.doesNotMatch(source, /\b(DatabaseSync|sqlite|fetch|process\.env|child_process)\b/, relative(ROOT, path));
  }
});

test('room.workshop owns its machinery without reaching into Marble-wide systems', async () => {
  const room = resolve(SRC, 'places', 'hub', 'workshop');
  for (const path of await filesUnder(room)) {
    const source = await readFile(path, 'utf8');
    assert.doesNotMatch(
      source,
      /from ['"].*(runtime|server|providers|ledger|spine|forest|result-rack|context|world)\//,
      relative(ROOT, path),
    );
    for (const [, specifier] of source.matchAll(/^\s*import[^\n]*from ['"]([^'"]+)['"]/gm)) {
      assert.equal(
        specifier.startsWith('node:') || specifier.startsWith('./') || (path.endsWith('declaration.js') && specifier === '../../declaration.js'),
        true,
        `${relative(ROOT, path)} reaches outside the carryable room package through ${specifier}`,
      );
    }
  }
  for (const obsolete of ['workshop.js','git.js','recipes.js','sandbox.js','sandbox-recipes.js','promotion.js']) {
    const source = await readFile(resolve(SRC, 'world', obsolete), 'utf8');
    assert.match(source, /Compatibility import/);
    assert.ok(source.split(/\r?\n/).length <= 4, `${obsolete} must remain a thin compatibility door`);
  }
});

test('room installation manifest contracts remain inert and cannot discover or activate packages', async () => {
  for (const path of await filesUnder(resolve(SRC, 'rooms'))) {
    if (!path.endsWith('installation-contract.js')) continue;
    const source = await readFile(path, 'utf8');
    assert.doesNotMatch(source, /from ['"](?:node:)?(fs|url|module|child_process)|\b(import\(|require\(|fetch\(|process\.)/, relative(ROOT, path));
    assert.doesNotMatch(source, /from ['"].*(runtime|server|providers|ledger|spine|forest|result-rack|context|world|places)\//, relative(ROOT, path));
  }
});

test('domain stores never import presentation, transport, or composition roots', async () => {
  for (const owner of ['ledger','forest','spine','integrity','result-rack']) for (const path of await filesUnder(resolve(SRC, owner))) {
    const source = await readFile(path, 'utf8');
    assert.doesNotMatch(source, /from ['"].*(server|corner|public)\//, relative(ROOT, path));
  }
});

test('large modules have explicit cohesion standing instead of silently growing', async () => {
  const standing = new Map([
    ['src/ledger/source.js', 'stable shared-transaction facade; trace, Roots, stream, and schema owners already extracted'],
    ['src/world/graph.js', 'stable World operations facade; versioned migration and event mechanics are extracted behind unchanged methods'],
    ['src/world/event-reducer.js', 'one closed deterministic reducer for universal World law; splitting its event cases would obscure replay order'],
    ['src/runtime/wake-service.js', 'wake choreography; provider crossing extracts only with the adopted return-trace contract'],
    ['src/forest/store.js', 'exact Forest custody facade; Home chronology access remains joined to entry integrity and append-only edge ownership'],
    ['src/spine/verified-index.js', 'one closed Spine checkpoint proof covering frame validation, lifecycle reconstruction, compact indexing, and suffix continuation'],
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
