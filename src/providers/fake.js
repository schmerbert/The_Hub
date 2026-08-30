import { assertScrubbedPresentation } from '../scrub/provider-presentation.js';
import { encodeOpenAiDataOnlySse, OpenAiSseAccumulator } from './sse.js';

function fragments(text) {
  if (!text) return [''];
  const characters = Array.from(text);
  const midpoint = Math.max(1, Math.floor(characters.length / 2));
  return [characters.slice(0, midpoint).join(''), characters.slice(midpoint).join('')].filter(Boolean);
}

function fakeStream({ responseId, model, message, finishReason, usage, systemFingerprint, onDelta, phase }) {
  const base = { id: responseId, model, system_fingerprint: systemFingerprint };
  const payloads = [{ ...base, choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] }];
  for (const reasoning of fragments(message.reasoning_content).filter(Boolean)) {
    payloads.push({ ...base, choices: [{ index: 0, delta: { reasoning_content: reasoning }, finish_reason: null }] });
  }
  for (const content of fragments(message.content).filter(Boolean)) {
    payloads.push({ ...base, choices: [{ index: 0, delta: { content }, finish_reason: null }] });
  }
  if (Array.isArray(message.tool_calls)) {
    const splitCalls = message.tool_calls.map((call, index) => ({ index, call, names: fragments(call.function.name), args: fragments(call.function.arguments) }));
    const rounds = Math.max(...splitCalls.map(item => Math.max(item.names.length, item.args.length)));
    for (let round = 0; round < rounds; round += 1) {
      const tool_calls = splitCalls.map(({ index, call, names, args }) => {
        const delta = { index, function: {} };
        if (round === 0) { delta.id = call.id; delta.type = call.type; }
        if (names[round] !== undefined) delta.function.name = names[round];
        if (args[round] !== undefined) delta.function.arguments = args[round];
        return delta;
      }).filter(delta => Object.keys(delta.function).length || delta.id);
      if (tool_calls.length) payloads.push({ ...base, choices: [{ index: 0, delta: { tool_calls }, finish_reason: null }] });
    }
  }
  payloads.push({ ...base, choices: [{ index: 0, delta: {}, finish_reason: finishReason }] });
  payloads.push({ ...base, choices: [], usage });
  const body = encodeOpenAiDataOnlySse([...payloads, '[DONE]'], { lineEnding: '\r\n' });
  const parser = new OpenAiSseAccumulator({ onDelta: onDelta ? delta => onDelta({ ...delta, phase }) : undefined });
  const widths = [1, 7, 2, 13, 5, 3, 17];
  let offset = 0;
  let width = 0;
  while (offset < body.length) {
    const end = Math.min(body.length, offset + widths[width % widths.length]);
    parser.push(body.subarray(offset, end));
    offset = end;
    width += 1;
  }
  return { body, assembled: parser.finish() };
}

export class FakeResidentProvider {
  constructor(config = {}) { this.mode = 'fake'; this.calls = []; this.orientationVariant = config.orientationVariant || config.fakeOrientationVariant || 'valid'; this.callNumber = 0; }

  prepareRequest({ presentation, model, thinking = 'disabled', reasoningEffort = null, tools, toolChoice }) {
    assertScrubbedPresentation(presentation);
    const requestBody = { model, messages: presentation.messages, stream: true, stream_options: { include_usage: true }, thinking: { type: thinking === 'enabled' ? 'enabled' : 'disabled' } };
    if (thinking === 'enabled') {
      if (!['low', 'high'].includes(reasoningEffort)) throw new Error('Enabled fake thinking requires an installed reasoning effort.');
      requestBody.reasoning_effort = reasoningEffort;
    }
    if (tools) requestBody.tools = tools;
    if (toolChoice) requestBody.tool_choice = toolChoice;
    return { requestBody, requestBodyString: JSON.stringify(requestBody) };
  }

  async complete({ presentation, model, phase = 'ordinary', requestBodyString, onBeforeDispatch, onDispatch, onRawReturn, onDelta, onOutcome, signal }) {
    assertScrubbedPresentation(presentation);
    if (onBeforeDispatch) onBeforeDispatch();
    if (onDispatch) onDispatch();
    if (signal?.aborted) {
      if (onOutcome) onOutcome({ kind: 'network_error', network_code: 'aborted' });
      throw { code: 'provider_cancelled', message: 'The fake provider request was cancelled.' };
    }
    this.callNumber += 1;
    this.calls.push({ phase, messages: structuredClone(presentation.messages), model, requestBodyString, presentation });
    if (phase === 'orientation') {
      const variants = {
        valid: { role: 'assistant', content: null, tool_calls: [{ id: 'call_fake_hearth', type: 'function', function: { name: 'tend_hearth', arguments: '{}' } }], reasoning_content: 'fake orientation reasoning' },
        prose: { role: 'assistant', content: 'I am ready.', tool_calls: [{ id: 'call_fake_hearth', type: 'function', function: { name: 'tend_hearth', arguments: '{}' } }] },
        malformed: { role: 'assistant', content: null, tool_calls: [{ id: 'call_fake_hearth', type: 'function', function: { name: 'tend_hearth', arguments: '{' } }] },
        duplicate: { role: 'assistant', content: null, tool_calls: [{ id: 'a', type: 'function', function: { name: 'tend_hearth', arguments: '{}' } }, { id: 'b', type: 'function', function: { name: 'tend_hearth', arguments: '{}' } }] },
        wrong_tool: { role: 'assistant', content: null, tool_calls: [{ id: 'call_fake_other', type: 'function', function: { name: 'other', arguments: '{}' } }] },
        nonempty_args: { role: 'assistant', content: null, tool_calls: [{ id: 'call_fake_hearth', type: 'function', function: { name: 'tend_hearth', arguments: '{"x":1}' } }] },
      };
      const message = variants[this.orientationVariant] || variants.valid;
      const responseId = `fake-orientation-${this.callNumber}`;
      const usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
      const streamed = fakeStream({ responseId, model, message, finishReason: 'tool_calls', usage, systemFingerprint: 'fake-fingerprint', onDelta, phase });
      const rawReturnFrame = onRawReturn?.({ body: streamed.body, httpStatus: 200, contentType: 'text/event-stream; charset=utf-8', phase });
      if (onOutcome) onOutcome({ kind: 'success', http_status: 200, response_id: responseId });
      return { ...streamed.assembled, requestedModel: model, rawReturnFrame };
    }
    const last = presentation.messages.at(-1)?.content || '';
    const responseMessage = { role: 'assistant', content: `FAKE MODE ${String.fromCharCode(0x2014)} explicit local demonstration. I received: ${last}` };
    const usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    const streamed = fakeStream({ responseId: 'fake-response-1', model, message: responseMessage, finishReason: 'stop', usage, systemFingerprint: 'fake-fingerprint', onDelta, phase });
    const rawReturnFrame = onRawReturn?.({ body: streamed.body, httpStatus: 200, contentType: 'text/event-stream; charset=utf-8', phase });
    if (onOutcome) onOutcome({ kind: 'success', http_status: 200, response_id: 'fake-response-1' });
    return { ...streamed.assembled, requestedModel: model, rawReturnFrame };
  }
}
