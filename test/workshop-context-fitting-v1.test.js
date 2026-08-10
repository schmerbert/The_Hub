import test from 'node:test';
import assert from 'node:assert/strict';
import { planOldToolExchangeOmissions, projectSourceRefs } from '../src/context/tool-pairs.js';
import { scrubProviderHistory, verifyScrubbedProjection } from '../src/scrub/provider-presentation.js';

function row(ordinal, wakeId, messageKind, message) {
  return { ordinal, wakeId, messageKind, messageJson: JSON.stringify(message) };
}

test('old completed multi-tool exchanges are omitted as declared whole messages while current work remains exact', () => {
  const history = [
    row(1, 'old-a', 'assistant_tool_call', { role: 'assistant', content: null, tool_calls: [
      { id: 'a1', type: 'function', function: { name: 'one', arguments: '{}' } },
      { id: 'a2', type: 'function', function: { name: 'two', arguments: '{}' } },
    ] }),
    row(2, 'old-a', 'tool_result', { role: 'tool', tool_call_id: 'a1', content: 'large one' }),
    row(3, 'old-a', 'tool_result', { role: 'tool', tool_call_id: 'a2', content: 'large two' }),
    row(4, 'old-b', 'assistant_tool_call', { role: 'assistant', content: null, tool_calls: [{ id: 'b1', type: 'function', function: { name: 'three', arguments: '{}' } }] }),
    row(5, 'old-b', 'tool_result', { role: 'tool', tool_call_id: 'b1', content: 'keep recent' }),
    row(6, 'current', 'assistant_tool_call', { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'four', arguments: '{}' } }] }),
    row(7, 'current', 'tool_result', { role: 'tool', tool_call_id: 'c1', content: 'keep active' }),
  ];
  const plan = planOldToolExchangeOmissions(history, { currentWakeId: 'current', retainExchanges: 1 });
  assert.equal(plan.omittedExchangeCount, 1);
  assert.equal(plan.omittedMessageCount, 3);
  assert.deepEqual(plan.omissions.map(item => item.sourceIndex), [1, 2, 3]);
  assert.match(plan.disclosure, /exact session history remains in host custody/);

  const refs = [
    { message: { role: 'system', content: 'ground' } },
    ...history.map(item => ({ message: JSON.parse(item.messageJson) })),
    { message: { role: 'system', content: plan.disclosure } },
  ];
  const source = refs.map(ref => ref.message);
  const scrubbed = scrubProviderHistory(source, { omissions: plan.omissions });
  assert.equal(verifyScrubbedProjection(source, scrubbed), true);
  assert.deepEqual(scrubbed.messages, projectSourceRefs(refs, plan.omissions).map(ref => ref.message));
  assert.equal(scrubbed.messages.some(message => message.tool_call_id === 'a1'), false);
  assert.equal(scrubbed.messages.some(message => message.tool_call_id === 'b1'), true);
  assert.equal(scrubbed.messages.some(message => message.tool_call_id === 'c1'), true);
});

test('incomplete and unmatched exchanges are never omitted', () => {
  const history = [
    row(1, 'old', 'assistant_tool_call', { role: 'assistant', content: null, tool_calls: [{ id: 'missing', type: 'function', function: { name: 'one', arguments: '{}' } }] }),
    row(2, 'old', 'tool_result', { role: 'tool', tool_call_id: 'different', content: 'not its result' }),
  ];
  const plan = planOldToolExchangeOmissions(history, { currentWakeId: 'current', retainExchanges: 0 });
  assert.deepEqual(plan.omissions, []);
});
