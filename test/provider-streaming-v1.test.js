import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DeepSeekResidentProvider } from '../src/providers/deepseek.js';
import { FakeResidentProvider } from '../src/providers/fake.js';
import { encodeOpenAiDataOnlySse, OpenAiSseAccumulator, parseOpenAiSseBytes } from '../src/providers/sse.js';
import { scrubProviderHistory } from '../src/scrub/provider-presentation.js';
import { assertScrubbedProviderReturn, scrubProviderReturn } from '../src/scrub/provider-return.js';
import { sha256Bytes } from '../src/core/hash.js';
import { readConfig } from '../src/core/config.js';
import { SpineStore } from '../src/spine/store.js';

function payload(id, model, choices, extra = {}) {
  return { id, model, system_fingerprint: 'fp-stream', choices, ...extra };
}

function textStream({ id = 'stream-text', model = 'deepseek-test', lineEnding = '\r\n' } = {}) {
  const events = [
    payload(id, model, [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }]),
    payload(id, model, [{ index: 0, delta: { reasoning_content: 'think 🙂' }, finish_reason: null }]),
    payload(id, model, [{ index: 0, delta: { content: 'Hello ' }, finish_reason: null }]),
    payload(id, model, [{ index: 0, delta: { content: '世界' }, finish_reason: null }]),
    payload(id, model, [{ index: 0, delta: {}, finish_reason: 'stop' }]),
    payload(id, model, [], { usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 } }),
    '[DONE]',
  ];
  return encodeOpenAiDataOnlySse(events, { lineEnding });
}

function rawFrame(body, contentType = 'text/event-stream; charset=utf-8') {
  return {
    record_id: 'raw-stream-1',
    record_hash: 'record-hash',
    raw_body_base64: body.toString('base64'),
    body_byte_length: body.length,
    body_sha256: sha256Bytes(body),
    content_type: contentType,
  };
}

test('SSE parser reconstructs Unicode identically across every byte boundary and emits typed deltas', () => {
  const body = textStream();
  const expected = parseOpenAiSseBytes(body);
  assert.equal(expected.message.reasoning_content, 'think 🙂');
  assert.equal(expected.message.content, 'Hello 世界');
  assert.deepEqual(expected.usage, { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 });
  for (let split = 0; split <= body.length; split += 1) {
    const parser = new OpenAiSseAccumulator();
    parser.push(body.subarray(0, split));
    parser.push(body.subarray(split));
    assert.deepEqual(parser.finish(), expected, `split ${split}`);
  }

  const deltas = [];
  const bytewise = new OpenAiSseAccumulator({ onDelta: event => deltas.push(event) });
  for (const byte of body) bytewise.push(Buffer.from([byte]));
  assert.deepEqual(bytewise.finish().message, expected.message);
  assert.deepEqual(deltas.map(event => event.kind), ['reasoning_content', 'content', 'content']);
  assert.equal(deltas.map(event => event.delta).join(''), 'think 🙂Hello 世界');
});

test('SSE parser deterministically assembles indexed fragmented tool calls', () => {
  const id = 'stream-tools'; const model = 'deepseek-test';
  const body = encodeOpenAiDataOnlySse([
    payload(id, model, [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }]),
    payload(id, model, [{ index: 0, delta: { tool_calls: [
      { index: 0, id: 'call-read', type: 'function', function: { name: 'workshop_', arguments: '{"pa' } },
      { index: 1, id: 'call-status', type: 'function', function: { name: 'sta', arguments: '{' } },
    ] }, finish_reason: null }]),
    payload(id, model, [{ index: 0, delta: { tool_calls: [
      { index: 0, id: null, type: null, function: { name: 'read', arguments: 'th":"a.txt"}' } },
      { index: 1, id: null, type: null, function: { name: 'tus', arguments: '}' } },
    ] }, finish_reason: null }]),
    payload(id, model, [{ index: 0, delta: {}, finish_reason: 'tool_calls' }]),
    '[DONE]',
  ]);
  const deltas = [];
  const result = parseOpenAiSseBytes(body, { onDelta: event => deltas.push(event) });
  assert.deepEqual(result.message, {
    role: 'assistant', content: null,
    tool_calls: [
      { id: 'call-read', type: 'function', function: { name: 'workshop_read', arguments: '{"path":"a.txt"}' } },
      { id: 'call-status', type: 'function', function: { name: 'status', arguments: '{}' } },
    ],
  });
  assert.equal(deltas.filter(event => event.kind === 'tool_call').length, 4);
  assert.deepEqual(deltas[0], { kind: 'tool_call', responseId: id, model, choiceIndex: 0, index: 0, id: 'call-read', type: 'function', function: { name: 'workshop_', arguments: '{"pa' } });
});

