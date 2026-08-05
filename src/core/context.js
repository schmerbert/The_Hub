import { ARRIVAL_CHARTER } from '../resident/charter.js';
import { sha256 } from './hash.js';

export function buildContext({ utterances, newContent, ceiling }) {
  const all = [...utterances, { id: '$NEW_USER', actorKind: 'user', authority: 'ground', content: newContent }];
  const keep = all.slice(-ceiling);
  const omitted = all.length - keep.length;
  const items = [{
    ordinal: 1, itemKind: 'charter', actorRole: 'system', content: ARRIVAL_CHARTER,
    sourceDescription: 'Resident arrival charter', authority: 'host_receipt', included: true,
    contentHash: sha256(ARRIVAL_CHARTER),
  }];
  let ordinal = 2;
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
