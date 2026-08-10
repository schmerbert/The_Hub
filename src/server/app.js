import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HubDatabase } from '../ledger/source.js';
import { readConfig } from '../core/config.js';
import { createProvider } from '../providers/index.js';
import { completeProvider, prepareProviderRequest } from '../providers/dispatch.js';
import { echoReasoningContentForContinuation } from '../providers/deepseek.js';
import { ForestStore } from '../forest/store.js';
import { verifyForest } from '../forest/verify.js';
import { SpineStore } from '../spine/store.js';
import { sha256 } from '../core/hash.js';
import { BLESSING_SOURCE_EVENT_ID } from '../resident/charter.js';
import { validateBlessingSourceEvent } from '../context/assemble.js';
import { planOldToolExchangeOmissions, projectSourceRefs } from '../context/tool-pairs.js';
import { assertScrubbedPresentation, scrubProviderHistory, verifyScrubbedProjection } from '../scrub/provider-presentation.js';
import { scrubProviderReturn } from '../scrub/provider-return.js';
import { buildClinicalBootstrap, messageSourceRefs } from '../session/lifespan.js';
import { HEARTH_TOOL, HEARTH_TOOL_CHOICE, hearthReturn, hearthReturnHash, validateOrientationResult } from '../hearth/handshake.js';
import { buildHearthScroll } from '../hearth/scroll.js';
import { WorldGraphStore } from '../world/graph.js';
import { WorkshopAdapter } from '../world/workshop.js';
import { WorldActionGateway } from '../world/gateway.js';
import { ceilingCatalog } from '../world/ceiling.js';
import { residentToolProfile, schemasForResidentSession, schemasForSession } from '../world/tools.js';
import { scrubHostReturn } from '../scrub/host-return.js';
import { projectWakeSlips } from '../corner/slips.js';
import { AttentionMeter, ResultRackStore } from '../world/results.js';
import { DockerCliSandboxBackend, SandboxBay } from '../world/sandbox.js';
import { SandboxRecipeRunner } from '../world/sandbox-recipes.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PUBLIC = join(ROOT, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };

