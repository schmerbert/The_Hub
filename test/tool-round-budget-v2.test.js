import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHub } from '../src/server/app.js';

async function fixture(provider, extra = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'hub-tool-round-budget-v2-'));
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
  const base = `http://127.0.0.1:${hub.server.address().port}`;
  return {
    dir,
    hub,
    base,
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

test('tool-round budget is disclosed and the final opportunity is schema-free', async () => {
  let ordinaryRound = 0;
  const requests = [];
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
          tool_calls: [{ id: 'move', type: 'function', function: { name: 'move_through_passage', arguments: '{"passage_id":"passage.center_garden"}' } }],
        },
        content: null,
        resolvedModel: 'test-model',
        finishReason: 'tool_calls',
      };
      return { message: { role: 'assistant', content: 'The bounded action is complete.' }, content: 'The bounded action is complete.', resolvedModel: 'test-model', finishReason: 'stop' };
    },
  };
  const f = await fixture(provider, { HUB_MAX_TOOL_ROUNDS: '1' });
  try {
    const result = await post(f.base, 'Use one bounded action, then answer.');
    assert.equal(result.response.status, 200);
    assert.equal(result.body.status, 'committed');
    assert.equal(ordinaryRound, 2);
    assert.equal(requests.length, 3);
    assert.ok(requests[1].tools.some(tool => tool.function.name === 'move_through_passage'));
    assert.ok(requests[1].tools.some(tool => tool.function.name === 'reopen_result'));
    assert.match(requests[1].messages.find(message => message.content.includes('Action horizon')).content, /up to 1 further action round may be used/);
    assert.deepEqual(requests[2].tools, []);
    assert.match(requests[2].messages.find(message => message.content.includes('Action horizon')).content, /no further actions are available/);
    assert.match(requests[2].messages.find(message => message.content.includes('Action horizon')).content, /reserved final response/);
  } finally {
    await f.close();
  }
});

test('a tool call emitted in the schema-free final opportunity fails honestly', async () => {
  let ordinaryRound = 0;
  const requests = [];
  const provider = {
    prepareRequest({ phase, messages, tools }) {
      requests.push({ phase, messages: structuredClone(messages), tools: structuredClone(tools) });
      return { requestBodyString: JSON.stringify({ model: 'test-model', messages, tools }) };
    },
    async complete({ phase }) {
      if (phase === 'orientation') return hearth();
      ordinaryRound += 1;
      const toolName = ordinaryRound === 1 ? 'move_through_passage' : 'workshop_list';
      const argumentsJson = ordinaryRound === 1 ? '{"passage_id":"passage.center_garden"}' : '{"path":"."}';
      return {
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [{ id: `call-${ordinaryRound}`, type: 'function', function: { name: toolName, arguments: argumentsJson } }],
        },
        content: null,
        resolvedModel: 'test-model',
        finishReason: 'tool_calls',
      };
    },
  };
  const f = await fixture(provider, { HUB_MAX_TOOL_ROUNDS: '1' });
  try {
    const result = await post(f.base, 'Try one action too many.');
    assert.equal(result.body.status, 'failed');
    assert.equal(result.body.failureCode, 'world_tool_round_limit');
    assert.equal(ordinaryRound, 2);
    assert.deepEqual(requests[2].tools, []);
    assert.equal(f.hub.world.sqlite.prepare("SELECT COUNT(*) AS count FROM world_action_receipts WHERE outcome='refused' AND tool_name='workshop_list'").get().count, 1);
  } finally {
    await f.close();
  }
});
