import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  acknowledgeResync,
  clearLiveWake,
  clearOptimisticUser,
  createLiveState,
  projectLiveState,
  recoverHubEventHistory,
  reduceHubEvent,
  registerHubEventSource,
  setLiveConnection,
  setOptimisticUser,
} from '../public/live-state.js';

function envelope(sequence, kind, payload = {}, wakeId = 'wake-live') {
  return { schemaVersion: 1, sequence, kind, wakeId, payload };
}

test('live reducer projects a complete streamed wake without making provisional content canonical', () => {
  let state = setOptimisticUser(createLiveState(), '  exact <user> text  ', 'local-1');
  state = reduceHubEvent(state, envelope(1, 'wake.accepted'));
  assert.deepEqual(state.optimisticUser, { content: '  exact <user> text  ', localId: 'local-1', wakeId: 'wake-live' });
  state = reduceHubEvent(state, envelope(2, 'phase.started', { phase: { name: 'orientation' } }));
  state = reduceHubEvent(state, envelope(3, 'provider.thinking.delta', { delta: 'careful ' }));
  state = reduceHubEvent(state, envelope(4, 'provider.thinking.delta', { text: '<thought>' }));
  state = reduceHubEvent(state, envelope(5, 'provider.content.delta', { delta: 'draft ' }));
  state = reduceHubEvent(state, envelope(6, 'provider.content.delta', { content: '<unsafe-looking>' }));
  state = reduceHubEvent(state, envelope(7, 'provider.tool_call.delta', { index: 0, id: 'call-', type: 'function', function: { name: 'workshop_', arguments: '{"pa' } }));
  state = reduceHubEvent(state, envelope(8, 'provider.tool_call.delta', { index: 0, idDelta: '1', function: { name: 'read', arguments: 'th":"a"}' } }));
  state = reduceHubEvent(state, envelope(9, 'provider.message.ready', { message: { role: 'assistant', content: 'draft <unsafe-looking>', reasoning_content: 'careful <thought>' } }));
  state = reduceHubEvent(state, envelope(10, 'tool_call.ready', { cardId: 'tool-card', revision: 1, cardKind: 'action', label: 'Read a file', callId: 'call-1' }));
  state = reduceHubEvent(state, envelope(11, 'tool.started', { cardId: 'tool-card', revision: 2, state: 'running', label: 'Read a file' }));
  state = reduceHubEvent(state, envelope(12, 'tool.completed', { cardId: 'tool-card', revision: 3, cardKind: 'result', state: 'completed', label: 'Read complete', detail: '<exact output>', exactPointer: 'result-rack://job/j/output' }));
  state = reduceHubEvent(state, envelope(13, 'card.upsert', { cardId: 'approval-card', revision: 1, cardKind: 'approval', approvalId: 'approval-1', title: 'Apply patch', content: '<diff>' }));
  let projected = projectLiveState(state);
  assert.equal(projected.status, 'awaiting approval');
  assert.equal(projected.thinking, 'careful <thought>');
  assert.equal(projected.draft, 'draft <unsafe-looking>');
  assert.deepEqual(projected.toolCalls, [{ index: 0, id: 'call-1', type: 'function', name: 'workshop_read' }]);
  assert.equal(Object.hasOwn(projected.toolCalls[0], 'arguments'), false);
  assert.deepEqual(projected.cards.map(card => [card.cardId, card.revision, card.cardKind, card.state]), [
    ['tool-card', 3, 'result', 'completed'],
    ['approval-card', 1, 'approval', 'pending'],
  ]);
  assert.equal(projected.cards[0].detail, '<exact output>');
  assert.equal(projected.cards[0].pointer, 'result-rack://job/j/output');
  assert.deepEqual(projected.timeline.map(segment => segment.kind), ['phase', 'thinking', 'tool', 'card', 'card']);
  assert.equal(projected.timeline[1].text, 'careful <thought>');
  assert.equal(projected.timeline[2].toolCall.name, 'workshop_read');
  assert.equal(projected.timeline[3].card.label, 'Read complete');

  state = reduceHubEvent(state, envelope(14, 'message.committed', { content: 'canonical only on thread endpoint' }));
  projected = projectLiveState(state);
  assert.equal(projected.draft, '');
  assert.equal(Object.hasOwn(projected, 'conversation'), false);
  state = reduceHubEvent(state, envelope(15, 'wake.completed'));
  assert.deepEqual(projectLiveState(state).terminal, { kind: 'wake.completed', wakeId: 'wake-live', sequence: 15 });
  assert.equal(projectLiveState(state).status, 'committed');
});