test('SSE parser fails closed on malformed, truncated, conflicting, and ambiguous streams', () => {
  const id = 'bad'; const model = 'm';
  const base = payload(id, model, [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }]);
  assert.throws(() => parseOpenAiSseBytes(Buffer.from('data: {bad}\n\ndata: [DONE]\n\n')), /invalid JSON/);
  assert.throws(() => parseOpenAiSseBytes(encodeOpenAiDataOnlySse([base, payload(id, model, [{ index: 0, delta: { content: 'partial' }, finish_reason: 'stop' }])])), /without \[DONE\]/);
  assert.throws(() => parseOpenAiSseBytes(encodeOpenAiDataOnlySse([
    base,
    payload(id, model, [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'a', type: 'function', function: { name: 'x', arguments: '{}' } }] }, finish_reason: null }]),
    payload(id, model, [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'b' }] }, finish_reason: null }]),
    payload(id, model, [{ index: 0, delta: {}, finish_reason: 'tool_calls' }]), '[DONE]',
  ])), /changed id/);
  assert.throws(() => parseOpenAiSseBytes(encodeOpenAiDataOnlySse([
    base,
    payload(id, model, [{ index: 0, delta: { tool_calls: [
      { index: 0, id: 'a', type: 'function', function: { name: 'x', arguments: '{}' } },
      { index: 0, id: 'a', type: 'function', function: { name: 'x', arguments: '{}' } },
    ] }, finish_reason: null }]),
    payload(id, model, [{ index: 0, delta: {}, finish_reason: 'tool_calls' }]), '[DONE]',
  ])), /duplicated/);
  assert.throws(() => parseOpenAiSseBytes(encodeOpenAiDataOnlySse([
    base, payload(id, model, [{ index: 0, delta: { content: 'done' }, finish_reason: 'stop' }]), '[DONE]',
    payload(id, model, [], { usage: { total_tokens: 1 } }),
  ])), /after \[DONE\]/);
  for (const finishReason of ['length', 'content_filter', 'insufficient_system_resource', 'future_reason']) {
    assert.throws(() => parseOpenAiSseBytes(encodeOpenAiDataOnlySse([
      base, payload(id, model, [{ index: 0, delta: { content: 'partial' }, finish_reason: finishReason }]), '[DONE]',
    ])), /unsupported finish reason/);
  }
  assert.throws(() => parseOpenAiSseBytes(encodeOpenAiDataOnlySse([
    base, payload(id, model, [{ index: 0, delta: {}, finish_reason: 'stop' }]), '[DONE]',
  ])), /without a content delta/);
  assert.throws(() => parseOpenAiSseBytes(Buffer.concat([Buffer.from('data: '), Buffer.from([0xff]), Buffer.from('\n\n')])), /UTF-8/);
});

