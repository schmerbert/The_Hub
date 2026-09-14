import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const VALID_MODES = new Set(['live', 'fake']);
const VALID_SANDBOX_BACKENDS = new Set(['docker', 'host-test']);

function integer(env, name, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = env[name];
  const value = Number(raw === undefined || raw === '' ? fallback : raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    const range = max === Number.MAX_SAFE_INTEGER ? `an integer of at least ${min}` : `an integer from ${min} to ${max}`;
    throw new Error(`${name} must be ${range}`);
  }
  return value;
}

function immutable(value) { return Object.freeze(value); }

export function readConfig(env = process.env) {
  const mode = env.HUB_RESIDENT_MODE || 'live';
  if (!VALID_MODES.has(mode)) throw new Error('HUB_RESIDENT_MODE must be live or fake');
  const runtimeRoot = env.HUB_RUNTIME_ROOT || join(process.cwd(), '.runtime');
  const expectedSandboxBackend = mode === 'live' ? 'docker' : 'host-test';
  const sandboxBackend = env.HUB_SANDBOX_BACKEND || expectedSandboxBackend;
  if (!VALID_SANDBOX_BACKENDS.has(sandboxBackend)) throw new Error('HUB_SANDBOX_BACKEND must be docker or host-test');
  if (sandboxBackend !== expectedSandboxBackend) throw new Error(`HUB_SANDBOX_BACKEND must be ${expectedSandboxBackend} in ${mode} mode`);
  const resultProjectionMaxBytes = integer(env, 'HUB_RESULT_PROJECTION_MAX_BYTES', 12000, { min: 192 });
  const resultProjectionMaxLines = integer(env, 'HUB_RESULT_PROJECTION_MAX_LINES', 120, { min: 1 });
  const attentionWarnBytes = integer(env, 'HUB_ATTENTION_WARN_BYTES', 80000);
  const attentionRefuseBytes = integer(env, 'HUB_ATTENTION_REFUSE_BYTES', 120000, { min: 1 });
  const retainedToolPairs = integer(env, 'HUB_RETAINED_TOOL_PAIRS', 2);
  const providerMaxReturnBytes = integer(env, 'HUB_PROVIDER_MAX_RETURN_BYTES', 8 * 1024 * 1024, { min: 1 });
  const hearthWakeIntervalSeconds = integer(env, 'HUB_HEARTH_WAKE_INTERVAL_SECONDS', 0, { min: 0, max: 604800 });
  if (attentionRefuseBytes <= attentionWarnBytes) throw new Error('Attention thresholds require 0 <= HUB_ATTENTION_WARN_BYTES < HUB_ATTENTION_REFUSE_BYTES');
  if (hearthWakeIntervalSeconds !== 0 && hearthWakeIntervalSeconds < 60) throw new Error('HUB_HEARTH_WAKE_INTERVAL_SECONDS must be 0 or an integer from 60 to 604800');
  return immutable({
    mode,
    baseUrl: (env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, ''),
    model: env.DEEPSEEK_MODEL || 'deepseek-v4-flash',
    thinking: env.DEEPSEEK_THINKING || 'disabled',
    fakeOrientationVariant: env.HUB_FAKE_ORIENTATION_VARIANT || 'valid',
    apiKey: env.DEEPSEEK_API_KEY || '',
    runtimeRoot,
    dbPath: env.HUB_DB_PATH || join(runtimeRoot, 'hub.sqlite'),
    forestPath: env.HUB_FOREST_PATH || join(runtimeRoot, 'forest.sqlite'),
    semanticIndexPath: env.HUB_SEMANTIC_INDEX_PATH || join(runtimeRoot, 'forest-semantic.sqlite'),
    forestTraversalPath: env.HUB_FOREST_TRAVERSAL_PATH || join(runtimeRoot, 'forest-paths.sqlite'),
    embeddingModel: env.HUB_EMBEDDING_MODEL || 'Xenova/bge-small-en-v1.5',
    embeddingCachePath: env.HUB_EMBEDDING_CACHE_PATH || join(runtimeRoot, 'models'),
    spinePath: env.HUB_SPINE_PATH || join(runtimeRoot, 'spine', 'resident-seat-1.jsonl'),
    worldPath: env.HUB_WORLD_PATH || join(runtimeRoot, 'world.sqlite'),
    resultPath: env.HUB_RESULT_PATH || join(runtimeRoot, 'results.sqlite'),
    binderWindowSnapshotPath: env.HUB_BINDER_WINDOW_SNAPSHOT_PATH || join(runtimeRoot, 'binder-window.json'),
    spotlightEnabled: env.HUB_SPOTLIGHT_ENABLED === 'true',
    spotlightAuthPath: env.HUB_SPOTLIGHT_AUTH_PATH || join(runtimeRoot, 'spotlight', 'robinhood-auth.dpapi'),
    spotlightObservationPath: env.HUB_SPOTLIGHT_OBSERVATION_PATH || join(runtimeRoot, 'spotlight', 'observations.sqlite'),
    workshopRoot: env.HUB_WORKSHOP_ROOT || process.cwd(),
    forestActive: env.HUB_FOREST_ACTIVE === 'true',
    progressiveStartup: false,
    port: integer(env, 'HUB_PORT', 3000, { min: 0, max: 65535 }),
    messageCeiling: integer(env, 'HUB_MESSAGE_CEILING', 20, { min: 1 }),
    hearthScrollBudget: integer(env, 'HUB_HEARTH_SCROLL_BUDGET', 12000, { min: 1 }),
    hearthExcerptLimit: integer(env, 'HUB_HEARTH_EXCERPT_LIMIT', 600, { min: 1 }),
    maxMessageLength: integer(env, 'HUB_MAX_MESSAGE_LENGTH', 4000, { min: 1 }),
    maxBodyBytes: integer(env, 'HUB_MAX_BODY_BYTES', 10000, { min: 1 }),
    maxToolRounds: integer(env, 'HUB_MAX_TOOL_ROUNDS', 8, { min: 1 }),
    autonomousMaxToolRounds: integer(env, 'HUB_AUTONOMOUS_MAX_TOOL_ROUNDS', 24, { min: 1, max: 64 }),
    hearthWakeIntervalSeconds,
    workshopMaxFiles: integer(env, 'HUB_WORKSHOP_MAX_FILES', 100, { min: 1 }),
    workshopMaxBytes: integer(env, 'HUB_WORKSHOP_MAX_BYTES', 120000, { min: 1 }),
    workshopMaxLines: integer(env, 'HUB_WORKSHOP_MAX_LINES', 160, { min: 1 }),
    workshopMaxResults: integer(env, 'HUB_WORKSHOP_MAX_RESULTS', 50, { min: 1 }),
    approvalMode: mode === 'fake' && env.HUB_APPROVAL_MODE === 'auto' ? 'auto' : 'confirm',
    recipeTimeoutMs: integer(env, 'HUB_RECIPE_TIMEOUT_MS', 120000, { min: 1 }),
    resultProjectionMaxBytes,
    resultProjectionMaxLines,
    documentProjectionMaxBytes: integer(env, 'HUB_DOCUMENT_PROJECTION_MAX_BYTES', 65536, { min: resultProjectionMaxBytes }),
    documentProjectionMaxLines: integer(env, 'HUB_DOCUMENT_PROJECTION_MAX_LINES', 2000, { min: resultProjectionMaxLines }),
    attentionWarnBytes,
    attentionRefuseBytes,
    retainedToolPairs,
    providerMaxReturnBytes,
    sqliteBusyTimeoutMs: integer(env, 'HUB_SQLITE_BUSY_TIMEOUT_MS', 5000, { min: 1, max: 60000 }),
    sandboxBackend,
    sandboxImage: env.HUB_SANDBOX_IMAGE || 'node:22-alpine',
    sandboxJobsRoot: env.HUB_SANDBOX_JOBS_ROOT || join(tmpdir(), 'hub-sandbox-bay'),
  });
}

