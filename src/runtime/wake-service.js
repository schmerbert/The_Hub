import { sha256 } from '../core/hash.js';
import { buildGlassWakeInheritance } from '../context/glass-cast.js';
import { scrubHostReturn } from '../scrub/host-return.js';
import { hearthReturnHash, validateOrientationResult } from '../hearth/handshake.js';
import { renderHearthPacket } from '../hearth/packet.js';
import { AttentionMeter } from '../context/attention-meter.js';
import { WakeEventPublication } from './wake-event-publication.js';
import {
  RESULT_REOPEN_TOOL_NAME, parseReopenResultArguments,
} from '../context/result-exhale.js';
import { runSemanticForestShadow, runAmbientFeatherShadow, buildSemanticRoomSignals } from '../context/semantic-exhale.js';
import { FOREST_WALK_TOOL_NAMES } from '../forest/traversal.js';
import { isSimpleEmbodiedAction } from './reasoning-posture.js';
import { ProviderPhase, providerCancellation } from './provider-phase.js';
import { REST_FOR_TOOL_NAME, autonomousToolAllowed } from './autonomous-wakes.js';
import { fitToolContinuationRound, publishToolCallsReady, publishToolStarted, settleToolAction } from './tool-continuation.js';

export class WakeService {
  constructor({ config, db, provider, forest, spine, world, gateway, eventBus = null, ambientFeatherService = null, forestTraversalService = null, forestReadiness = null }) {
    this.config = config;
    this.db = db;
    this.provider = provider;
    this.forest = forest;
    this.ambientFeatherService = ambientFeatherService;
    this.forestTraversalService = forestTraversalService;
    // Progressive startup owns the readiness observation. Wake Service only
    // translates a non-ready observation into a bounded admission refusal;
    // it never inspects the opened-but-unverified Forest itself.
    this.forestReadiness = forestReadiness;
    this.forestDataVersion = typeof forest?.dataVersion === 'function' ? forest.dataVersion() : null;
    this.spine = spine;
    this.world = world;
    this.gateway = gateway;
    this.resultRack = gateway?.resultRack || null;
    this.eventBus = eventBus;
    this.attentionMeter = new AttentionMeter({ warnBytes: config.attentionWarnBytes, refuseBytes: config.attentionRefuseBytes });
    this.wakeInProgress = false;
    this.activeWakeId = null;
    this.activeWakePromise = null;
    this.lastAttention = null;
    this.closing = false;
    this.cardRevisions = new Map();
    this.suppressedDeltaChannels = new Set();
    this.eventPublication = new WakeEventPublication({
      eventBus,
      cardRevisions: this.cardRevisions,
      suppressedDeltaChannels: this.suppressedDeltaChannels,
    });
    this.activeProviderAbortController = null;
    this.autonomousWakeController = null;
    this.providerPhase = new ProviderPhase({
      config,
      db,
      provider,
      spine,
      world,
      gateway,
      resultRack: this.resultRack,
      attentionMeter: this.attentionMeter,
      isClosing: () => this.closing,
      setActiveProviderAbortController: controller => { this.activeProviderAbortController = controller; },
      clearActiveProviderAbortController: controller => {
        if (this.activeProviderAbortController === controller) this.activeProviderAbortController = null;
      },
      setLastAttention: attention => { this.lastAttention = attention; },
      publish: (...args) => this.publish(...args),
      publishDelta: (...args) => this.publishDelta(...args),
      publishCollectedDelta: (...args) => this.publishCollectedDelta(...args),
      clearSuppressedRequest: (...args) => this.clearSuppressedRequest(...args),
    });
  }

  setAutonomousWakeController(controller) { this.autonomousWakeController = controller; }

  publish(kind, { sessionId, wakeId, phase = null, authority = 'host_receipt', committed = true, payload = {}, source = {} }, fallbackPayload = null) {
    return this.eventPublication.publish(kind, { sessionId, wakeId, phase, authority, committed, payload, source }, fallbackPayload);
  }

  publishAfterCommit(kind, detail, fallbackPayload = null) {
    return this.eventPublication.publishAfterCommit(kind, detail, fallbackPayload);
  }

