import { assertScrubbedPresentation } from '../scrub/provider-presentation.js';

export class DeepSeekResidentProvider {
  constructor(config) { this.config = config; this.mode = 'live'; }

  prepareRequest({ presentation, model, thinking = this.config.thinking, tools, toolChoice }) {
    if (!this.config.apiKey) throw { code: 'provider_unavailable', message: 'Live DeepSeek resident wakes require DEEPSEEK_API_KEY.' };
    assertScrubbedPresentation(presentation);
    const requestBody = { model, messages: presentation.messages, stream: false, thinking: { type: thinking === 'enabled' ? 'enabled' : 'disabled' } };
    if (tools) requestBody.tools = tools;
    if (toolChoice) requestBody.tool_choice = toolChoice;
    return { requestBody, requestBodyString: JSON.stringify(requestBody) };
  }

  async complete({ presentation, model, phase = 'ordinary', requestBodyString, onBeforeDispatch, onDispatch, onOutcome }) {
    assertScrubbedPresentation(presentation);
    const prepared = requestBodyString ? { requestBodyString } : this.prepareRequest({ presentation, model });
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
    const message = choice?.message && typeof choice.message === 'object' ? structuredClone(choice.message) : null;
    const content = typeof message?.content === 'string' ? message.content : null;
    if (phase !== 'orientation' && (!content || !content.trim())) {
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
      content: content || '',
      message: message || { role: 'assistant', content },
      toolCalls: Array.isArray(message?.tool_calls) ? message.tool_calls : null,
      reasoningContent: Object.hasOwn(message || {}, 'reasoning_content') ? message.reasoning_content : undefined,
    };
  }
}
