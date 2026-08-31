import { sha256 } from '../core/hash.js';

/**
 * Owns the durable wake-event projection and its bounded provisional/card
 * presentation state. The WakeService facade supplies complete event facts;
 * this owner does not reach into orchestration or domain stores.
 */
export class WakeEventPublication {
  constructor({ eventBus = null, cardRevisions = new Map(), suppressedDeltaChannels = new Set(), hash = sha256 }) {
    this.eventBus = eventBus;
    this.cardRevisions = cardRevisions;
    this.suppressedDeltaChannels = suppressedDeltaChannels;
    this.hash = hash;
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
    return {
      kind,
      sessionId: created.sessionId,
      wakeId: created.wakeId,
      phase,
      authority: 'provider_provisional',
      committed: false,
      payload,
      source: { providerRequestId: requestId, spineRecordId: requestFrame?.record_id || null },
    };
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
    const identity = toolCallId || `${toolName}.${this.hash(JSON.stringify(extra)).slice(0, 12)}`;
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
}