test('return Scrub independently rebuilds an exact SSE message and retains JSON compatibility', () => {
  const body = textStream();
  const scrubbed = scrubProviderReturn(rawFrame(body));
  assertScrubbedProviderReturn(scrubbed);
  assert.deepEqual(scrubbed.message, { role: 'assistant', content: 'Hello 世界', reasoning_content: 'think 🙂' });
  assert.equal(scrubbed.receipt.policyName, 'provider_return_openai_sse_exact_assembly');
  assert.deepEqual(scrubbed.receipt.streamingPolicy, { name: 'openai_data_only_sse', version: 'v1' });
  assert.equal(scrubbed.receipt.source.sha256, sha256Bytes(body));
  assert.equal(scrubbed.receipt.doneObserved, true);

  const jsonBody = Buffer.from(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'legacy' } }] }));
  const jsonScrubbed = scrubProviderReturn({ ...rawFrame(jsonBody, 'application/json'), record_id: 'raw-json' });
  assert.equal(jsonScrubbed.message.content, 'legacy');
  assert.equal(jsonScrubbed.receipt.policyName, 'provider_return_exact_selection');

  const tampered = rawFrame(body);
  tampered.raw_body_base64 = Buffer.from('changed').toString('base64');
  assert.throws(() => scrubProviderReturn(tampered), /does not match its exact bytes/);
  const truncated = body.subarray(0, body.lastIndexOf(Buffer.from('data: [DONE]')));
  assert.throws(() => scrubProviderReturn(rawFrame(truncated)), /not a valid complete/);
});

test('DeepSeek streams exact raw custody once and its terminal result equals independent Scrub assembly', async () => {
  const responseBody = textStream({ id: 'deepseek-live', model: 'deepseek-stream' });
  let requestBody;
  const upstream = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    requestBody = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' });
    const widths = [1, 4, 2, 9, 3, 16];
    let offset = 0; let index = 0;
    while (offset < responseBody.length) {
      const end = Math.min(responseBody.length, offset + widths[index % widths.length]);
      response.write(responseBody.subarray(offset, end));
      offset = end; index += 1;
      await new Promise(resolve => setImmediate(resolve));
    }
    response.end();
  });
  await new Promise(resolve => upstream.listen(0, resolve));
  const provider = new DeepSeekResidentProvider({ apiKey: 'test-key', baseUrl: `http://127.0.0.1:${upstream.address().port}`, thinking: 'enabled' });
  const presentation = scrubProviderHistory([{ role: 'user', content: 'hello' }]);
  const prepared = provider.prepareRequest({ presentation, model: 'deepseek-stream', thinking: 'enabled' });
  const deltas = []; const outcomes = []; const rawReturns = [];
  try {
    const result = await provider.complete({
      presentation, model: 'deepseek-stream', phase: 'ordinary', requestBodyString: prepared.requestBodyString,
      onDelta: event => deltas.push(event),
      onRawReturn: detail => { rawReturns.push(detail); return rawFrame(detail.body, detail.contentType); },
      onOutcome: outcome => outcomes.push(outcome),
    });
    assert.equal(requestBody.stream, true);
    assert.deepEqual(requestBody.stream_options, { include_usage: true });
    assert.equal(rawReturns.length, 1);
    assert.equal(rawReturns[0].body.equals(responseBody), true);
    assert.equal(deltas.some(event => event.kind === 'reasoning_content' && event.phase === 'ordinary'), true);
    assert.equal(deltas.some(event => event.kind === 'content' && event.phase === 'ordinary'), true);
    assert.deepEqual(outcomes, [{ kind: 'success', http_status: 200, response_id: 'deepseek-live' }]);
    const independentlyScrubbed = scrubProviderReturn(result.rawReturnFrame);
    assert.deepEqual(result.message, independentlyScrubbed.message);
    assert.equal(result.content, 'Hello 世界');
    assert.equal(result.reasoningContent, 'think 🙂');
  } finally {
    await new Promise(resolve => upstream.close(resolve));
  }
});

