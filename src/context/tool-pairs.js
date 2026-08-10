import { sha256 } from '../core/hash.js';

function parseMessage(row) {
  try { return JSON.parse(row.messageJson); } catch { return null; }
}

/**
 * Selects only completed tool exchanges from older wakes. The source history is
 * never changed; callers pass the returned whole-message omissions through Scrub.
 */
export function planOldToolExchangeOmissions(historyRows, { currentWakeId, retainExchanges = 2, sourceOffset = 1 } = {}) {
  if (!Array.isArray(historyRows)) throw new Error('Tool exchange history must be an array.');
  if (!Number.isInteger(retainExchanges) || retainExchanges < 0) throw new Error('Retained tool exchanges must be a non-negative integer.');
  const completed = [];
  for (let index = 0; index < historyRows.length; index += 1) {
    const assistantRow = historyRows[index];
    if (assistantRow.messageKind !== 'assistant_tool_call') continue;
    const assistant = parseMessage(assistantRow);
    const callIds = new Set((assistant?.tool_calls || []).map(call => call?.id).filter(Boolean));
    if (!callIds.size) continue;
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
    if (assistantRow.wakeId !== currentWakeId) completed.push({ assistantIndex: index, resultIndexes, wakeId: assistantRow.wakeId, callIds: [...callIds] });
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
  }));
  return {
    omissions,
    manifest,
    omittedExchangeCount: omitted.length,
    omittedMessageCount: sourceIndexes.length,
    disclosure: omitted.length
      ? `Attention disclosure: ${omitted.length} older completed tool exchange${omitted.length === 1 ? '' : 's'} omitted through declared Scrub whole-message omissions; exact session history remains in host custody.`
      : null,
  };
}

export function projectSourceRefs(sourceRefs, omissions) {
  const omitted = new Set((omissions || []).filter(item => item.omitMessage).map(item => item.sourceIndex));
  return sourceRefs.filter((_, index) => !omitted.has(index));
}
