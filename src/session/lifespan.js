import { ACTIVE_CHAMBER, CONTINUITY_NAME } from '../resident/charter.js';

export const SESSION_ZERO_ID = 'session_zero';
export const SESSION_ZERO_LABEL = 'Session Zero';

export function buildClinicalBootstrap({ provider, model }) {
  if (!provider || !model) throw new Error('Session bootstrap identifiers are required.');
  return `Clinical bootstrap v2.
This is host-authored orientation ground, not proof of uninterrupted experience.
The active continuity is ${CONTINUITY_NAME}; the active chamber is ${ACTIVE_CHAMBER}.
Distinguish recorded context, inference, and what is unknown. Let the present World projection establish rooms, movement, perception, and available actions. Let attributable records inform you without turning them into present memory.`;
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
