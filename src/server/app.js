import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HubDatabase } from '../ledger/source.js';
import { readConfig } from '../core/config.js';
import { createProvider } from '../providers/index.js';
import { completeProvider, prepareProviderRequest } from '../providers/dispatch.js';
import { ForestStore } from '../forest/store.js';
import { verifyForest } from '../forest/verify.js';
import { SpineStore } from '../spine/store.js';
import { sha256 } from '../core/hash.js';
import { BLESSING_SOURCE_EVENT_ID } from '../resident/charter.js';
import { validateBlessingSourceEvent } from '../context/assemble.js';
import { assertScrubbedPresentation, scrubProviderHistory, verifyScrubbedProjection } from '../scrub/provider-presentation.js';
import { scrubProviderReturn } from '../scrub/provider-return.js';
import { buildClinicalBootstrap, messageSourceRefs } from '../session/lifespan.js';
import { HEARTH_TOOL, HEARTH_TOOL_CHOICE, hearthReturn, hearthReturnHash, validateOrientationResult } from '../hearth/handshake.js';
import { buildHearthScroll } from '../hearth/scroll.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PUBLIC = join(ROOT, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };

function json(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(body);
}
function typedError(response, status, code, message) { json(response, status, { error: { code, message } }); }
function statusFor(code) { return ['invalid_message', 'message_too_large', 'request_too_large', 'invalid_json'].includes(code) ? 400 : code === 'wake_in_progress' ? 409 : ['provider_unavailable', 'forest_intake_failed', 'forest_activation_refused', 'wake_ritual_invalid'].includes(code) ? 503 : ['hearth_orientation_invalid'].includes(code) || code.startsWith('provider_') ? 502 : 500; }
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
  else if ((dbPath || env.HUB_DB_PATH) && !env.HUB_SPINE_PATH) config.spinePath = join(dirname(config.dbPath), 'spine.jsonl');
  if (activateForest !== undefined) config.forestActive = activateForest;
  if (config.forestActive && config.mode === 'fake') throw { code: 'forest_activation_refused', message: 'Forest activation requires a live DeepSeek provider.' };
  if (config.forestActive && (!existsSync(config.dbPath) || !existsSync(config.forestPath))) throw { code: 'forest_activation_refused', message: 'Forest activation requires an existing operational database and validated Forest database.' };
  const db = new HubDatabase(config.dbPath);
  const provider = createProvider(config, providerOverride);
  let forest = null; let spine = null;
  try {
    if (config.forestActive && !forestOverride) {
      if (config.mode === 'live') validateBlessingSourceEvent(db.getEvent(BLESSING_SOURCE_EVENT_ID), db.threadId);
      verifyForest({ forestPath: config.forestPath, operationalPath: config.dbPath, spinePath: existsSync(config.spinePath) ? config.spinePath : undefined });
      forest = new ForestStore(config.forestPath, { mode: 'requireExisting' });
    } else forest = forestOverride || null;
    spine = spineOverride || new SpineStore(config.spinePath);
    if (config.mode === 'live' && forest && spine) validateBlessingSourceEvent(db.getEvent(BLESSING_SOURCE_EVENT_ID), db.threadId);
  } catch (error) {
    forest?.close(); db.close(); throw { code: error?.code === 'wake_ritual_invalid' ? 'wake_ritual_invalid' : 'forest_activation_refused', message: error?.code === 'wake_ritual_invalid' ? error.message : error?.code === 'forest_activation_refused' ? error.message : 'Existing Forest validation failed.' };
  }

  let wakeInProgress = false;

  function registerPresentationBoundary(wakeId, requestFrame, requestBodyString, presentation, sourceMessages, sourceRefs = []) {
    if (!forest || !requestFrame) return;
    assertScrubbedPresentation(presentation);
    let requestBody;
    try { requestBody = JSON.parse(requestBodyString); } catch { throw { code: 'forest_intake_failed', message: 'The serialized provider request was not valid JSON.' }; }
    if (!Array.isArray(requestBody.messages) || requestBody.messages.length !== presentation.messages.length ||
      JSON.stringify(requestBody.messages) !== JSON.stringify(presentation.messages)) {
      throw { code: 'forest_intake_failed', message: 'The serialized provider messages do not match the validated scrubbed presentation.' };
    }
    verifyScrubbedProjection(sourceMessages, presentation);
    const links = [];
    for (let index = 0; index < sourceRefs.length; index++) {
      const source = sourceRefs[index]; const message = requestBody.messages[index];
      if (!source || JSON.stringify(message) !== JSON.stringify(source.message)) throw { code: 'forest_intake_failed', message: 'The serialized provider messages do not match the persisted provider presentation.' };
      if (!source.sourceEventId) continue;
      const entry = forest.listEntries().find(candidate => candidate.source_event_id === source.sourceEventId);
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
    const providerName = config.mode === 'fake' ? 'fake' : 'deepseek';
    const firstTurn = !db.sessionHasOrientation();
    const priorEligible = db.listEligibleUtteranceEvents().at(-1)?.id || null;
    const created = db.createSessionWake({ provider: providerName, model: config.model, content: submitted });
    if (forest) {
      try { forest.ingestEvent(db.getEvent(created.eventId), { spineStatus: 'live', predecessorSourceEventId: priorEligible }); }
      catch (error) {
        const failure = { code: 'forest_intake_failed', message: error?.message || 'The Forest could not accept the source event.' };
        db.failSessionWake(created.wakeId, failure);
        return db.getWake(created.wakeId);
      }
    }
    db.markCalling(created.wakeId);
    const bootstrap = buildClinicalBootstrap({ provider: providerName, model: config.model });
    const callPhase = async (phase, historyRows, options = {}) => {
      const refs = messageSourceRefs(historyRows, bootstrap);
      const sourceMessages = refs.map(ref => ref.message);
      const presentation = scrubProviderHistory(sourceMessages);
      const prepared = prepareProviderRequest(provider, {
        presentation, model: config.model, thinking: config.thinking, phase,
        tools: options.orientation ? [HEARTH_TOOL] : undefined,
        toolChoice: options.orientation ? HEARTH_TOOL_CHOICE : undefined,
      });
      const requestBodyString = prepared.requestBodyString || JSON.stringify(prepared.requestBody);
      const wakeRecord = db.getWake(created.wakeId);
      const requestFrame = spine?.prepareRequest({ requestBody: requestBodyString, threadId: wakeRecord.threadId, wakeId: wakeRecord.id, provider: wakeRecord.provider, model: config.model, authorizationPresent: config.mode === 'live' && Boolean(config.apiKey), requestPhase: phase });
      const requestId = db.recordProviderRequest({ sessionId: created.sessionId, wakeId: created.wakeId, phase, requestBody: requestBodyString, messageSources: refs, spineRecordId: requestFrame?.record_id });
      let observedOutcome = null;
      let rawReturnFrame = null;
      let dispatchObserved = false;
      const onBeforeDispatch = requestFrame ? () => registerPresentationBoundary(created.wakeId, requestFrame, requestBodyString, presentation, sourceMessages, refs) : undefined;
      const onDispatch = requestFrame ? () => { dispatchObserved = true; return spine.dispatchAttempted(requestFrame.record_id); } : undefined;
      const onRawReturn = requestFrame ? detail => { rawReturnFrame = spine.providerRawReturn(requestFrame.record_id, detail); return rawReturnFrame; } : undefined;
      const onOutcome = requestFrame ? outcome => { observedOutcome = outcome; } : undefined;
      try {
        let result = await completeProvider(provider, { presentation, model: config.model, phase, requestBodyString, onBeforeDispatch, onDispatch, onRawReturn, onOutcome });
        if (requestFrame && !dispatchObserved) { dispatchObserved = true; spine.dispatchAttempted(requestFrame.record_id); }
        if (requestFrame && !rawReturnFrame && result) {
          const fallbackMessage = result.message || { role: 'assistant', content: typeof result.content === 'string' ? result.content : null };
          rawReturnFrame = spine.providerRawReturn(requestFrame.record_id, { body: Buffer.from(JSON.stringify({ id: result.responseId || null, model: result.resolvedModel || config.model, choices: [{ message: fallbackMessage, finish_reason: result.finishReason || null }] }), 'utf8'), httpStatus: 200, contentType: 'application/json', phase });
        }
        if (!rawReturnFrame) throw { code: 'return_scrub_invalid', message: 'The provider returned no custody body.' };
        const returnScrub = scrubProviderReturn(rawReturnFrame);
        result = { ...result, message: returnScrub.message, content: typeof returnScrub.message.content === 'string' ? returnScrub.message.content : null, returnScrub };
        db.completeProviderRequest(requestId, result, observedOutcome, returnScrub);
        if (requestFrame && observedOutcome) spine.providerOutcome(requestFrame.record_id, observedOutcome);
        return { result, returnScrub, requestFrame, requestId, refs };
      } catch (error) {
        db.completeProviderRequest(requestId, {}, observedOutcome);
        if (requestFrame && observedOutcome) spine.providerOutcome(requestFrame.record_id, observedOutcome);
        throw error;
      }
    };
    try {
      if (firstTurn) {
        const orientation = await callPhase('orientation', db.getSessionHistory(created.sessionId), { orientation: true });
        const action = validateOrientationResult(orientation.result);
        const actionEventId = db.recordHearthAction({ wakeId: created.wakeId, sessionId: created.sessionId, message: action.message, returnScrub: orientation.returnScrub });
        const prior = db.priorSessionTail({ sessionId: created.sessionId, ceiling: config.messageCeiling });
        const hearthBase = hearthReturn({ sessionId: created.sessionId, threadId: db.threadId, provider: providerName, model: config.model, prior, sourceEvent: db.getEvent(BLESSING_SOURCE_EVENT_ID), clinicalGround: bootstrap });
        const scroll = buildHearthScroll({ hearth: hearthBase, prior, forest, budget: config.hearthScrollBudget, excerptLimit: config.hearthExcerptLimit, sourceAncestry: { orientationSpineRecordId: orientation.requestFrame?.record_id || null, orientationReturnScrub: orientation.returnScrub.receipt } });
        db.recordHearthReturn({ wakeId: created.wakeId, sessionId: created.sessionId, toolCallId: action.toolCallId, returnValue: scroll.receipt, scrollMarkdown: scroll.markdown, scrollHash: scroll.markdownHash, actionEventId, returnHash: hearthReturnHash(scroll.receipt) });
        const response = await callPhase('response', db.getSessionHistory(created.sessionId));
        if (!response.result || typeof response.result.content !== 'string' || !response.result.content.trim()) throw { code: 'provider_empty_content', message: 'The resident provider returned no content.' };
        const residentEventId = db.commitSessionWake(created.wakeId, response.result);
        if (forest && response.requestFrame) {
          try {
            const entry = forest.ingestEvent(db.getEvent(residentEventId), { spineStatus: 'live', predecessorSourceEventId: created.eventId });
            forest.linkEmission({ entryId: entry.entryId || entry.entry_id, requestRecordId: response.requestFrame.record_id });
          } catch (error) { db.recordHostFailure(created.wakeId, { code: 'forest_intake_failed', message: error?.message || 'The Forest could not accept the resident utterance.' }); }
        }
      } else {
        const ordinary = await callPhase('ordinary', db.getSessionHistory(created.sessionId));
        if (!ordinary.result || typeof ordinary.result.content !== 'string' || !ordinary.result.content.trim()) throw { code: 'provider_empty_content', message: 'The resident provider returned no content.' };
        const residentEventId = db.commitSessionWake(created.wakeId, ordinary.result);
        if (forest && ordinary.requestFrame) {
        try {
          const entry = forest.ingestEvent(db.getEvent(residentEventId), { spineStatus: 'live', predecessorSourceEventId: created.eventId });
          forest.linkEmission({ entryId: entry.entryId || entry.entry_id, requestRecordId: ordinary.requestFrame.record_id });
        } catch (error) { db.recordHostFailure(created.wakeId, { code: 'forest_intake_failed', message: error?.message || 'The Forest could not accept the resident utterance.' }); }
        }
      }
    } catch (error) {
      const failure = { code: error?.code || 'provider_error', message: error?.message || 'The resident provider failed.' };
      db.failSessionWake(created.wakeId, failure);
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
      if (request.method === 'GET' && url.pathname === '/api/session') return json(response, 200, { session: db.getActiveSession(), sessions: db.listSessions(), history: db.getSessionHistory(), residentMode: config.mode, model: config.model });
      if (request.method === 'GET' && /^\/api\/wakes\/[^/]+$/.test(url.pathname)) {
        const wakeRecord = db.getWake(url.pathname.split('/').at(-1));
        if (!wakeRecord) return typedError(response, 404, 'wake_not_found', 'Wake not found.');
        const wiring = spine ? spine.frames().filter(frame => frame.wake_id === wakeRecord.id || wakeRecord.phases.some(phase => phase.spineRecordId === frame.request_record_id || phase.spineRecordId === frame.record_id)) : [];
        return json(response, 200, { ...wakeRecord, wiring: { spineFrames: wiring, hearthMachineReceipt: wakeRecord.hearth?.returnJson || null, returnScrubReceipts: wakeRecord.phases.map(phase => phase.returnScrubReceipt).filter(Boolean) }, residentMode: config.mode });
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
