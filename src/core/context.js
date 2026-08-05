import { ARRIVAL_CHARTER } from '../resident/charter.js';
import { sha256 } from './hash.js';

export function buildContext({
  utterances, newContent, ceiling, threadId, wakeId, wakeStartedAtUtc,
  residentMode, requestedModel, residenceId = 'first-breath',
}) {
  const all = [...utterances, { id: '$NEW_USER', actorKind: 'user', authority: 'ground', content: newContent }];
  const keep = all.slice(-ceiling);
  const omitted = all.length - keep.length;
  const wakeStartedAtUnixMs = Date.parse(wakeStartedAtUtc);
  if (!threadId || !wakeId || !wakeStartedAtUtc || !Number.isFinite(wakeStartedAtUnixMs)) {
    throw new Error('Orientation receipt requires persisted wake identity and timestamp.');
  }
  const manifest = {
    schema_version: 1,
    residence_id: residenceId,
    thread_id: threadId,
    wake_id: wakeId,
    wake_started_at_utc: wakeStartedAtUtc,
    wake_started_at_unix_ms: wakeStartedAtUnixMs,
    prior_utterance_count: utterances.length,
    incoming_utterance_ordinal: utterances.length + 1,
    context_scope: 'conversation_only',
    context_ceiling: ceiling,
    older_utterances_omitted: omitted,
    exposed_tools: [],
    resident_mode: residentMode,
    requested_model: requestedModel,
  };
  const manifestContent = `Host environment manifest:\n${JSON.stringify(manifest)}`;
  const items = [{
    ordinal: 1, itemKind: 'charter', actorRole: 'system', content: ARRIVAL_CHARTER,
    sourceDescription: 'Resident arrival charter', authority: 'host_receipt', included: true,
    contentHash: sha256(ARRIVAL_CHARTER),
  }];
  let ordinal = 2;
  items.push({
    ordinal: ordinal++, itemKind: 'environment_manifest', actorRole: 'system', content: manifestContent,
    sourceDescription: 'Host environment manifest', authority: 'host_receipt', included: true,
    contentHash: sha256(manifestContent),
  });
  if (omitted > 0) {
    const disclosure = `Context disclosure: ${omitted} older utterance${omitted === 1 ? '' : 's'} omitted because the message-count ceiling is ${ceiling}; no summary was created.`;
    items.push({ ordinal: ordinal++, itemKind: 'disclosure', actorRole: 'system', content: disclosure,
      sourceDescription: 'Host context-ceiling disclosure', authority: 'host_receipt', included: true,
      contentHash: sha256(disclosure) });
  }
  const keptIds = new Set(keep.map(item => item.id));
  for (const item of all) {
    const included = keptIds.has(item.id);
    items.push({ ordinal: ordinal++, itemKind: 'utterance', actorRole: item.actorKind === 'resident' ? 'assistant' : 'user',
      content: item.content, sourceEventId: item.id === '$NEW_USER' ? null : item.id, sourceDescription: `Thread utterance by ${item.actorKind}`,
      authority: item.authority, included, omissionReason: included ? null : `Older than the ${ceiling}-utterance context ceiling`,
      contentHash: sha256(item.content) });
  }
  const messages = items.filter(item => item.included).map(item => ({ role: item.actorRole, content: item.content }));
  return { items, messages };
}