  publishDelta(created, phase, requestId, requestFrame, delta) {
    return this.eventPublication.publishDelta(created, phase, requestId, requestFrame, delta);
  }

  publishCollectedDelta(event) {
    return this.eventPublication.publishCollectedDelta(event);
  }

  clearSuppressedRequest(requestId) {
    return this.eventPublication.clearSuppressedRequest(requestId);
  }

  nextCardRevision(cardId) {
    return this.eventPublication.nextCardRevision(cardId);
  }

  toolCardPayload(toolCallId, toolName, state, extra = {}) {
    return this.eventPublication.toolCardPayload(toolCallId, toolName, state, extra);
  }

  publishCards(created, phase, call, action, hostEventId) {
    return this.eventPublication.publishCards(created, phase, call, action, hostEventId);
  }

  beginClose() {
    this.closing = true;
    if (this.activeProviderAbortController && !this.activeProviderAbortController.signal.aborted) {
      this.activeProviderAbortController.abort(providerCancellation());
    }
    return this.activeWakePromise;
  }

  registerPresentationBoundary(wakeId, requestFrame, requestBodyString, presentation, sourceMessages, sourceRefs = []) {
    return this.providerPhase.registerPresentationBoundary({ forest: this.forest, wakeId, requestFrame, requestBodyString, presentation, sourceMessages, sourceRefs });
  }

  assertForestReadyForWake() {
    if (!this.config.forestActive || typeof this.forestReadiness !== 'function') return;
    const stage = this.forestReadiness();
    if (!stage || stage.state === 'ready' || stage.state === 'inactive') return;
    if (stage.state === 'pending') throw {
      code: 'forest_verification_pending',
      message: 'The Forest is still waking. Send again when continuity is ready.',
    };
    throw {
      code: stage.code || 'forest_unavailable',
      message: 'Continuity is unavailable for this lifespan. No wake was admitted.',
    };
  }

  async wake(content, { completionProjection = 'full', origin = { kind: 'human_present' } } = {}) {
    if (this.closing) throw { code: 'hub_closing', message: 'The Hub is shutting down and is not accepting new wakes.' };
    if (this.wakeInProgress) throw { code: 'wake_in_progress', message: 'Another wake is already in progress.' };
    this.assertForestReadyForWake();
    this.wakeInProgress = true;
    const operation = this.performWake(content, { completionProjection, origin });
    this.activeWakePromise = operation;
    try { return await operation; }
    finally {
      if (this.activeWakePromise === operation) this.activeWakePromise = null;
      this.wakeInProgress = false;
      this.activeWakeId = null;
    }
  }

