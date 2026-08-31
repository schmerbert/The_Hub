import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HubDatabase } from '../ledger/source.js';
import { resolveHubConfig } from '../core/config.js';
import { createProvider } from '../providers/index.js';
import { ForestStore } from '../forest/store.js';
import { SemanticIndexStore } from '../forest/semantic-index.js';
import { LocalEmbeddingProvider } from '../forest/embedding-provider.js';
import { AmbientFeatherService } from '../forest/ambient-feathers.js';
import { ForestTraversalStore } from '../forest/traversal-store.js';
import { ForestTraversalService } from '../forest/traversal.js';
import { verifyForest } from '../forest/verify.js';
import { verifyForestAsync } from '../forest/verify-async.js';
import { projectForestHealth } from '../forest/health.js';
import { SpineStore, readSpineLedgerFrames, spineLedgerExists } from '../spine/store.js';
import { WorldGraphStore } from '../world/graph.js';
import { projectWorldBuilderInspection } from '../world/inspection.js';
import { WorkshopAdapter, DockerCliSandboxBackend, SandboxBay, SandboxRecipeRunner } from '../places/hub/workshop/index.js';
import { loadBinderWindowSnapshot } from '../places/hub/binder-window/index.js';
import { WorldActionGateway } from '../world/gateway.js';
import { residentToolProfile, schemasForSession } from '../world/tools.js';
import { projectWakeSlips } from '../corner/slips.js';
import { ResultRackStore } from '../result-rack/store.js';
import { WakeService } from '../runtime/wake-service.js';
import { HubEventBus } from '../runtime/hub-event-bus.js';
import { ReadinessProjection } from '../runtime/readiness.js';
import { establishInstalledRoomReceipts } from '../rooms/installation-runtime.js';

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
  if (code?.startsWith('wake_stream_')) return 400;
  if (code === 'sandbox_backend_unavailable' || code === 'sandbox_workspace_not_writable') return 503;
  if (code?.startsWith('sandbox_')) return 400;
  if (['invalid_message', 'message_too_large', 'request_too_large', 'invalid_json', 'attention_ceiling_exceeded', 'world_invalid_argument', 'world_tool_invalid', 'world_tool_unknown', 'world_wrong_room', 'world_wrong_station', 'world_not_engaged', 'world_station_unknown', 'world_station_unreachable', 'world_fixture_unknown', 'world_fixture_unreachable', 'world_fixture_not_turnable', 'world_wrong_location_or_passage', 'world_passage_closed', 'world_passage_operation_invalid', 'world_passage_operation_refused', 'workshop_path_invalid', 'workshop_path_forbidden', 'workshop_not_found', 'workshop_not_file', 'workshop_not_directory', 'workshop_range', 'workshop_limit', 'workshop_oversized', 'workshop_binary', 'workshop_invalid_argument', 'workshop_patch_missing', 'workshop_patch_ambiguous', 'workshop_patch_stale', 'workshop_recipe_unknown', 'workshop_approval_not_found', 'workshop_approval_not_pending', 'workshop_git_failed', 'workshop_git_unavailable'].includes(code)) return 400;
  if (['provider_unavailable', 'forest_intake_failed', 'forest_activation_refused', 'wake_ritual_invalid'].includes(code)) return 503;
  if (code === 'hearth_orientation_invalid' || code?.startsWith('provider_')) return 502;
  return 500;
}
async function body(request, maxBytes) {
  let total = 0; const chunks = [];
  for await (const chunk of request) { total += chunk.length; if (total > maxBytes) throw { code: 'request_too_large', message: 'Request body is too large.' }; chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { throw { code: 'invalid_json', message: 'Request body must be valid JSON.' }; }
}

function cursor(value, label, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  if (!/^\d+$/.test(String(value))) throw { code: 'wake_stream_invalid_argument', message: `${label} must be a non-negative integer.` };
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw { code: 'wake_stream_invalid_argument', message: `${label} must be a safe non-negative integer.` };
  return parsed;
}

function sseFrame(event) {
  return `id: ${event.sequence}\nevent: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`;
}

function boundedForestReadinessHealth(active, stage) {
  const state = stage?.state || (active ? 'pending' : 'inactive');
  return {
    forestActive: active,
    forestEligibleCount: null,
    forestCount: null,
    forestWildEligibleCount: null,
    forestWildCount: null,
    forestIntakeOfferCount: null,
    forestIntakeHeldCount: null,
    forestIntakeUnresolvedCount: null,
    forestCaughtUp: state === 'ready' ? true : state === 'failed' ? false : null,
    forestIntegrity: state === 'ready' ? 'ok' : state === 'failed' ? 'error' : state === 'inactive' ? 'inactive' : 'pending',
    forestErrorCode: state === 'failed' ? stage.code : state === 'pending' ? 'forest_verification_pending' : null,
    forestVerification: state === 'ready' ? 'startup_snapshot' : state,
    excludedFakeUtteranceCount: null,
  };
}

export function createHub({ env = process.env, dbPath, forestPath, forestTraversalPath, spinePath, worldPath, resultPath, binderWindowSnapshotPath, activateForest, progressiveStartup = false, forest: forestOverride, spine: spineOverride, world: worldOverride, provider: providerOverride, recipeRunner: recipeRunnerOverride, ambientFeatherService: ambientFeatherServiceOverride, forestTraversalService: forestTraversalServiceOverride, forestVerifier: forestVerifierOverride, readiness: readinessOverride } = {}) {
  const config = resolveHubConfig(env, { dbPath, forestPath, forestTraversalPath, spinePath, worldPath, resultPath, binderWindowSnapshotPath, activateForest, progressiveStartup });
  const progressiveMode = Boolean(config.progressiveStartup && config.forestActive);
  const readiness = readinessOverride || new ReadinessProjection();
  readiness.begin('shell');
  readiness.begin('conversation');
  readiness.beginTiming('composition');
  if (config.forestActive) readiness.begin('forest', { code: 'forest_verification_pending' });
  else readiness.settle('forest', 'inactive', { code: 'forest_not_configured' });
  if (config.forestActive && config.mode === 'fake') throw { code: 'forest_activation_refused', message: 'Forest activation requires a live DeepSeek provider.' };
  if (config.forestActive && (!existsSync(config.dbPath) || (!progressiveMode && !existsSync(config.forestPath)))) throw { code: 'forest_activation_refused', message: 'Forest activation requires an existing operational database and validated Forest database.' };
  const db = new HubDatabase(config.dbPath, { busyTimeoutMs: config.sqliteBusyTimeoutMs });
  const provider = createProvider(config, providerOverride);
  let forest = null; let forestVerification = null; let spine = null; let world = null; let results = null; let semanticIndex = null; let forestTraversalStore = null;
  let ambientFeatherService = progressiveMode ? null : (ambientFeatherServiceOverride || null);
  let forestTraversalService = progressiveMode ? null : (forestTraversalServiceOverride || null);
  let worldVerified = false;
  let progressiveForestOpenFailure = false;
  try {
    if (config.forestActive && !forestOverride) {
      try {
        // Opening the writable Forest first installs startup-safe additive
        // companion schemas (such as Journal) before strict verification.
        // No historical entries are fabricated by this step.
        forest = new ForestStore(config.forestPath, { mode: 'requireExisting' });
        if (!progressiveMode) forestVerification = verifyForest({ forestPath: config.forestPath, operationalPath: config.dbPath, spinePath: spineLedgerExists(config.spinePath) ? config.spinePath : undefined, worldPath: existsSync(config.worldPath) ? config.worldPath : undefined });
      } catch (error) {
        forest?.close();
        forest = null;
        if (!progressiveMode) throw { code: 'forest_activation_refused', message: error?.message || 'Forest verification failed.' };
        progressiveForestOpenFailure = true;
      }
      if (!progressiveMode) {
        semanticIndex = new SemanticIndexStore(config.semanticIndexPath);
        ambientFeatherService = new AmbientFeatherService({ forest, index: semanticIndex, embeddingProvider: new LocalEmbeddingProvider({ model: config.embeddingModel, cacheDir: config.embeddingCachePath }) });
      }
    } else {
      forest = forestOverride || null;
      if (config.forestActive && forestOverride) {
        if (!progressiveMode) {
          try {
            forestVerification = verifyForest({ forestPath: config.forestPath, operationalPath: config.dbPath, spinePath: spineLedgerExists(config.spinePath) ? config.spinePath : undefined, worldPath: existsSync(config.worldPath) ? config.worldPath : undefined });
          } catch (error) {
            throw { code: 'forest_activation_refused', message: error?.message || 'Forest verification failed.' };
          }
        }
      }
    }
    if (!progressiveMode && forest && ambientFeatherService && !forestTraversalService) {
      forestTraversalStore = new ForestTraversalStore(config.forestTraversalPath);
      forestTraversalService = new ForestTraversalService({ store: forestTraversalStore, forest, ambientFeatherService });
    }
    spine = spineOverride || new SpineStore(config.spinePath, { sessionId: config.spineSessionScoped ? db.session.id : null });
    world = worldOverride || new WorldGraphStore(config.worldPath, { topologyVersion: 'spotlight' });
    worldVerified = world.verification({ mismatchLimit: 50, requireHearth: true, requireForest: true, requireBinderWindow: true, requireSpotlight: true }).verified;
    if (worldVerified) establishInstalledRoomReceipts(world);
    results = new ResultRackStore(config.resultPath, { projectionMaxBytes: config.resultProjectionMaxBytes, projectionMaxLines: config.resultProjectionMaxLines });
    if (worldVerified) {
      world.ensureLifespan(db.session.id);
      if (db.sessionHasOrientation()) world.setHearthSettlement?.(db.session.id, { settled: true });
    }
  } catch (error) {
    forestTraversalStore?.close(); semanticIndex?.close(); forest?.close(); spine?.close(); world?.close(); results?.close(); db.close();
    if (error?.code === 'wake_ritual_invalid' || error?.code === 'forest_activation_refused' || error?.code === 'room_installation_upgrade_required' || error?.code === 'room_installation_witness_drift' || error?.code === 'room_installation_receipt_invalid') throw error;
    throw { code: 'hub_startup_failed', message: `Hub startup failed: ${error?.message || 'unknown store initialization error'}` };
  }
  let workshop = null; let sandboxBay = null; let recipeRunner = recipeRunnerOverride || null; let gateway = null;
  try {
    const binderWindow = loadBinderWindowSnapshot(config.binderWindowSnapshotPath);
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
    gateway = new WorldActionGateway({ world, workshop, forest: progressiveMode ? null : forest, resultRack: results, recipeRunner, binderWindow, approvalMode: config.approvalMode, recipeTimeoutMs: config.recipeTimeoutMs, readHearth: sessionId => db.getSessionHearthPacket(sessionId) });
    if (world.verification({ mismatchLimit: 50, requireHearth: true, requireForest: true, requireBinderWindow: true, requireSpotlight: true }).verified) gateway.reconcileStartup(db.session.id);
  } catch (error) {
    forestTraversalStore?.close(); semanticIndex?.close(); forest?.close(); spine?.close(); world?.close(); results?.close(); db.close();
    throw error;
  }
  const eventBus = new HubEventBus(db);
  const wakeService = new WakeService({ config, db, provider, forest: progressiveMode ? null : forest, spine, world, gateway, eventBus, ambientFeatherService, forestTraversalService });
  const wake = (content, options) => wakeService.wake(content, options);
  if (config.forestActive && !progressiveMode) readiness.settle('forest', 'ready', { code: 'forest_verified' });
  if (worldVerified) readiness.settle('conversation', 'ready', { code: 'conversation_ready' });
  else readiness.settle('conversation', 'failed', { code: 'conversation_verification_failed' });
  readiness.settleTiming('composition');
  let closing = false;
  let closePromise = null;
  const eventStreams = new Set();
  async function handler(request, response) {
    const url = new URL(request.url, 'http://localhost');
    try {
      if (closing) return typedError(response, 503, 'hub_closing', 'The Hub is shutting down and is not accepting new requests.');
      if (request.method === 'GET' && url.pathname === '/api/health') {
        const readinessProjection = readiness.projection();
        const forestReady = readinessProjection.forest.state === 'ready' && Boolean(forest);
        const custody = forestReady
          ? projectForestHealth({ forest, source: db, paths: config, verifiedSnapshot: forestVerification, fullVerification: url.searchParams.get('verify') === 'full' })
          : boundedForestReadinessHealth(config.forestActive, readinessProjection.forest);
        const projection = world.projection(db.session.id);
        const forestTools = forestReady ? forestTraversalService?.tools(db.session.id, projection.roomId) || [] : [];
        const forestToolNames = forestTools.map(tool => tool.function.name);
        const forestWalk = forestReady ? forestTraversalService?.projection(db.session.id) || { active: false } : { active: false };
        const worldProfile = residentToolProfile(world, db.session.id);
        const fittedProfile = forestWalk.active
          ? { roomId: projection.roomId, activeGroup: 'forest_walk', names: forestToolNames, completeCount: forestToolNames.length, omittedCount: 0 }
          : { ...worldProfile, names: [...worldProfile.names, ...forestToolNames], completeCount: worldProfile.completeCount + forestToolNames.length };
        const mountedTools = forestWalk.active
          ? forestToolNames
          : [...schemasForSession(world, db.session.id).map(tool => tool.function.name), ...forestToolNames];
        return json(response, 200, {
          ok: readinessProjection.shell.state === 'ready' && readinessProjection.conversation.state === 'ready' && (!config.forestActive || (readinessProjection.forest.state === 'ready' && custody.forestIntegrity === 'ok' && custody.forestCaughtUp)), schemaReady: readinessProjection.conversation.state === 'ready',
          readiness: readinessProjection,
          residentMode: config.mode, provider: config.mode === 'fake' ? 'fake' : 'deepseek',
          model: config.model, liveCredentialsAvailable: Boolean(config.apiKey), currentRoom: { ...projection, forestThreshold: forestTraversalService?.thresholdMessage(db.session.id, projection.roomId) || null }, engagedFixtureId: projection.engagedFixtureId, engagedStationId: projection.engagedFixtureId, heartbeat: projection.heartbeat || null, mountedTools, residentToolProfile: fittedProfile, forestWalk, attention: wakeService.lastAttention, recipeRuntime: config.mode === 'live' ? 'docker_sandbox' : 'direct_host_test_only', recipeState: gateway.recipes.status(), pendingApprovals: world.listApprovals(db.session.id, { pendingOnly: true }).length, ...custody, wakeInProgress: wakeService.wakeInProgress, activeWakeId: wakeService.activeWakeId,
        });
      }
      if (request.method === 'GET' && url.pathname === '/api/thread') {
        const projection = url.searchParams.get('scope') === 'active' ? db.getActiveThreadProjection() : db.getThread();
        return json(response, 200, { ...projection, residentMode: config.mode, model: config.model });
      }
      if (request.method === 'GET' && url.pathname === '/api/session') return json(response, 200, { session: db.getActiveSession(), sessions: db.listSessions(), history: db.getSessionHistory(), world: world.projection(db.session.id), residentMode: config.mode, model: config.model });
      if (request.method === 'GET' && url.pathname === '/api/world') {
        return json(response, 200, projectWorldBuilderInspection(world, db.session.id));
      }
      if (request.method === 'GET' && url.pathname === '/api/approvals') return json(response, 200, { approvals: world.listApprovals(db.session.id) });
      if (request.method === 'GET' && url.pathname === '/api/events/history') {
        const afterSequence = cursor(url.searchParams.get('after'), 'after', 0);
        const limit = cursor(url.searchParams.get('limit'), 'limit', 100);
        if (limit < 1 || limit > 1000) return typedError(response, 400, 'wake_stream_invalid_argument', 'limit must be an integer from 1 to 1000.');
        const events = db.listWakeStreamEvents({ afterSequence, limit });
        const latestSequence = db.getLatestWakeStreamSequence();
        return json(response, 200, {
          events,
          afterSequence,
          nextAfter: events.at(-1)?.sequence ?? afterSequence,
          latestSequence,
          hasMore: Boolean(events.length) && events.at(-1).sequence < latestSequence,
        });
      }
      if (request.method === 'GET' && url.pathname === '/api/events') {
        const queryAfter = url.searchParams.get('after');
        const headerAfter = request.headers['last-event-id'];
        const afterSequence = cursor(queryAfter === null ? headerAfter : queryAfter, queryAfter === null ? 'Last-Event-ID' : 'after', undefined);
        response.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-store, no-cache, must-revalidate',
          connection: 'keep-alive',
          'x-accel-buffering': 'no',
          'x-content-type-options': 'nosniff',
        });
        response.write(': connected\n\n');
        let settled = false;
        let unsubscribe = null;
        const keepalive = setInterval(() => { if (!settled && !response.destroyed) response.write(': keepalive\n\n'); }, 15000);
        keepalive.unref?.();
        const stream = { response, cleanup: null };
        const cleanup = () => {
          if (settled) return;
          settled = true;
          clearInterval(keepalive);
          unsubscribe?.();
          eventStreams.delete(stream);
        };
        stream.cleanup = cleanup;
        eventStreams.add(stream);
        response.on('close', cleanup);
        request.on('close', cleanup);
        request.on('aborted', cleanup);
        unsubscribe = eventBus.subscribe(event => {
          if (!settled && !response.destroyed) response.write(sseFrame(event));
        }, afterSequence === undefined ? {} : { afterSequence });
        return;
      }
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
        const spineFrames = spine
          ? (wakeRecord.sessionId === db.session.id ? spine.frames() : readSpineLedgerFrames(config.spinePath))
          : [];
        const wiring = spineFrames.filter(frame => frame.wake_id === wakeRecord.id || wakeRecord.phases.some(phase => phase.spineRecordId === frame.request_record_id || phase.spineRecordId === frame.record_id));
        return json(response, 200, { ...wakeRecord, wiring: { spineFrames: wiring, hearthMachineReceipt: wakeRecord.hearth?.returnJson || null, returnScrubReceipts: wakeRecord.phases.map(phase => phase.returnScrubReceipt).filter(Boolean) }, residentMode: config.mode });
      }
      if (request.method === 'GET' && /^\/api\/wakes\/[^/]+\/slips$/.test(url.pathname)) {
        const wakeId = url.pathname.split('/')[3];
        const wakeRecord = db.getWakeSlipSource(wakeId);
        if (!wakeRecord) return typedError(response, 404, 'wake_not_found', 'Wake not found.');
        return json(response, 200, projectWakeSlips({ wake: wakeRecord, world, pendingApprovals: world.listApprovals(wakeRecord.sessionId, { pendingOnly: true }) }));
      }
      if (request.method === 'POST' && url.pathname === '/api/wakes') {
        let incoming; try { incoming = await body(request, config.maxBodyBytes); } catch (error) { return typedError(response, 400, error.code, error.message); }
        if (!Object.hasOwn(incoming, 'content')) return typedError(response, 400, 'invalid_message', 'Message must contain text.');
        const completionProjection = url.searchParams.get('projection') === 'compact' ? 'compact' : 'full';
        const record = await wake(incoming.content, { completionProjection });
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
  readiness.beginTiming('loopbackBinding');
  server.once('listening', () => {
    readiness.settle('shell', 'ready', { code: 'shell_bound' });
    readiness.settleTiming('loopbackBinding');
  });
  let forestVerificationAbortController = null;
  let forestVerificationPromise = null;
  let forestActivationPromise = null;
  let startupGeneration = 1;
  let forestSourceSnapshot = null;
  let forestDataVersionSnapshot = null;
  const forestVerificationOptions = {
    forestPath: config.forestPath,
    operationalPath: config.dbPath,
    spinePath: spineLedgerExists(config.spinePath) ? config.spinePath : undefined,
    worldPath: existsSync(config.worldPath) ? config.worldPath : undefined,
  };
  const closeProgressiveForest = () => {
    gateway.forest = null;
    wakeService.forest = null;
    wakeService.ambientFeatherService = null;
    wakeService.forestTraversalService = null;
    try { forestTraversalStore?.close(); } catch {}
    try { semanticIndex?.close(); } catch {}
    try { forest?.close(); } catch {}
    forestTraversalStore = null;
    semanticIndex = null;
    forest = null;
    forestVerification = null;
    ambientFeatherService = null;
    forestTraversalService = null;
  };
  const activateProgressiveForest = async (verification, generation) => {
    if (closing || generation !== startupGeneration || !forest || readiness.is('forest', 'ready')) return;
    // A wake that began while Forest was pending must complete without Forest
    // before the process-local capability transition can take place.
    const wakeWasActive = Boolean(wakeService.activeWakePromise);
    if (wakeService.activeWakePromise) {
      try { await wakeService.activeWakePromise; } catch {}
    }
    if (closing || generation !== startupGeneration || !forest || readiness.is('forest', 'ready')) return;
    const currentSourceSnapshot = JSON.stringify(db.listEligibleUtteranceEvents().map(event => [event.id, event.content, event.createdAt, event.actorKind, event.threadId, event.wakeId || null]));
    const currentForestDataVersion = typeof forest.dataVersion === 'function' ? forest.dataVersion() : null;
    if (wakeWasActive || currentSourceSnapshot !== forestSourceSnapshot || currentForestDataVersion !== forestDataVersionSnapshot) {
      // The worker proof belongs to an earlier Source view. A pending wake is
      // deliberately not retroactively admitted to Forest in v1, so this
      // generation remains unavailable instead of blessing stale custody.
      closeProgressiveForest();
      readiness.settle('forest', 'failed', { code: 'forest_verification_stale' });
      return;
    }
    if (!verification?.ok) {
      closeProgressiveForest();
      readiness.settle('forest', 'failed', { code: 'forest_verification_failed' });
      return;
    }
    const candidate = forest;
    let nextIndex = null;
    let nextAmbient = ambientFeatherServiceOverride || null;
    let nextTraversalStore = null;
    let nextTraversal = forestTraversalServiceOverride || null;
    try {
      if (!nextAmbient) {
        nextIndex = new SemanticIndexStore(config.semanticIndexPath);
        nextAmbient = new AmbientFeatherService({ forest: candidate, index: nextIndex, embeddingProvider: new LocalEmbeddingProvider({ model: config.embeddingModel, cacheDir: config.embeddingCachePath }) });
      }
      if (nextAmbient && !nextTraversal) {
        nextTraversalStore = new ForestTraversalStore(config.forestTraversalPath);
        nextTraversal = new ForestTraversalService({ store: nextTraversalStore, forest: candidate, ambientFeatherService: nextAmbient });
      }
      if (closing || generation !== startupGeneration || candidate !== forest) {
        nextTraversalStore?.close(); nextIndex?.close();
        return;
      }
      // This block is the one capability transition: every Forest-dependent
      // owner receives the exact verified store before readiness is settled.
      semanticIndex = nextIndex;
      ambientFeatherService = nextAmbient;
      forestTraversalStore = nextTraversalStore;
      forestTraversalService = nextTraversal;
      forestVerification = verification;
      wakeService.forest = candidate;
      wakeService.forestDataVersion = typeof candidate.dataVersion === 'function' ? candidate.dataVersion() : null;
      wakeService.ambientFeatherService = nextAmbient;
      wakeService.forestTraversalService = nextTraversal;
      gateway.forest = candidate;
      readiness.settle('forest', 'ready', { code: 'forest_verified' });
    } catch {
      nextTraversalStore?.close(); nextIndex?.close();
      closeProgressiveForest();
      readiness.settle('forest', 'failed', { code: 'forest_activation_failed' });
    }
  };
  const startProgressiveForestVerification = () => {
    if (!progressiveMode) return;
    if (!forest) {
      if (!readiness.is('forest', 'failed')) readiness.settle('forest', 'failed', { code: progressiveForestOpenFailure ? 'forest_open_failed' : 'forest_unavailable' });
      return;
    }
    forestVerificationAbortController = new AbortController();
    const generation = startupGeneration;
    forestSourceSnapshot = JSON.stringify(db.listEligibleUtteranceEvents().map(event => [event.id, event.content, event.createdAt, event.actorKind, event.threadId, event.wakeId || null]));
    forestDataVersionSnapshot = typeof forest.dataVersion === 'function' ? forest.dataVersion() : null;
    const verifier = forestVerifierOverride || verifyForestAsync;
    try {
      forestVerificationPromise = Promise.resolve(verifier(forestVerificationOptions, { signal: forestVerificationAbortController.signal }))
        .then(verification => activateProgressiveForest(verification, generation))
        .catch(() => {
          if (closing || generation !== startupGeneration) return;
          void activateProgressiveForest(null, generation);
        });
      forestActivationPromise = forestVerificationPromise;
    } catch {
      forestVerificationPromise = Promise.resolve().then(() => {
        if (!closing && generation === startupGeneration) {
          return activateProgressiveForest(null, generation);
        }
      });
      forestActivationPromise = forestVerificationPromise;
    }
  };
  if (progressiveMode) startProgressiveForestVerification();
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
    startupGeneration += 1;
    forestVerificationAbortController?.abort();
    const failures = [];
    for (const stream of [...eventStreams]) {
      try { stream.cleanup(); stream.response.end(); } catch (error) { failures.push(error); }
    }
    const intakeClosing = stopIntake();
    const wakeClosing = wakeService.beginClose();
    let gatewayClosing;
    try { gatewayClosing = gateway.close('hub_close'); }
    catch (error) { failures.push(error); }
    const progressiveClosing = progressiveMode ? (forestActivationPromise || forestVerificationPromise) : null;
    const operations = [intakeClosing, wakeClosing, gatewayClosing, progressiveClosing]
      .filter(operation => operation && typeof operation.then === 'function');
    const closeStores = () => {
      try { eventBus.close(); } catch (error) { failures.push(error); }
      try { forestTraversalStore?.close(); } catch (error) { failures.push(error); }
      try { semanticIndex?.close(); } catch (error) { failures.push(error); }
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
  return {
    config, db, provider, spine, world, results, sandboxBay, workshop, gateway, eventBus, wakeService, server, wake, close,
    readiness,
    get forest() { return progressiveMode && !readiness.is('forest', 'ready') ? null : forest; },
    get forestTraversal() { return progressiveMode && !readiness.is('forest', 'ready') ? null : forestTraversalService; },
    get forestVerification() { return progressiveMode && !readiness.is('forest', 'ready') ? null : forestVerification; },
    get forestVerificationPromise() { return forestVerificationPromise; },
  };
}
