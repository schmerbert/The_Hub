export const HUB_EVENT_PROTOCOL = 'hub_event/v1';
export const HUB_EVENT_SCHEMA_VERSION = 1;

export const HUB_EVENT_KINDS = Object.freeze([
  'wake.accepted',
  'phase.started',
  'provider.thinking.delta',
  'provider.content.delta',
  'provider.tool_call.delta',
  'provider.message.ready',
  'tool_call.ready',
  'tool.started',
  'tool.completed',
  'tool.refused',
  'approval.pending',
  'card.upsert',
  'message.committed',
  'wake.completed',
  'wake.failed',
  'resync_required',
]);

export function registerHubEventSource(eventSource, listener) {
  const eventTypes = ['message', 'hub_event', ...HUB_EVENT_KINDS];
  for (const eventType of eventTypes) eventSource.addEventListener(eventType, listener);
  return () => {
    for (const eventType of eventTypes) eventSource.removeEventListener?.(eventType, listener);
  };
}

const TERMINAL_KINDS = new Set(['wake.completed', 'wake.failed']);
const CARD_KINDS = new Set(['action', 'diff', 'result', 'approval']);

function string(value) { return typeof value === 'string' ? value : null; }

function displayText(value) {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try { return JSON.stringify(value, null, 2); } catch { return ''; }
}

function payloadOf(event) {
  return event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload) ? event.payload : {};
}

function eventWakeId(event) {
  const payload = payloadOf(event);
  return string(event.wakeId) || string(payload.wakeId);
}

function deltaText(payload) {
  return string(payload.delta) ?? string(payload.text) ?? string(payload.content) ?? '';
}

function phaseName(event) {
  const payload = payloadOf(event);
  if (typeof payload.phase === 'string') return payload.phase;
  if (payload.phase && typeof payload.phase === 'object') return string(payload.phase.name) || string(payload.phase.phase);
  if (typeof event.phase === 'string') return event.phase;
  if (event.phase && typeof event.phase === 'object') return string(event.phase.name) || string(event.phase.phase);
  return string(payload.name);
}

function cardKind(value) { return CARD_KINDS.has(value) ? value : 'action'; }

function cardIdFor(kind, payload) {
  const source = payload.card && typeof payload.card === 'object' ? payload.card : payload;
  const explicit = string(source.cardId) || string(payload.cardId);
  if (explicit) return explicit;
  const identity = string(payload.toolCallId) || string(payload.callId) || string(payload.actionId) || string(payload.approvalId);
  return identity ? `${kind}:${identity}` : null;
}

function normalizeCard(kind, payload, sequence, prior) {
  const source = payload.card && typeof payload.card === 'object' ? payload.card : payload;
  const cardId = cardIdFor(kind, payload);
  if (!cardId) return null;
  const revision = Number.isInteger(source.revision) && source.revision >= 0 ? source.revision : sequence;
  const inferredKind = kind === 'approval.pending' ? 'approval' : kind === 'tool.completed' ? 'result' : 'action';
  const normalizedKind = cardKind(string(source.cardKind) || string(source.kind) || prior?.cardKind || inferredKind);
  const approvalId = string(source.approvalId) || string(payload.approvalId) || prior?.approvalId || null;
  const normalizedState = string(source.state) || (kind === 'tool.started' ? 'running' : kind === 'tool.completed' ? 'completed' : kind === 'tool.refused' ? 'refused' : kind === 'approval.pending' || (normalizedKind === 'approval' && approvalId) ? 'pending' : prior?.state || 'ready');
  return {
    cardId,
    revision,
    cardKind: normalizedKind,
    state: normalizedState,
    label: string(source.label) || string(source.title) || string(payload.toolName) || string(payload.name) || prior?.label || 'Action',
    detail: displayText(source.detail ?? source.content ?? source.preview ?? source.result ?? payload.detail ?? payload.result ?? prior?.detail),
    pointer: string(source.pointer) || string(source.exactPointer) || prior?.pointer || null,
    approvalId,
    decidable: source.decidable === true || payload.decidable === true || (normalizedKind === 'approval' && normalizedState === 'pending' && Boolean(approvalId)),
  };
}

function updateCard(state, kind, payload, sequence) {
  const cardId = cardIdFor(kind, payload);
  const prior = cardId ? state.cards[cardId] : null;
  const card = normalizeCard(kind, payload, sequence, prior);
  if (!card || (prior && card.revision <= prior.revision)) return state;
  const firstAppearance = !prior;
  return {
    ...state,
    cards: { ...state.cards, [card.cardId]: card },
    cardOrder: prior ? state.cardOrder : [...state.cardOrder, card.cardId],
    timeline: firstAppearance ? [...state.timeline, { kind: 'card', id: card.cardId }] : state.timeline,
  };
}

function phaseTimelineLabel(phase) {
  return phase === 'orientation' ? 'Orienting' : 'Considering…';
}