test('sequence and card revision rules ignore duplicates and require resync on gaps', () => {
  let state = reduceHubEvent(createLiveState(), envelope(20, 'wake.accepted'));
  state = reduceHubEvent(state, envelope(21, 'card.upsert', { cardId: 'stable', revision: 4, cardKind: 'diff', label: 'New', detail: 'new' }));
  state = reduceHubEvent(state, envelope(22, 'card.upsert', { cardId: 'stable', revision: 3, cardKind: 'diff', label: 'Old', detail: 'old' }));
  assert.equal(state.cards.stable.label, 'New');
  assert.equal(state.cards.stable.revision, 4);
  const duplicate = reduceHubEvent(state, envelope(22, 'card.upsert', { cardId: 'stable', revision: 5, label: 'Duplicate sequence' }));
  assert.equal(duplicate, state);
  const old = reduceHubEvent(state, envelope(19, 'wake.failed'));
  assert.equal(old, state);

  state = reduceHubEvent(state, envelope(24, 'provider.content.delta', { delta: 'must not apply across gap' }));
  assert.equal(state.lastSequence, 22);
  assert.equal(state.resyncRequired, true);
  assert.equal(state.draft, '');
  state = acknowledgeResync(state);
  assert.equal(state.resyncRequired, false);
  state = reduceHubEvent(state, envelope(25, 'resync_required'));
  assert.equal(state.resyncRequired, true);
});

test('live timeline preserves thinking and actions between provider phases', () => {
  let state = reduceHubEvent(createLiveState(), envelope(1, 'wake.accepted'));
  state = reduceHubEvent(state, envelope(2, 'phase.started', { phase: 'ordinary' }));
  state = reduceHubEvent(state, envelope(3, 'provider.thinking.delta', { delta: 'first thought' }));
  state = reduceHubEvent(state, envelope(4, 'provider.tool_call.delta', { index: 0, id: 'first', function: { name: 'inspect_fixture' } }));
  state = reduceHubEvent(state, envelope(5, 'card.upsert', { cardId: 'first-card', revision: 1, label: 'Looks at the stone' }));
  state = reduceHubEvent(state, envelope(6, 'phase.started', { phase: 'ordinary' }));
  state = reduceHubEvent(state, envelope(7, 'provider.thinking.delta', { delta: 'second thought' }));
  state = reduceHubEvent(state, envelope(8, 'provider.tool_call.delta', { index: 0, id: 'second', function: { name: 'turn_fixture' } }));
  const timeline = projectLiveState(state).timeline;
  assert.deepEqual(timeline.map(segment => segment.kind), ['phase', 'thinking', 'tool', 'card', 'phase', 'thinking', 'tool']);
  assert.deepEqual(timeline.filter(segment => segment.kind === 'thinking').map(segment => segment.text), ['first thought', 'second thought']);
  assert.deepEqual(timeline.filter(segment => segment.kind === 'tool').map(segment => segment.toolCall.name), ['inspect_fixture', 'turn_fixture']);
});