  async performWake(content, { completionProjection = 'full', origin = { kind: 'human_present' } } = {}) {
    // Keep the domain boundary intact for direct callers as well as HTTP.
    // This second check closes the bypass where a caller invokes the
    // orchestration method without going through wake().
    this.assertForestReadyForWake();
    const { config, db, provider, forest, spine, world, gateway, attentionMeter } = this;
    const autonomous = origin?.kind === 'self_directed' || origin?.kind === 'hearth_origin';
    if (!autonomous && origin?.kind !== 'human_present') throw { code: 'wake_origin_invalid', message: 'Wake origin is not installed.' };
    const submitted = typeof content === 'string' ? content : '';
    const trimmed = submitted.trim();
    if (!autonomous && !trimmed) throw { code: 'invalid_message', message: 'Message must contain text.' };
    if (!autonomous && trimmed.length > config.maxMessageLength) throw { code: 'message_too_large', message: `Message must be ${config.maxMessageLength} characters or fewer.` };
    const glassTraceVerification = db.verifyGlassTrace({ mismatchLimit: 10 });
    if (!glassTraceVerification.verified) throw { code: 'glass_trace_drift', message: `Glass trace verification found a dangling or altered closure-era path: ${glassTraceVerification.mismatches.map(item => item.code).join(', ')}.` };
    const rootsVerification = db.verifyRoots({ mismatchLimit: 10 });
    if (!rootsVerification.verified) throw { code: 'roots_drift', message: `Roots verification found altered or dangling causal evidence: ${rootsVerification.mismatches.map(item => item.code).join(', ')}.` };
    const providerName = config.mode === 'fake' ? 'fake' : 'deepseek';
    const firstTurn = !db.sessionHasOrientation();
    const priorEligible = db.listEligibleUtteranceEvents().at(-1)?.id || null;
    const created = autonomous
      ? origin.kind === 'hearth_origin'
        ? db.createHearthOriginWake({ provider: providerName, model: config.model, timing: origin.timing })
        : db.createAutonomousSessionWake({ provider: providerName, model: config.model, plan: origin.plan, timing: origin.timing })
      : db.createSessionWake({ provider: providerName, model: config.model, content: submitted });
    const triggerEvent = db.getEvent(created.eventId);
    if (!firstTurn) world.ageHearthSettlement?.(created.sessionId);
    this.activeWakeId = created.wakeId;
    this.publish('wake.accepted', {
      sessionId: created.sessionId,
      wakeId: created.wakeId,
      payload: { status: 'assembling', provider: providerName, requestedModel: config.model, origin: autonomous ? origin.kind : 'human_present' },
      source: autonomous ? { triggerEventId: created.eventId } : { userEventId: created.eventId },
    });
    let semanticExhale = null;
    if (forest && !autonomous) {
      try { forest.ingestEvent(db.getEvent(created.eventId), { spineStatus: 'live', predecessorSourceEventId: priorEligible }); }
      catch (error) {
        const failure = { code: 'forest_intake_failed', message: error?.message || 'The Forest could not accept the source event.' };
        const failureEventId = db.failSessionWake(created.wakeId, failure);
        this.publish('wake.failed', {
          sessionId: created.sessionId, wakeId: created.wakeId,
          payload: failure, source: { failureEventId },
        });
        return completionProjection === 'compact' ? db.getWakeCompletion(created.wakeId) : db.getWake(created.wakeId);
      }
    }
    if (forest && !autonomous) {
      // Startup performs the expensive custody proof once. Request-time checks
      // bind that verified head to this connection and the exact admitted tail.
      const intake = typeof forest.intakeStatus === 'function' ? forest.intakeStatus() : { held: 0, unresolved: 0 };
      const externalDrift = this.forestDataVersion !== null && forest.dataVersion() !== this.forestDataVersion;
      const forestReady = !externalDrift && intake.held === 0 && intake.unresolved === 0 && forest.count() === db.listEligibleUtteranceEvents().length;
      if (!forestReady) {
        const failure = { code: 'forest_semantic_shadow_unavailable', message: 'The Forest is not verified and caught up for the Semantic Forest shadow crossing.' };
        const failureEventId = db.failSessionWake(created.wakeId, failure);
        this.publish('wake.failed', { sessionId: created.sessionId, wakeId: created.wakeId, payload: failure, source: { failureEventId } });
        return completionProjection === 'compact' ? db.getWakeCompletion(created.wakeId) : db.getWake(created.wakeId);
      }
      {
        const location = world.current(created.sessionId);
        const roomSignals = buildSemanticRoomSignals({
          roomId: location.room_node_id,
          roomType: world.node(location.room_node_id)?.node_type || null,
          engagedFixtureId: location.engaged_fixture_id || null,
        });
        const activeHistory = db.getSessionHistory(created.sessionId);
        const activeSourceEventIds = activeHistory.map(row => row.sourceEventId).filter(Boolean);
        const activeContextTexts = activeHistory
          .filter(row => row.sourceEventId !== triggerEvent.id)
          .map(row => {
            try { return JSON.parse(row.messageJson)?.content; } catch { return null; }
          })
          .filter(content => typeof content === 'string' && content.trim())
          .slice(-8);
        const forestWalk = this.forestTraversalService?.projection(created.sessionId) || null;
        const featherExcludeEntryIds = forestWalk?.active ? this.forestTraversalService.featherExclusions(created.sessionId) : [];
        const shadow = this.ambientFeatherService ? await runAmbientFeatherShadow({
          service: this.ambientFeatherService,
          utterance: triggerEvent.content,
          trigger: {
            sessionId: created.sessionId,
            wakeId: created.wakeId,
            sourceEventId: triggerEvent.id,
            sourceEventHash: sha256(triggerEvent.content),
            contentHash: sha256(triggerEvent.content),
            threadId: triggerEvent.threadId,
            turnOrdinal: created.turnOrdinal,
            sourceTimestamp: triggerEvent.createdAt,
          },
          activeSourceEventIds,
          activeContextTexts,
          excludeEntryIds: featherExcludeEntryIds,
          forestWalk,
          roomSignals,
          firstTurn,
        }) : runSemanticForestShadow({ forest, utterance: triggerEvent.content, trigger: {
          sessionId: created.sessionId, wakeId: created.wakeId, sourceEventId: triggerEvent.id,
          sourceEventHash: sha256(triggerEvent.content), contentHash: sha256(triggerEvent.content),
          threadId: triggerEvent.threadId, turnOrdinal: created.turnOrdinal, sourceTimestamp: triggerEvent.createdAt,
        }, activeSourceEventIds, roomSignals });
        if (!shadow.bypassed) {
          semanticExhale = shadow.packet?.atoms?.length ? shadow.packet : null;
          try {
            const rootedShadow = db.roots.recordSemanticShadowDecision({
              sessionId: created.sessionId,
              wakeId: created.wakeId,
              trigger: shadow.decision.trigger,
              policyVersion: shadow.decision.policyVersion,
              selectorVersion: shadow.decision.selectorVersion,
              decision: shadow.decision,
              roomSignals,
            });
            if (forestWalk?.active && semanticExhale) this.forestTraversalService.landFeathers({
              sessionId:created.sessionId, wakeId:created.wakeId, generationId:this.ambientFeatherService.generationId,
              rootsArtifactId:rootedShadow.artifactId, packet:semanticExhale,
            });
          } catch (error) {
            const failure = { code: 'roots_semantic_shadow_failed', message: error?.message || 'Roots could not retain the Semantic Forest shadow decision.' };
            const failureEventId = db.failSessionWake(created.wakeId, failure);
            this.publish('wake.failed', { sessionId: created.sessionId, wakeId: created.wakeId, payload: failure, source: { failureEventId } });
            return completionProjection === 'compact' ? db.getWakeCompletion(created.wakeId) : db.getWake(created.wakeId);
          }
        }
      }
    }
    db.markCalling(created.wakeId);
    let wakeInheritance = null;
    let silverBulletHolster = firstTurn ? null : db.getSessionSilverBulletHolster(created.sessionId);
    const departedFeathers = firstTurn ? [] : db.roots.recentSemanticExhaleDepartures({ sessionId: created.sessionId, beforeTurnOrdinal: created.turnOrdinal, retainTurns: 2 });
    const callPhase = async (phase, historyRows, options = {}) => this.providerPhase.run({
      phase,
      historyRows,
      options,
      created,
      providerName,
      forest,
      forestTraversalService: this.forestTraversalService,
      wakeInheritance,
      silverBulletHolster,
      semanticExhale,
      departedFeathers,
    });
    const reopenResult = (call, { requestRecordId = null, spineRecordId = null } = {}) => {
      let args;
      try { args = parseReopenResultArguments(call?.function?.arguments || ''); }
      catch (error) {
        const result = { ok: false, kind: 'result_reopen', status: 'refused', error: error?.code || 'result_reopen_invalid_arguments', message: error?.message || 'Result reopening arguments were refused.' };
        const scrub = scrubHostReturn({ toolName: RESULT_REOPEN_TOOL_NAME, toolCallId: call?.id || null, arguments: {}, result, roomId: world.current(created.sessionId).room_node_id, requestRecordId, spineRecordId });
        return { name: RESULT_REOPEN_TOOL_NAME, result, scrub, resultRack: null, actionReceipt: null, wild: [] };
      }
      if (!this.resultRack) {
        const result = { ok: false, kind: 'result_reopen', status: 'refused', error: 'result_reopen_unavailable', message: 'Result reopening is unavailable because Result Rack custody is not installed.' };
        const scrub = scrubHostReturn({ toolName: RESULT_REOPEN_TOOL_NAME, toolCallId: call?.id || null, arguments: args, result, roomId: world.current(created.sessionId).room_node_id, requestRecordId, spineRecordId });
        return { name: RESULT_REOPEN_TOOL_NAME, result, scrub, resultRack: null, actionReceipt: null, wild: [] };
      }
      try {
        const projection = this.resultRack.reopenProjection(args.exactPointer, { sessionId: created.sessionId });
        const result = {
          ok: true, kind: 'result_reopen', status: 'reopened', exactPointer: projection.exactPointer,
          projection: {
            projectionId: projection.projectionId, content: projection.content, contentHash: projection.contentHash,
            sourceHash: projection.sourceHash, byteLength: projection.byteLength, lineCount: projection.lineCount,
            truncated: projection.truncated, omittedBytes: projection.omittedBytes, omittedLines: projection.omittedLines,
            sourceManifest: projection.sourceManifest,
          },
          custody: { exact: true, rawBody: false, generatedSummary: false, actionAuthority: false, forestExhaleEligible: false },
        };
        const scrub = scrubHostReturn({ toolName: RESULT_REOPEN_TOOL_NAME, toolCallId: call?.id || null, arguments: args, result,
          content: projection.content, renderPolicy: 'result_rack_projection_v1', projection: {
            projectionId: projection.projectionId, content: projection.content, contentHash: projection.contentHash,
            sourceHash: projection.sourceHash, exactPointer: projection.exactPointer,
          }, roomId: world.current(created.sessionId).room_node_id, requestRecordId, spineRecordId });
        return { name: RESULT_REOPEN_TOOL_NAME, result, scrub, resultRack: null, actionReceipt: null, wild: [] };
      } catch (error) {
        const result = { ok: false, kind: 'result_reopen', status: 'refused', exactPointer: args.exactPointer, error: error?.code || 'result_reopen_refused', message: error?.message || 'Result reopening was refused.' };
        const scrub = scrubHostReturn({ toolName: RESULT_REOPEN_TOOL_NAME, toolCallId: call?.id || null, arguments: args, result, roomId: world.current(created.sessionId).room_node_id, requestRecordId, spineRecordId });
        return { name: RESULT_REOPEN_TOOL_NAME, result, scrub, resultRack: null, actionReceipt: null, wild: [] };
      }
    };
    const runResidentRounds = async (phase = 'response', options = {}) => {
      let afterSimpleAction = options.afterSimpleAction === true;
      const roundLimit = autonomous ? config.autonomousMaxToolRounds : config.maxToolRounds;
      for (let round = 0; round <= roundLimit; round += 1) {
        const fitted = fitToolContinuationRound({ world, sessionId: created.sessionId, config, forestTraversalService: this.forestTraversalService, autonomous, round, roundLimit });
        const { finalOpportunity, location, roomId, toolProfile, tools, toolRoundBudget } = fitted;
        const response = await callPhase(phase, db.getSessionHistory(created.sessionId), {
          ...options,
          afterSimpleAction,
          tools,
          toolsDisabled: finalOpportunity,
          toolProfile,
          wakeOrigin: autonomous ? origin : null,
          toolRoundBudget,
        });
        const calls = Array.isArray(response.result?.message?.tool_calls) ? response.result.message.tool_calls : [];
        if (!calls.length) {
          if (!response.result || typeof response.result.content !== 'string' || !response.result.content.trim()) throw { code: 'provider_empty_content', message: 'The resident provider returned no content.' };
          return response;
        }
        const toolCallEventId = publishToolCallsReady({
          calls, response, created, phase, db,
          publish: (...args) => this.publish(...args),
          toolCardPayload: (...args) => this.toolCardPayload(...args),
        });
        if (round === roundLimit) {
          const limitError = { code: 'world_tool_round_limit', message: 'The bounded resident tool loop refused a tool action after the configured round limit.' };
          for (const call of calls) {
            const action = gateway.refuse({ sessionId: created.sessionId, wakeId: created.wakeId, requestRecordId: response.requestId, spineRecordId: response.requestFrame?.record_id, intent: call, error: limitError });
            const hostEventId = db.recordToolResult({ wakeId: created.wakeId, sessionId: created.sessionId, toolName: action.name || call.function?.name || 'unknown', result: action.result, hostReturnScrub: action.scrub });
            this.publish('tool.refused', {
              sessionId: created.sessionId, wakeId: created.wakeId, phase,
              payload: this.toolCardPayload(call.id || null, action.name || call.function?.name || 'unknown', 'refused', { error: action.result?.error || limitError.code }),
              source: { hostEventId, actionReceiptId: action.actionReceipt?.receiptId || null, hostReturnReceiptId: action.scrub?.receipt?.receiptId || null },
            });
            this.publishCards(created, phase, call, action, hostEventId);
          }
          throw limitError;
        }
        for (const call of calls) {
          let action;
          publishToolStarted({
            call, response, toolCallEventId, created, phase,
            publish: (...args) => this.publish(...args),
            toolCardPayload: (...args) => this.toolCardPayload(...args),
          });
          try {
            const isForestTool = FOREST_WALK_TOOL_NAMES.has(call.function?.name);
            if (autonomous && !autonomousToolAllowed(call.function?.name, { forestToolNames: [...FOREST_WALK_TOOL_NAMES] })) throw Object.assign(new Error('That consequential capability is not available during an autonomous wake.'), { code: 'autonomous_tool_denied' });
            action = call.function?.name === REST_FOR_TOOL_NAME
              ? this.autonomousWakeController?.executeRestTool({ sessionId: created.sessionId, wakeId: created.wakeId, call }) || (() => { throw Object.assign(new Error('Autonomous rest scheduling is unavailable.'), { code: 'autonomous_wake_unavailable' }); })()
              : call.function?.name === RESULT_REOPEN_TOOL_NAME
              ? reopenResult(call, { requestRecordId: response.requestId, spineRecordId: response.requestFrame?.record_id })
              : isForestTool && this.forestTraversalService
                ? await this.forestTraversalService.execute({ sessionId: created.sessionId, wakeId: created.wakeId, roomId, departureFocusId: location.engaged_fixture_id || null, tetherSourceEventId: autonomous ? priorEligible : created.eventId, queryFallback: autonomous ? origin.plan?.intention || 'wander and notice' : triggerEvent.content, requestRecordId: response.requestId, spineRecordId: response.requestFrame?.record_id, sourceEvent: db.getEvent(toolCallEventId), intent: call })
              : await gateway.execute({ sessionId: created.sessionId, wakeId: created.wakeId, requestRecordId: response.requestId, spineRecordId: response.requestFrame?.record_id, intent: call });
            // Journal custody binds the exact identity return created at the
            // planting boundary. Result Rack may subsequently fit a second,
            // projected return for conversation, so preserve the exact
            // provenance receipt before replacing the presentation scrub.
            if (call.function?.name === 'write_journal' && action.result?.entryId && action.scrub) {
              db.persistHostReturnScrub({ sessionId: created.sessionId, wakeId: created.wakeId, toolName: 'write_journal', hostReturnScrub: action.scrub });
            }
            if ((isForestTool || call.function?.name === REST_FOR_TOOL_NAME) && action && !action.resultRack) {
              const custody = gateway.captureResultSafely({
                sessionId: created.sessionId,
                wakeId: created.wakeId,
                toolName: action.name || call.function?.name || 'unknown',
                result: action.result,
                sourceActionReceiptId: action.actionReceipt?.receiptId || null,
                requestRecordId: response.requestId,
                spineRecordId: response.requestFrame?.record_id,
              });
              if (custody.resultRack) {
                if (call.function?.name === 'write_journal' && action.result?.entryId && this.forest) {
                  this.forest.appendJournalCustody({
                    entryId: action.result.entryId,
                    actionReceiptId: action.actionReceipt?.receiptId || action.result.actionReceiptId,
                    hostReturnReceiptId: action.scrub?.receipt?.receiptId,
                    resultRack: custody.resultRack,
                  });
                }
                let args = {};
                try { args = JSON.parse(call.function?.arguments || '{}'); } catch {}
                action = {
                  ...action,
                  resultRack: custody.resultRack,
                  resultCustodyFailure: null,
                  scrub: scrubHostReturn({
                    toolName: action.name || call.function?.name || 'unknown', toolCallId: call.id || null, arguments: args, result: action.result,
                    content: custody.resultRack.projection.content, renderPolicy: 'result_rack_projection_v1', projection: custody.resultRack.projection,
                    roomId, actionReceiptId: action.actionReceipt?.receiptId || null, requestRecordId: response.requestId, spineRecordId: response.requestFrame?.record_id,
                  }),
                };
              } else action = { ...action, resultCustodyFailure: custody.failure, resultCustodyFailureReceipt: custody.failureReceipt };
            }
          }
          catch (error) { action = gateway.refuse({ sessionId: created.sessionId, wakeId: created.wakeId, requestRecordId: response.requestId, spineRecordId: response.requestFrame?.record_id, intent: call, error }); }
          settleToolAction({
            call, action, created, phase, db,
            publish: (...args) => this.publish(...args),
            publishCards: (...args) => this.publishCards(...args),
            toolCardPayload: (...args) => this.toolCardPayload(...args),
            forestTraversalService: this.forestTraversalService,
          });
        }
        afterSimpleAction = calls.length > 0 && calls.every(call => isSimpleEmbodiedAction(call.function?.name));
      }
      throw { code: 'world_tool_round_limit', message: 'The bounded resident tool loop ended before a final response.' };
    };
    let canonicalCommitted = false;
    try {
      world.assertVerified();
      if (firstTurn) {
        const orientation = await callPhase('orientation', db.getSessionHistory(created.sessionId), { orientation: true });
        const action = validateOrientationResult(orientation.result);
        const actionEventId = db.recordHearthAction({ wakeId: created.wakeId, sessionId: created.sessionId, message: action.message, returnScrub: orientation.returnScrub });
        this.publish('tool_call.ready', {
          sessionId: created.sessionId, wakeId: created.wakeId, phase: 'orientation',
          payload: this.toolCardPayload(action.toolCallId, 'tend_hearth', 'ready', { providerRequestId: orientation.requestId }),
          source: { toolCallEventId: actionEventId, returnScrubReceiptId: orientation.returnScrub.receipt.receiptId },
        });
        this.publish('tool.started', {
          sessionId: created.sessionId, wakeId: created.wakeId, phase: 'orientation',
          payload: this.toolCardPayload(action.toolCallId, 'tend_hearth', 'running', { providerRequestId: orientation.requestId }),
          source: { toolCallEventId: actionEventId, providerRequestId: orientation.requestId },
        });
        const prior = db.priorSessionTail({ sessionId: created.sessionId, ceiling: config.messageCeiling });
        const inheritance = buildGlassWakeInheritance({ prior, forest, budgetBytes: config.hearthScrollBudget, excerptLimitUtf16: config.hearthExcerptLimit, sourceAncestry: { orientationSpineRecordId: orientation.requestFrame?.record_id || null, orientationReturnScrub: orientation.returnScrub.receipt } });
        wakeInheritance = { wakeAnchor: inheritance.receipt.wakeAnchor, atoms: inheritance.atoms, priorHorizon: inheritance.priorHorizon };
        const packet = renderHearthPacket({ atoms: inheritance.atoms, priorHorizon: inheritance.priorHorizon, selection: inheritance.receipt.selection, budgetBytes: config.hearthScrollBudget });
        silverBulletHolster = packet.receipt.silverBulletSlots;
        const hearthScrub = scrubHostReturn({ toolName: 'tend_hearth', toolCallId: action.toolCallId, arguments: {}, result: { markdown: packet.markdown, hearthPacket: packet.receipt }, content: packet.markdown, renderPolicy: 'house_hearth_packet_markdown_v1' });
        const hearthReturnRecord = db.recordHearthReturn({ wakeId: created.wakeId, sessionId: created.sessionId, toolCallId: action.toolCallId, returnValue: packet.receipt, scrollMarkdown: packet.markdown, scrollHash: packet.markdownHash, actionEventId, returnHash: hearthReturnHash(packet.receipt), hostReturnScrub: hearthScrub });
        world.setHearthSettlement?.(created.sessionId, { wakeId: created.wakeId, packetHash: packet.markdownHash });
        this.publish('tool.completed', {
          sessionId: created.sessionId, wakeId: created.wakeId, phase: 'orientation',
          payload: this.toolCardPayload(action.toolCallId, 'tend_hearth', 'completed', { status: 'completed' }),
          source: { hostEventId: hearthReturnRecord.eventId, toolCallEventId: actionEventId, hostReturnReceiptId: hearthScrub.receipt.receiptId },
        });
        const response = await runResidentRounds('response', { inheritance: wakeInheritance, causalHearth: true });
        const residentEventId = db.commitSessionWake(created.wakeId, response.result);
        canonicalCommitted = true;
        this.publishAfterCommit('message.committed', {
          sessionId: created.sessionId, wakeId: created.wakeId, phase: 'response',
          payload: { role: 'assistant', content: response.result.content, resolvedModel: response.result.resolvedModel || config.model },
          source: { residentEventId, providerRequestId: response.requestId, returnScrubReceiptId: response.returnScrub.receipt.receiptId },
        }, { role: 'assistant', content: null, contentOmitted: true });
        if (forest && response.requestFrame) {
          try {
            const entry = forest.ingestEvent(db.getEvent(residentEventId), { spineStatus: 'live', predecessorSourceEventId: autonomous ? priorEligible : created.eventId });
            forest.linkEmission({ entryId: entry.entryId || entry.entry_id, requestRecordId: response.requestFrame.record_id });
          } catch (error) { db.recordHostFailure(created.wakeId, { code: 'forest_intake_failed', message: error?.message || 'The Forest could not accept the resident utterance.' }); }
        }
        this.publishAfterCommit('wake.completed', {
          sessionId: created.sessionId, wakeId: created.wakeId,
          payload: { status: 'committed', residentEventId }, source: { residentEventId },
        });
      } else {
        const ordinary = await runResidentRounds('ordinary');
        if (!ordinary.result || typeof ordinary.result.content !== 'string' || !ordinary.result.content.trim()) throw { code: 'provider_empty_content', message: 'The resident provider returned no content.' };
        const residentEventId = db.commitSessionWake(created.wakeId, ordinary.result);
        canonicalCommitted = true;
        this.publishAfterCommit('message.committed', {
          sessionId: created.sessionId, wakeId: created.wakeId, phase: 'ordinary',
          payload: { role: 'assistant', content: ordinary.result.content, resolvedModel: ordinary.result.resolvedModel || config.model },
          source: { residentEventId, providerRequestId: ordinary.requestId, returnScrubReceiptId: ordinary.returnScrub.receipt.receiptId },
        }, { role: 'assistant', content: null, contentOmitted: true });
        if (forest && ordinary.requestFrame) {
          try {
            const entry = forest.ingestEvent(db.getEvent(residentEventId), { spineStatus: 'live', predecessorSourceEventId: autonomous ? priorEligible : created.eventId });
            forest.linkEmission({ entryId: entry.entryId || entry.entry_id, requestRecordId: ordinary.requestFrame.record_id });
          } catch (error) { db.recordHostFailure(created.wakeId, { code: 'forest_intake_failed', message: error?.message || 'The Forest could not accept the resident utterance.' }); }
        }
        this.publishAfterCommit('wake.completed', {
          sessionId: created.sessionId, wakeId: created.wakeId,
          payload: { status: 'committed', residentEventId }, source: { residentEventId },
        });
      }
    } catch (error) {
      if (!canonicalCommitted) {
        const failure = { code: error?.code || 'provider_error', message: error?.message || 'The resident provider failed.' };
        const failureEventId = db.failSessionWake(created.wakeId, failure);
        this.publish('wake.failed', {
          sessionId: created.sessionId, wakeId: created.wakeId,
          payload: failure, source: { failureEventId },
        });
      }
    }
    return completionProjection === 'compact' ? db.getWakeCompletion(created.wakeId) : db.getWake(created.wakeId);
  }
}
