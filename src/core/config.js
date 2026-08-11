import { join } from 'node:path';
import { tmpdir } from 'node:os';

const VALID_MODES = new Set(['live', 'fake']);
const VALID_SANDBOX_BACKENDS = new Set(['docker', 'host-test']);

export function readConfig(env = process.env) {
  const mode = env.HUB_RESIDENT_MODE || 'live';
  if (!VALID_MODES.has(mode)) throw new Error('HUB_RESIDENT_MODE must be live or fake');
  const runtimeRoot = env.HUB_RUNTIME_ROOT || join(process.cwd(), '.runtime');
  const expectedSandboxBackend = mode === 'live' ? 'docker' : 'host-test';
  const sandboxBackend = env.HUB_SANDBOX_BACKEND || expectedSandboxBackend;
  if (!VALID_SANDBOX_BACKENDS.has(sandboxBackend)) throw new Error('HUB_SANDBOX_BACKEND must be docker or host-test');
  if (sandboxBackend !== expectedSandboxBackend) throw new Error(`HUB_SANDBOX_BACKEND must be ${expectedSandboxBackend} in ${mode} mode`);
  const resultProjectionMaxBytes = Number(env.HUB_RESULT_PROJECTION_MAX_BYTES || 12000);
  const resultProjectionMaxLines = Number(env.HUB_RESULT_PROJECTION_MAX_LINES || 120);
  const attentionWarnBytes = Number(env.HUB_ATTENTION_WARN_BYTES || 80000);
  const attentionRefuseBytes = Number(env.HUB_ATTENTION_REFUSE_BYTES || 120000);
  const retainedToolPairs = Number(env.HUB_RETAINED_TOOL_PAIRS || 2);
  const providerMaxReturnBytes = Number(env.HUB_PROVIDER_MAX_RETURN_BYTES || 8 * 1024 * 1024);
  if (!Number.isInteger(resultProjectionMaxBytes) || resultProjectionMaxBytes < 192) throw new Error('HUB_RESULT_PROJECTION_MAX_BYTES must be an integer of at least 192');
  if (!Number.isInteger(resultProjectionMaxLines) || resultProjectionMaxLines < 1) throw new Error('HUB_RESULT_PROJECTION_MAX_LINES must be a positive integer');
  if (!Number.isInteger(attentionWarnBytes) || attentionWarnBytes < 0 || !Number.isInteger(attentionRefuseBytes) || attentionRefuseBytes <= attentionWarnBytes) throw new Error('Attention thresholds require 0 <= HUB_ATTENTION_WARN_BYTES < HUB_ATTENTION_REFUSE_BYTES');
  if (!Number.isInteger(retainedToolPairs) || retainedToolPairs < 0) throw new Error('HUB_RETAINED_TOOL_PAIRS must be a non-negative integer');
  if (!Number.isInteger(providerMaxReturnBytes) || providerMaxReturnBytes < 1) throw new Error('HUB_PROVIDER_MAX_RETURN_BYTES must be a positive integer');
  return {
    mode,
    baseUrl: (env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, ''),
    model: env.DEEPSEEK_MODEL || 'deepseek-v4-flash',
    thinking: env.DEEPSEEK_THINKING || 'disabled',
    fakeOrientationVariant: env.HUB_FAKE_ORIENTATION_VARIANT || 'valid',
    apiKey: env.DEEPSEEK_API_KEY || '',
    runtimeRoot,
    dbPath: env.HUB_DB_PATH || join(runtimeRoot, 'hub.sqlite'),
    forestPath: env.HUB_FOREST_PATH || join(runtimeRoot, 'forest.sqlite'),
    spinePath: env.HUB_SPINE_PATH || join(runtimeRoot, 'spine', 'resident-seat-1.jsonl'),
    worldPath: env.HUB_WORLD_PATH || join(runtimeRoot, 'world.sqlite'),
    resultPath: env.HUB_RESULT_PATH || join(runtimeRoot, 'results.sqlite'),
    workshopRoot: env.HUB_WORKSHOP_ROOT || process.cwd(),
    forestActive: env.HUB_FOREST_ACTIVE === 'true',
    port: Number(env.HUB_PORT || 3000),
    messageCeiling: Number(env.HUB_MESSAGE_CEILING || 20),
    hearthScrollBudget: Number(env.HUB_HEARTH_SCROLL_BUDGET || 3000),
    hearthExcerptLimit: Number(env.HUB_HEARTH_EXCERPT_LIMIT || 600),
    maxMessageLength: Number(env.HUB_MAX_MESSAGE_LENGTH || 4000),
    maxBodyBytes: Number(env.HUB_MAX_BODY_BYTES || 10000),
    maxToolRounds: Number(env.HUB_MAX_TOOL_ROUNDS || 8),
    workshopMaxFiles: Number(env.HUB_WORKSHOP_MAX_FILES || 100),
    workshopMaxBytes: Number(env.HUB_WORKSHOP_MAX_BYTES || 120000),
    workshopMaxLines: Number(env.HUB_WORKSHOP_MAX_LINES || 160),
    workshopMaxResults: Number(env.HUB_WORKSHOP_MAX_RESULTS || 50),
    approvalMode: mode === 'fake' && env.HUB_APPROVAL_MODE === 'auto' ? 'auto' : 'confirm',
    recipeTimeoutMs: Number(env.HUB_RECIPE_TIMEOUT_MS || 120000),
    resultProjectionMaxBytes,
    resultProjectionMaxLines,
    attentionWarnBytes,
    attentionRefuseBytes,
    retainedToolPairs,
    providerMaxReturnBytes,
    sandboxBackend,
    sandboxImage: env.HUB_SANDBOX_IMAGE || 'node:22-alpine',
    sandboxJobsRoot: env.HUB_SANDBOX_JOBS_ROOT || join(tmpdir(), 'hub-sandbox-bay'),
  };
}
