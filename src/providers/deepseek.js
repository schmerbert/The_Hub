export class DeepSeekResidentProvider {
  constructor(config) { this.config = config; this.mode = 'live'; }

  prepareRequest({ messages, model }) {
    if (!this.config.apiKey) throw { code: 'provider_unavailable', message: 'Live DeepSeek resident wakes require DEEPSEEK_API_KEY.' };
    const requestBody = { model, messages, stream: false, thinking: { type: this.config.thinking === 'enabled' ? 'enabled' : 'disabled' } };
    return { requestBody, requestBodyString: JSON.stringify(requestBody) };
  }

  async complete({ messages, model, requestBodyString, onBeforeDispatch, onDispatch, onOutcome }) {
    const prepared = requestBodyString ? { requestBodyString } : this.prepareRequest({ messages, model });
    const requestBody = prepared.requestBodyString;
    let response;
    if (onBeforeDispatch) onBeforeDispatch();
    // Dispatch is recorded at the host's committed-to-dispatch boundary, immediately before fetch.
    if (onDispatch) onDispatch();
    try {
      response = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.config.apiKey}` },
        body: requestBody,
      });
    } catch {
      if (onOutcome) onOutcome({ kind: 'network_error', network_code: 'fetch_failed' });
      throw { code: 'provider_network_error', message: 'The DeepSeek provider could not be reached.' };
    }
    if (!response.ok) {
      if (onOutcome) onOutcome({ kind: 'http_error', http_status: response.status });
      throw { code: 'provider_http_error', message: `DeepSeek returned HTTP ${response.status}.` };
    }
    let payload;
    try { payload = await response.json(); } catch {
      if (onOutcome) onOutcome({ kind: 'invalid_response', http_status: response.status });
      throw { code: 'provider_invalid_response', message: 'DeepSeek returned invalid JSON.' };
    }
    const choice = payload?.choices?.[0];
    const content = typeof choice?.message?.content === 'string' ? choice.message.content : '';
    if (!content.trim()) {
      if (onOutcome) onOutcome({ kind: 'empty_content', http_status: response.status });
      throw { code: 'provider_empty_content', message: 'DeepSeek returned no resident content.' };
    }
    if (onOutcome) onOutcome({ kind: 'success', http_status: response.status, response_id: typeof payload.id === 'string' ? payload.id : null });
    return {
      responseId: typeof payload.id === 'string' ? payload.id : null,
      resolvedModel: typeof payload.model === 'string' ? payload.model : model,
      requestedModel: model,
      finishReason: typeof choice.finish_reason === 'string' ? choice.finish_reason : null,
      systemFingerprint: typeof payload.system_fingerprint === 'string' ? payload.system_fingerprint : null,
      usage: payload.usage && typeof payload.usage === 'object' ? payload.usage : null,
      content,
    };
  }
}