export function resolveHubConfig(env = process.env, overrides = {}) {
  const base = readConfig(env);
  const dbPath = overrides.dbPath || base.dbPath;
  const dbWasSelected = Boolean(overrides.dbPath || env.HUB_DB_PATH);
  const resolved = {
    ...base,
    dbPath,
    forestPath: overrides.forestPath || base.forestPath,
    semanticIndexPath: overrides.semanticIndexPath || base.semanticIndexPath,
    forestTraversalPath: overrides.forestTraversalPath || (dbWasSelected && !env.HUB_FOREST_TRAVERSAL_PATH ? join(dirname(dbPath), 'forest-paths.sqlite') : base.forestTraversalPath),
    spinePath: overrides.spinePath || (dbWasSelected && !env.HUB_SPINE_PATH ? join(dirname(dbPath), 'spine.jsonl') : base.spinePath),
    spineSessionScoped: !overrides.spinePath && !env.HUB_SPINE_PATH,
    worldPath: overrides.worldPath || (dbWasSelected && !env.HUB_WORLD_PATH ? join(dirname(dbPath), 'world.sqlite') : base.worldPath),
    resultPath: overrides.resultPath || (dbWasSelected && !env.HUB_RESULT_PATH ? join(dirname(dbPath), 'results.sqlite') : base.resultPath),
    binderWindowSnapshotPath: overrides.binderWindowSnapshotPath || (dbWasSelected && !env.HUB_BINDER_WINDOW_SNAPSHOT_PATH ? join(dirname(dbPath), 'binder-window.json') : base.binderWindowSnapshotPath),
    spotlightAuthPath: overrides.spotlightAuthPath || (dbWasSelected && !env.HUB_SPOTLIGHT_AUTH_PATH ? join(dirname(dbPath), 'spotlight', 'robinhood-auth.dpapi') : base.spotlightAuthPath),
    spotlightObservationPath: overrides.spotlightObservationPath || (dbWasSelected && !env.HUB_SPOTLIGHT_OBSERVATION_PATH ? join(dirname(dbPath), 'spotlight', 'observations.sqlite') : base.spotlightObservationPath),
    forestActive: overrides.activateForest === undefined ? base.forestActive : Boolean(overrides.activateForest),
    progressiveStartup: Boolean(overrides.progressiveStartup),
  };
  return immutable(resolved);
}
