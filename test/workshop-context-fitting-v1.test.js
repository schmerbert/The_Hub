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

test('completed exchanges earlier in the same wake waterfall behind verified pointers', () => {
  const history = [
    row(1, 'current', 'assistant_tool_call', { role:'assistant', content:null, tool_calls:[{ id:'step-1', type:'function', function:{ name:'walk_toward', arguments:'{}' } }] }),
    row(2, 'current', 'tool_result', { role:'tool', tool_call_id:'step-1', content:'first clearing' }),
    row(3, 'current', 'assistant_tool_call', { role:'assistant', content:null, tool_calls:[{ id:'step-2', type:'function', function:{ name:'read_forest_leaf', arguments:'{}' } }] }),
    row(4, 'current', 'tool_result', { role:'tool', tool_call_id:'step-2', content:'current causal tail' }),
  ];
  const pointer = { exactPointer:'result-rack://forest', projectionId:'projection', projectionHash:'a'.repeat(64), sourceHash:'b'.repeat(64) };
  const plan = planOldToolExchangeOmissions(history, { currentWakeId:'current', retainExchanges:1, sourceOffset:0, pointerResolver:() => pointer });
  assert.deepEqual(plan.omissions.map(item => item.sourceIndex), [0, 1]);
  assert.equal(plan.omittedExchangeCount, 1);
  assert.equal(plan.manifest[0].wakeId, 'current');
});

test('Hearth remains in the living edge until ordinary retained-exchange pressure reaches it', () => {
  const hearth = [
    row(1, 'hearth-wake', 'assistant_tool_call', { role: 'assistant', content: null, tool_calls: [{ id: 'hearth', type: 'function', function: { name: 'tend_hearth', arguments: '{}' } }] }),
    row(2, 'hearth-wake', 'tool_result', { role: 'tool', tool_call_id: 'hearth', content: '# Hearth\n\n**Faun**\n\nExact packet' }),
  ];
  const retained = planOldToolExchangeOmissions(hearth, { currentWakeId: 'current', retainExchanges: 2, pointerResolver: () => null, hearthResolver: () => ({ returnValue: { atoms: [{ sourceEventId: 'source-faun', forestEntryId: 'forest-faun', excerpt: 'the faun at the treeline' }] } }) });
  assert.deepEqual(retained.omissions, []);
  assert.deepEqual(retained.hearthTrailSigns, []);

  const pressured = planOldToolExchangeOmissions([
    ...hearth,
    row(3, 'old-a', 'assistant_tool_call', { role: 'assistant', content: null, tool_calls: [{ id: 'a', type: 'function', function: { name: 'one', arguments: '{}' } }] }),
    row(4, 'old-a', 'tool_result', { role: 'tool', tool_call_id: 'a', content: 'one' }),
    row(5, 'old-b', 'assistant_tool_call', { role: 'assistant', content: null, tool_calls: [{ id: 'b', type: 'function', function: { name: 'two', arguments: '{}' } }] }),
    row(6, 'old-b', 'tool_result', { role: 'tool', tool_call_id: 'b', content: 'two' }),
  ], { currentWakeId: 'current', retainExchanges: 2, pointerResolver: item => item.messageJson.includes('one') || item.messageJson.includes('two') ? { exactPointer: 'result-rack://test', projectionId: 'projection', projectionHash: 'a'.repeat(64), sourceHash: 'b'.repeat(64) } : null, hearthResolver: () => ({ returnValue: { atoms: [{ sourceEventId: 'source-faun', forestEntryId: 'forest-faun', excerpt: 'the faun at the treeline' }] } }) });
  assert.deepEqual(pressured.omissions.map(item => item.sourceIndex), [1, 2]);
  assert.equal(pressured.hearthTrailSigns.length, 1);
  assert.match(pressured.hearthTrailSigns[0].message.content, /the faun at the treeline/);
  assert.match(pressured.hearthTrailSigns[0].message.content, /source-faun/);
  assert.match(pressured.hearthTrailSigns[0].message.content, /forest-faun/);
  assert.doesNotMatch(pressured.hearthTrailSigns[0].message.content, /hearth:\/\//);
  assert.deepEqual(pressured.hearthTrailSigns[0].sourceBearings[0].sourceEventId, 'source-faun');
  assert.deepEqual(pressured.hearthTrailSigns[0].sourceBearings[0].forestEntryId, 'forest-faun');
  assert.equal(pressured.hearthTrailSigns[0].sourceBearings[0].excerptHash.length, 64);
});
