import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Load KEY=VALUE pairs from a .env file into process.env without overriding existing vars. */
export function loadEnvFile(path = resolve(process.cwd(), '.env')) {
  if (!existsSync(path)) return { loaded: false, path, count: 0 };
  const text = readFileSync(path, 'utf8');
  let count = 0;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const cut = line.indexOf('=');
    if (cut <= 0) continue;
    const key = line.slice(0, cut).trim();
    let value = line.slice(cut + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!key || Object.hasOwn(process.env, key)) continue;
    process.env[key] = value;
    count += 1;
  }
  return { loaded: true, path, count };
}
