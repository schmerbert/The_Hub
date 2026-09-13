import { sha256 } from '../core/hash.js';
import { completeProvider, prepareProviderRequest } from '../providers/dispatch.js';
import { planOldToolExchangeOmissions, projectSourceRefs } from '../context/tool-pairs.js';
import { composeGlassCast, finalizeGlassCast, planPromotedHearthOmissions } from '../context/glass-cast.js';
import { assertScrubbedPresentation, scrubProviderHistory, verifyScrubbedProjection } from '../scrub/provider-presentation.js';
import { scrubProviderReturn } from '../scrub/provider-return.js';
import { HEARTH_TOOL, HEARTH_TOOL_CHOICE } from '../hearth/handshake.js';
import { renderCrossingGround, renderOrientationGround, renderToolAttentionGround } from '../context/resident-presentation.js';
import { ProvisionalCollector } from './provisional-collector.js';
import { REOPEN_RESULT_TOOL, recoverablePointerFromHostReceipt, RESULT_REOPEN_TOOL_NAME } from '../context/result-exhale.js';
import { renderAmbientFeatherPacket, renderDepartedFeatherFootprint } from '../context/semantic-exhale.js';
import { providerReasoningControls, selectReasoningPosture } from './reasoning-posture.js';
import { renderSpotlightReadGround } from '../places/hub/spotlight/presentation.js';
import { renderAutonomousWakeGround } from './autonomous-wakes.js';

const PROVIDER_ABORT_GRACE_MS = 250;

export function providerCancellation() {
  return { code: 'provider_cancelled', message: 'Hub shutdown cancelled the active provider request.' };
}

