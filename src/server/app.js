import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HubDatabase } from '../core/db.js';
import { buildContext } from '../core/context.js';
import { readConfig } from '../core/config.js';
import { createProvider } from '../providers/index.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PUBLIC = join(ROOT, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };

function json(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(body);
}
function typedError(response, status, code, message) { json(response, status, { error: { code, message } }); }
function statusFor(code) { return ['invalid_message', 'message_too_large', 'request_too_large', 'invalid_json'].includes(code) ? 400 : code === 'provider_unavailable' ? 503 : code.startsWith('provider_') ? 502 : 500; }
async function body(request, maxBytes) {
  let total = 0; const chunks = [];
  for await (const chunk of request) { total += chunk.length; if (total > maxBytes) throw { code: 'request_too_large', message: 'Request body is too large.' }; chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { throw { code: 'invalid_json', message: 'Request body must be valid JSON.' }; }
}

export function createHub({ env = process.env, dbPath, provider: providerOverride } = {}) {
  const config = readConfig(env);
  if (dbPath) config.dbPath = dbPath;
  const db = new HubDatabase(config.dbPath);
  const provider = createProvider(config, providerOverride);

  async function wake(content) {
    const submitted = typeof content === 'string' ? content : '';
    const trimmed = submitted.trim();
    if (!trimmed) throw { code: 'invalid_message', message: 'Message must contain text.' };
    if (trimmed.length > config.maxMessageLength) throw { code: 'message_too_large', message: `Message must be ${config.maxMessageLength} characters or fewer.` };
    const utterances = db.getThread().events.filter(event => event.eventKind === 'utterance');
    let assembledContext;
    const created = db.createWake({
      provider: config.mode === 'fake' ? 'fake' : 'deepseek', model: config.model, content: submitted,
      contextBuilder: ({ threadId, wakeId, startedAt }) => {
        assembledContext = buildContext({
          utterances, newContent: submitted, ceiling: config.messageCeiling,
          threadId, wakeId, wakeStartedAtUtc: startedAt,
          residentMode: config.mode, requestedModel: config.model,
        });
        return assembledContext.items;
      },
    });
    db.markCalling(created.wakeId);
    try {
      const result = await provider.complete({ messages: assembledContext.messages, model: config.model });
      if (!result || typeof result.content !== 'string' || !result.content.trim()) throw { code: 'provider_empty_content', message: 'The resident provider returned no content.' };
      db.commitWake(created.wakeId, result, result.content);
    } catch (error) {
      const failure = { code: error?.code || 'provider_error', message: error?.message || 'The resident provider failed.' };
      db.failWake(created.wakeId, failure);
    }
    return db.getWake(created.wakeId);
  }

  async function handler(request, response) {
    const url = new URL(request.url, 'http://localhost');
    try {
      if (request.method === 'GET' && url.pathname === '/api/health') return json(response, 200, {
        ok: true, schemaReady: true, residentMode: config.mode, provider: config.mode === 'fake' ? 'fake' : 'deepseek',
        model: config.model, liveCredentialsAvailable: Boolean(config.apiKey),
      });
      if (request.method === 'GET' && url.pathname === '/api/thread') return json(response, 200, { ...db.getThread(), residentMode: config.mode, model: config.model });
      if (request.method === 'GET' && /^\/api\/wakes\/[^/]+$/.test(url.pathname)) {
        const wakeRecord = db.getWake(url.pathname.split('/').at(-1));
        return wakeRecord ? json(response, 200, { ...wakeRecord, residentMode: config.mode }) : typedError(response, 404, 'wake_not_found', 'Wake not found.');
      }
      if (request.method === 'POST' && url.pathname === '/api/wakes') {
        let incoming; try { incoming = await body(request, config.maxBodyBytes); } catch (error) { return typedError(response, 400, error.code, error.message); }
        if (!Object.hasOwn(incoming, 'content')) return typedError(response, 400, 'invalid_message', 'Message must contain text.');
        const record = await wake(incoming.content);
        return json(response, record.status === 'committed' ? 200 : statusFor(record.failureCode || 'provider_error'), { ...record, residentMode: config.mode });
      }
      if (request.method === 'GET') {
        const safePath = url.pathname === '/' ? '/index.html' : url.pathname;
        if (safePath.includes('..')) return typedError(response, 400, 'invalid_path', 'Invalid path.');
        try { const file = await readFile(join(PUBLIC, safePath)); response.writeHead(200, { 'content-type': TYPES[extname(safePath)] || 'application/octet-stream' }); response.end(file); return; } catch {}
      }
      typedError(response, 404, 'not_found', 'Route not found.');
    } catch (error) {
      typedError(response, statusFor(error?.code || ''), error?.code || 'internal_error', error?.message || 'The host failed unexpectedly.');
    }
  }
  const server = createServer(handler);
  return { config, db, provider, server, wake, close: () => db.close() };
}
