import { sha256 } from '../core/hash.js';
import { completeProvider, prepareProviderRequest } from '../providers/dispatch.js';
import { planOldToolExchangeOmissions, projectSourceRefs } from '../context/tool-pairs.js';
import { buildGlassWakeInheritance, composeGlassCast, finalizeGlassCast, planPromotedHearthOmissions } from '../context/glass-cast.js';
import { assertScrubbedPresentation, scrubProviderHistory, verifyScrubbedProjection } from '../scrub/provider-presentation.js';
import { scrubProviderReturn } from '../scrub/provider-return.js';
import { scrubHostReturn } from '../scrub/host-return.js';
import { HEARTH_TOOL, HEARTH_TOOL_CHOICE, hearthReturnHash, validateOrientationResult } from '../hearth/handshake.js';
import { renderHearthPacket } from '../hearth/packet.js';
import { residentToolProfile, schemasForResidentSession } from '../world/tools.js';
import { AttentionMeter } from '../context/attention-meter.js';
import { renderCrossingGround, renderOrientationGround, renderToolAttentionGround } from '../context/resident-presentation.js';
import { ProvisionalCollector } from './provisional-collector.js';

const PROVIDER_ABORT_GRACE_MS = 250;

function providerCancellation() {
  return { code: 'provider_cancelled', message: 'Hub shutdown cancelled the active provider request.' };
}

function awaitProviderWithAbort(operation, signal) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let abortTimer = null;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      if (abortTimer !== null) clearTimeout(abortTimer);
      signal.removeEventListener('abort', onAbort);
      callback(value);
    };
    const onAbort = () => {
      if (abortTimer === null) abortTimer = setTimeout(() => finish(reject, providerCancellation()), PROVIDER_ABORT_GRACE_MS);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(operation).then(
      value => signal.aborted ? finish(reject, providerCancellation()) : finish(resolve, value),
      error => signal.aborted ? finish(reject, providerCancellation()) : finish(reject, error),
    );
    if (signal.aborted) onAbort();
  });
}

export class WakeService {
  constructor({ config, db, provider, forest, spine, world, gateway, eventBus = null }) {
    this.config = config;
    this.db = db;
    this.provider = provider;
    this.forest = forest;
    this.spine = spine;
    this.world = world;
    this.gateway = gateway;
    this.eventBus = eventBus;
    this.attentionMeter = new AttentionMeter({ warnBytes: config.attentionWarnBytes, refuseBytes: config.attentionRefuseBytes });
    this.wakeInProgress = false;
    this.activeWakeId = null;
    this.activeWakePromise = null;
    this.lastAttention = null;
    this.closing = false;
    this.cardRevisions = new Map();
    this.suppressedDeltaChannels = new Set();
    this.activeProviderAbortController = null;
  }

  publish(kind, { sessionId, wakeId, phase = null, authority = 'host_receipt', committed = true, payload = {}, source = {} }, fallbackPayload = null) {
    if (!this.eventBus) return null;
    try {
      return this.eventBus.publish({ kind, sessionId, wakeId, phase, authority, committed, payload, source });
    } catch (error) {
      if (!fallbackPayload || !['wake_stream_secret_refused', 'wake_stream_invalid_json'].includes(error?.code)) throw error;
      return this.eventBus.publish({ kind, sessionId, wakeId, phase, authority, committed, payload: fallbackPayload, source });
    }
  }

  publishAfterCommit(kind, detail, fallbackPayload = null) {
    try { return this.publish(kind, detail, fallbackPayload); }
    catch { return null; }
  }

