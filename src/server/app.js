import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HubDatabase } from '../ledger/source.js';
import { readConfig } from '../core/config.js';
import { createProvider } from '../providers/index.js';
import { ForestStore } from '../forest/store.js';
import { verifyForest } from '../forest/verify.js';
import { SpineStore } from '../spine/store.js';
import { WorldGraphStore } from '../world/graph.js';
import { WorkshopAdapter } from '../world/workshop.js';
import { WorldActionGateway } from '../world/gateway.js';
import { ceilingCatalog } from '../world/ceiling.js';
import { residentToolProfile, schemasForSession } from '../world/tools.js';
import { projectWakeSlips } from '../corner/slips.js';
import { ResultRackStore } from '../world/results.js';
import { DockerCliSandboxBackend, SandboxBay } from '../world/sandbox.js';
import { SandboxRecipeRunner } from '../world/sandbox-recipes.js';
import { WakeService } from '../runtime/wake-service.js';
import { HubEventBus } from '../runtime/hub-event-bus.js';

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
      verifyForest({ forestPath: config.forestPath, operationalPath: config.dbPath, spinePath: existsSync(config.spinePath) ? config.spinePath : undefined, worldPath: existsSync(config.worldPath) ? config.worldPath : undefined });
      forest = new ForestStore(config.forestPath, { mode: 'requireExisting' });
    } else forest = forestOverride || null;
    spine = spineOverride || new SpineStore(config.spinePath);
    world = worldOverride || new WorldGraphStore(config.worldPath);
    results = new ResultRackStore(config.resultPath, { projectionMaxBytes: config.resultProjectionMaxBytes, projectionMaxLines: config.resultProjectionMaxLines });
    if (world.verification({ mismatchLimit: 50 }).verified) world.ensureLifespan(db.session.id);
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
    if (world.verification({ mismatchLimit: 50 }).verified) gateway.reconcileStartup(db.session.id);
  } catch (error) {
    forest?.close(); spine?.close(); world?.close(); results?.close(); db.close();
    throw error;
  }
  const eventBus = new HubEventBus(db);
  const wakeService = new WakeService({ config, db, provider, forest, spine, world, gateway, eventBus });
  const wake = content => wakeService.wake(content);
  let closing = false;
  let closePromise = null;
  const eventStreams = new Set();
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
          model: config.model, liveCredentialsAvailable: Boolean(config.apiKey), currentRoom: projection, engagedFixtureId: projection.engagedFixtureId, engagedStationId: projection.engagedFixtureId, heartbeat: projection.heartbeat || null, mountedTools: world.availableTools(db.session.id), residentToolProfile: residentToolProfile(world, db.session.id), attention: wakeService.lastAttention, recipeRuntime: config.mode === 'live' ? 'docker_sandbox' : 'direct_host_test_only', recipeState: gateway.recipes.status(), pendingApprovals: world.listApprovals(db.session.id, { pendingOnly: true }).length, ...custody, wakeInProgress: wakeService.wakeInProgress, activeWakeId: wakeService.activeWakeId,
        });
      }
      if (request.method === 'GET' && url.pathname === '/api/thread') return json(response, 200, { ...db.getThread(), residentMode: config.mode, model: config.model });
      if (request.method === 'GET' && url.pathname === '/api/session') return json(response, 200, { session: db.getActiveSession(), sessions: db.listSessions(), history: db.getSessionHistory(), world: world.projection(db.session.id), residentMode: config.mode, model: config.model });
      if (request.method === 'GET' && url.pathname === '/api/world') {
        const verification = world.verification({ mismatchLimit: 50 });
        const collectionLimit = 100; const sampleLimit = collectionLimit + 1; const cellCharacterLimit = 2048;
        const safeCollection = (table, sql, parameters = []) => {
          if (!world.sqlite.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=?").get(table)) return { rows: [], total: 0, totalAtLeast: 0, returned: 0, truncated: false, available: false };
          try {
            const sampled = world.sqlite.prepare(sql).all(...parameters, sampleLimit); const truncated = sampled.length > collectionLimit; const rows = sampled.slice(0, collectionLimit);
            return { rows, total: truncated ? null : rows.length, totalAtLeast: sampled.length, returned: rows.length, truncated, available: true };
          } catch { return { rows: [], total: 0, totalAtLeast: 0, returned: 0, truncated: false, available: false }; }
        };
        const cap = column => `substr(${column},1,${cellCharacterLimit + 1}) AS ${column}`;
        const nodes = safeCollection('world_nodes', verification.verified
          ? 'SELECT * FROM world_nodes ORDER BY id LIMIT ?'
          : `SELECT ${['id', 'node_type', 'resident_text', 'state_json', 'lifecycle'].map(cap).join(',')},revision,${cap('created_at')},last_event_sequence,${cap('last_event_hash')} FROM world_nodes ORDER BY id LIMIT ?`);
        const edges = safeCollection('world_edges', verification.verified
          ? 'SELECT * FROM world_edges ORDER BY id LIMIT ?'
          : `SELECT ${['id', 'edge_type', 'from_node_id', 'to_node_id', 'door_identity', 'label', 'created_at'].map(cap).join(',')},last_event_sequence,${cap('last_event_hash')} FROM world_edges ORDER BY id LIMIT ?`);
        const approvalRows = safeCollection('world_approvals',
          `SELECT ${['approval_id', 'session_id', 'wake_id', 'kind', 'status', 'payload_json', 'preview_json', 'application_json', 'outcome_json', 'created_at', 'decided_at'].map(cap).join(',')},revision,last_event_sequence,${cap('last_event_hash')} FROM world_approvals WHERE session_id=? ORDER BY created_at,approval_id LIMIT ?`, [db.session.id]);
        const diagnosticText = value => value === null ? null : { value: value.slice(0, cellCharacterLimit), truncated: value.length > cellCharacterLimit, charactersObserved: value.length };
        const diagnosticRow = row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, typeof value === 'string' ? diagnosticText(value) : value]));
        if (!verification.verified) {
          nodes.rows = nodes.rows.map(diagnosticRow); edges.rows = edges.rows.map(diagnosticRow); approvalRows.rows = approvalRows.rows.map(diagnosticRow);
        }
        const approvals = approvalRows.rows.map(row => {
          if (!verification.verified) return row;
          const boundedString = value => typeof value === 'string' && value.length > cellCharacterLimit ? diagnosticText(value) : value;
          const parsedField = value => {
            if (value === null) return null;
            if (value.length > cellCharacterLimit) return { bounded: true, truncated: true, charactersAtLeast: value.length, prefix: value.slice(0, cellCharacterLimit) };
            return JSON.parse(value);
          };
          try {
            return {
              approvalId: boundedString(row.approval_id), sessionId: boundedString(row.session_id), wakeId: boundedString(row.wake_id), kind: boundedString(row.kind), status: boundedString(row.status),
              payload: parsedField(row.payload_json), preview: parsedField(row.preview_json), application: parsedField(row.application_json),
              outcome: parsedField(row.outcome_json), createdAt: boundedString(row.created_at), decidedAt: boundedString(row.decided_at),
              revision: row.revision, worldEventSequence: row.last_event_sequence, worldEventHash: boundedString(row.last_event_hash),
            };
          } catch { return { approvalId: row.approval_id ?? null, status: row.status ?? null, malformed: true }; }
        });
        const builder = {
          graph: { nodes: nodes.rows, edges: edges.rows }, verification, ceiling: ceilingCatalog(), approvals,
          collectionBounds: {
            limit: collectionLimit,
            diagnosticCellCharacterLimit: cellCharacterLimit,
            approvalFieldCharacterLimit: cellCharacterLimit,
            nodes: { total: nodes.total, totalAtLeast: nodes.totalAtLeast, returned: nodes.returned, truncated: nodes.truncated, available: nodes.available },
            edges: { total: edges.total, totalAtLeast: edges.totalAtLeast, returned: edges.returned, truncated: edges.truncated, available: edges.available },
            approvals: { total: approvalRows.total, totalAtLeast: approvalRows.totalAtLeast, returned: approvalRows.returned, truncated: approvalRows.truncated, available: approvalRows.available },
          },
        };
        if (!verification.verified) return json(response, 200, { ...builder, location: null, projection: null, tools: [] });
        try { return json(response, 200, { ...builder, location: world.current(db.session.id), projection: world.projection(db.session.id), tools: schemasForSession(world, db.session.id) }); }
        catch (error) { return json(response, 200, { ...builder, location: null, projection: null, tools: [], builderReadError: { code: error?.code || 'world_builder_read_failed', message: error?.message || 'World builder projection is unavailable.' } }); }
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
    for (const stream of [...eventStreams]) {
      try { stream.cleanup(); stream.response.end(); } catch (error) { failures.push(error); }
    }
    const intakeClosing = stopIntake();
    const wakeClosing = wakeService.beginClose();
    let gatewayClosing;
    try { gatewayClosing = gateway.close('hub_close'); }
    catch (error) { failures.push(error); }
    const operations = [intakeClosing, wakeClosing, gatewayClosing]
      .filter(operation => operation && typeof operation.then === 'function');
    const closeStores = () => {
      try { eventBus.close(); } catch (error) { failures.push(error); }
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
  return { config, db, provider, forest, spine, world, results, sandboxBay, workshop, gateway, eventBus, wakeService, server, wake, close };
}
