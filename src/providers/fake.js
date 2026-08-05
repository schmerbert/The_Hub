export class FakeResidentProvider {
  constructor() { this.mode = 'fake'; this.calls = []; }

  prepareRequest({ messages, model }) {
    const requestBody = { model, messages, stream: false, thinking: { type: 'disabled' } };
    return { requestBody, requestBodyString: JSON.stringify(requestBody) };
  }

  async complete({ messages, model, requestBodyString, onBeforeDispatch, onDispatch, onOutcome }) {
    if (onBeforeDispatch) onBeforeDispatch();
    if (onDispatch) onDispatch();
    this.calls.push({ messages: structuredClone(messages), model, requestBodyString });
    const last = messages.at(-1)?.content || '';
    if (onOutcome) onOutcome({ kind: 'success', http_status: 200, response_id: 'fake-response-1' });
    return {
      responseId: 'fake-response-1', resolvedModel: model, requestedModel: model,
      finishReason: 'stop', systemFingerprint: 'fake-fingerprint', usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      content: `FAKE MODE — explicit local demonstration. I received: ${last}`,
    };
  }
}
