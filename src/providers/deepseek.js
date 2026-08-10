import { assertScrubbedPresentation } from '../scrub/provider-presentation.js';

/**
 * DeepSeek thinking + tools requires every assistant history message to carry
 * `reasoning_content` on subsequent requests. Orientation runs with thinking
 * disabled (forced tool_choice), so that turn often has no field — echo "" so
 * response/tool rounds do not 400. Never invent non-empty CoT.
 */
export function echoReasoningContentForContinuation(refs, { thinking, tools } = {}) {
  const needsEcho = thinking === 'enabled' || (Array.isArray(tools) && tools.length > 0);
  if (!needsEcho || !Array.isArray(refs)) return refs;
  return refs.map(ref => {
    const message = ref?.message;
    if (!message || message.role !== 'assistant' || Object.hasOwn(message, 'reasoning_content')) return ref;
    return { ...ref, message: { ...message, reasoning_content: '' } };
  });
}

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

  async complete({ presentation, model, phase = 'ordinary', requestBodyString, onBeforeDispatch, onDispatch, onRawReturn, onOutcome }) {
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
    const bodyBytes = Buffer.from(await response.arrayBuffer());
    const rawReturnFrame = onRawReturn?.({ body: bodyBytes, httpStatus: response.status, contentType: response.headers.get('content-type') || null, phase });
    if (!response.ok) {
      if (onOutcome) onOutcome({ kind: 'http_error', http_status: response.status });
      let detail = '';
      try {
        const payload = JSON.parse(bodyBytes.toString('utf8'));
        const message = payload?.error?.message || payload?.message;
        if (typeof message === 'string' && message.trim() && !/bearer|authorization|api[_-]?key/i.test(message)) detail = ` ${message.trim()}`;
      } catch {}
      throw { code: 'provider_http_error', message: `DeepSeek returned HTTP ${response.status}.${detail}` };
    }
    if (!bodyBytes.length) {
      if (onOutcome) onOutcome({ kind: 'empty_content', http_status: response.status });
      throw { code: 'provider_empty_content', message: 'DeepSeek returned an empty response body.' };
    }
    let payload;
    try { payload = JSON.parse(bodyBytes.toString('utf8')); } catch {
      if (onOutcome) onOutcome({ kind: 'invalid_response', http_status: response.status });
      throw { code: 'provider_invalid_response', message: 'DeepSeek returned invalid JSON.' };
    }
    const choice = payload?.choices?.[0];
    const message = choice?.message && typeof choice.message === 'object' ? structuredClone(choice.message) : null;
    if (!message || message.role !== 'assistant') {
      if (onOutcome) onOutcome({ kind: 'invalid_response', http_status: response.status });
      throw { code: 'provider_invalid_response', message: 'DeepSeek returned no assistant message.' };
    }
    const content = typeof message?.content === 'string' ? message.content : null;
    if (phase !== 'orientation' && (!content || !content.trim()) && !Array.isArray(message?.tool_calls)) {
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
      rawReturnFrame,
    };
  }
}
