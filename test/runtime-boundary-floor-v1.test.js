import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { readConfig, resolveHubConfig } from '../src/core/config.js';
import { createHub } from '../src/server/app.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('configuration is immutable, resolves sibling stores once, and preserves explicit paths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hub-config-floor-'));
  try {
    const dbPath = join(root, 'custom.sqlite');
    const explicitSpine = join(root, 'exact', 'spine.jsonl');
    const config = resolveHubConfig({ HUB_RESIDENT_MODE: 'fake' }, { dbPath, spinePath: explicitSpine, activateForest: false });
    assert.equal(Object.isFrozen(config), true);
    assert.equal(config.dbPath, dbPath);
    assert.equal(config.spinePath, explicitSpine);
    assert.equal(config.worldPath, join(root, 'world.sqlite'));
    assert.equal(config.resultPath, join(root, 'results.sqlite'));
    assert.equal(config.forestActive, false);
    assert.throws(() => { config.port = 42; }, TypeError);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('every numeric runtime setting rejects malformed and out-of-range input', () => {
  const cases = [
    ['HUB_PORT', '-1'], ['HUB_PORT', '65536'], ['HUB_PORT', '1.5'],
    ['HUB_MESSAGE_CEILING', '0'], ['HUB_HEARTH_SCROLL_BUDGET', 'NaN'],
    ['HUB_HEARTH_EXCERPT_LIMIT', '-1'], ['HUB_MAX_MESSAGE_LENGTH', '0'],
    ['HUB_MAX_BODY_BYTES', '1.5'], ['HUB_MAX_TOOL_ROUNDS', '0'],
    ['HUB_WORKSHOP_MAX_FILES', '-1'], ['HUB_WORKSHOP_MAX_BYTES', 'nope'],
    ['HUB_WORKSHOP_MAX_LINES', '0'], ['HUB_WORKSHOP_MAX_RESULTS', '2.2'],
    ['HUB_RECIPE_TIMEOUT_MS', '0'], ['HUB_RESULT_PROJECTION_MAX_BYTES', '191'],
    ['HUB_RESULT_PROJECTION_MAX_LINES', '0'], ['HUB_RETAINED_TOOL_PAIRS', '-1'],
    ['HUB_PROVIDER_MAX_RETURN_BYTES', '0'],
    ['HUB_SQLITE_BUSY_TIMEOUT_MS', '0'], ['HUB_SQLITE_BUSY_TIMEOUT_MS', '60001'],
  ];
  for (const [name, value] of cases) {
    assert.throws(() => readConfig({ HUB_RESIDENT_MODE: 'fake', [name]: value }), new RegExp(name), `${name}=${value}`);
  }
  assert.equal(readConfig({ HUB_RESIDENT_MODE: 'fake', HUB_PORT: '0' }).port, 0);
  assert.equal(readConfig({ HUB_RESIDENT_MODE: 'fake', HUB_RETAINED_TOOL_PAIRS: '0' }).retainedToolPairs, 0);
  assert.equal(readConfig({ HUB_RESIDENT_MODE: 'fake' }).sqliteBusyTimeoutMs, 5000);
});

test('server transport does not reach through Forest or World sqlite internals', async () => {
  const source = await readFile(join(ROOT, 'src', 'server', 'app.js'), 'utf8');
  assert.doesNotMatch(source, /\b(?:forest|world)\.sqlite\b/);
  assert.match(source, /projectForestHealth/);
  assert.match(source, /projectWorldBuilderInspection/);
});

test('createHub exposes the same immutable resolved configuration', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hub-create-config-floor-'));
  const hub = createHub({ env: { HUB_RESIDENT_MODE: 'fake' }, dbPath: join(root, 'hub.sqlite') });
  try {
    assert.equal(Object.isFrozen(hub.config), true);
    assert.equal(hub.config.spinePath, join(root, 'spine.jsonl'));
    assert.equal(hub.config.worldPath, join(root, 'world.sqlite'));
    assert.equal(hub.config.resultPath, join(root, 'results.sqlite'));
  } finally {
    await hub.close();
    await rm(root, { recursive: true, force: true });
  }
});