test('DeepSeek records one exact raw return before refusing a truncated stream', async () => {
  const complete = textStream({ id: 'truncated', model: 'm', lineEnding: '\n' });
  const marker = complete.lastIndexOf(Buffer.from('data: [DONE]'));
  const truncated = complete.subarray(0, marker);
  const upstream = createServer((request, response) => {
    request.resume();
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.end(truncated);
  });
  await new Promise(resolve => upstream.listen(0, resolve));
  const provider = new DeepSeekResidentProvider({ apiKey: 'test-key', baseUrl: `http://127.0.0.1:${upstream.address().port}`, thinking: 'disabled' });
  const presentation = scrubProviderHistory([{ role: 'user', content: 'hello' }]);
  const prepared = provider.prepareRequest({ presentation, model: 'm' });
  const rawReturns = []; const outcomes = [];
  try {
    await assert.rejects(
      provider.complete({
        presentation, model: 'm', requestBodyString: prepared.requestBodyString,
        onRawReturn: detail => { rawReturns.push(detail); return rawFrame(detail.body, detail.contentType); },
        onOutcome: outcome => outcomes.push(outcome),
      }),
      error => error.code === 'provider_invalid_response',
    );
    assert.equal(rawReturns.length, 1);
    assert.equal(rawReturns[0].body.equals(truncated), true);
    assert.deepEqual(outcomes, [{ kind: 'invalid_response', http_status: 200 }]);
  } finally {
    await new Promise(resolve => upstream.close(resolve));
  }
});

test('DeepSeek refuses unsupported terminal reasons in JSON compatibility responses', async () => {
  const originalFetch = globalThis.fetch;
  const presentation = scrubProviderHistory([{ role: 'user', content: 'finish completely' }]);
  const provider = new DeepSeekResidentProvider({ apiKey: 'test-key', baseUrl: 'https://provider.invalid', thinking: 'disabled' });
  const prepared = provider.prepareRequest({ presentation, model: 'm' });
  try {
    for (const finishReason of ['length', 'content_filter', 'insufficient_system_resource', 'future_reason']) {
      const body = JSON.stringify({ id: `json-${finishReason}`, model: 'm', choices: [{ message: { role: 'assistant', content: 'partial' }, finish_reason: finishReason }] });
      globalThis.fetch = async () => new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
      const outcomes = [];
      await assert.rejects(provider.complete({
        presentation, model: 'm', requestBodyString: prepared.requestBodyString,
        onRawReturn: detail => rawFrame(detail.body, detail.contentType),
        onOutcome: outcome => outcomes.push(outcome),
      }), error => error.code === 'provider_invalid_response');
      assert.deepEqual(outcomes, [{ kind: 'invalid_response', http_status: 200 }]);
    }
  } finally { globalThis.fetch = originalFetch; }
});

test('DeepSeek retains a partial HTTP body before a typed interrupted-stream outcome', async () => {
  const originalFetch = globalThis.fetch;
  const partial = Buffer.from('data: {"id":"partial"');
  let reads = 0;
  try {
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/event-stream' }),
      body: { getReader: () => ({
        async read() {
          if (reads++ === 0) return { done: false, value: partial };
          throw new Error('socket reset after headers');
        },
        async cancel() {},
      }) },
    });
    const provider = new DeepSeekResidentProvider({ apiKey: 'test-key', baseUrl: 'https://provider.invalid', thinking: 'disabled' });
    const presentation = scrubProviderHistory([{ role: 'user', content: 'interrupt' }]);
    const prepared = provider.prepareRequest({ presentation, model: 'm' });
    const rawReturns = []; const outcomes = []; const order = [];
    await assert.rejects(provider.complete({
      presentation, model: 'm', requestBodyString: prepared.requestBodyString,
      onRawReturn: detail => { order.push('raw'); rawReturns.push(detail); return rawFrame(detail.body, detail.contentType); },
      onOutcome: outcome => { order.push('outcome'); outcomes.push(outcome); },
    }), error => error.code === 'provider_network_error');
    assert.deepEqual(order, ['raw', 'outcome']);
    assert.equal(rawReturns.length, 1);
    assert.equal(rawReturns[0].body.equals(partial), true);
    assert.deepEqual(outcomes, [{ kind: 'network_error', network_code: 'stream_interrupted', http_status: 200 }]);
  } finally { globalThis.fetch = originalFetch; }
});

