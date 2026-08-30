import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHub } from '../src/server/app.js';
import { DeepSeekResidentProvider } from '../src/providers/deepseek.js';
import { scrubProviderHistory } from '../src/scrub/provider-presentation.js';
import { isSimpleEmbodiedAction, providerReasoningControls, selectReasoningPosture } from '../src/runtime/reasoning-posture.js';

function intent(id, name, args = {}) {
  return { id, type: 'function', function: { name, arguments: JSON.stringify(args) } };
}

async function hubFixture(env = {}, provider = undefined) {
  const dir = await mkdtemp(join(tmpdir(), 'hub-responsive-presence-'));
  const hub = createHub({
    env: {
      HUB_RESIDENT_MODE: 'fake',
      DEEPSEEK_THINKING: 'enabled',
      HUB_DB_PATH: join(dir, 'hub.sqlite'),
      HUB_SPINE_PATH: join(dir, 'spine.jsonl'),
      HUB_WORLD_PATH: join(dir, 'world.sqlite'),
      HUB_FOREST_PATH: join(dir, 'forest.sqlite'),
      HUB_RESULT_PATH: join(dir, 'results.sqlite'),
      ...env,
    },
    provider,
  });
  return { hub, dir };
}

test('reasoning posture fitting selects installed light and attentive levels', () => {
  assert.deepEqual(selectReasoningPosture({ phase: 'orientation', roomId: 'place.house' }), { posture: 'light', effort: 'low', reason: 'forced_hearth_orientation' });
  assert.deepEqual(selectReasoningPosture({ phase: 'ordinary', roomId: 'place.garden' }), { posture: 'light', effort: 'low', reason: 'garden_place' });
  assert.deepEqual(selectReasoningPosture({ phase: 'ordinary', roomId: 'room.workshop' }), { posture: 'attentive', effort: 'high', reason: 'place_default' });
  assert.deepEqual(selectReasoningPosture({ phase: 'ordinary', roomId: 'place.garden', forestWalkActive: true }), { posture: 'attentive', effort: 'high', reason: 'forest_walk' });
  assert.deepEqual(selectReasoningPosture({ phase: 'ordinary', roomId: 'room.workshop', afterSimpleAction: true }), { posture: 'light', effort: 'low', reason: 'after_simple_embodied_action' });
  assert.equal(isSimpleEmbodiedAction('tend_hearth'), true);
  assert.equal(isSimpleEmbodiedAction('inspect_fixture'), true);
  assert.equal(isSimpleEmbodiedAction('workshop_read'), false);
  assert.deepEqual(providerReasoningControls({ thinking: 'enabled', posture: 'light', effort: 'low' }), { thinking: 'enabled', reasoningEffort: 'low' });
  assert.deepEqual(providerReasoningControls({ thinking: 'enabled', posture: 'attentive', effort: 'high' }), { thinking: 'enabled', reasoningEffort: 'high' });
  assert.deepEqual(providerReasoningControls({ thinking: 'disabled', posture: 'light', effort: 'low' }), { thinking: 'disabled', reasoningEffort: null });
  assert.throws(() => providerReasoningControls({ thinking: 'enabled', posture: 'light', effort: 'max' }), /not installed/);
});

test('DeepSeek request JSON carries exact low/high effort only when thinking is enabled', () => {
  const presentation = scrubProviderHistory([{ role: 'system', content: 'ground' }]);
  const provider = new DeepSeekResidentProvider({ apiKey: 'test-key', baseUrl: 'https://provider.invalid', thinking: 'enabled' });
  const low = JSON.parse(provider.prepareRequest({ presentation, model: 'deepseek-v4-flash', thinking: 'enabled', reasoningEffort: 'low' }).requestBodyString);
  assert.deepEqual(low, {
    model: 'deepseek-v4-flash', messages: [{ role: 'system', content: 'ground' }], stream: true,
    stream_options: { include_usage: true }, thinking: { type: 'enabled' }, reasoning_effort: 'low',
  });
  const high = JSON.parse(provider.prepareRequest({ presentation, model: 'deepseek-v4-flash', thinking: 'enabled', reasoningEffort: 'high' }).requestBodyString);
  assert.equal(high.reasoning_effort, 'high');
  assert.throws(() => provider.prepareRequest({ presentation, model: 'deepseek-v4-flash', thinking: 'enabled', reasoningEffort: 'max' }), error => error.code === 'provider_reasoning_effort_invalid');
  const disabled = JSON.parse(provider.prepareRequest({ presentation, model: 'deepseek-v4-flash', thinking: 'disabled', reasoningEffort: null }).requestBodyString);
  assert.deepEqual(disabled.thinking, { type: 'disabled' });
  assert.equal(Object.hasOwn(disabled, 'reasoning_effort'), false);
});

