import { join } from 'node:path';

const VALID_MODES = new Set(['live', 'fake']);

export function readConfig(env = process.env) {
  const mode = env.HUB_RESIDENT_MODE || 'live';
  if (!VALID_MODES.has(mode)) throw new Error('HUB_RESIDENT_MODE must be live or fake');
  const runtimeRoot = env.HUB_RUNTIME_ROOT || join(process.cwd(), '.runtime');
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
    workshopRoot: env.HUB_WORKSHOP_ROOT || process.cwd(),
    forestActive: env.HUB_FOREST_ACTIVE === 'true',
    port: Number(env.HUB_PORT || 3000),
    messageCeiling: Number(env.HUB_MESSAGE_CEILING || 20),
    hearthScrollBudget: Number(env.HUB_HEARTH_SCROLL_BUDGET || 3000),
    hearthExcerptLimit: Number(env.HUB_HEARTH_EXCERPT_LIMIT || 600),
    maxMessageLength: Number(env.HUB_MAX_MESSAGE_LENGTH || 4000),
    maxBodyBytes: Number(env.HUB_MAX_BODY_BYTES || 10000),
    maxToolRounds: Number(env.HUB_MAX_TOOL_ROUNDS || 4),
    workshopMaxFiles: Number(env.HUB_WORKSHOP_MAX_FILES || 100),
    workshopMaxBytes: Number(env.HUB_WORKSHOP_MAX_BYTES || 120000),
    workshopMaxLines: Number(env.HUB_WORKSHOP_MAX_LINES || 160),
    workshopMaxResults: Number(env.HUB_WORKSHOP_MAX_RESULTS || 50),
  };
}
