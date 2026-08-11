import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONVERSATION_TAIL_THRESHOLD_PX,
  captureConversationScroll,
  reconcileThinkingDisclosure,
  restoreConversationScroll,
} from '../public/render-state.js';

test('conversation scroll follows only an existing tail and otherwise restores the exact prior top', () => {
  const nearTail = { scrollTop: 452, clientHeight: 500, scrollHeight: 1000 };
  const nearSnapshot = captureConversationScroll(nearTail);
  assert.equal(CONVERSATION_TAIL_THRESHOLD_PX, 48);
  assert.equal(nearSnapshot.followTail, true);
  nearTail.scrollHeight = 1300;
  restoreConversationScroll(nearTail, nearSnapshot);
  assert.equal(nearTail.scrollTop, 1300);

  const readingHistory = { scrollTop: 451, clientHeight: 500, scrollHeight: 1000 };
  const historySnapshot = captureConversationScroll(readingHistory);
  assert.deepEqual(historySnapshot, { scrollTop: 451, clientHeight: 500, scrollHeight: 1000, followTail: false });
  assert.equal(historySnapshot.followTail, false);
  readingHistory.scrollTop = 0;
  readingHistory.scrollHeight = 1600;
  restoreConversationScroll(readingHistory, historySnapshot);
  assert.equal(readingHistory.scrollTop, 451);
});

test('initial and explicit submission renders tail-follow while invalid metrics remain deterministic', () => {
  const initial = { scrollTop: 0, clientHeight: 0, scrollHeight: 0 };
  assert.equal(captureConversationScroll(initial).followTail, true);

  const scrolledUp = { scrollTop: 125, clientHeight: 300, scrollHeight: 1000 };
  const forced = captureConversationScroll(scrolledUp, { forceTail: true });
  scrolledUp.scrollHeight = 1200;
  restoreConversationScroll(scrolledUp, forced);
  assert.equal(scrolledUp.scrollTop, 1200);

  assert.deepEqual(captureConversationScroll({ scrollTop: NaN, clientHeight: undefined, scrollHeight: null }), { scrollTop: 0, clientHeight: 0, scrollHeight: 0, followTail: true });
});

test('Thinking disclosure persists within one live wake and resets when thinking or the wake changes', () => {
  let disclosure = reconcileThinkingDisclosure(null, { wakeId: 'wake-1', hasThinking: true });
  assert.deepEqual(disclosure, { wakeId: 'wake-1', open: false });

  disclosure = reconcileThinkingDisclosure(disclosure, { wakeId: 'wake-1', hasThinking: true, renderedOpen: true });
  assert.deepEqual(disclosure, { wakeId: 'wake-1', open: true });
  disclosure = reconcileThinkingDisclosure(disclosure, { wakeId: 'wake-1', hasThinking: true });
  assert.equal(disclosure.open, true);

  disclosure = reconcileThinkingDisclosure(disclosure, { wakeId: 'wake-1', hasThinking: false, renderedOpen: true });
  assert.deepEqual(disclosure, { wakeId: null, open: false });
  disclosure = reconcileThinkingDisclosure({ wakeId: 'wake-1', open: true }, { wakeId: 'wake-2', hasThinking: true, renderedOpen: true });
  assert.deepEqual(disclosure, { wakeId: 'wake-2', open: false });
});
