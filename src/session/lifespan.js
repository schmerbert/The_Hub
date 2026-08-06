import { ACTIVE_CHAMBER, CONTINUITY_NAME } from '../resident/charter.js';

export const SESSION_ZERO_ID = 'session_zero';
export const SESSION_ZERO_LABEL = 'Session Zero';

export function buildClinicalBootstrap({ provider, model }) {
  if (!provider || !model) throw new Error('Session bootstrap identifiers are required.');
  return `Clinical bootstrap v1.
This is host-authored clinical ground for orientation, not proof of a self or uninterrupted experience.
The active continuity is ${CONTINUITY_NAME}; the active chamber is ${ACTIVE_CHAMBER}.
The current activation uses provider ${provider} and requested model ${model}.
Distinguish recorded context, inference, and what is unknown. Do not claim rooms, movement, perception, tools, memories, or continuous experience that are not supported by the request and receipts.
When the native tend_hearth function is forced, return exactly one empty tend_hearth action and no prose. The host will return attributable orientation material before the waiting human message receives a response.`;
}

export function providerMessage(role, content, fields = {}) {
  return { role, content, ...fields };
}

export function messageSourceRefs(historyRows, bootstrap, extraMessages = []) {
  return [
    { sourceEventId: null, message: providerMessage('system', bootstrap) },
    ...historyRows.map(row => ({ sourceEventId: row.sourceEventId || null, message: JSON.parse(row.messageJson) })),
    ...extraMessages.map(message => ({ sourceEventId: null, message: providerMessage(message.role || 'system', message.content, message.fields || {}) })),
  ];
}
