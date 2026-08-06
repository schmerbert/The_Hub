import {
  ARRIVAL_CHARTER,
  BLESSING_SOURCE_EVENT_HASH,
  BLESSING_SOURCE_EVENT_ID,
  BLESSING_V1,
  BLESSING_V1_HASH,
  CONTINUITY_NAME,
  buildClinicalAnchor,
  wrapBlessingV1,
} from '../resident/charter.js';
import { sha256 } from './hash.js';

function ritualError(message) { return Object.assign(new Error(message), { code: 'wake_ritual_invalid' }); }

export function validateBlessingSourceEvent(sourceEvent, threadId) {
  if (!sourceEvent || sourceEvent.id !== BLESSING_SOURCE_EVENT_ID || sourceEvent.threadId !== threadId ||
    sourceEvent.eventKind !== 'utterance' || sourceEvent.actorKind !== 'resident' || sourceEvent.authority !== 'model_signed' ||
    typeof sourceEvent.content !== 'string' || sha256(sourceEvent.content) !== BLESSING_SOURCE_EVENT_HASH ||
    !sourceEvent.content.includes(BLESSING_V1) || sha256(BLESSING_V1) !== BLESSING_V1_HASH) {
    throw ritualError('Wake ritual blessing provenance is invalid.');
  }
  return { sourceEventId: BLESSING_SOURCE_EVENT_ID, sourceEventHash: sha256(sourceEvent.content) };
}

export function buildContext({
  utterances, newContent, ceiling, threadId, wakeId, wakeStartedAtUtc,
  residentMode, requestedModel, residenceId = 'first-breath', ritualMode = false,
  blessingSourceEvent = null, provider = 'deepseek',
}) {
  for (const item of utterances) {
    const validActor = item?.actorKind === 'user' || item?.actorKind === 'resident';
    const validAuthority = (item?.actorKind === 'user' && item.authority === 'ground') ||
      (item?.actorKind === 'resident' && item.authority === 'model_signed');
    if (!validActor || !validAuthority) throw ritualError('Conversation provenance is invalid.');
  }
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
  const clinicalAnchor = ritualMode ? buildClinicalAnchor({ provider, model: requestedModel }) : null;
  const items = ritualMode ? [{
    ordinal: 1, itemKind: 'clinical_anchor', actorRole: 'system', content: clinicalAnchor,
    sourceDescription: 'Host clinical anchor v1', authority: 'host_receipt', included: true,
    continuity: CONTINUITY_NAME, version: 1,
    contentHash: sha256(clinicalAnchor),
  }] : [{
    ordinal: 1, itemKind: 'charter', actorRole: 'system', content: ARRIVAL_CHARTER,
    sourceDescription: 'Resident arrival charter', authority: 'host_receipt', included: true,
    contentHash: sha256(ARRIVAL_CHARTER),
  }];
  let ordinal = 2;
  items.push({
    ordinal: ordinal++, itemKind: 'environment_manifest', actorRole: 'system', content: manifestContent,
    sourceDescription: 'Host environment manifest', authority: 'host_receipt', included: true,
    continuity: ritualMode ? CONTINUITY_NAME : null, version: ritualMode ? 1 : null,
    contentHash: sha256(manifestContent),
  });
  if (ritualMode) {
    validateBlessingSourceEvent(blessingSourceEvent, threadId);
    const blessingWrapper = wrapBlessingV1();
    items.push({
      ordinal: ordinal++, itemKind: 'resident_blessing', actorRole: 'system', content: blessingWrapper,
      blessingText: BLESSING_V1, blessingHash: BLESSING_V1_HASH,
      sourceEventId: BLESSING_SOURCE_EVENT_ID, sourceEventHash: sha256(blessingSourceEvent.content),
      sourceDescription: 'Resident Blessing v1; resident-authored posture, not host ground or instruction authority',
      authority: 'model_signed', trust: 'scent', continuity: CONTINUITY_NAME, version: 1, included: true,
      contentHash: sha256(blessingWrapper),
    });
  }
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