test('DeepSeek retains admitted HTTP bytes exactly once when an active stream is aborted', async () => {
  const originalFetch = globalThis.fetch;
  const partial = Buffer.from('data: {"id":"aborted"');
  let signal; let readCount = 0; let firstRead;
  const firstReadObserved = new Promise(resolve => { firstRead = resolve; });
  try {
    globalThis.fetch = async (_url, options) => {
      signal = options.signal;
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'text/event-stream' }),
        body: { getReader: () => ({
          async read() {
            if (readCount++ === 0) { firstRead(); return { done: false, value: partial }; }
            return new Promise((_resolve, reject) => {
              const refuse = () => reject(new Error('aborted'));
              if (signal.aborted) refuse();
              else signal.addEventListener('abort', refuse, { once: true });
            });
          },
          async cancel() {},
        }) },
      };
    };
    const provider = new DeepSeekResidentProvider({ apiKey: 'test-key', baseUrl: 'https://provider.invalid', thinking: 'disabled' });
    const presentation = scrubProviderHistory([{ role: 'user', content: 'abort' }]);
    const prepared = provider.prepareRequest({ presentation, model: 'm' });
    const controller = new AbortController();
    const rawReturns = []; const outcomes = []; const order = [];
    const completion = provider.complete({
      presentation, model: 'm', requestBodyString: prepared.requestBodyString, signal: controller.signal,
      onRawReturn: detail => { order.push('raw'); rawReturns.push(detail); return rawFrame(detail.body, detail.contentType); },
      onOutcome: outcome => { order.push('outcome'); outcomes.push(outcome); },
    });
    await firstReadObserved;
    controller.abort('hub_close');
    await assert.rejects(completion, error => error.code === 'provider_cancelled');
    assert.deepEqual(order, ['raw', 'outcome']);
    assert.equal(rawReturns.length, 1);
    assert.equal(rawReturns[0].body.equals(partial), true);
    assert.deepEqual(outcomes, [{ kind: 'network_error', network_code: 'aborted', http_status: 200 }]);
  } finally { globalThis.fetch = originalFetch; }
});

test('provider return ceiling is configured as a validated positive integer', () => {
  assert.equal(readConfig({ HUB_RESIDENT_MODE: 'fake' }).providerMaxReturnBytes, 8 * 1024 * 1024);
  assert.equal(readConfig({ HUB_RESIDENT_MODE: 'fake', HUB_PROVIDER_MAX_RETURN_BYTES: '17' }).providerMaxReturnBytes, 17);
  for (const value of ['0', '-1', '1.5', 'not-a-number']) {
    assert.throws(() => readConfig({ HUB_RESIDENT_MODE: 'fake', HUB_PROVIDER_MAX_RETURN_BYTES: value }), /HUB_PROVIDER_MAX_RETURN_BYTES/);
  }
});