  publishDelta(created, phase, requestId, requestFrame, delta) {
    const kind = delta?.kind === 'reasoning_content'
      ? 'provider.thinking.delta'
      : delta?.kind === 'content'
        ? 'provider.content.delta'
        : delta?.kind === 'tool_call'
          ? 'provider.tool_call.delta'
          : null;
    if (!kind) return;
    const channel = `${requestId}:${kind}:${delta?.kind === 'tool_call' ? (delta.index ?? 'unknown') : 'text'}`;
    if (this.suppressedDeltaChannels.has(channel)) return;
    const payload = delta.kind === 'tool_call'
      ? {
          choiceIndex: delta.choiceIndex ?? 0,
          index: delta.index ?? 0,
          type: delta.type || null,
          function: {
            name: delta.function?.name || '',
          },
          argumentsOmitted: typeof delta.function?.arguments === 'string' && delta.function.arguments.length > 0,
        }
      : {
          choiceIndex: delta.choiceIndex ?? 0,
          delta: typeof delta.delta === 'string' ? delta.delta : '',
        };
    const event = {
      kind,
      sessionId: created.sessionId,
      wakeId: created.wakeId,
      phase,
      authority: 'provider_provisional',
      committed: false,
      payload,
      source: { providerRequestId: requestId, spineRecordId: requestFrame?.record_id || null },
    };
    return event;
  }

  publishCollectedDelta(event) {
    const requestId = event.source.providerRequestId;
    const channel = `${requestId}:${event.kind}:${event.kind === 'provider.tool_call.delta' ? (event.payload?.index ?? 'unknown') : 'text'}`;
    if (this.suppressedDeltaChannels.has(channel)) return null;
    try { return this.eventBus?.publish(event); }
    catch (error) {
      if (error?.code !== 'wake_stream_delta_secret_refused') throw error;
      this.suppressedDeltaChannels.add(channel);
      return this.eventBus?.publish({ ...event, payload: { omitted: true, omittedReason: 'credential_boundary', channelSuppressed: true } });
    }
  }

  clearSuppressedRequest(requestId) {
    for (const channel of this.suppressedDeltaChannels) if (channel.startsWith(`${requestId}:`)) this.suppressedDeltaChannels.delete(channel);
  }

  nextCardRevision(cardId) {
    const revision = (this.cardRevisions.get(cardId) || 0) + 1;
    this.cardRevisions.set(cardId, revision);
    return revision;
  }

  toolCardPayload(toolCallId, toolName, state, extra = {}) {
    const identity = toolCallId || `${toolName}.${sha256(JSON.stringify(extra)).slice(0, 12)}`;
    const cardId = `card.action.${identity}`;
    return {
      cardId,
      revision: this.nextCardRevision(cardId),
      cardKind: state === 'completed' ? 'result' : 'action',
      state,
      label: toolName,
      toolCallId: toolCallId || null,
      toolName,
      ...extra,
    };
  }

  publishCards(created, phase, call, action, hostEventId) {
    const receiptRefs = {
      actionReceiptId: action.actionReceipt?.receiptId || null,
      approvalReceiptId: action.approvalReceipt?.receiptId || null,
      hostReturnReceiptId: action.scrub?.receipt?.receiptId || null,
      hostEventId,
    };
    if (action.resultRack?.projection) {
      const projection = action.resultRack.projection;
      const cardId = `card.result.${action.resultRack.jobId}`;
      const cardKind = /diff/i.test(action.name || call.function?.name || '') ? 'diff' : 'result';
      const payload = {
        cardId,
        revision: this.nextCardRevision(cardId),
        cardKind,
        title: `${action.name || call.function?.name || 'World action'} result`,
        content: projection.content || '',
        exactPointer: projection.exactPointer || null,
        projectionId: projection.projectionId || null,
        sourceHash: projection.sourceHash || null,
        receiptRefs,
      };
      this.publish('card.upsert', {
        sessionId: created.sessionId, wakeId: created.wakeId, phase, payload,
        source: { resultRackJobId: action.resultRack.jobId, actionReceiptId: receiptRefs.actionReceiptId },
      }, { ...payload, content: '', contentOmitted: true });
    }
    if (action.result?.status === 'pending_approval' && action.result?.approvalId) {
      const cardId = `card.approval.${action.result.approvalId}`;
      const preview = action.result.preview || {};
      const payload = {
        cardId,
        revision: this.nextCardRevision(cardId),
        cardKind: 'approval',
        title: 'Approval required',
        content: typeof preview.content === 'string' ? preview.content : '',
        exactPointer: preview.exactPointer || preview.patchOverflow?.exactPointer || null,
        approvalId: action.result.approvalId,
        receiptRefs,
      };
      this.publish('card.upsert', {
        sessionId: created.sessionId, wakeId: created.wakeId, phase, payload,
        source: { approvalId: action.result.approvalId, actionReceiptId: receiptRefs.actionReceiptId },
      }, { ...payload, content: '', contentOmitted: true });
    }
  }

