import { join } from 'node:path';

const VALID_MODES = new Set(['live', 'fake']);

export function readConfig(env = process.env) {
  const mode = env.HUB_RESIDENT_MODE || 'live';
  if (!VALID_MODES.has(mode)) throw new Error('HUB_RESIDENT_MODE must be live or fake');
  return {
    mode,
    baseUrl: (env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, ''),
    model: env.DEEPSEEK_MODEL || 'deepseek-v4-flash',
    thinking: env.DEEPSEEK_THINKING || 'disabled',
    fakeOrientationVariant: env.HUB_FAKE_ORIENTATION_VARIANT || 'valid',
    apiKey: env.DEEPSEEK_API_KEY || '',
    dbPath: env.HUB_DB_PATH || join(process.cwd(), '.runtime', 'hub.sqlite'),
    forestPath: env.HUB_FOREST_PATH || join(process.cwd(), '.runtime', 'forest.sqlite'),
    spinePath: env.HUB_SPINE_PATH || join(process.cwd(), '.runtime', 'spine', 'resident-seat-1.jsonl'),
    forestActive: env.HUB_FOREST_ACTIVE === 'true',
    port: Number(env.HUB_PORT || 3000),
    messageCeiling: Number(env.HUB_MESSAGE_CEILING || 20),
    maxMessageLength: Number(env.HUB_MAX_MESSAGE_LENGTH || 4000),
    maxBodyBytes: Number(env.HUB_MAX_BODY_BYTES || 10000),
  };
}
