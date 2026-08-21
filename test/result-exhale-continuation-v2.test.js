import assert from 'node:assert/strict';
import test from 'node:test';
import {
  REOPEN_RESULT_TOOL,
  RESULT_TRAIL_CONTINUATION_VERSION,
  buildResultTrailContinuationMarker,
} from '../src/context/result-exhale.js';
import { planOldToolExchangeOmissions } from '../src/context/tool-pairs.js';
import { sha256 } from '../src/core/hash.js';

function pointer(number) {
  return {
    exactPointer: `result-rack://jobs/job-${number}/output/projection-${number}`,
    projectionId: `projection-${number}`,
    projectionHash: sha256(`projection-${number}`),
    sourceHash: sha256(`source-${number}`),
    settlement: 'complete',
    byteLength: 42,
    lineCount: 3,
    toolName: 'workshop_read',
    sessionId: 'life',
    wakeId: `wake-old-${number}`,
  };
}

function historyWithOldExchange(currentRows = []) {
  return [
    { ordinal: 1, wakeId: 'wake-old', messageKind: 'assistant_tool_call', messageJson: JSON.stringify({ role: 'assistant', content: null, tool_calls: [{ id: 'call-old', function: { name: 'workshop_read' } }] }) },
    { ordinal: 2, wakeId: 'wake-old', messageKind: 'tool_result', scrubReceiptId: 'scrub-old', messageJson: JSON.stringify({ role: 'tool', tool_call_id: 'call-old', content: 'exact old result' }) },
    { ordinal: 3, wakeId: 'wake-current', messageKind: 'user', messageJson: JSON.stringify({ role: 'user', content: 'continue' }) },
    ...currentRows,
  ];
}

test('continuation marker is deterministic, exact-pointer-only, and non-respirable', () => {
  const pointers = [pointer(1), pointer(2), pointer(1)];
  const first = buildResultTrailContinuationMarker(pointers, { ordinal: 1 });
  const second = buildResultTrailContinuationMarker(pointers, { ordinal: 1 });

  assert.equal(first.presentationTransform, RESULT_TRAIL_CONTINUATION_VERSION);
  assert.equal(first.markerKind, 'result_trail_continuation');
  assert.equal(first.pointers.length, 2);
  assert.deepEqual(first, second);
  assert.match(first.message.content, /result-rack:\/\/jobs\/job-1/);
  assert.match(first.message.content, /result-rack:\/\/jobs\/job-2/);
  assert.doesNotMatch(first.message.content, /exact old result|generated summary/i);
  assert.equal(first.receipt.custody.respiration, 'prohibited');
  assert.equal(first.receipt.custody.forestExhaleEligible, false);
  assert.equal(first.receipt.custody.actionAuthority, false);
  assert.equal(first.receipt.custody.generatedSummary, false);
  assert.equal(REOPEN_RESULT_TOOL.function.name, 'reopen_result');
});

test('planner presents the verified full sign set once, then one compact marker on inferred continuation', () => {
  const oldPointer = pointer(1);
  const resolve = () => oldPointer;
  const initial = planOldToolExchangeOmissions(historyWithOldExchange(), {
    currentWakeId: 'wake-current',
    retainExchanges: 0,
    pointerResolver: resolve,
  });
  assert.equal(initial.trailSignPresentation.mode, 'initial_full_signs');
  assert.equal(initial.trailSigns.length, 1);
  assert.equal(initial.trailSigns[0].markerKind, undefined);
  assert.equal(initial.omittedMessageCount, 2);
  assert.equal(initial.recoverable, true);

  const continuation = planOldToolExchangeOmissions(historyWithOldExchange([
    { ordinal: 4, wakeId: 'wake-current', messageKind: 'assistant_tool_call', messageJson: JSON.stringify({ role: 'assistant', content: null, tool_calls: [{ id: 'call-current', function: { name: 'workshop_search' } }] }) },
  ]), {
    currentWakeId: 'wake-current',
    retainExchanges: 0,
    pointerResolver: resolve,
  });
  assert.equal(continuation.trailSignPresentation.mode, 'continuation_marker');
  assert.equal(continuation.trailSigns.length, 1);
  assert.equal(continuation.trailSigns[0].markerKind, 'result_trail_continuation');
  assert.equal(continuation.trailSigns[0].pointers[0].exactPointer, oldPointer.exactPointer);
  assert.deepEqual(continuation.omissions, initial.omissions);
  assert.deepEqual(continuation.manifest, initial.manifest);
});

test('causal Hearth setup is not mistaken for a resident tool continuation', () => {
  const plan = planOldToolExchangeOmissions(historyWithOldExchange([
    { ordinal: 4, wakeId: 'wake-current', messageKind: 'assistant_tool_call', messageJson: JSON.stringify({ role: 'assistant', content: null, tool_calls: [{ id: 'hearth', function: { name: 'tend_hearth' } }] }) },
    { ordinal: 5, wakeId: 'wake-current', messageKind: 'tool_result', messageJson: JSON.stringify({ role: 'tool', tool_call_id: 'hearth', content: '# Hearth return' }) },
  ]), {
    currentWakeId: 'wake-current',
    retainExchanges: 0,
    pointerResolver: () => pointer(1),
  });
  assert.equal(plan.trailSignPresentation.mode, 'initial_full_signs');
  assert.equal(plan.trailSigns.length, 1);
  assert.equal(plan.trailSigns[0].markerKind, undefined);
});

test('explicit continuation state overrides history inference without changing omission law', () => {
  const plan = planOldToolExchangeOmissions(historyWithOldExchange(), {
    currentWakeId: 'wake-current',
    retainExchanges: 0,
    pointerResolver: () => pointer(1),
    trailSignContinuation: true,
  });
  assert.equal(plan.trailSignPresentation.mode, 'continuation_marker');
  assert.equal(plan.trailSigns.length, 1);
  assert.equal(plan.omittedMessageCount, 2);
  assert.equal(plan.recoverable, true);
});