  beginClose() {
    this.closing = true;
    if (this.activeProviderAbortController && !this.activeProviderAbortController.signal.aborted) {
      this.activeProviderAbortController.abort(providerCancellation());
    }
    return this.activeWakePromise;
  }

  registerPresentationBoundary(wakeId, requestFrame, requestBodyString, presentation, sourceMessages, sourceRefs = []) {
    const { forest } = this;
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

  async wake(content, { completionProjection = 'full' } = {}) {
    if (this.closing) throw { code: 'hub_closing', message: 'The Hub is shutting down and is not accepting new wakes.' };
    if (this.wakeInProgress) throw { code: 'wake_in_progress', message: 'Another wake is already in progress.' };
    this.wakeInProgress = true;
    const operation = this.performWake(content, { completionProjection });
    this.activeWakePromise = operation;
    try { return await operation; }
    finally {
      if (this.activeWakePromise === operation) this.activeWakePromise = null;
      this.wakeInProgress = false;
      this.activeWakeId = null;
    }
  }

  async performWake(content, { completionProjection = 'full' } = {}) {
    const { config, db, provider, forest, spine, world, gateway, attentionMeter } = this;
    const submitted = typeof content === 'string' ? content : '';
    const trimmed = submitted.trim();
    if (!trimmed) throw { code: 'invalid_message', message: 'Message must contain text.' };
    if (trimmed.length > config.maxMessageLength) throw { code: 'message_too_large', message: `Message must be ${config.maxMessageLength} characters or fewer.` };
    const glassTraceVerification = db.verifyGlassTrace({ mismatchLimit: 10 });
    if (!glassTraceVerification.verified) throw { code: 'glass_trace_drift', message: `Glass trace verification found a dangling or altered closure-era path: ${glassTraceVerification.mismatches.map(item => item.code).join(', ')}.` };
    const rootsVerification = db.verifyRoots({ mismatchLimit: 10 });
    if (!rootsVerification.verified) throw { code: 'roots_drift', message: `Roots verification found altered or dangling causal evidence: ${rootsVerification.mismatches.map(item => item.code).join(', ')}.` };
    const providerName = config.mode === 'fake' ? 'fake' : 'deepseek';
    const firstTurn = !db.sessionHasOrientation();
    const priorEligible = db.listEligibleUtteranceEvents().at(-1)?.id || null;
    const created = db.createSessionWake({ provider: providerName, model: config.model, content: submitted });
    this.activeWakeId = created.wakeId;
    this.publish('wake.accepted', {
      sessionId: created.sessionId,
      wakeId: created.wakeId,
      payload: { status: 'assembling', provider: providerName, requestedModel: config.model },
      source: { userEventId: created.eventId },
    });
    if (forest) {
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
    db.markCalling(created.wakeId);
    let wakeInheritance = null;
    let silverBulletHolster = firstTurn ? null : db.getSessionSilverBulletHolster(created.sessionId);
    const callPhase = async (phase, historyRows, options = {}) => {
      if (this.closing) throw providerCancellation();
      const thinking = options.orientation ? 'disabled' : config.thinking;
      const tools = options.orientation ? [HEARTH_TOOL] : options.tools;
      const continuityMode = options.orientation ? 'pending' : options.causalHearth ? 'causal_hearth' : 'none';
      let omissionPlan = options.orientation
        ? { omissions: [], manifest: [], omittedExchangeCount: 0, omittedMessageCount: 0, disclosure: null }
        : planOldToolExchangeOmissions(historyRows, { currentWakeId: created.wakeId, retainExchanges: config.retainedToolPairs, sourceOffset: 0 });
      if (continuityMode === 'direct' || continuityMode === 'none') {
        const promotion = planPromotedHearthOmissions(historyRows);
        const byIndex = new Map([...omissionPlan.omissions, ...promotion.omissions].map(item => [item.sourceIndex, item]));
        omissionPlan = {
          ...omissionPlan,
          omissions: [...byIndex.values()].sort((left, right) => left.sourceIndex - right.sourceIndex),
          omittedMessageCount: byIndex.size,
          glassContinuityPromotion: promotion.manifest,
          disclosure: [omissionPlan.disclosure, promotion.disclosure].filter(Boolean).join('\n') || null,
        };
      }
      const currentGround = [{
        kind: 'crossing_ground', authority: 'host_receipt', sourceEventId: null,
        message: { role: 'system', content: renderCrossingGround({ phase }) },
      }];
      if (options.orientation) currentGround.push({
        kind: 'orientation_ground', authority: 'host_receipt', sourceEventId: null,
        message: { role: 'system', content: renderOrientationGround() },
      });
      if (options.causalHearth) currentGround.push({
        kind: 'orientation_ground', authority: 'host_receipt', sourceEventId: null,
        message: { role: 'system', content: renderOrientationGround({ completed: true }) },
      });
      if (options.roomPresence !== false) currentGround.push({ kind: 'world_current_ground', authority: 'host_receipt', sourceEventId: null, message: { role: 'system', content: world.presenceMessage(created.sessionId) } });
      if (options.toolProfile?.omittedCount) {
        currentGround.push({ kind: 'tool_current_ground', authority: 'host_receipt', sourceEventId: null, message: { role: 'system', content: renderToolAttentionGround(options.toolProfile) } });
      }
      if (omissionPlan.disclosure) currentGround.push({ kind: 'attention_current_ground', authority: 'host_receipt', sourceEventId: null, message: { role: 'system', content: omissionPlan.disclosure } });
      const assemble = () => {
        const historyRefs = historyRows.map(row => {
          const message = db.projectSessionHistoryMessage(row, {
            activeWakeId: created.wakeId,
            materializeActiveToolReasoning: !options.orientation,
            materializeMissingAsEmpty: config.mode === 'live',
          });
          const isCausalHearthReturn = options.causalHearth && row.wakeId === created.wakeId && row.messageKind === 'tool_result' && typeof message.content === 'string' && message.content.startsWith('# Hearth');
          const isCausalHearthAction = options.causalHearth && row.wakeId === created.wakeId && row.messageKind === 'assistant_tool_call' && message.tool_calls?.some(call => call.function?.name === 'tend_hearth');
          return {
            kind: isCausalHearthReturn ? 'hearth_return' : isCausalHearthAction ? 'hearth_action' : row.messageKind,
            authority: row.messageKind === 'user' ? 'ground' : row.messageKind === 'resident' || row.messageKind === 'assistant_tool_call' ? 'model_signed' : 'host_receipt',
            sourceEventId: row.sourceEventId || null,
            sourceContentHash: row.contentHash || null,
            historyId: row.id,
            historySessionId: row.sessionId,
            historyOrdinal: row.ordinal,
            historyMessageHash: sha256(row.messageJson),
            message,
          };
        });
        const livingEdgeRefs = [...currentGround, ...historyRefs];
        const livingEdgeOmissions = omissionPlan.omissions.map(omission => ({ ...omission, sourceIndex: omission.sourceIndex + currentGround.length }));
        const composed = composeGlassCast({
          phase,
          livingEdgeRefs,
          livingEdgeOmissions,
          inheritance: options.inheritance || wakeInheritance,
          continuityMode,
          priorHorizon: (options.inheritance || wakeInheritance)?.priorHorizon || null,
          silverBulletHolster,
        });
        const refs = composed.refs;
        const sourceMessages = refs.map(ref => ref.message);
        const presentation = scrubProviderHistory(sourceMessages, { omissions: composed.omissions });
        const presentedRefs = projectSourceRefs(refs, composed.omissions);
        const attention = attentionMeter.measure({ messages: presentation.messages, tools: tools || [] });
        return { refs, sourceMessages, presentation, presentedRefs, attention, glassCast: composed.cast };
      };
      // Byte thresholds are host evidence, not Resident ground. The exact
      // measure remains available in the attention receipt and Corner.
      const assembled = assemble();
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
      this.lastAttention = attention;
      const attentionReceipt = db.recordAttentionReceipt({ sessionId: created.sessionId, wakeId: created.wakeId, phase, attention });
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
      if (!requestFrame) throw { code: 'glass_cast_invalid', message: 'Glass Casting requires an exact Spine request frame.' };
      const requestId = db.recordProviderRequest({ sessionId: created.sessionId, wakeId: created.wakeId, phase, requestBody: requestBodyString, messageSources: presentedRefs, spineRecordId: requestFrame?.record_id, attention });
      const worldVerification = world.verification({ mismatchLimit: 1 });
      if (!worldVerification.verified || !worldVerification.journalHead) throw { code: 'glass_trace_invalid', message: 'Glass World ground requires a verified World journal head.' };
      const worldProjection = world.projection(created.sessionId);
      const toolSchemas = tools || [];
      const commonWitness = { sessionId: created.sessionId, wakeId: created.wakeId, phase };
      const messageHashesFor = kinds => refs.filter(ref => kinds.includes(ref.kind)).map(ref => sha256(JSON.stringify(ref.message)));
      const groundWitnesses = {
        crossing_ground: { ...commonWitness, provider: providerName, requestedModel: config.model, thinking, lifespanSessionId: created.sessionId, sourceMessageHashes: messageHashesFor(['crossing_ground']) },
        world_current_ground: { ...commonWitness, journalHead: worldVerification.journalHead, projectorVersion: worldVerification.projectorVersion, projectionHash: sha256(JSON.stringify(worldProjection)), presenceMessageHash: sha256(world.presenceMessage(created.sessionId)), sourceMessageHashes: messageHashesFor(['world_current_ground']) },
        tool_mount: { ...commonWitness, roomId: worldProjection.roomId, mountProfile: worldProjection.mountProfile, fittedProfile: options.toolProfile || null, schemaCount: toolSchemas.length, schemaHashes: toolSchemas.map(schema => sha256(JSON.stringify(schema))), sourceMessageHashes: messageHashesFor(['tool_current_ground']) },
        attention: { ...commonWitness, attentionReceiptId: attentionReceipt.receiptId, attentionReceiptHash: attentionReceipt.receiptHash, status: attention.status, omissionManifest: omissionPlan, sourceMessageHashes: messageHashesFor(['attention_current_ground', 'orientation_ground']) },
        continuity_ground: { ...commonWitness, mode: continuityMode, inheritanceReceiptHash: (options.inheritance || wakeInheritance) ? sha256(JSON.stringify(options.inheritance || wakeInheritance)) : null, silverBulletHolsterHash: silverBulletHolster ? sha256(JSON.stringify(silverBulletHolster)) : null, sourceMessageHashes: messageHashesFor(['clinical_wake_anchor', 'source_exact_inheritance', 'prior_horizon', 'silver_bullet_holster']) },
      };
      const glassReceipt = finalizeGlassCast({ cast: assembled.glassCast, sourceMessages, presentation, requestBodyString, requestFrame, crossing: { sessionId: created.sessionId, wakeId: created.wakeId, provider: providerName, requestedModel: config.model } });
      const { persistedGlass, glassTrace } = db.transaction(() => {
        const groundReceipts = db.recordGlassGroundReceipts({ providerRequestId: requestId, witnesses: groundWitnesses });
        const persistedGlass = db.recordGlassCastReceipt({ sessionId: created.sessionId, wakeId: created.wakeId, providerRequestId: requestId, receipt: glassReceipt });
        const glassTrace = db.recordGlassTraceManifest({ providerRequestId: requestId, glassCastReceiptId: persistedGlass.receiptId, sourceRefs: refs, presentationReceipt: presentation.receipt, groundReceipts });
        return { persistedGlass, glassTrace };
      });
      this.publish('phase.started', {
        sessionId: created.sessionId, wakeId: created.wakeId, phase,
        payload: { providerRequestId: requestId, spineRecordId: requestFrame?.record_id || null },
        source: { providerRequestId: requestId, attentionReceiptStatus: attention.status, glassCastReceiptId: persistedGlass.receiptId, glassTraceManifestId: glassTrace?.manifestId || null },
      });
      let observedOutcome = null;
      let rawReturnFrame = null;
      let dispatchObserved = false;
      let providerCallbacksOpen = true;
      const provisionalCollector = new ProvisionalCollector({ emit: event => this.publishCollectedDelta(event) });
      const onBeforeDispatch = requestFrame ? () => providerCallbacksOpen ? this.registerPresentationBoundary(created.wakeId, requestFrame, requestBodyString, presentation, sourceMessages, presentedRefs) : undefined : undefined;
      const onDispatch = requestFrame ? () => {
        if (!providerCallbacksOpen) return undefined;
        dispatchObserved = true;
        return spine.dispatchAttempted(requestFrame.record_id);
      } : undefined;
      const onRawReturn = requestFrame ? detail => {
        if (!providerCallbacksOpen) return rawReturnFrame;
        rawReturnFrame = spine.providerRawReturn(requestFrame.record_id, detail);
        return rawReturnFrame;
      } : undefined;
      const onOutcome = requestFrame ? outcome => { if (providerCallbacksOpen) observedOutcome = outcome; } : undefined;
      const onDelta = delta => {
        if (!providerCallbacksOpen) return;
        const event = this.publishDelta(created, phase, requestId, requestFrame, delta);
        if (event) provisionalCollector.collect(event);
      };
      const providerAbortController = new AbortController();
      this.activeProviderAbortController = providerAbortController;
      try {
        let result;
        try {
          const operation = completeProvider(provider, { presentation, model: config.model, phase, requestBodyString, onBeforeDispatch, onDispatch, onRawReturn, onDelta, onOutcome, signal: providerAbortController.signal });
          result = await awaitProviderWithAbort(operation, providerAbortController.signal);
          provisionalCollector.flush();
        } finally {
          providerCallbacksOpen = false;
          if (this.activeProviderAbortController === providerAbortController) this.activeProviderAbortController = null;
        }
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
        const readyPayload = {
          providerRequestId: requestId,
          responseId: result.responseId || null,
          finishReason: result.finishReason || null,
          message: {
            role: returnScrub.message.role,
            content: typeof returnScrub.message.content === 'string' ? returnScrub.message.content : null,
            reasoning_content: typeof returnScrub.message.reasoning_content === 'string' ? returnScrub.message.reasoning_content : null,
            toolCalls: (returnScrub.message.tool_calls || []).map(call => ({ id: call.id, type: call.type, name: call.function?.name || null })),
          },
        };
        this.publish('provider.message.ready', {
          sessionId: created.sessionId, wakeId: created.wakeId, phase, payload: readyPayload,
          source: { providerRequestId: requestId, spineRecordId: requestFrame?.record_id || null, returnScrubReceiptId: returnScrub.receipt.receiptId },
        }, {
          providerRequestId: requestId,
          responseId: result.responseId || null,
          finishReason: result.finishReason || null,
          message: { role: returnScrub.message.role, content: null, reasoning_content: null, toolCalls: readyPayload.message.toolCalls },
          contentOmitted: true,
        });
        this.clearSuppressedRequest(requestId);
        return { result, returnScrub, requestFrame, requestId, refs, glassReceipt: { ...persistedGlass, receipt: glassReceipt } };
      } catch (error) {
        provisionalCollector.discard();
        this.clearSuppressedRequest(requestId);
        const terminalError = providerAbortController.signal.aborted ? providerCancellation() : error;
        if (terminalError?.code === 'provider_cancelled' && requestFrame && observedOutcome?.network_code !== 'aborted') observedOutcome = { kind: 'network_error', network_code: 'aborted' };
        db.completeProviderRequest(requestId, {}, observedOutcome);
        if (requestFrame && observedOutcome) spine.providerOutcome(requestFrame.record_id, observedOutcome);
        throw terminalError;
      }
    };
    const runResidentRounds = async (phase = 'response', options = {}) => {
      for (let round = 0; round <= config.maxToolRounds; round += 1) {
        const toolProfile = residentToolProfile(world, created.sessionId);
        const response = await callPhase(phase, db.getSessionHistory(created.sessionId), { tools: schemasForResidentSession(world, created.sessionId), toolProfile, ...options });
        const calls = Array.isArray(response.result?.message?.tool_calls) ? response.result.message.tool_calls : [];
        if (!calls.length) {
          if (!response.result || typeof response.result.content !== 'string' || !response.result.content.trim()) throw { code: 'provider_empty_content', message: 'The resident provider returned no content.' };
          return response;
        }
        const toolCallEventId = db.recordToolCall({ wakeId: created.wakeId, sessionId: created.sessionId, message: response.result.message, returnScrub: response.returnScrub });
        for (const call of calls) {
          this.publish('tool_call.ready', {
            sessionId: created.sessionId, wakeId: created.wakeId, phase,
            payload: this.toolCardPayload(call.id || null, call.function?.name || 'unknown', 'ready', { providerRequestId: response.requestId }),
            source: { toolCallEventId, returnScrubReceiptId: response.returnScrub.receipt.receiptId },
          });
        }
        if (round === config.maxToolRounds) {
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
          this.publish('tool.started', {
            sessionId: created.sessionId, wakeId: created.wakeId, phase,
            payload: this.toolCardPayload(call.id || null, call.function?.name || 'unknown', 'running', { providerRequestId: response.requestId }),
            source: { toolCallEventId, providerRequestId: response.requestId },
          });
          try { action = await gateway.execute({ sessionId: created.sessionId, wakeId: created.wakeId, requestRecordId: response.requestId, spineRecordId: response.requestFrame?.record_id, intent: call }); }
          catch (error) { action = gateway.refuse({ sessionId: created.sessionId, wakeId: created.wakeId, requestRecordId: response.requestId, spineRecordId: response.requestFrame?.record_id, intent: call, error }); }
          const toolName = action.name || call.function?.name || 'unknown';
          const hostEventId = db.recordToolResult({ wakeId: created.wakeId, sessionId: created.sessionId, toolName, result: action.result, hostReturnScrub: action.scrub });
          const refused = action.result?.ok === false;
          this.publish(refused ? 'tool.refused' : 'tool.completed', {
            sessionId: created.sessionId, wakeId: created.wakeId, phase,
            payload: this.toolCardPayload(call.id || null, toolName, refused ? 'refused' : 'completed', { status: action.result?.status || (refused ? 'refused' : 'completed') }),
            source: { hostEventId, actionReceiptId: action.actionReceipt?.receiptId || null, hostReturnReceiptId: action.scrub?.receipt?.receiptId || null },
          });
          if (action.result?.status === 'pending_approval') {
            this.publish('approval.pending', {
              sessionId: created.sessionId, wakeId: created.wakeId, phase,
              payload: { approvalId: action.result.approvalId, toolCallId: call.id || null, toolName },
              source: { hostEventId, actionReceiptId: action.actionReceipt?.receiptId || null, approvalReceiptId: action.approvalReceipt?.receiptId || null },
            });
          }
          this.publishCards(created, phase, call, action, hostEventId);
        }
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
            const entry = forest.ingestEvent(db.getEvent(residentEventId), { spineStatus: 'live', predecessorSourceEventId: created.eventId });
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
            const entry = forest.ingestEvent(db.getEvent(residentEventId), { spineStatus: 'live', predecessorSourceEventId: created.eventId });
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
