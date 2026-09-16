import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHub } from '../src/server/app.js';
import {
  countQuietEmbodimentCalls,
  isQuietEmbodimentAction,
  quietEmbodimentLimitError,
  renderQuietEmbodimentHorizon,
} from '../src/runtime/quiet-embodiment.js';

async function fixture(provider, extra = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'hub-quiet-embodiment-v1-'));
  const hub = createHub({
    env: {
      HUB_RESIDENT_MODE: 'fake',
      HUB_DB_PATH: join(dir, 'hub.sqlite'),
      HUB_SPINE_PATH: join(dir, 'spine.jsonl'),
      HUB_WORLD_PATH: join(dir, 'world.sqlite'),
      HUB_WORKSHOP_ROOT: process.cwd(),
      ...extra,
    },
    provider,
  });
  await new Promise(resolve => hub.server.listen(0, resolve));
  return {
    dir,
    hub,
    base: `http://127.0.0.1:${hub.server.address().port}`,
    close: async () => {
      await new Promise(resolve => hub.server.close(resolve));
      hub.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

async function post(base, content) {
  const response = await fetch(`${base}/api/wakes`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  return { response, body: await response.json() };
}

function hearth() {
  return {
    message: {
      role: 'assistant',
      content: null,
      tool_calls: [{ id: 'hearth', type: 'function', function: { name: 'tend_hearth', arguments: '{}' } }],
    },
    content: null,
    resolvedModel: 'test-model',
    finishReason: 'tool_calls',
  };
}

function call(id, name, args) {
  return { id, type: 'function', function: { name, arguments: JSON.stringify(args) } };
}

test('quiet horizon is optional, bounded, and uses verified place bearings', () => {
  assert.equal(isQuietEmbodimentAction('move_through_passage'), true);
  assert.equal(isQuietEmbodimentAction('tend_hearth'), false);
  assert.equal(countQuietEmbodimentCalls([
    call('a', 'move_through_passage', { passage_id: 'x' }),
    call('b', 'tend_hearth', {}),
    call('c', 'workshop_list', {}),
  ]), 1);
  const horizon = renderQuietEmbodimentHorizon({
    remaining: 4,
    projection: {
      roomId: 'place.house',
      exits: [],
      passages: [{ to: 'place.garden', label: 'Garden door' }],
      boundaries: [],
    },
  });
  assert.match(horizon, /optional/);
  assert.match(horizon, /stay and speak now/);
  assert.match(horizon, /Up to 4 simple embodied actions remain/);
  assert.match(horizon, /Garden may hold the Forest threshold/);
  assert.match(horizon, /not relevance judgments/);
});

test('ordinary wake may stay put and speak immediately', async () => {
  const requests = [];
  const provider = {
    prepareRequest({ phase, messages, tools }) {
      requests.push({ phase, messages: structuredClone(messages), tools: structuredClone(tools) });
      return { requestBodyString: JSON.stringify({ model: 'test-model', messages, tools }) };
    },
    async complete({ phase }) {
      if (phase === 'orientation') return hearth();
      return { message: { role: 'assistant', content: 'No movement was needed.' }, content: 'No movement was needed.', resolvedModel: 'test-model', finishReason: 'stop' };
    },
  };
  const f = await fixture(provider);
  try {
    const result = await post(f.base, 'Answer directly if place would not help.');
    assert.equal(result.response.status, 200);
    assert.equal(result.body.status, 'committed');
    const ordinary = requests.find(request => request.phase !== 'orientation');
    assert.match(ordinary.messages.find(message => message.content?.includes('Quiet embodiment is optional')).content, /stay and speak now/);
    assert.equal(f.hub.world.sqlite.prepare("SELECT COUNT(*) AS count FROM world_action_receipts WHERE tool_name!='tend_hearth'").get().count, 0);
  } finally {
    await f.close();
  }
});

test('useful quiet movement refits World ground before final speech', async () => {
  const requests = [];
  let ordinaryRound = 0;
  const provider = {
    prepareRequest({ phase, messages, tools }) {
      requests.push({ phase, messages: structuredClone(messages), tools: structuredClone(tools) });
      return { requestBodyString: JSON.stringify({ model: 'test-model', messages, tools }) };
    },
    async complete({ phase }) {
      if (phase === 'orientation') return hearth();
      ordinaryRound += 1;
      if (ordinaryRound === 1) return {
        message: { role: 'assistant', content: null, tool_calls: [
          call('open', 'operate_passage', { passage_id: 'passage.garden_house', action: 'open' }),
          call('walk', 'move_through_passage', { passage_id: 'passage.garden_house' }),
        ] },
        content: null,
        resolvedModel: 'test-model',
        finishReason: 'tool_calls',
      };
      return { message: { role: 'assistant', content: 'The Garden gave me the needed footing.' }, content: 'The Garden gave me the needed footing.', resolvedModel: 'test-model', finishReason: 'stop' };
    },
  };
  const f = await fixture(provider, { HUB_QUIET_EMBODIMENT_ACTIONS: '2', HUB_MAX_TOOL_ROUNDS: '3' });
  try {
    const result = await post(f.base, 'Move only if it materially helps.');
    assert.equal(result.response.status, 200);
    assert.equal(result.body.status, 'committed');
    assert.equal(f.hub.world.current(f.hub.db.session.id).room_node_id, 'place.garden');
    const continuation = requests.at(-1);
    assert.match(continuation.messages.find(message => message.content?.includes('Current World ground for this phase')).content, /Current location: place\.garden/);
  } finally {
    await f.close();
  }
});

test('same-batch excess simple action refuses before its World mutation and withdraws on continuation', async () => {
  const requests = [];
  let ordinaryRound = 0;
  const provider = {
    prepareRequest({ phase, messages, tools }) {
      requests.push({ phase, messages: structuredClone(messages), tools: structuredClone(tools) });
      return { requestBodyString: JSON.stringify({ model: 'test-model', messages, tools }) };
    },
    async complete({ phase }) {
      if (phase === 'orientation') return hearth();
      ordinaryRound += 1;
      if (ordinaryRound === 1) return {
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            call('open', 'operate_passage', { passage_id: 'passage.garden_house', action: 'open' }),
            call('walk', 'move_through_passage', { passage_id: 'passage.garden_house' }),
          ],
        },
        content: null,
        resolvedModel: 'test-model',
        finishReason: 'tool_calls',
      };
      return { message: { role: 'assistant', content: 'I stayed with the useful step.' }, content: 'I stayed with the useful step.', resolvedModel: 'test-model', finishReason: 'stop' };
    },
  };
  const f = await fixture(provider, { HUB_QUIET_EMBODIMENT_ACTIONS: '1', HUB_MAX_TOOL_ROUNDS: '3' });
  try {
    const result = await post(f.base, 'Please gather what is relevant, then answer.');
    assert.equal(result.response.status, 200);
    assert.equal(result.body.status, 'committed');
    assert.equal(ordinaryRound, 2);
    const continuation = requests.find(request => request.phase !== 'orientation' && request.messages.some(message => message.content?.includes('No further simple embodied actions remain')));
    assert.ok(continuation);
    assert.equal(continuation.tools.some(tool => tool.function.name === 'move_through_passage'), false);
    assert.equal(continuation.tools.some(tool => tool.function.name === 'operate_passage'), false);
    assert.equal(continuation.tools.some(tool => tool.function.name === 'tend_hearth'), true);
    assert.equal(continuation.tools.some(tool => tool.function.name === 'reopen_result'), true);
    const refused = f.hub.world.sqlite.prepare("SELECT result_json FROM world_action_receipts WHERE tool_name='move_through_passage' AND outcome='refused' ORDER BY rowid DESC LIMIT 1").get();
    assert.ok(refused);
    assert.equal(JSON.parse(refused.result_json).error, 'quiet_embodiment_limit');
    assert.equal(f.hub.world.current(f.hub.db.session.id).room_node_id, 'place.house');
    assert.equal(f.hub.world.sqlite.prepare("SELECT COUNT(*) AS count FROM world_action_receipts WHERE tool_name='move_through_passage' AND outcome='committed'").get().count, 0);
    assert.equal(f.hub.world.sqlite.prepare("SELECT COUNT(*) AS count FROM world_action_receipts WHERE tool_name='operate_passage' AND outcome='committed'").get().count, 1);
  } finally {
    await f.close();
  }
});

test('quiet limit failure is typed', () => {
  assert.deepEqual(quietEmbodimentLimitError(), {
    code: 'quiet_embodiment_limit',
    message: 'The quiet embodied-action horizon is spent; this simple embodied action was refused before World mutation.',
  });
});