test('named EventSource lifecycle events reach the reducer, dedupe, and invoke terminal reconciliation', () => {
  const source = new EventTarget();
  let state = createLiveState();
  let terminalRefreshes = 0;
  const receive = messageEvent => {
    const next = reduceHubEvent(state, JSON.parse(messageEvent.data));
    if (next === state) return;
    state = next;
    if (projectLiveState(state).terminal) terminalRefreshes += 1;
  };
  const unregister = registerHubEventSource(source, receive);
  const dispatch = event => source.dispatchEvent(new MessageEvent(event.kind, { data: JSON.stringify(event) }));
  dispatch(envelope(1, 'wake.accepted'));
  dispatch(envelope(2, 'phase.started', { phase: 'ordinary' }));
  dispatch(envelope(3, 'provider.thinking.delta', { delta: '<reasoning>' }));
  dispatch(envelope(4, 'provider.content.delta', { delta: '<draft>' }));
  dispatch(envelope(5, 'provider.tool_call.delta', { index: 0, id: 'call-1', type: 'function', function: { name: 'workshop_read', arguments: '{}' } }));
  dispatch(envelope(6, 'card.upsert', { cardId: 'card-1', revision: 1, cardKind: 'result', detail: '<result>' }));
  dispatch(envelope(6, 'card.upsert', { cardId: 'card-1', revision: 2, detail: 'duplicate must not apply' }));
  dispatch(envelope(7, 'wake.completed'));
  const projected = projectLiveState(state);
  assert.equal(projected.thinking, '<reasoning>');
  assert.equal(projected.draft, '');
  assert.equal(projected.toolCalls[0].name, 'workshop_read');
  assert.equal(projected.cards[0].detail, '<result>');
  assert.equal(projected.cards[0].revision, 1);
  assert.equal(terminalRefreshes, 1);
  unregister();
  source.dispatchEvent(new MessageEvent('wake.failed', { data: JSON.stringify(envelope(8, 'wake.failed')) }));
  assert.equal(terminalRefreshes, 1);
});

test('active wake history recovery restores missed thinking, tool, and card state before terminal', async () => {
  let state = reduceHubEvent(createLiveState(), envelope(1, 'wake.accepted'));
  state = reduceHubEvent(state, envelope(2, 'phase.started', { phase: 'ordinary' }));
  state = reduceHubEvent(state, envelope(6, 'wake.completed'));
  assert.equal(state.lastSequence, 2);
  assert.equal(state.resyncRequired, true);
  const pages = [];
  state = await recoverHubEventHistory(state, async (after, limit) => {
    pages.push([after, limit]);
    return {
      events: [
        envelope(3, 'provider.thinking.delta', { delta: 'recovered thought' }),
        envelope(4, 'provider.tool_call.delta', { index: 0, id: 'recovered-call', type: 'function', function: { name: 'workshop_read', arguments: '{}' } }),
        envelope(5, 'card.upsert', { cardId: 'recovered-card', revision: 1, cardKind: 'result', detail: 'recovered result' }),
        envelope(6, 'wake.completed'),
      ],
      latestSequence: 6,
      hasMore: false,
    };
  });
  const projected = projectLiveState(state);
  assert.deepEqual(pages, [[2, 1000]]);
  assert.equal(state.resyncRequired, false);
  assert.equal(projected.thinking, 'recovered thought');
  assert.equal(projected.toolCalls[0].id, 'recovered-call');
  assert.equal(projected.cards[0].detail, 'recovered result');
  assert.equal(projected.terminal.sequence, 6);
});

test('history recovery refuses incomplete pages without acknowledging the gap', async () => {
  let state = reduceHubEvent(createLiveState(), envelope(1, 'wake.accepted'));
  state = reduceHubEvent(state, envelope(3, 'provider.content.delta', { delta: 'gap' }));
  await assert.rejects(
    recoverHubEventHistory(state, async () => ({ events: [envelope(3, 'provider.content.delta', { delta: 'still missing two' })], latestSequence: 3, hasMore: false })),
    /Incomplete event recovery history/,
  );
  assert.equal(state.lastSequence, 1);
  assert.equal(state.resyncRequired, true);
});

test('tool refusal, malformed tool index, failed terminal, connection, and clearing are deterministic', () => {
  let state = setLiveConnection(createLiveState(), 'open');
  state = reduceHubEvent(state, envelope(1, 'wake.accepted'));
  state = reduceHubEvent(state, envelope(2, 'tool.refused', { cardId: 'refused', revision: 1, label: 'Delete', detail: 'policy refused' }));
  assert.equal(projectLiveState(state).cards[0].state, 'refused');
  state = reduceHubEvent(state, envelope(3, 'provider.tool_call.delta', { index: -1, function: { arguments: '{}' } }));
  assert.equal(state.resyncRequired, true);
  state = reduceHubEvent(state, envelope(4, 'wake.failed', { failureCode: 'provider_invalid_response' }));
  assert.equal(projectLiveState(state).status, 'failed');
  assert.equal(projectLiveState(state).draft, '');
  state = clearOptimisticUser(state);
  const cleared = clearLiveWake(state, 'wake-live');
  assert.equal(cleared.activeWakeId, null);
  assert.equal(cleared.cards.refused, undefined);
  assert.equal(cleared.connection, 'open');
  assert.equal(cleared.lastSequence, 4);
});