test('DeepSeek bounds first-chunk, later-chunk, and endless response overflow with exact prefix custody', async () => {
  const originalFetch = globalThis.fetch;
  const presentation = scrubProviderHistory([{ role: 'user', content: 'bounded response' }]);
  const scenarios = [
    { name: 'first', limit: 4, chunks: [Buffer.from('12345')], admitted: Buffer.alloc(0), observed: 5 },
    { name: 'later', limit: 3, chunks: [Buffer.from('123'), Buffer.from('45')], admitted: Buffer.from('123'), observed: 5 },
    { name: 'endless', limit: 3, endless: true, admitted: Buffer.from('xxx'), observed: 4 },
  ];
  try {
    for (const scenario of scenarios) {
      let readIndex = 0; let cancelReason = null;
      const reader = {
        async read() {
          if (scenario.endless) { readIndex += 1; return { done: false, value: Buffer.from('x') }; }
          const value = scenario.chunks[readIndex++];
          return value ? { done: false, value } : { done: true, value: undefined };
        },
        async cancel(reason) { cancelReason = reason; },
      };
      globalThis.fetch = async () => ({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'text/event-stream' }),
        body: { getReader: () => reader },
      });
      const provider = new DeepSeekResidentProvider({ apiKey: 'test-key', baseUrl: 'https://provider.invalid', thinking: 'disabled', providerMaxReturnBytes: scenario.limit });
      const prepared = provider.prepareRequest({ presentation, model: 'm' });
      const order = []; const rawReturns = []; const outcomes = [];
      await assert.rejects(
        provider.complete({
          presentation,
          model: 'm',
          requestBodyString: prepared.requestBodyString,
          onRawReturn: detail => { order.push('raw'); rawReturns.push(detail); return rawFrame(detail.body, detail.contentType); },
          onOutcome: outcome => { order.push('outcome'); outcomes.push(outcome); },
        }),
        error => error.code === 'provider_response_too_large',
        scenario.name,
      );
      assert.deepEqual(order, ['raw', 'outcome'], scenario.name);
      assert.equal(rawReturns.length, 1, scenario.name);
      assert.equal(rawReturns[0].body.equals(scenario.admitted), true, scenario.name);
      assert.equal(rawReturns[0].body.length <= scenario.limit, true, scenario.name);
      assert.equal(rawReturns[0].captureComplete, false, scenario.name);
      assert.equal(cancelReason, 'provider_response_too_large', scenario.name);
      assert.deepEqual(outcomes, [{ kind: 'oversized_response', http_status: 200, limit_bytes: scenario.limit, observed_bytes: scenario.observed }], scenario.name);
      assert.equal(readIndex <= scenario.limit + 1, true, scenario.name);
    }
  } finally { globalThis.fetch = originalFetch; }
});

test('over-limit stream tool deltas remain provisional and never produce a terminal provider message', async () => {
  const originalFetch = globalThis.fetch;
  const first = encodeOpenAiDataOnlySse([
    payload('too-large-tools', 'm', [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'call-1', type: 'function', function: { name: 'workshop_read', arguments: '{}' } }] }, finish_reason: null }]),
  ]);
  let cancelled = false;
  let index = 0;
  const chunks = [first, Buffer.from('x')];
  try {
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/event-stream' }),
      body: { getReader: () => ({ read: async () => chunks[index] ? { done: false, value: chunks[index++] } : { done: true }, cancel: async () => { cancelled = true; } }) },
    });
    const provider = new DeepSeekResidentProvider({ apiKey: 'test-key', baseUrl: 'https://provider.invalid', thinking: 'disabled', providerMaxReturnBytes: first.length });
    const presentation = scrubProviderHistory([{ role: 'user', content: 'do not execute partial tools' }]);
    const prepared = provider.prepareRequest({ presentation, model: 'm' });
    const deltas = []; let terminalResult = null;
    await assert.rejects(
      provider.complete({
        presentation, model: 'm', requestBodyString: prepared.requestBodyString,
        onDelta: delta => deltas.push(delta),
        onRawReturn: detail => rawFrame(detail.body, detail.contentType),
        onOutcome: () => {},
      }).then(result => { terminalResult = result; }),
      error => error.code === 'provider_response_too_large',
    );
    assert.equal(deltas.some(delta => delta.kind === 'tool_call'), true);
    assert.equal(terminalResult, null);
    assert.equal(cancelled, true);
  } finally { globalThis.fetch = originalFetch; }
});

