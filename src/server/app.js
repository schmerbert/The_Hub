import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HubDatabase } from '../core/db.js';
import { buildContext } from '../core/context.js';
import { readConfig } from '../core/config.js';
import { createProvider } from '../providers/index.js';
import { ForestStore, verifyForest } from '../core/forest.js';
import { SpineStore } from '../core/spine.js';
import { sha256 } from '../core/hash.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PUBLIC = join(ROOT, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };

function json(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(body);
}
function typedError(response, status, code, message) { json(response, status, { error: { code, message } }); }
function statusFor(code) { return ['invalid_message', 'message_too_large', 'request_too_large', 'invalid_json'].includes(code) ? 400 : code === 'wake_in_progress' ? 409 : ['provider_unavailable', 'forest_intake_failed', 'forest_activation_refused'].includes(code) ? 503 : code.startsWith('provider_') ? 502 : 500; }
async function body(request, maxBytes) {
  let total = 0; const chunks = [];
  for await (const chunk of request) { total += chunk.length; if (total > maxBytes) throw { code: 'request_too_large', message: 'Request body is too large.' }; chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { throw { code: 'invalid_json', message: 'Request body must be valid JSON.' }; }
}

export function createHub({ env = process.env, dbPath, forestPath, spinePath, activateForest, forest: forestOverride, spine: spineOverride, provider: providerOverride } = {}) {
  const config = readConfig(env);
  if (dbPath) config.dbPath = dbPath;
  if (forestPath) config.forestPath = forestPath;
  if (spinePath) config.spinePath = spinePath;
  if (activateForest !== undefined) config.forestActive = activateForest;
  if (config.forestActive && config.mode === 'fake') throw { code: 'forest_activation_refused', message: 'Forest activation requires a live DeepSeek provider.' };
  if (config.forestActive && (!existsSync(config.dbPath) || !existsSync(config.forestPath))) throw { code: 'forest_activation_refused', message: 'Forest activation requires an existing operational database and validated Forest database.' };
  const db = new HubDatabase(config.dbPath);
  const provider = createProvider(config, providerOverride);
  let forest = null; let spine = null;
  try {
    if (config.forestActive && !forestOverride) {
      verifyForest({ forestPath: config.forestPath, operationalPath: config.dbPath, spinePath: existsSync(config.spinePath) ? config.spinePath : undefined });
      forest = new ForestStore(config.forestPath, { mode: 'requireExisting' });
    } else forest = forestOverride || null;
    spine = spineOverride || (config.forestActive ? new SpineStore(config.spinePath) : null);
  } catch (error) {
    forest?.close(); db.close(); throw { code: 'forest_activation_refused', message: error?.code === 'forest_activation_refused' ? error.message : 'Existing Forest validation failed.' };
  }

  let wakeInProgress = false;

  function registerPresentationBoundary(wakeId, requestFrame, requestBodyString) {
    if (!forest || !requestFrame) return;
    let requestBody;
    try { requestBody = JSON.parse(requestBodyString); } catch { throw { code: 'forest_intake_failed', message: 'The serialized provider request was not valid JSON.' }; }
    const context = db.getWake(wakeId).context;
    const included = context.filter(item => item.included);
    if (!Array.isArray(requestBody.messages) || requestBody.messages.length !== included.length) throw { code: 'forest_intake_failed', message: 'The serialized provider messages do not match the persisted wake context.' };
    const links = [];
    for (let index = 0; index < included.length; index++) {
      const item = included[index]; const message = requestBody.messages[index];
      if (message?.role !== item.actorRole || message?.content !== item.content) throw { code: 'forest_intake_failed', message: 'The serialized provider messages do not match the persisted wake context.' };
      if (item.itemKind !== 'utterance' || !item.sourceEventId) continue;
      const entry = forest.listEntries().find(candidate => candidate.source_event_id === item.sourceEventId);
      if (!entry) throw { code: 'forest_intake_failed', message: 'A presented utterance is missing from the Forest.' };
      links.push({ entryId: entry.entry_id, requestRecordId: requestFrame.record_id, messageOrdinal: index + 1, providerRole: message.role, contentHash: sha256(message.content) });
    }
    forest.linkPresentations(links);
  }

  async function wake(content) {
    if (wakeInProgress) throw { code: 'wake_in_progress', message: 'Another wake is already in progress.' };
    wakeInProgress = true;
    try { return await performWake(content); } finally { wakeInProgress = false; }
  }

  async function performWake(content) {
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
    if (forest) {
      try { forest.ingestEvent(db.getEvent(created.eventId), { spineStatus: 'live', predecessorSourceEventId: utterances.at(-1)?.id || null }); }
      catch (error) {
        const failure = { code: 'forest_intake_failed', message: error?.message || 'The Forest could not accept the source event.' };
        db.failWake(created.wakeId, failure);
        return db.getWake(created.wakeId);
      }
    }
    db.markCalling(created.wakeId);
    try {
      let prepared;
      try {
        prepared = provider.prepareRequest ? provider.prepareRequest({ messages: assembledContext.messages, model: config.model }) : {
          requestBody: { model: config.model, messages: assembledContext.messages, stream: false, thinking: { type: config.thinking === 'enabled' ? 'enabled' : 'disabled' } },
        };
      } catch (error) { throw error; }
      const requestBodyString = prepared.requestBodyString || JSON.stringify(prepared.requestBody);
      const wakeRecord = db.getWake(created.wakeId);
      const requestFrame = spine?.prepareRequest({ requestBody: requestBodyString, threadId: wakeRecord.threadId, wakeId: wakeRecord.id, provider: wakeRecord.provider, model: config.model, authorizationPresent: config.mode === 'live' && Boolean(config.apiKey) });
      // The host commits presentation evidence, then marks dispatch immediately before fetch.
      const onBeforeDispatch = requestFrame ? () => registerPresentationBoundary(created.wakeId, requestFrame, requestBodyString) : undefined;
      const onDispatch = requestFrame ? () => spine.dispatchAttempted(requestFrame.record_id) : undefined;
      const onOutcome = requestFrame ? outcome => spine.providerOutcome(requestFrame.record_id, outcome) : undefined;
      const result = await provider.complete({ messages: assembledContext.messages, model: config.model, requestBodyString, onBeforeDispatch, onDispatch, onOutcome });
      if (!result || typeof result.content !== 'string' || !result.content.trim()) throw { code: 'provider_empty_content', message: 'The resident provider returned no content.' };
      const residentEventId = db.commitWake(created.wakeId, result, result.content);
      if (forest && requestFrame) {
        try {
          const entry = forest.ingestEvent(db.getEvent(residentEventId), { spineStatus: 'live', predecessorSourceEventId: created.eventId });
          forest.linkEmission({ entryId: entry.entryId || entry.entry_id, requestRecordId: requestFrame.record_id });
        } catch (error) {
          db.recordHostFailure(created.wakeId, { code: 'forest_intake_failed', message: error?.message || 'The Forest could not accept the resident utterance.' });
        }
      }
    } catch (error) {
      const failure = { code: error?.code || 'provider_error', message: error?.message || 'The resident provider failed.' };
      db.failWake(created.wakeId, failure);
    }
    return db.getWake(created.wakeId);
  }

  function forestHealth() {
    if (!forest) return { forestActive: false, forestEligibleCount: null, forestCount: null, forestCaughtUp: null, forestIntegrity: 'inactive', forestErrorCode: null, excludedFakeUtteranceCount: null };
    const eligibleCount = db.listEligibleUtteranceEvents().length;
    const excludedFakeUtteranceCount = db.countExcludedFakeUtterances();
    try {
      const verification = verifyForest({ forestPath: config.forestPath, operationalPath: config.dbPath, spinePath: existsSync(config.spinePath) ? config.spinePath : undefined });
      return { forestActive: true, forestEligibleCount: eligibleCount, forestCount: forest.count(), forestCaughtUp: verification.ok && verification.entryCount === eligibleCount, forestIntegrity: 'ok', forestErrorCode: null, excludedFakeUtteranceCount };
    } catch { return { forestActive: true, forestEligibleCount: eligibleCount, forestCount: forest.count(), forestCaughtUp: false, forestIntegrity: 'error', forestErrorCode: 'forest_integrity_error', excludedFakeUtteranceCount }; }
  }

  async function handler(request, response) {
    const url = new URL(request.url, 'http://localhost');
    try {
      if (request.method === 'GET' && url.pathname === '/api/health') {
        const custody = forestHealth();
        return json(response, 200, {
          ok: !custody.forestActive || (custody.forestIntegrity === 'ok' && custody.forestCaughtUp), schemaReady: true,
          residentMode: config.mode, provider: config.mode === 'fake' ? 'fake' : 'deepseek',
          model: config.model, liveCredentialsAvailable: Boolean(config.apiKey), ...custody, wakeInProgress,
        });
      }
      if (request.method === 'GET' && url.pathname === '/api/thread') return json(response, 200, { ...db.getThread(), residentMode: config.mode, model: config.model });
      if (request.method === 'GET' && /^\/api\/wakes\/[^/]+$/.test(url.pathname)) {
        const wakeRecord = db.getWake(url.pathname.split('/').at(-1));
        return wakeRecord ? json(response, 200, { ...wakeRecord, residentMode: config.mode }) : typedError(response, 404, 'wake_not_found', 'Wake not found.');
      }
      if (request.method === 'POST' && url.pathname === '/api/wakes') {
        let incoming; try { incoming = await body(request, config.maxBodyBytes); } catch (error) { return typedError(response, 400, error.code, error.message); }
        if (!Object.hasOwn(incoming, 'content')) return typedError(response, 400, 'invalid_message', 'Message must contain text.');
        const record = await wake(incoming.content);
        const responseStatus = record.status === 'committed' && !record.custodyFailureCode ? 200 : statusFor(record.failureCode || record.custodyFailureCode || 'provider_error');
        return json(response, responseStatus, { ...record, residentMode: config.mode });
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
  return { config, db, provider, forest, spine, server, wake, close: () => { forest?.close(); db.close(); } };
}