test('invalid schema, shape, sequence, and unrelated-wake events do not mutate visible state', () => {
  let state = reduceHubEvent(createLiveState(), envelope(1, 'wake.accepted'));
  const cases = [
    null,
    { schemaVersion: 2, sequence: 2, kind: 'provider.content.delta', wakeId: 'wake-live', payload: { delta: 'x' } },
    { schemaVersion: 1, sequence: '2', kind: 'provider.content.delta', wakeId: 'wake-live', payload: { delta: 'x' } },
    envelope(2, 'provider.content.delta', { delta: 'other wake' }, 'wake-other'),
  ];
  for (const candidate of cases) {
    const next = reduceHubEvent(state, candidate);
    if (candidate?.sequence === 2 && candidate?.wakeId === 'wake-other') {
      assert.equal(next.draft, '');
      assert.equal(next.lastSequence, 2);
      state = next;
    } else assert.equal(next, state);
  }
});

test('Corner opens one same-origin EventSource and renders events through textContent with polling fallback', async () => {
  const [app, html, css, reducer] = await Promise.all([
    readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/styles.css', import.meta.url), 'utf8'),
    readFile(new URL('../public/live-state.js', import.meta.url), 'utf8'),
  ]);
  assert.equal((app.match(/new EventSource\(path\)/g) || []).length, 1);
  assert.match(app, /registerHubEventSource\(source, receiveHubEvent\)/);
  assert.match(app, /events\/history\?after=\$\{afterSequence\}&limit=\$\{limit\}/);
  assert.match(app, /setInterval\(pollSlips, 400\)/);
  assert.match(app, /liveState\.connection === 'open'/);
  assert.match(app, /retainWakeSlips/);
  assert.match(app, /clearLiveWake/);
  assert.match(app, /renderThread\(thread\)/);
  assert.match(app, /captureConversationScroll\(conversationScroller\)/);
  assert.match(app, /renderLive\(\{ scrollSnapshot: preservedScroll \}\)/);
  assert.match(app, /renderLive\(\{ forceTail: true \}\)/);
  assert.match(app, /function scheduleLiveRender\(\)/);
  assert.match(app, /requestAnimationFrame/);
  assert.match(app, /for \(const segment of projection\.timeline\)/);
  assert.match(app, /openThinkingDisclosures/);
  assert.match(app, /gap wake-timeline/);
  assert.doesNotMatch(app, /`Steps [^`]*\$\{steps\.length\}`/);
  assert.doesNotMatch(app, /conversationScroller\.scrollTop\s*=\s*conversationScroller\.scrollHeight/);
  assert.match(app, /event\.content === optimistic\.content/);
  assert.match(app, /textContent = content/);
  assert.doesNotMatch(`${app}\n${reducer}`, /innerHTML/);
  assert.doesNotMatch(`${app}\n${reducer}`, /toolCall\.arguments|fn\.arguments|argumentsDelta/);
  assert.match(html, /id="live-conversation"/);
  assert.match(html, /id="live-gap"/);
  assert.match(css, /\.provisional-resident/);
  assert.match(css, /\.live-card\.card-approval/);
  assert.match(app, /window\.cornerDesktop/);
  for (const kind of [
    'wake.accepted', 'phase.started', 'provider.thinking.delta', 'provider.content.delta', 'provider.tool_call.delta',
    'provider.message.ready', 'tool_call.ready', 'tool.started', 'tool.completed', 'tool.refused', 'approval.pending',
    'card.upsert', 'message.committed', 'wake.completed', 'wake.failed', 'resync_required',
  ]) assert.equal(reducer.includes(`'${kind}'`), true, `missing reducer event: ${kind}`);
});