function renderToolRoundBudget({ remaining, finalOpportunity = false }) {
  if (finalOpportunity) return 'Action horizon: no further actions are available in this wake. This is the reserved final response.';
  return `Action horizon: up to ${remaining} further action round${remaining === 1 ? '' : 's'} may be used in this wake before the reserved final response.`;
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

/**
 * Owns one provider phase from request preparation through terminal return
 * Scrub. WakeService remains the public orchestrator and supplies all
 * wake-specific facts through this explicit port rather than sharing its
 * closure state with the phase owner.
 */
export class ProviderPhase {
  constructor({
    config,
    db,
    provider,
    spine,
    world,
    gateway,
    resultRack = gateway?.resultRack || null,
    attentionMeter,
    isClosing = () => false,
    setActiveProviderAbortController = () => {},
    clearActiveProviderAbortController = () => {},
    setLastAttention = () => {},
    publish,
    publishDelta,
    publishCollectedDelta,
    clearSuppressedRequest,
  }) {
    this.config = config;
    this.db = db;
    this.provider = provider;
    this.spine = spine;
    this.world = world;
    this.gateway = gateway;
    this.resultRack = resultRack;
    this.attentionMeter = attentionMeter;
    this.isClosing = isClosing;
    this.setActiveProviderAbortController = setActiveProviderAbortController;
    this.clearActiveProviderAbortController = clearActiveProviderAbortController;
    this.setLastAttention = setLastAttention;
    this.publish = publish;
    this.publishDelta = publishDelta;
    this.publishCollectedDelta = publishCollectedDelta;
    this.clearSuppressedRequest = clearSuppressedRequest;
  }

  registerPresentationBoundary({ forest, wakeId, requestFrame, requestBodyString, presentation, sourceMessages, sourceRefs = [] }) {
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

  async run({
    phase,
    historyRows,
    options = {},
    created,
    providerName,
    forest = null,
    forestTraversalService = null,
    wakeInheritance = null,
    silverBulletHolster = null,
    semanticExhale = null,
    departedFeathers = [],
  }) {
    const { config, db, provider, spine, world, attentionMeter } = this;
    if (this.isClosing()) throw providerCancellation();
    const currentLocation = world.current(created.sessionId);
    const currentForestWalk = forestTraversalService?.projection(created.sessionId);
    const posture = selectReasoningPosture({
      roomId: currentLocation.room_node_id,
      phase,
      forestWalkActive: currentForestWalk?.active === true,
      afterSimpleAction: options.afterSimpleAction === true,
    });
    // DeepSeek rejects forced tool_choice while thinking is enabled. Hearth
    // orientation is a deterministic mechanical crossing, so keep its forced
    // action and reserve fitted thinking for the causal response.
    const requestThinking = options.orientation ? 'disabled' : config.thinking;
    const reasoning = providerReasoningControls({ thinking: requestThinking, posture: posture.posture, effort: posture.effort });
    const thinking = reasoning.thinking;
    const toolsDisabled = options.toolsDisabled === true;
    const tools = options.orientation ? [HEARTH_TOOL] : toolsDisabled ? [] : [...(options.tools || [])];
    if (!options.orientation && !toolsDisabled && !tools.some(tool => tool?.function?.name === RESULT_REOPEN_TOOL_NAME)) tools.push(REOPEN_RESULT_TOOL);
    const continuityMode = options.orientation ? 'pending' : options.causalHearth ? 'causal_hearth' : 'none';
    let omissionPlan = options.orientation
      ? { omissions: [], manifest: [], omittedExchangeCount: 0, omittedMessageCount: 0, disclosure: null }
      : planOldToolExchangeOmissions(historyRows, {
        currentWakeId: created.wakeId,
        retainExchanges: config.retainedToolPairs,
        sourceOffset: 0,
        pointerResolver: row => {
          const persisted = db.getHostReturnScrubReceipt(row?.scrubReceiptId);
          const pointer = recoverablePointerFromHostReceipt(persisted, { sessionId: created.sessionId });
          if (!pointer || !this.resultRack) return null;
          const verified = this.resultRack.validateProjectionReceipt(pointer, { sessionId: created.sessionId });
          return verified ? { ...pointer, ...verified } : null;
        },
        hearthResolver: wakeId => db.getHearthReturn?.(wakeId),
      });
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
    const autonomousWakeGround = renderAutonomousWakeGround(options.wakeOrigin);
    if (autonomousWakeGround) currentGround.push({ kind: 'autonomous_wake_ground', authority: 'host_receipt', sourceEventId: null, wakeTriggerEventId: created.eventId, message: { role: 'system', content: autonomousWakeGround } });
    if (options.orientation) currentGround.push({
      kind: 'orientation_ground', authority: 'host_receipt', sourceEventId: null,
      message: { role: 'system', content: renderOrientationGround() },
    });
    if (options.causalHearth) currentGround.push({
      kind: 'orientation_ground', authority: 'host_receipt', sourceEventId: null,
      message: { role: 'system', content: renderOrientationGround({ completed: true }) },
    });
    const forestProjection = forestTraversalService?.projection(created.sessionId);
    if (options.roomPresence !== false && !forestProjection?.active) currentGround.push({ kind: 'world_current_ground', authority: 'host_receipt', sourceEventId: null, message: { role: 'system', content: world.presenceMessage(created.sessionId) } });
    const forestThreshold = forestTraversalService?.thresholdMessage(created.sessionId, world.current(created.sessionId).room_node_id);
    if (forestThreshold) currentGround.push({ kind: 'forest_threshold_ground', authority: 'host_receipt', sourceEventId: null, message: { role: 'system', content: forestThreshold } });
    const forestPresence = forestTraversalService?.presenceMessage(created.sessionId);
    if (forestPresence) currentGround.push({ kind: 'forest_current_ground', authority: 'host_receipt', sourceEventId: null, message: { role: 'system', content: forestPresence } });
    if (options.toolProfile?.omittedCount && !toolsDisabled) {
      currentGround.push({ kind: 'tool_current_ground', authority: 'host_receipt', sourceEventId: null, message: { role: 'system', content: renderToolAttentionGround(options.toolProfile) } });
    }
    const spotlightReadStanding = !options.orientation && !toolsDisabled && !forestProjection?.active && world.current(created.sessionId).room_node_id === 'room.spotlight'
      ? this.gateway?.spotlight?.status() || null : null;
    if (spotlightReadStanding) currentGround.push({
      kind: 'tool_current_ground', authority: 'host_receipt', sourceEventId: null,
      message: { role: 'system', content: renderSpotlightReadGround(spotlightReadStanding) },
    });
    if (options.toolRoundBudget) currentGround.push({
      kind: 'tool_current_ground', authority: 'host_receipt', sourceEventId: null,
      message: { role: 'system', content: renderToolRoundBudget(options.toolRoundBudget) },
    });
    if (omissionPlan.disclosure) currentGround.push({ kind: 'attention_current_ground', authority: 'host_receipt', sourceEventId: null, message: { role: 'system', content: omissionPlan.disclosure } });
    const departedFeatherMarkdown = !options.orientation ? renderDepartedFeatherFootprint(departedFeathers) : null;
    if (departedFeatherMarkdown) currentGround.push({
      kind: 'semantic_forest_departure', authority: 'host_receipt', sourceEventId: null,
      departureArtifacts: structuredClone(departedFeathers),
      message: { role: 'system', content: departedFeatherMarkdown },
    });
    const semanticExhaleMarkdown = !options.orientation && semanticExhale ? renderAmbientFeatherPacket(semanticExhale) : null;
    if (semanticExhaleMarkdown) currentGround.push({
      kind: 'semantic_forest_exhale', authority: 'host_receipt', sourceEventId: null,
      packet: structuredClone(semanticExhale),
      message: { role: 'system', content: semanticExhaleMarkdown },
    });
    for (const sign of omissionPlan.trailSigns || []) currentGround.push({
      ...sign,
      kind: 'result_trail_sign',
      authority: 'host_receipt',
      sourceEventId: null,
      message: structuredClone(sign.message),
    });
    for (const sign of omissionPlan.hearthTrailSigns || []) currentGround.push({
      ...sign,
      kind: 'hearth_trail_sign',
      authority: 'host_receipt',
      sourceEventId: null,
      message: structuredClone(sign.message),
    });
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
          scrubReceiptId: row.scrubReceiptId || null,
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
      reasoningPosture: posture.posture,
      reasoningEffort: reasoning.reasoningEffort,
      reasoningFittingReason: posture.reason,
      providerThinking: reasoning.thinking,
    };
    this.setLastAttention(attention);
    const attentionReceipt = db.recordAttentionReceipt({ sessionId: created.sessionId, wakeId: created.wakeId, phase, attention });
    if (!attention.dispatchAllowed) throw { code: 'attention_ceiling_exceeded', message: `The fitted provider crossing is ${attention.totalBytes} bytes and exceeds the ${config.attentionRefuseBytes}-byte attention ceiling.` };
    const prepared = prepareProviderRequest(provider, {
      presentation, model: config.model,
      thinking,
      reasoningEffort: reasoning.reasoningEffort,
      phase,
      tools,
      toolChoice: options.orientation ? HEARTH_TOOL_CHOICE : undefined,
    });
    const requestBodyString = prepared.requestBodyString || JSON.stringify(prepared.requestBody);
    const wakeRecord = db.getWake(created.wakeId);
    const requestFrame = spine?.prepareRequest({ requestBody: requestBodyString, threadId: wakeRecord.threadId, wakeId: wakeRecord.id, provider: wakeRecord.provider, model: config.model, authorizationPresent: config.mode === 'live' && Boolean(config.apiKey), requestPhase: phase });
    if (!requestFrame) throw { code: 'glass_cast_invalid', message: 'Glass Casting requires an exact Spine request frame.' };
    const requestId = db.recordProviderRequest({ sessionId: created.sessionId, wakeId: created.wakeId, phase, requestBody: requestBodyString, messageSources: presentedRefs, spineRecordId: requestFrame?.record_id, attention });
    const worldVerification = world.verification({ mismatchLimit: 1, requireHearth: true, requireForest: true, requireBinderWindow: true, requireSpotlight: true });
    if (!worldVerification.verified || !worldVerification.journalHead) throw { code: 'glass_trace_invalid', message: 'Glass World ground requires a verified World journal head.' };
    const worldProjection = world.projection(created.sessionId);
    const toolSchemas = tools || [];
    const commonWitness = { sessionId: created.sessionId, wakeId: created.wakeId, phase };
    const messageHashesFor = kinds => refs.filter(ref => kinds.includes(ref.kind)).map(ref => sha256(JSON.stringify(ref.message)));
    const groundWitnesses = {
      crossing_ground: { ...commonWitness, provider: providerName, requestedModel: config.model, thinking, reasoningPosture: posture.posture, reasoningEffort: reasoning.reasoningEffort, reasoningFittingReason: posture.reason, lifespanSessionId: created.sessionId, sourceMessageHashes: messageHashesFor(['crossing_ground']) },
      world_current_ground: { ...commonWitness, journalHead: worldVerification.journalHead, projectorVersion: worldVerification.projectorVersion, projectionHash: sha256(JSON.stringify(worldProjection)), presenceMessageHash: sha256(world.presenceMessage(created.sessionId)), sourceMessageHashes: messageHashesFor(['world_current_ground']) },
      tool_mount: { ...commonWitness, roomId: worldProjection.roomId, mountProfile: worldProjection.mountProfile, fittedProfile: options.toolsDisabled ? { ...(options.toolProfile || {}), names: [], completeCount: 0, finalResponseOnly: true } : options.toolProfile || null, schemaCount: toolSchemas.length, schemaHashes: toolSchemas.map(schema => sha256(JSON.stringify(schema))), ...(spotlightReadStanding ? { spotlightReadStanding } : {}), sourceMessageHashes: messageHashesFor(['tool_current_ground']) },
      attention: { ...commonWitness, attentionReceiptId: attentionReceipt.receiptId, attentionReceiptHash: attentionReceipt.receiptHash, status: attention.status, reasoningPosture: posture.posture, reasoningEffort: reasoning.reasoningEffort, reasoningFittingReason: posture.reason, omissionManifest: omissionPlan, semanticExhaleDepartures: departedFeathers, forestWalk: forestTraversalService?.projection(created.sessionId) || null, sourceMessageHashes: messageHashesFor(['attention_current_ground', 'orientation_ground', 'forest_threshold_ground', 'forest_current_ground', 'result_trail_sign', 'hearth_trail_sign', 'semantic_forest_exhale', 'semantic_forest_departure']) },
      continuity_ground: { ...commonWitness, mode: continuityMode, inheritanceReceiptHash: (options.inheritance || wakeInheritance) ? sha256(JSON.stringify(options.inheritance || wakeInheritance)) : null, silverBulletHolsterHash: silverBulletHolster ? sha256(JSON.stringify(silverBulletHolster)) : null, sourceMessageHashes: messageHashesFor(['clinical_wake_anchor', 'source_exact_inheritance', 'prior_horizon', 'silver_bullet_holster']) },
    };
    const glassReceipt = finalizeGlassCast({ cast: assembled.glassCast, sourceMessages, presentation, requestBodyString, requestFrame, crossing: { sessionId: created.sessionId, wakeId: created.wakeId, provider: providerName, requestedModel: config.model } });
    const { persistedGlass, glassTrace, exposureArtifacts } = db.transaction(() => {
      const groundReceipts = db.recordGlassGroundReceipts({ providerRequestId: requestId, witnesses: groundWitnesses });
      const persistedGlass = db.recordGlassCastReceipt({ sessionId: created.sessionId, wakeId: created.wakeId, providerRequestId: requestId, receipt: glassReceipt });
      const glassTrace = db.recordGlassTraceManifest({ providerRequestId: requestId, glassCastReceiptId: persistedGlass.receiptId, sourceRefs: refs, presentationReceipt: presentation.receipt, groundReceipts });
      const glassItems = assembled.glassCast.bands.flatMap(band => band.items.map((item, index) => ({ band: band.name, ordinal: item.sourceMessageOrdinal || index + 1, item })));
      const exposureRefs = refs.map((ref, index) => ({ ref, ordinal: index + 1, glassItem: glassItems.find(candidate => candidate.item.kind === ref.kind && candidate.item.messageSha256 === sha256(JSON.stringify(ref.message))) }));
      const exposureArtifacts = exposureRefs.flatMap(({ ref, ordinal, glassItem }) => {
        const isTrail = ref.kind === 'result_trail_sign' && ref.receipt?.pointer;
        const isReopen = ref.kind === 'tool_result' && ref.historyId && db.getHostReturnScrubReceipt(ref.scrubReceiptId)?.receipt?.toolName === RESULT_REOPEN_TOOL_NAME;
        const isForestExhale = ref.kind === 'semantic_forest_exhale' && ref.packet?.atoms?.length;
        if (!isTrail && !isReopen && !isForestExhale) return [];
        const pointer = isTrail ? ref.receipt.pointer : isReopen ? recoverablePointerFromHostReceipt(db.getHostReturnScrubReceipt(ref.scrubReceiptId), { sessionId: created.sessionId }) : null;
        const packet = isForestExhale ? structuredClone(ref.packet) : {
          kind: ref.kind,
          messageHash: sha256(JSON.stringify(ref.message)),
          ...(pointer ? { pointer } : {}),
          ...(ref.markerKind ? { markerKind: ref.markerKind } : {}),
          ...(Array.isArray(ref.pointers) ? { pointers: ref.pointers } : {}),
        };
        return [db.roots.recordAttentionExposure({
          sessionId: created.sessionId, wakeId: created.wakeId, phase, exposureKind: isForestExhale ? 'semantic_forest_exhale' : isTrail ? 'result_trail_sign' : 'result_reopen', pointer,
          packet, glassBand: glassItem?.band || 'living_edge', glassOrdinal: glassItem?.ordinal || ordinal,
          glassCastReceiptId: persistedGlass.receiptId, glassCastReceiptHash: persistedGlass.receiptHash,
          scrubReceiptHash: glassReceipt.presentationScrubSha256, spineRecordId: requestFrame.record_id, spineRecordHash: requestFrame.record_hash,
        })];
      });
      return { persistedGlass, glassTrace, exposureArtifacts };
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
    const onBeforeDispatch = requestFrame ? () => providerCallbacksOpen ? this.registerPresentationBoundary({ forest, wakeId: created.wakeId, requestFrame, requestBodyString, presentation, sourceMessages, sourceRefs: presentedRefs }) : undefined : undefined;
    const onDispatch = requestFrame ? () => {
      if (!providerCallbacksOpen) return undefined;
      const attempted = spine.dispatchAttempted(requestFrame.record_id);
      for (const exposure of exposureArtifacts) db.roots.recordAttentionExposureDisposition({ artifactId: exposure.artifactId, disposition: 'presented', dispatchHash: requestFrame.record_hash });
      dispatchObserved = true;
      return attempted;
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
    this.setActiveProviderAbortController(providerAbortController);
    try {
      let result;
      try {
        const operation = completeProvider(provider, { presentation, model: config.model, phase, requestBodyString, onBeforeDispatch, onDispatch, onRawReturn, onDelta, onOutcome, signal: providerAbortController.signal });
        result = await awaitProviderWithAbort(operation, providerAbortController.signal);
        provisionalCollector.flush();
      } finally {
        providerCallbacksOpen = false;
        this.clearActiveProviderAbortController(providerAbortController);
      }
      if (requestFrame && !dispatchObserved) {
        spine.dispatchAttempted(requestFrame.record_id);
        for (const exposure of exposureArtifacts) db.roots.recordAttentionExposureDisposition({ artifactId: exposure.artifactId, disposition: 'presented', dispatchHash: requestFrame.record_hash });
        dispatchObserved = true;
      }
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
      if (!dispatchObserved) for (const exposure of exposureArtifacts) {
        try { db.roots.recordAttentionExposureDisposition({ artifactId: exposure.artifactId, disposition: 'never_dispatched' }); } catch {}
      }
      provisionalCollector.discard();
      this.clearSuppressedRequest(requestId);
      const terminalError = providerAbortController.signal.aborted ? providerCancellation() : error;
      if (terminalError?.code === 'provider_cancelled' && requestFrame && observedOutcome?.network_code !== 'aborted') observedOutcome = { kind: 'network_error', network_code: 'aborted' };
      db.completeProviderRequest(requestId, {}, observedOutcome);
      if (requestFrame && observedOutcome) spine.providerOutcome(requestFrame.record_id, observedOutcome);
      throw terminalError;
    }
  }
}

export function createProviderPhase(dependencies) {
  return new ProviderPhase(dependencies);
}
