import { sha256 } from '../core/hash.js';
import { buildResultTrailContinuationMarker, buildResultTrailSign, RESULT_REOPEN_TOOL_NAME, RESULT_TRAIL_SIGN_LIMIT } from './result-exhale.js';
import { renderFoldDisclosure } from './resident-presentation.js';

function parseMessage(row) {
  try { return JSON.parse(row.messageJson); } catch { return null; }
}

function hearthExchange(historyRows, assistantIndex, resultIndexes, hearthResolver = null) {
  const assistant = parseMessage(historyRows[assistantIndex]);
  const result = resultIndexes.length === 1 ? parseMessage(historyRows[resultIndexes[0]]) : null;
  const call = (assistant?.tool_calls || []).length === 1 ? assistant.tool_calls[0] : null;
  if (call?.function?.name !== 'tend_hearth' || typeof result?.content !== 'string' || !result.content.startsWith('# Hearth')) return null;
  const packetHash = sha256(result.content);
  const custody = typeof hearthResolver === 'function' ? hearthResolver(historyRows[assistantIndex]?.wakeId) : null;
  const atoms = Array.isArray(custody?.returnValue?.atoms) ? custody.returnValue.atoms : [];
  const sourceBearingLines = atoms.slice(0, 4).flatMap(atom => {
    if (typeof atom?.excerpt !== 'string' || !atom.excerpt) return [];
    const bearings = [
      `Source event: ${atom.sourceEventId || 'unavailable'}`,
      ...(atom.forestEntryId ? [`Forest bearing: ${atom.forestEntryId}`] : []),
    ];
    return ['', ...bearings, `> ${atom.excerpt}`];
  });
  return {
    toolCallId: call.id || null,
    packetHash,
    wrapper: {
      kind: 'hearth_trail_sign',
      authority: 'host_receipt',
      presentationTransform: 'hearth_attention_wrapper_v1',
      sourceEventId: null,
      message: {
        role: 'system',
        content: [
          '[Hearth trace]',
          '✓ The Hearth was tended during this lifespan and its bounded packet has moved beyond immediate attention.',
          `Hearth custody receipt: wake ${historyRows[assistantIndex]?.wakeId || 'unknown'}. Packet hash: ${packetHash}.`,
          ...(sourceBearingLines.length ? ['Source-bearing excerpts retained with the exact packet:', ...sourceBearingLines] : ['The exact packet remains in Hearth custody; its source-bearing excerpts are available behind the receipt.']),
          'The earlier action and return remain in exact Session Scroll and Hearth custody. This is a bounded custody trace, not a replay, summary, or new action.',
        ].join('\n'),
      },
      packetHash,
      sourceBearings: atoms.slice(0, 4).map(atom => ({ sourceEventId: atom.sourceEventId || null, forestEntryId: atom.forestEntryId || null, sourceContentHash: atom.originalHash || null, excerptHash: atom.excerptHash || sha256(atom.excerpt || '') })),
    },
  };
}

function hasNonHearthToolContinuation(historyRows, currentWakeId) {
  return historyRows.some(row => {
    if (row?.wakeId !== currentWakeId || row?.messageKind !== 'assistant_tool_call') return false;
    const message = parseMessage(row);
    return (message?.tool_calls || []).some(call => call?.function?.name && call.function.name !== 'tend_hearth');
  });
}

/**
 * Selects completed tool exchanges outside the retained causal tail. The source
 * history is never changed; callers pass whole-message omissions through Scrub.
 */