function json(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(body);
}
function typedError(response, status, code, message) { json(response, status, { error: { code, message } }); }
function statusFor(code) {
  if (code === 'wake_in_progress' || code === 'sandbox_promotion_stale') return 409;
  if (code === 'sandbox_backend_unavailable' || code === 'sandbox_workspace_not_writable') return 503;
  if (code?.startsWith('sandbox_')) return 400;
  if (['invalid_message', 'message_too_large', 'request_too_large', 'invalid_json', 'attention_ceiling_exceeded', 'world_invalid_argument', 'world_tool_invalid', 'world_tool_unknown', 'world_wrong_room', 'world_wrong_station', 'world_not_engaged', 'world_station_unknown', 'world_station_unreachable', 'workshop_path_invalid', 'workshop_path_forbidden', 'workshop_not_found', 'workshop_not_file', 'workshop_not_directory', 'workshop_range', 'workshop_limit', 'workshop_oversized', 'workshop_binary', 'workshop_invalid_argument', 'workshop_patch_missing', 'workshop_patch_ambiguous', 'workshop_patch_stale', 'workshop_recipe_unknown', 'workshop_approval_not_found', 'workshop_approval_not_pending', 'workshop_git_failed', 'workshop_git_unavailable'].includes(code)) return 400;
  if (['provider_unavailable', 'forest_intake_failed', 'forest_activation_refused', 'wake_ritual_invalid'].includes(code)) return 503;
  if (code === 'hearth_orientation_invalid' || code?.startsWith('provider_')) return 502;
  return 500;
}
async function body(request, maxBytes) {
  let total = 0; const chunks = [];
  for await (const chunk of request) { total += chunk.length; if (total > maxBytes) throw { code: 'request_too_large', message: 'Request body is too large.' }; chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { throw { code: 'invalid_json', message: 'Request body must be valid JSON.' }; }
}

export function createHub({ env = process.env, dbPath, forestPath, spinePath, worldPath, resultPath, activateForest, forest: forestOverride, spine: spineOverride, world: worldOverride, provider: providerOverride, recipeRunner: recipeRunnerOverride } = {}) {
  const config = readConfig(env);
  if (dbPath) config.dbPath = dbPath;
  if (forestPath) config.forestPath = forestPath;
  if (spinePath) config.spinePath = spinePath;
  else if ((dbPath || env.HUB_DB_PATH) && !env.HUB_SPINE_PATH) config.spinePath = join(dirname(config.dbPath), 'spine.jsonl');
  if (worldPath) config.worldPath = worldPath;
  else if ((dbPath || env.HUB_DB_PATH) && !env.HUB_WORLD_PATH) config.worldPath = join(dirname(config.dbPath), 'world.sqlite');
  if (resultPath) config.resultPath = resultPath;
  else if ((dbPath || env.HUB_DB_PATH) && !env.HUB_RESULT_PATH) config.resultPath = join(dirname(config.dbPath), 'results.sqlite');
  if (activateForest !== undefined) config.forestActive = activateForest;
  if (config.forestActive && config.mode === 'fake') throw { code: 'forest_activation_refused', message: 'Forest activation requires a live DeepSeek provider.' };
  if (config.forestActive && (!existsSync(config.dbPath) || !existsSync(config.forestPath))) throw { code: 'forest_activation_refused', message: 'Forest activation requires an existing operational database and validated Forest database.' };
  const db = new HubDatabase(config.dbPath);
  const provider = createProvider(config, providerOverride);
  let forest = null; let spine = null; let world = null; let results = null;
  try {
    if (config.forestActive && !forestOverride) {
      if (config.mode === 'live') validateBlessingSourceEvent(db.getEvent(BLESSING_SOURCE_EVENT_ID), db.threadId);
      verifyForest({ forestPath: config.forestPath, operationalPath: config.dbPath, spinePath: existsSync(config.spinePath) ? config.spinePath : undefined, worldPath: existsSync(config.worldPath) ? config.worldPath : undefined });
      forest = new ForestStore(config.forestPath, { mode: 'requireExisting' });
    } else forest = forestOverride || null;
    spine = spineOverride || new SpineStore(config.spinePath);
    world = worldOverride || new WorldGraphStore(config.worldPath);
    results = new ResultRackStore(config.resultPath, { projectionMaxBytes: config.resultProjectionMaxBytes, projectionMaxLines: config.resultProjectionMaxLines });
    world.ensureLifespan(db.session.id);
    if (config.mode === 'live' && forest && spine) validateBlessingSourceEvent(db.getEvent(BLESSING_SOURCE_EVENT_ID), db.threadId);
  } catch (error) {
    forest?.close(); spine?.close(); world?.close(); results?.close(); db.close(); throw { code: error?.code === 'wake_ritual_invalid' ? 'wake_ritual_invalid' : 'forest_activation_refused', message: error?.code === 'wake_ritual_invalid' ? error.message : error?.code === 'forest_activation_refused' ? error.message : 'Existing Forest validation failed.' };
  }
  let workshop = null; let sandboxBay = null; let recipeRunner = recipeRunnerOverride || null; let gateway = null;
  try {
    workshop = new WorkshopAdapter(config.workshopRoot, { maxFiles: config.workshopMaxFiles, maxBytes: config.workshopMaxBytes, maxLines: config.workshopMaxLines, maxResults: config.workshopMaxResults });
    if (config.mode === 'live' && !recipeRunner) {
      sandboxBay = new SandboxBay({
        repoRoot: config.workshopRoot,
        jobsRoot: config.sandboxJobsRoot,
        backend: new DockerCliSandboxBackend({ image: config.sandboxImage }),
        resources: { timeoutMs: config.recipeTimeoutMs, maxOutputBytes: config.workshopMaxBytes },
      });
      recipeRunner = new SandboxRecipeRunner(config.workshopRoot, { sandboxBay, timeoutMs: config.recipeTimeoutMs });
    }
    gateway = new WorldActionGateway({ world, workshop, forest, resultRack: results, recipeRunner, approvalMode: config.approvalMode, recipeTimeoutMs: config.recipeTimeoutMs });
    gateway.reconcileStartup(db.session.id);
  } catch (error) {
    forest?.close(); spine?.close(); world?.close(); results?.close(); db.close();
    throw error;
  }
  const attentionMeter = new AttentionMeter({ warnBytes: config.attentionWarnBytes, refuseBytes: config.attentionRefuseBytes });

  let wakeInProgress = false;
  let activeWakeId = null;
  let activeWakePromise = null;
  let lastAttention = null;
  let closing = false;
  let closePromise = null;

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
    if (closing) throw { code: 'hub_closing', message: 'The Hub is shutting down and is not accepting new wakes.' };
    if (wakeInProgress) throw { code: 'wake_in_progress', message: 'Another wake is already in progress.' };
    wakeInProgress = true;
    const operation = performWake(content);
    activeWakePromise = operation;
    try { return await operation; }
    finally {
      if (activeWakePromise === operation) activeWakePromise = null;
      wakeInProgress = false;
      activeWakeId = null;
    }
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
    activeWakeId = created.wakeId;
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
      // DeepSeek thinking mode rejects forced tool_choice; orientation must disable thinking.
      const thinking = options.orientation ? 'disabled' : config.thinking;
      const tools = options.orientation ? [HEARTH_TOOL] : options.tools;
      const omissionPlan = options.orientation
        ? { omissions: [], manifest: [], omittedExchangeCount: 0, omittedMessageCount: 0, disclosure: null }
        : planOldToolExchangeOmissions(historyRows, { currentWakeId: created.wakeId, retainExchanges: config.retainedToolPairs });
      const extraMessages = [];
      if (options.roomPresence !== false) extraMessages.push({ role: 'system', content: world.presenceMessage(created.sessionId) });
      if (options.toolProfile?.omittedCount) {
        const group = options.toolProfile.activeGroup ? ` Active fixture group: ${options.toolProfile.activeGroup}.` : ' Engage a fixture to present its group.';
        extraMessages.push({ role: 'system', content: `Tool attention disclosure: ${options.toolProfile.names.length} of ${options.toolProfile.completeCount} World-mounted schemas are presented.${group} The full catalog remains available through workshop_tool_catalog.` });
      }
      if (omissionPlan.disclosure) extraMessages.push({ role: 'system', content: omissionPlan.disclosure });
      const assemble = () => {
        const refs = echoReasoningContentForContinuation(messageSourceRefs(historyRows, bootstrap, extraMessages), { thinking, tools });
        const sourceMessages = refs.map(ref => ref.message);
        const presentation = scrubProviderHistory(sourceMessages, { omissions: omissionPlan.omissions });
        const presentedRefs = projectSourceRefs(refs, omissionPlan.omissions);
        const attention = attentionMeter.measure({ messages: presentation.messages, tools: tools || [] });
        return { refs, sourceMessages, presentation, presentedRefs, attention };
      };
      let assembled = assemble();
      if (assembled.attention.status === 'warn') {
        extraMessages.push({ role: 'system', content: `Attention meter warning: this fitted provider crossing is ${assembled.attention.totalBytes} bytes; the refusal ceiling is ${config.attentionRefuseBytes} bytes.` });
        assembled = assemble();
      }
      const { refs, sourceMessages, presentation, presentedRefs } = assembled;
      const sourceAttention = attentionMeter.measure({ messages: sourceMessages, tools: tools || [] });
      const attention = {
        ...assembled.attention,
        phase,
        wakeId: created.wakeId,
        sourceTotalBytes: sourceAttention.totalBytes,
        fittedSavingsBytes: sourceAttention.totalBytes - assembled.attention.totalBytes,
        contextOmissions: omissionPlan,
        toolProfile: options.toolProfile || null,
      };
      lastAttention = attention;
      db.recordAttentionReceipt({ sessionId: created.sessionId, wakeId: created.wakeId, phase, attention });
      if (!attention.dispatchAllowed) throw { code: 'attention_ceiling_exceeded', message: `The fitted provider crossing is ${attention.totalBytes} bytes and exceeds the ${config.attentionRefuseBytes}-byte attention ceiling.` };
      const prepared = prepareProviderRequest(provider, {
        presentation, model: config.model,
        thinking,
        phase,
        tools,
        toolChoice: options.orientation ? HEARTH_TOOL_CHOICE : undefined,
      });
      const requestBodyString = prepared.requestBodyString || JSON.stringify(prepared.requestBody);
      const wakeRecord = db.getWake(created.wakeId);
      const requestFrame = spine?.prepareRequest({ requestBody: requestBodyString, threadId: wakeRecord.threadId, wakeId: wakeRecord.id, provider: wakeRecord.provider, model: config.model, authorizationPresent: config.mode === 'live' && Boolean(config.apiKey), requestPhase: phase });
      const requestId = db.recordProviderRequest({ sessionId: created.sessionId, wakeId: created.wakeId, phase, requestBody: requestBodyString, messageSources: presentedRefs, spineRecordId: requestFrame?.record_id, attention });
      let observedOutcome = null;
      let rawReturnFrame = null;
      let dispatchObserved = false;
      const onBeforeDispatch = requestFrame ? () => registerPresentationBoundary(created.wakeId, requestFrame, requestBodyString, presentation, sourceMessages, presentedRefs) : undefined;
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
        if (requestFrame && !observedOutcome && result) observedOutcome = { kind: 'success', http_status: 200, response_id: result.responseId || null };
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
    const runResidentRounds = async (phase = 'response') => {
      for (let round = 0; round <= config.maxToolRounds; round += 1) {
        const toolProfile = residentToolProfile(world, created.sessionId);
        const response = await callPhase(phase, db.getSessionHistory(created.sessionId), { tools: schemasForResidentSession(world, created.sessionId), toolProfile });
        const calls = Array.isArray(response.result?.message?.tool_calls) ? response.result.message.tool_calls : [];
        if (!calls.length) {
          if (!response.result || typeof response.result.content !== 'string' || !response.result.content.trim()) throw { code: 'provider_empty_content', message: 'The resident provider returned no content.' };
          return response;
        }
        db.recordToolCall({ wakeId: created.wakeId, sessionId: created.sessionId, message: response.result.message, returnScrub: response.returnScrub });
        if (round === config.maxToolRounds) {
          const limitError = { code: 'world_tool_round_limit', message: 'The bounded resident tool loop refused a tool action after the configured round limit.' };
          for (const call of calls) {
            const action = gateway.refuse({ sessionId: created.sessionId, wakeId: created.wakeId, requestRecordId: response.requestId, spineRecordId: response.requestFrame?.record_id, intent: call, error: limitError });
            db.recordToolResult({ wakeId: created.wakeId, sessionId: created.sessionId, toolName: action.name || call.function?.name || 'unknown', result: action.result, hostReturnScrub: action.scrub });
          }
          throw limitError;
        }
        for (const call of calls) {
          let action;
          try { action = await gateway.execute({ sessionId: created.sessionId, wakeId: created.wakeId, requestRecordId: response.requestId, spineRecordId: response.requestFrame?.record_id, intent: call }); }
          catch (error) { action = gateway.refuse({ sessionId: created.sessionId, wakeId: created.wakeId, requestRecordId: response.requestId, spineRecordId: response.requestFrame?.record_id, intent: call, error }); }
          db.recordToolResult({ wakeId: created.wakeId, sessionId: created.sessionId, toolName: action.name || call.function?.name || 'unknown', result: action.result, hostReturnScrub: action.scrub });
        }
      }
      throw { code: 'world_tool_round_limit', message: 'The bounded resident tool loop ended before a final response.' };
    };
    try {
      if (firstTurn) {
        const orientation = await callPhase('orientation', db.getSessionHistory(created.sessionId), { orientation: true, roomPresence: false });
        const action = validateOrientationResult(orientation.result);
        const actionEventId = db.recordHearthAction({ wakeId: created.wakeId, sessionId: created.sessionId, message: action.message, returnScrub: orientation.returnScrub });
        const prior = db.priorSessionTail({ sessionId: created.sessionId, ceiling: config.messageCeiling });
        const roomProjection = world.projection(created.sessionId);
         const hearthBase = hearthReturn({ sessionId: created.sessionId, threadId: db.threadId, provider: providerName, model: config.model, prior, sourceEvent: db.getEvent(BLESSING_SOURCE_EVENT_ID), clinicalGround: bootstrap, environmentImplemented: true, roomProjection });
        const scroll = buildHearthScroll({ hearth: hearthBase, prior, forest, budget: config.hearthScrollBudget, excerptLimit: config.hearthExcerptLimit, sourceAncestry: { orientationSpineRecordId: orientation.requestFrame?.record_id || null, orientationReturnScrub: orientation.returnScrub.receipt }, roomProjection });
         const hearthScrub = scrubHostReturn({ toolName: 'tend_hearth', toolCallId: action.toolCallId, arguments: {}, result: { markdown: scroll.markdown, room: roomProjection }, content: scroll.markdown, renderPolicy: 'hearth_scroll_markdown_v1', roomId: roomProjection.roomId });
        db.recordHearthReturn({ wakeId: created.wakeId, sessionId: created.sessionId, toolCallId: action.toolCallId, returnValue: scroll.receipt, scrollMarkdown: scroll.markdown, scrollHash: scroll.markdownHash, actionEventId, returnHash: hearthReturnHash(scroll.receipt), hostReturnScrub: hearthScrub });
        const response = await runResidentRounds();
        const residentEventId = db.commitSessionWake(created.wakeId, response.result);
        if (forest && response.requestFrame) {
          try {
            const entry = forest.ingestEvent(db.getEvent(residentEventId), { spineStatus: 'live', predecessorSourceEventId: created.eventId });
            forest.linkEmission({ entryId: entry.entryId || entry.entry_id, requestRecordId: response.requestFrame.record_id });
          } catch (error) { db.recordHostFailure(created.wakeId, { code: 'forest_intake_failed', message: error?.message || 'The Forest could not accept the resident utterance.' }); }
        }
      } else {
        const ordinary = await runResidentRounds('ordinary');
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
      const verification = verifyForest({ forestPath: config.forestPath, operationalPath: config.dbPath, spinePath: existsSync(config.spinePath) ? config.spinePath : undefined, worldPath: existsSync(config.worldPath) ? config.worldPath : undefined });
      return { forestActive: true, forestEligibleCount: eligibleCount, forestCount: forest.count(), forestCaughtUp: verification.ok && verification.entryCount === eligibleCount, forestIntegrity: 'ok', forestErrorCode: null, excludedFakeUtteranceCount };
    } catch { return { forestActive: true, forestEligibleCount: eligibleCount, forestCount: forest.count(), forestCaughtUp: false, forestIntegrity: 'error', forestErrorCode: 'forest_integrity_error', excludedFakeUtteranceCount }; }
  }

  async function handler(request, response) {
    const url = new URL(request.url, 'http://localhost');
    try {
      if (closing) return typedError(response, 503, 'hub_closing', 'The Hub is shutting down and is not accepting new requests.');
      if (request.method === 'GET' && url.pathname === '/api/health') {
        const custody = forestHealth();
        const projection = world.projection(db.session.id);
        return json(response, 200, {
          ok: !custody.forestActive || (custody.forestIntegrity === 'ok' && custody.forestCaughtUp), schemaReady: true,
          residentMode: config.mode, provider: config.mode === 'fake' ? 'fake' : 'deepseek',
          model: config.model, liveCredentialsAvailable: Boolean(config.apiKey), currentRoom: projection, engagedFixtureId: projection.engagedFixtureId, engagedStationId: projection.engagedFixtureId, heartbeat: projection.heartbeat || null, mountedTools: world.availableTools(db.session.id), residentToolProfile: residentToolProfile(world, db.session.id), attention: lastAttention, recipeRuntime: config.mode === 'live' ? 'docker_sandbox' : 'direct_host_test_only', recipeState: gateway.recipes.status(), pendingApprovals: world.listApprovals(db.session.id, { pendingOnly: true }).length, ...custody, wakeInProgress, activeWakeId,
        });
      }
      if (request.method === 'GET' && url.pathname === '/api/thread') return json(response, 200, { ...db.getThread(), residentMode: config.mode, model: config.model });
      if (request.method === 'GET' && url.pathname === '/api/session') return json(response, 200, { session: db.getActiveSession(), sessions: db.listSessions(), history: db.getSessionHistory(), world: world.projection(db.session.id), residentMode: config.mode, model: config.model });
      if (request.method === 'GET' && url.pathname === '/api/world') return json(response, 200, { graph: { nodes: world.sqlite.prepare('SELECT * FROM world_nodes ORDER BY id').all(), edges: world.sqlite.prepare('SELECT * FROM world_edges ORDER BY id').all() }, location: world.current(db.session.id), projection: world.projection(db.session.id), ceiling: ceilingCatalog(), tools: schemasForSession(world, db.session.id), approvals: world.listApprovals(db.session.id) });
      if (request.method === 'GET' && url.pathname === '/api/approvals') return json(response, 200, { approvals: world.listApprovals(db.session.id) });
      if (request.method === 'POST' && /^\/api\/approvals\/[^/]+\/decide$/.test(url.pathname)) {
        let incoming; try { incoming = await body(request, config.maxBodyBytes); } catch (error) { return typedError(response, 400, error.code, error.message); }
        const approvalId = url.pathname.split('/')[3];
        try {
          if (incoming.decision === 'confirm') return json(response, 200, await gateway.confirmApproval(approvalId, db.session.id));
          if (incoming.decision === 'reject') return json(response, 200, gateway.rejectApproval(approvalId, db.session.id));
          return typedError(response, 400, 'workshop_invalid_argument', 'decision must be confirm or reject.');
        } catch (error) { return typedError(response, statusFor(error.code || ''), error.code || 'workshop_approval_failed', error.message || 'Approval decision failed.'); }
      }
      if (request.method === 'GET' && /^\/api\/wakes\/[^/]+$/.test(url.pathname)) {
        const wakeRecord = db.getWake(url.pathname.split('/').at(-1));
        if (!wakeRecord) return typedError(response, 404, 'wake_not_found', 'Wake not found.');
        const wiring = spine ? spine.frames().filter(frame => frame.wake_id === wakeRecord.id || wakeRecord.phases.some(phase => phase.spineRecordId === frame.request_record_id || phase.spineRecordId === frame.record_id)) : [];
        return json(response, 200, { ...wakeRecord, wiring: { spineFrames: wiring, hearthMachineReceipt: wakeRecord.hearth?.returnJson || null, returnScrubReceipts: wakeRecord.phases.map(phase => phase.returnScrubReceipt).filter(Boolean) }, residentMode: config.mode });
      }
      if (request.method === 'GET' && /^\/api\/wakes\/[^/]+\/slips$/.test(url.pathname)) {
        const wakeId = url.pathname.split('/')[3];
        const wakeRecord = db.getWake(wakeId);
        if (!wakeRecord) return typedError(response, 404, 'wake_not_found', 'Wake not found.');
        const history = db.getSessionHistory(wakeRecord.sessionId).filter(item => item.wakeId === wakeId);
        return json(response, 200, projectWakeSlips({ wake: wakeRecord, history, world, pendingApprovals: world.listApprovals(wakeRecord.sessionId, { pendingOnly: true }) }));
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
  function stopIntake() {
    if (!server.listening) return null;
    return new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  }
  function closeStore(store) {
    if (store && typeof store.close === 'function') store.close();
  }
  function close() {
    if (closePromise) return closePromise;
    closing = true;
    const failures = [];
    const intakeClosing = stopIntake();
    const wakeClosing = activeWakePromise;
    let gatewayClosing;
    try { gatewayClosing = gateway.close('hub_close'); }
    catch (error) { failures.push(error); }
    const operations = [intakeClosing, wakeClosing, gatewayClosing]
      .filter(operation => operation && typeof operation.then === 'function');
    const closeStores = () => {
      for (const store of [forest, spine, world, results, db]) {
        try { closeStore(store); } catch (error) { failures.push(error); }
      }
    };
    const finish = () => {
      if (failures.length === 1) throw failures[0];
      if (failures.length > 1) throw new AggregateError(failures, 'The Hub encountered multiple failures while shutting down.');
    };
    if (!operations.length) {
      closeStores();
      try { finish(); closePromise = Promise.resolve(); }
      catch (error) { closePromise = Promise.reject(error); }
      return closePromise;
    }
    closePromise = (async () => {
      for (const operation of operations) {
        try { await operation; } catch (error) { failures.push(error); }
      }
      closeStores();
      finish();
    })();
    return closePromise;
  }
  return { config, db, provider, forest, spine, world, results, sandboxBay, workshop, gateway, server, wake, close };
}