test('enabled requests witness fitted posture and exact provider effort', async () => {
  const { hub, dir } = await hubFixture();
  try {
    const first = await hub.wake('Wake with the Hearth.');
    assert.equal(first.status, 'committed');
    assert.deepEqual(first.phases.map(phase => phase.attention.reasoningPosture), ['light', 'attentive']);
    assert.deepEqual(first.phases.map(phase => phase.attention.reasoningEffort), [null, 'high']);
    assert.deepEqual(first.phases.map(phase => JSON.parse(phase.requestBody).reasoning_effort ?? null), [null, 'high']);
    assert.deepEqual(first.phases.map(phase => JSON.parse(phase.requestBody).thinking.type), ['disabled', 'enabled']);
    assert.equal(first.phases[0].glassGroundReceipts.find(item => item.receipt.kind === 'crossing_ground').receipt.reasoningPosture, 'light');
    assert.equal(first.phases[0].glassGroundReceipts.find(item => item.receipt.kind === 'crossing_ground').receipt.reasoningEffort, null);
    const second = await hub.wake('Continue in the House.');
    assert.equal(second.phases[0].attention.reasoningPosture, 'attentive');
    assert.equal(second.phases[0].attention.reasoningEffort, 'high');
    assert.equal(JSON.parse(second.phases[0].requestBody).reasoning_effort, 'high');
  } finally { await hub.close(); await rm(dir, { recursive: true, force: true }); }
});

class RereadProvider {
  constructor() { this.calls = []; this.round = 0; }
  prepareRequest({ presentation, model, thinking, reasoningEffort, tools, toolChoice }) {
    const body = { model, messages: presentation.messages, stream: false, thinking: { type: thinking === 'enabled' ? 'enabled' : 'disabled' } };
    if (thinking === 'enabled') body.reasoning_effort = reasoningEffort;
    if (tools) body.tools = tools;
    if (toolChoice) body.tool_choice = toolChoice;
    return { requestBody: body, requestBodyString: JSON.stringify(body) };
  }
  async complete({ phase, requestBodyString, onBeforeDispatch, onDispatch, onOutcome }) {
    const body = JSON.parse(requestBodyString);
    this.calls.push({ phase, body });
    onBeforeDispatch?.(); onDispatch?.();
    let message;
    if (phase === 'orientation') {
      message = { role: 'assistant', content: null, tool_calls: [intent('first-hearth', 'tend_hearth')] };
    } else if (this.round++ === 0) {
      message = { role: 'assistant', content: null, tool_calls: [intent('reread-hearth', 'tend_hearth')] };
    } else {
      message = { role: 'assistant', content: 'The Hearth is still here.', reasoning_content: '' };
    }
    onOutcome?.({ kind: 'success', http_status: 200, response_id: `${phase}-${this.calls.length}` });
    return { message, content: message.content, toolCalls: message.tool_calls || null, finishReason: message.tool_calls ? 'tool_calls' : 'stop', resolvedModel: body.model };
  }
}

test('settled Hearth reread is exact, idempotent, and House-local', async () => {
  const provider = new RereadProvider();
  const { hub, dir } = await hubFixture({}, provider);
  try {
    const first = await hub.wake('Please wake and reread the Hearth.');
    assert.equal(first.status, 'committed');
    assert.equal(first.phases.length, 3);
    assert.equal(first.phases[0].phase, 'orientation');
    assert.deepEqual(provider.calls.map(call => call.body.reasoning_effort ?? null), [null, 'high', 'low']);
    assert.deepEqual(provider.calls.map(call => call.body.thinking.type), ['disabled', 'enabled', 'enabled']);
    const hearthRows = hub.db.sqlite.prepare('SELECT id, wake_id, scroll_hash FROM hearth_receipts ORDER BY created_at,id').all();
    assert.equal(hearthRows.length, 1);
    const packet = hub.db.getSessionHearthPacket(hub.db.session.id);
    const toolResults = hub.db.getSessionHistory(hub.db.session.id).filter(row => row.messageKind === 'tool_result' && row.messageJson.includes('# Hearth'));
    assert.equal(toolResults.length, 2);
    for (const row of toolResults) assert.equal(JSON.parse(row.messageJson).content, packet.scrollMarkdown);
    const rereadReceipt = hub.db.getHostReturnScrubReceipt(toolResults[1].scrubReceiptId);
    assert.equal(rereadReceipt.receipt.policy, 'house_hearth_packet_markdown_v1');
    assert.equal(rereadReceipt.receipt.exact, false);
    assert.equal(rereadReceipt.result.settlementUnchanged, true);
    assert.equal(rereadReceipt.result.inheritanceSelection, 'unchanged');
    assert.equal(hub.world.projection(hub.db.session.id).fixtures.find(item => item.id === 'fixture.hearth').state.affordance.available, true);

    await hub.gateway.execute({ sessionId: hub.db.session.id, wakeId: 'leave-house', intent: { id: 'open', type: 'function', function: { name: 'operate_passage', arguments: JSON.stringify({ passage_id: 'passage.garden_house', action: 'open' }) } } });
    await hub.gateway.execute({ sessionId: hub.db.session.id, wakeId: 'leave-house', intent: { id: 'function', type: 'function', function: { name: 'move_through_passage', arguments: JSON.stringify({ passage_id: 'passage.garden_house' }) } } });
    assert.equal(hub.world.current(hub.db.session.id).room_node_id, 'place.garden');
    assert.equal(hub.world.availableTools(hub.db.session.id).includes('tend_hearth'), false);
    await assert.rejects(() => hub.gateway.execute({ sessionId: hub.db.session.id, wakeId: 'outside', intent: { id: 'outside-hearth', type: 'function', function: { name: 'tend_hearth', arguments: '{}' } } }), error => error.code === 'world_wrong_station');
  } finally { await hub.close(); await rm(dir, { recursive: true, force: true }); }
});