function updateThinkingTimeline(state, text, { replace = false } = {}) {
  let segmentId = state.thinkingSegmentId;
  let timeline = state.timeline;
  if (!segmentId) {
    segmentId = `thinking:${state.phaseKey || 'phase'}`;
    timeline = [...timeline, { kind: 'thinking', id: segmentId, text: '' }];
  }
  timeline = timeline.map(segment => segment.id === segmentId
    ? { ...segment, text: replace ? text : `${segment.text || ''}${text}` }
    : segment);
  return { ...state, timeline, thinkingSegmentId: segmentId };
}

function updateSpeechTimeline(state, text, { replace = false } = {}) {
  let segmentId = state.speechSegmentId;
  let timeline = state.timeline;
  if (!segmentId) {
    segmentId = `speech:${state.phaseKey || 'phase'}`;
    timeline = [...timeline, { kind: 'speech', id: segmentId, text: '' }];
  }
  timeline = timeline.map(segment => segment.id === segmentId
    ? { ...segment, text: replace ? text : `${segment.text || ''}${text}` }
    : segment);
  return { ...state, timeline, speechSegmentId: segmentId };
}

function resetForWake(state, wakeId) {
  return {
    ...state,
    activeWakeId: wakeId,
    phase: null,
    thinking: '',
    draft: '',
    toolCalls: {},
    cards: {},
    cardOrder: [],
    timeline: [],
    phaseKey: null,
    thinkingSegmentId: null,
    speechSegmentId: null,
    terminal: null,
    status: 'assembling',
    optimisticUser: state.optimisticUser ? { ...state.optimisticUser, wakeId } : null,
  };
}

export function createLiveState() {
  return {
    lastSequence: 0,
    connection: 'connecting',
    resyncRequired: false,
    activeWakeId: null,
    phase: null,
    thinking: '',
    draft: '',
    toolCalls: {},
    cards: {},
    cardOrder: [],
    timeline: [],
    phaseKey: null,
    thinkingSegmentId: null,
    speechSegmentId: null,
    terminal: null,
    status: 'idle',
    optimisticUser: null,
  };
}

export function reduceHubEvent(current, event) {
  if (!event || event.schemaVersion !== HUB_EVENT_SCHEMA_VERSION || !Number.isInteger(event.sequence) || typeof event.kind !== 'string') return current;
  if (event.kind === 'resync_required') {
    if (event.sequence < 0) return current;
    return current.resyncRequired ? current : { ...current, resyncRequired: true };
  }
  if (event.sequence <= 0) return current;
  if (event.sequence <= current.lastSequence) return current;
  if (current.lastSequence > 0 && event.sequence !== current.lastSequence + 1) {
    return current.resyncRequired ? current : { ...current, resyncRequired: true };
  }
  let state = { ...current, lastSequence: event.sequence };
  const wakeId = eventWakeId(event);
  if (event.kind === 'wake.accepted') {
    if (!wakeId) return state;
    state = current.activeWakeId === wakeId ? state : resetForWake(state, wakeId);
    return { ...state, lastSequence: event.sequence, status: 'assembling' };
  }
  if (!wakeId) return state;
  if (state.activeWakeId && state.activeWakeId !== wakeId) return state;
  if (!state.activeWakeId) state = resetForWake(state, wakeId);
  const payload = payloadOf(event);

  if (event.kind === 'phase.started') {
    const phase = phaseName(event);
    const phaseKey = `${phase || 'phase'}:${event.sequence}`;
    return {
      ...state,
      phase,
      phaseKey,
      thinkingSegmentId: null,
      speechSegmentId: null,
      timeline: [...state.timeline, { kind: 'phase', id: `phase:${phaseKey}`, label: phaseTimelineLabel(phase) }],
      status: phase === 'orientation' ? 'orienting' : 'calling provider',
      thinking: '',
      draft: '',
    };
  }
  if (event.kind === 'provider.thinking.delta') {
    const delta = deltaText(payload);
    return { ...updateThinkingTimeline(state, delta), thinking: state.thinking + delta, status: 'thinking' };
  }
  if (event.kind === 'provider.content.delta') {
    const delta = deltaText(payload);
    return { ...updateSpeechTimeline(state, delta), draft: state.draft + delta, status: 'responding' };
  }
  if (event.kind === 'provider.tool_call.delta') {
    const index = Number.isInteger(payload.index) && payload.index >= 0 ? payload.index : null;
    if (index === null) return { ...state, resyncRequired: true };
    const key = `${state.phaseKey || state.phase || 'phase'}:${index}`;
    const prior = state.toolCalls[key] || { index, id: '', type: '', name: '' };
    const fn = payload.function && typeof payload.function === 'object' ? payload.function : {};
    const next = {
      index,
      id: prior.id + (string(payload.id) || string(payload.idDelta) || ''),
      type: string(payload.type) || prior.type,
      name: prior.name + (string(fn.name) || string(payload.nameDelta) || ''),
    };
    const firstAppearance = !state.toolCalls[key];
    return {
      ...state,
      toolCalls: { ...state.toolCalls, [key]: next },
      timeline: firstAppearance ? [...state.timeline, { kind: 'tool', id: key }] : state.timeline,
      status: 'preparing tools',
    };
  }
  if (event.kind === 'provider.message.ready') {
    const message = payload.message && typeof payload.message === 'object' ? payload.message : null;
    const exactThinking = typeof message?.reasoning_content === 'string' ? message.reasoning_content : null;
    const exactSpeech = typeof message?.content === 'string' ? message.content : null;
    state = exactThinking !== null ? updateThinkingTimeline(state, exactThinking, { replace: true }) : state;
    state = exactSpeech !== null && exactSpeech ? updateSpeechTimeline(state, exactSpeech, { replace: true }) : state;
    return {
      ...state,
      draft: exactSpeech ?? state.draft,
      thinking: exactThinking ?? state.thinking,
      status: 'message ready',
    };
  }
  if (event.kind === 'tool_call.ready' || event.kind === 'tool.started' || event.kind === 'tool.completed' || event.kind === 'tool.refused' || event.kind === 'approval.pending' || event.kind === 'card.upsert') {
    state = updateCard(state, event.kind, payload, event.sequence);
    const cardId = cardIdFor(event.kind, payload);
    const currentCard = cardId ? state.cards[cardId] : null;
    const status = event.kind === 'tool.started' ? 'using tools' : event.kind === 'approval.pending' || (currentCard?.cardKind === 'approval' && currentCard.state === 'pending') ? 'awaiting approval' : event.kind === 'tool.refused' ? 'tool refused' : event.kind === 'tool.completed' ? 'working' : state.status;
    return { ...state, status };
  }
  // Keep the sealed provider draft visible until canonical thread replacement.
  if (event.kind === 'message.committed') return { ...state, status: 'committed' };
  if (TERMINAL_KINDS.has(event.kind)) {
    return { ...state, terminal: { kind: event.kind, wakeId, sequence: event.sequence }, status: event.kind === 'wake.failed' ? 'failed' : 'committed' };
  }
  return state;
}