test('Spine accepts an oversized outcome only after bounded raw-return custody', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-provider-ceiling-'));
  try {
    const spine = new SpineStore(join(dir, 'spine.jsonl'));
    const request = spine.prepareRequest({ requestBody: '{}', threadId: 'thread-1', wakeId: 'wake-1', provider: 'deepseek', model: 'm', authorizationPresent: true, requestPhase: 'ordinary' });
    spine.dispatchAttempted(request.record_id);
    const raw = spine.providerRawReturn(request.record_id, { body: Buffer.from('123'), httpStatus: 200, contentType: 'text/event-stream', phase: 'ordinary' });
    const outcome = spine.providerOutcome(request.record_id, { kind: 'oversized_response', http_status: 200, limit_bytes: 3, observed_bytes: 4 });
    assert.equal(raw.body_byte_length, 3);
    assert.equal(outcome.outcome.kind, 'oversized_response');
    assert.equal(spine.verify().ok, true);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('Spine validates interrupted and pre/post-response aborted outcomes exactly once', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-provider-network-outcomes-'));
  try {
    const spine = new SpineStore(join(dir, 'spine.jsonl'));
    const append = (wakeId, outcome, { raw = false } = {}) => {
      const request = spine.prepareRequest({ requestBody: '{}', threadId: 'thread-1', wakeId, provider: 'deepseek', model: 'm', authorizationPresent: true, requestPhase: 'ordinary' });
      spine.dispatchAttempted(request.record_id);
      if (raw) spine.providerRawReturn(request.record_id, { body: Buffer.from('partial'), httpStatus: 200, contentType: 'text/event-stream', phase: 'ordinary' });
      const frame = spine.providerOutcome(request.record_id, outcome);
      assert.throws(() => spine.providerOutcome(request.record_id, outcome), /duplicate outcome receipts/);
      return frame;
    };
    assert.equal(append('wake-interrupted', { kind: 'network_error', network_code: 'stream_interrupted', http_status: 200 }, { raw: true }).outcome.network_code, 'stream_interrupted');
    assert.equal(append('wake-aborted-before', { kind: 'network_error', network_code: 'aborted' }).outcome.network_code, 'aborted');
    assert.equal(append('wake-aborted-after', { kind: 'network_error', network_code: 'aborted', http_status: 200 }, { raw: true }).outcome.http_status, 200);
    assert.equal(spine.verify().ok, true);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('Fake provider emits deterministic reasoning, content, and indexed tool deltas with SSE custody', async () => {
  const provider = new FakeResidentProvider();
  const presentation = scrubProviderHistory([{ role: 'user', content: 'hello' }]);
  const prepared = provider.prepareRequest({ presentation, model: 'fake-model' });
  assert.equal(prepared.requestBody.stream, true);
  assert.deepEqual(prepared.requestBody.stream_options, { include_usage: true });
  const orientationDeltas = []; let orientationRaw;
  const orientation = await provider.complete({
    presentation, model: 'fake-model', phase: 'orientation', requestBodyString: prepared.requestBodyString,
    onDelta: delta => orientationDeltas.push(delta),
    onRawReturn: detail => (orientationRaw = rawFrame(detail.body, detail.contentType)),
  });
  assert.equal(orientationDeltas.some(delta => delta.kind === 'reasoning_content'), true);
  assert.equal(orientationDeltas.some(delta => delta.kind === 'tool_call' && delta.index === 0), true);
  assert.deepEqual(scrubProviderReturn(orientationRaw).message, orientation.message);

  const contentDeltas = []; let contentRaw;
  const response = await provider.complete({
    presentation, model: 'fake-model', phase: 'ordinary', requestBodyString: prepared.requestBodyString,
    onDelta: delta => contentDeltas.push(delta),
    onRawReturn: detail => (contentRaw = rawFrame(detail.body, detail.contentType)),
  });
  assert.equal(contentDeltas.filter(delta => delta.kind === 'content').map(delta => delta.delta).join(''), response.content);
  assert.deepEqual(scrubProviderReturn(contentRaw).message, response.message);
});