export function planOldToolExchangeOmissions(historyRows, { currentWakeId, retainExchanges = 2, sourceOffset = 1, pointerResolver = null, hearthResolver = null, maxTrailSigns = RESULT_TRAIL_SIGN_LIMIT, trailSignContinuation = null } = {}) {
  if (!Array.isArray(historyRows)) throw new Error('Tool exchange history must be an array.');
  if (!Number.isInteger(retainExchanges) || retainExchanges < 0) throw new Error('Retained tool exchanges must be a non-negative integer.');
  if (pointerResolver !== null && typeof pointerResolver !== 'function') throw new Error('Result pointer resolver must be a function.');
  if (!Number.isInteger(maxTrailSigns) || maxTrailSigns < 0) throw new Error('Trail-sign ceiling must be a non-negative integer.');
  if (trailSignContinuation !== null && typeof trailSignContinuation !== 'boolean') throw new Error('Trail-sign continuation must be a boolean when provided.');
  const completed = [];
  for (let index = 0; index < historyRows.length; index += 1) {
    const assistantRow = historyRows[index];
    if (assistantRow.messageKind !== 'assistant_tool_call') continue;
    const assistant = parseMessage(assistantRow);
    const callIds = new Set((assistant?.tool_calls || []).map(call => call?.id).filter(Boolean));
    if (!callIds.size) continue;
    if ([...(assistant?.tool_calls || [])].some(call => call?.function?.name === RESULT_REOPEN_TOOL_NAME)) continue;
    const resultIndexes = [];
    const resultIds = new Set();
    let cursor = index + 1;
    while (cursor < historyRows.length && historyRows[cursor].messageKind === 'tool_result') {
      const tool = parseMessage(historyRows[cursor]);
      if (tool?.tool_call_id) resultIds.add(tool.tool_call_id);
      resultIndexes.push(cursor);
      cursor += 1;
    }
    if (!resultIndexes.length || resultIndexes.length !== callIds.size || [...callIds].some(callId => !resultIds.has(callId)) || [...resultIds].some(callId => !callIds.has(callId))) continue;
    const hearth = hearthExchange(historyRows, index, resultIndexes, hearthResolver);
    const pointers = pointerResolver ? resultIndexes.map(resultIndex => pointerResolver(historyRows[resultIndex])) : [];
    // Once recoverable Exhale is installed, omission is lawful only when every
    // result in the completed exchange has a verified persisted pointer. The
    // one installed exception is the House Hearth: its own custody receipt
    // supplies an exact packet hash and source-bearing wrapper rather than a
    // Result Rack pointer. Other unpointable exchanges remain in attention.
    if (pointerResolver && pointers.some(pointer => !pointer) && !hearth) continue;
    const sameWake = assistantRow.wakeId === currentWakeId;
    const sameWakeRecoverable = sameWake && !hearth && pointerResolver && pointers.length === resultIndexes.length && pointers.every(Boolean);
    if (!sameWake || sameWakeRecoverable) completed.push({ assistantIndex: index, resultIndexes, wakeId: assistantRow.wakeId, callIds: [...callIds], pointers, hearth });
    index = cursor - 1;
  }
  const omitted = retainExchanges ? completed.slice(0, -retainExchanges) : completed;
  const sourceIndexes = omitted.flatMap(group => [group.assistantIndex, ...group.resultIndexes]).map(index => index + sourceOffset);
  const omissions = sourceIndexes.map(sourceIndex => ({ sourceIndex, omitMessage: true, reason: 'Older completed tool exchange omitted by the declared attention ceiling.' }));
  const manifest = omitted.map(group => ({
    wakeId: group.wakeId,
    assistantHistoryOrdinal: historyRows[group.assistantIndex].ordinal,
    resultHistoryOrdinals: group.resultIndexes.map(index => historyRows[index].ordinal),
    callIds: group.callIds,
    messageHashes: [group.assistantIndex, ...group.resultIndexes].map(index => sha256(historyRows[index].messageJson)),
    ...(pointerResolver ? { pointers: group.pointers } : {}),
  }));
  const trailPointers = omitted.flatMap(group => group.pointers || []).filter(Boolean).slice(0, maxTrailSigns);
  const hearthTrailSigns = omitted.filter(group => group.hearth).map(group => group.hearth.wrapper);
  // Wake orchestration may provide explicit phase state. Until it does, the
  // current-wake history is enough to identify a later non-Hearth tool phase:
  // the first response has no resident tool call yet, while every continuation
  // has one. This keeps the planner deterministic and fail-closed.
  const continuation = trailSignContinuation === null
    ? hasNonHearthToolContinuation(historyRows, currentWakeId)
    : trailSignContinuation;
  const trailSigns = continuation
    ? (trailPointers.length ? [buildResultTrailContinuationMarker(trailPointers, { ordinal: 1 })] : [])
    : trailPointers.map((pointer, index) => buildResultTrailSign(pointer, { ordinal: index + 1 }));
  return {
    omissions,
    manifest,
    omittedExchangeCount: omitted.length,
    omittedMessageCount: sourceIndexes.length,
    trailSigns,
    trailSignPresentation: {
      mode: continuation ? 'continuation_marker' : 'initial_full_signs',
      pointerCount: trailPointers.length,
    },
    recoverable: pointerResolver ? omitted.every(group => group.hearth || group.pointers.length === group.resultIndexes.length) : null,
    hearthTrailSigns,
    disclosure: omitted.length
      ? renderFoldDisclosure(`Attention disclosure: ${omitted.length} older completed tool exchange${omitted.length === 1 ? '' : 's'} omitted through declared Scrub whole-message omissions; exact session history remains in host custody.`)
      : null,
  };
}

export function projectSourceRefs(sourceRefs, omissions) {
  const omitted = new Set((omissions || []).filter(item => item.omitMessage).map(item => item.sourceIndex));
  return sourceRefs.filter((_, index) => !omitted.has(index));
}
