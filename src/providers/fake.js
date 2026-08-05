export class FakeResidentProvider {
  constructor() { this.mode = 'fake'; this.calls = []; }

  async complete({ messages, model }) {
    this.calls.push({ messages: structuredClone(messages), model });
    const last = messages.at(-1)?.content || '';
    return {
      responseId: 'fake-response-1', resolvedModel: model, requestedModel: model,
      finishReason: 'stop', systemFingerprint: 'fake-fingerprint', usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      content: `FAKE MODE — explicit local demonstration. I received: ${last}`,
    };
  }
}
