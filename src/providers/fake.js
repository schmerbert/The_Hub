import { assertScrubbedPresentation } from '../scrub/provider-presentation.js';

export class FakeResidentProvider {
  constructor(config = {}) { this.mode = 'fake'; this.calls = []; this.orientationVariant = config.orientationVariant || config.fakeOrientationVariant || 'valid'; this.callNumber = 0; }

  prepareRequest({ presentation, model, thinking = 'disabled', tools, toolChoice }) {
    assertScrubbedPresentation(presentation);
    const requestBody = { model, messages: presentation.messages, stream: false, thinking: { type: thinking === 'enabled' ? 'enabled' : 'disabled' } };
    if (tools) requestBody.tools = tools;
    if (toolChoice) requestBody.tool_choice = toolChoice;
    return { requestBody, requestBodyString: JSON.stringify(requestBody) };
  }

  async complete({ presentation, model, phase = 'ordinary', requestBodyString, onBeforeDispatch, onDispatch, onRawReturn, onOutcome }) {
    assertScrubbedPresentation(presentation);
    if (onBeforeDispatch) onBeforeDispatch();
    if (onDispatch) onDispatch();
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
      const rawReturnFrame = onRawReturn?.({ body: Buffer.from(JSON.stringify({ id: `fake-orientation-${this.callNumber}`, model, choices: [{ message, finish_reason: 'tool_calls' }] }), 'utf8'), httpStatus: 200, contentType: 'application/json', phase });
      if (onOutcome) onOutcome({ kind: 'success', http_status: 200, response_id: `fake-orientation-${this.callNumber}` });
      return { responseId: `fake-orientation-${this.callNumber}`, resolvedModel: model, requestedModel: model, finishReason: 'tool_calls', systemFingerprint: 'fake-fingerprint', usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }, content: null, message, toolCalls: message.tool_calls, reasoningContent: message.reasoning_content, rawReturnFrame };
    }
    const last = presentation.messages.at(-1)?.content || '';
    const responseMessage = { role: 'assistant', content: `FAKE MODE ${String.fromCharCode(0x2014)} explicit local demonstration. I received: ${last}` };
    const rawReturnFrame = onRawReturn?.({ body: Buffer.from(JSON.stringify({ id: 'fake-response-1', model, choices: [{ message: responseMessage, finish_reason: 'stop' }] }), 'utf8'), httpStatus: 200, contentType: 'application/json', phase });
    if (onOutcome) onOutcome({ kind: 'success', http_status: 200, response_id: 'fake-response-1' });
    return {
      responseId: 'fake-response-1', resolvedModel: model, requestedModel: model,
      finishReason: 'stop', systemFingerprint: 'fake-fingerprint', usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }, message: responseMessage, rawReturnFrame,
      content: `FAKE MODE — explicit local demonstration. I received: ${last}`,
    };
  }
}
