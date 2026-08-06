import { assertScrubbedPresentation } from '../scrub/provider-presentation.js';

export class FakeResidentProvider {
  constructor() { this.mode = 'fake'; this.calls = []; }

  prepareRequest({ presentation, model }) {
    assertScrubbedPresentation(presentation);
    const requestBody = { model, messages: presentation.messages, stream: false, thinking: { type: 'disabled' } };
    return { requestBody, requestBodyString: JSON.stringify(requestBody) };
  }

  async complete({ presentation, model, requestBodyString, onBeforeDispatch, onDispatch, onOutcome }) {
    assertScrubbedPresentation(presentation);
    if (onBeforeDispatch) onBeforeDispatch();
    if (onDispatch) onDispatch();
    this.calls.push({ messages: structuredClone(presentation.messages), model, requestBodyString, presentation });
    const last = presentation.messages.at(-1)?.content || '';
    if (onOutcome) onOutcome({ kind: 'success', http_status: 200, response_id: 'fake-response-1' });
    return {
      responseId: 'fake-response-1', resolvedModel: model, requestedModel: model,
      finishReason: 'stop', systemFingerprint: 'fake-fingerprint', usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      content: `FAKE MODE — explicit local demonstration. I received: ${last}`,
    };
  }
}