export function setLiveConnection(state, connection) {
  return { ...state, connection };
}

export function setOptimisticUser(state, content, localId) {
  return { ...state, optimisticUser: { content: String(content), localId: String(localId), wakeId: null } };
}

export function clearOptimisticUser(state) {
  return state.optimisticUser ? { ...state, optimisticUser: null } : state;
}

export function acknowledgeResync(state) {
  return state.resyncRequired ? { ...state, resyncRequired: false } : state;
}

export async function recoverHubEventHistory(current, loadHistory, { limit = 1000, maxPages = 100 } = {}) {
  if (typeof loadHistory !== 'function') throw new TypeError('loadHistory must be a function.');
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new RangeError('limit must be an integer from 1 to 1000.');
  if (!Number.isInteger(maxPages) || maxPages < 1) throw new RangeError('maxPages must be a positive integer.');
  let state = current;
  for (let pageNumber = 0; pageNumber < maxPages; pageNumber += 1) {
    const afterSequence = state.lastSequence;
    const history = await loadHistory(afterSequence, limit);
    if (!history || !Array.isArray(history.events) || !Number.isInteger(history.latestSequence) || history.latestSequence < afterSequence || typeof history.hasMore !== 'boolean') throw new Error('Invalid event recovery history.');
    for (const envelope of history.events) {
      if (!Number.isInteger(envelope?.sequence)) throw new Error('Invalid event recovery sequence.');
      if (envelope.sequence <= state.lastSequence) continue;
      if (envelope.sequence !== state.lastSequence + 1) throw new Error('Incomplete event recovery history.');
      const next = reduceHubEvent(state, envelope);
      if (next.lastSequence !== envelope.sequence) throw new Error('Invalid event recovery envelope.');
      state = next;
    }
    if (history.hasMore === false && state.lastSequence >= history.latestSequence) return acknowledgeResync(state);
    if (state.lastSequence === afterSequence) throw new Error('Event recovery made no progress.');
  }
  throw new Error('Event recovery exceeded its bounded page limit.');
}

export function clearLiveWake(state, wakeId) {
  if (wakeId && state.activeWakeId && wakeId !== state.activeWakeId) return state;
  return {
    ...state,
    activeWakeId: null,
    phase: null,
    thinking: '',
    draft: '',
    toolCalls: {},
    cards: {},
    cardOrder: [],
    timeline: [],
    phaseKey: null,
    thinkingSegmentId: null,
    speechSegmentId: null,
    terminal: null,
    optimisticUser: null,
  };
}

export function projectLiveState(state) {
  const timeline = state.timeline.map(segment => {
    if (segment.kind === 'card') return state.cards[segment.id] ? { ...segment, card: state.cards[segment.id] } : null;
    if (segment.kind === 'tool') return state.toolCalls[segment.id] ? { ...segment, toolCall: state.toolCalls[segment.id] } : null;
    return { ...segment };
  }).filter(Boolean);
  return {
    wakeId: state.activeWakeId,
    status: state.status,
    thinking: state.thinking,
    draft: state.draft,
    toolCalls: Object.values(state.toolCalls).sort((left, right) => left.index - right.index),
    cards: state.cardOrder.map(cardId => state.cards[cardId]).filter(Boolean),
    timeline,
    optimisticUser: state.optimisticUser,
    terminal: state.terminal,
    connection: state.connection,
    resyncRequired: state.resyncRequired,
  };
}
