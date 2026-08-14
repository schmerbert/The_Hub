import { assertScrubbedPresentation } from '../scrub/provider-presentation.js';
import { OpenAiSseAccumulator } from './sse.js';

const DEFAULT_MAX_RETURN_BYTES = 8 * 1024 * 1024;

function assembleJsonCompletion(bytes, requestedModel) {
  let payload;
  try { payload = JSON.parse(bytes.toString('utf8')); }
  catch { throw new Error('invalid_json'); }
  const choice = payload?.choices?.[0];
  const message = choice?.message && typeof choice.message === 'object' && !Array.isArray(choice.message) ? structuredClone(choice.message) : null;
  if (!message || message.role !== 'assistant') throw new Error('missing_assistant');
  if (Object.hasOwn(message, 'content') && message.content !== null && typeof message.content !== 'string') throw new Error('invalid_content');
  if (Object.hasOwn(message, 'tool_calls') && !Array.isArray(message.tool_calls)) throw new Error('invalid_tools');
  const content = typeof message.content === 'string' ? message.content : null;
  const finishReason = typeof choice.finish_reason === 'string' ? choice.finish_reason : null;
  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  for (const call of toolCalls) {
    if (!call || typeof call !== 'object' || Array.isArray(call) || typeof call.id !== 'string' || !call.id || call.type !== 'function' ||
      !call.function || typeof call.function !== 'object' || Array.isArray(call.function) || typeof call.function.name !== 'string' || !call.function.name ||
      typeof call.function.arguments !== 'string') throw new Error('invalid_tools');
  }
  if (toolCalls.length && finishReason !== 'tool_calls') throw new Error('invalid_finish_reason');
  if (!toolCalls.length && finishReason !== 'stop') throw new Error('invalid_finish_reason');
  if (!toolCalls.length && typeof message.content !== 'string') throw new Error('missing_content');
  return {
    responseId: typeof payload.id === 'string' ? payload.id : null,
    resolvedModel: typeof payload.model === 'string' ? payload.model : requestedModel,
    finishReason,
    systemFingerprint: typeof payload.system_fingerprint === 'string' ? payload.system_fingerprint : null,
    usage: payload.usage && typeof payload.usage === 'object' ? payload.usage : null,
    content,
    message,
    toolCalls: toolCalls.length ? toolCalls : null,
    reasoningContent: Object.hasOwn(message, 'reasoning_content') ? message.reasoning_content : undefined,
  };
}

export class DeepSeekResidentProvider {
  constructor(config) {
    const providerMaxReturnBytes = config?.providerMaxReturnBytes ?? DEFAULT_MAX_RETURN_BYTES;
    if (!Number.isInteger(providerMaxReturnBytes) || providerMaxReturnBytes < 1) throw new Error('providerMaxReturnBytes must be a positive integer.');
    this.config = { ...config, providerMaxReturnBytes };
    this.mode = 'live';
  }

  prepareRequest({ presentation, model, thinking = this.config.thinking, tools, toolChoice }) {
    if (!this.config.apiKey) throw { code: 'provider_unavailable', message: 'Live DeepSeek resident wakes require DEEPSEEK_API_KEY.' };
    assertScrubbedPresentation(presentation);
    const requestBody = {
      model,
      messages: presentation.messages,
      stream: true,
      stream_options: { include_usage: true },
      thinking: { type: thinking === 'enabled' ? 'enabled' : 'disabled' },
    };
    if (tools) requestBody.tools = tools;
    if (toolChoice) requestBody.tool_choice = toolChoice;
    return { requestBody, requestBodyString: JSON.stringify(requestBody) };
  }

  async complete({ presentation, model, phase = 'ordinary', requestBodyString, onBeforeDispatch, onDispatch, onRawReturn, onDelta, onOutcome, signal }) {
    assertScrubbedPresentation(presentation);
    const prepared = requestBodyString ? { requestBodyString } : this.prepareRequest({ presentation, model });
    const requestBody = prepared.requestBodyString;
    let response;
    const transportController = new AbortController();
    const transportSignal = signal ? AbortSignal.any([signal, transportController.signal]) : transportController.signal;
    if (onBeforeDispatch) onBeforeDispatch();
    // Dispatch is recorded at the host's committed-to-dispatch boundary, immediately before fetch.
    if (onDispatch) onDispatch();
    try {
      response = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.config.apiKey}` },
        body: requestBody,
        signal: transportSignal,
      });
    } catch {
      const aborted = Boolean(signal?.aborted);
      if (onOutcome) onOutcome({ kind: 'network_error', network_code: aborted ? 'aborted' : 'fetch_failed' });
      throw { code: aborted ? 'provider_cancelled' : 'provider_network_error', message: aborted ? 'The DeepSeek request was cancelled.' : 'The DeepSeek provider could not be reached.' };
    }
    const contentType = response.headers.get('content-type') || null;
    const isEventStream = /^text\/event-stream(?:\s*;|$)/i.test(contentType || '');
    const parser = response.ok && isEventStream
      ? new OpenAiSseAccumulator({ onDelta: onDelta ? delta => onDelta({ ...delta, phase }) : undefined })
      : null;
    const chunks = [];
    let parseFailure = null;
    let readFailure = null;
    let oversizedResponse = null;
    let admittedBytes = 0;
    if (response.body) {
      const reader = response.body.getReader();
      while (true) {
        let next;
        try { next = await reader.read(); }
        catch (error) { readFailure = error; break; }
        if (next.done) break;
        const chunk = Buffer.from(next.value);
        const observedBytes = admittedBytes + chunk.length;
        if (observedBytes > this.config.providerMaxReturnBytes) {
          oversizedResponse = { limitBytes: this.config.providerMaxReturnBytes, observedBytes };
          try { await reader.cancel('provider_response_too_large'); } catch {}
          transportController.abort('provider_response_too_large');
          break;
        }
        chunks.push(chunk);
        admittedBytes = observedBytes;
        if (parser) {
          try { parser.push(chunk); }
          catch (error) {
            parseFailure = error;
            try { await reader.cancel(error); } catch {}
            break;
          }
        }
      }
    }
    const bodyBytes = Buffer.concat(chunks, admittedBytes);
    const rawReturnFrame = onRawReturn?.({
      body: bodyBytes, httpStatus: response.status, contentType, phase,
      ...(oversizedResponse ? { captureComplete: false, limitBytes: oversizedResponse.limitBytes, observedBytes: oversizedResponse.observedBytes } : {}),
    });
    if (oversizedResponse) {
      if (onOutcome) onOutcome({ kind: 'oversized_response', http_status: response.status, limit_bytes: oversizedResponse.limitBytes, observed_bytes: oversizedResponse.observedBytes });
      throw { code: 'provider_response_too_large', message: `DeepSeek response exceeded the ${oversizedResponse.limitBytes}-byte return ceiling.` };
    }
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
    if (readFailure) {
      const aborted = Boolean(signal?.aborted);
      if (onOutcome) onOutcome({ kind: 'network_error', network_code: aborted ? 'aborted' : 'stream_interrupted', http_status: response.status });
      throw { code: aborted ? 'provider_cancelled' : 'provider_network_error', message: aborted ? 'The DeepSeek request was cancelled.' : 'The DeepSeek response stream was interrupted.' };
    }
    if (!bodyBytes.length) {
      if (onOutcome) onOutcome({ kind: 'empty_content', http_status: response.status });
      throw { code: 'provider_empty_content', message: 'DeepSeek returned an empty response body.' };
    }
    if (parseFailure) {
      if (onOutcome) onOutcome({ kind: 'invalid_response', http_status: response.status });
      throw { code: 'provider_invalid_response', message: 'DeepSeek returned an invalid response stream.' };
    }
    let assembled;
    try { assembled = parser ? parser.finish() : assembleJsonCompletion(bodyBytes, model); }
    catch {
      if (onOutcome) onOutcome({ kind: 'invalid_response', http_status: response.status });
      throw { code: 'provider_invalid_response', message: 'DeepSeek returned an invalid or incomplete response stream.' };
    }
    if (phase !== 'orientation' && (typeof assembled.content !== 'string' || !assembled.content.trim()) && !Array.isArray(assembled.toolCalls)) {
      if (onOutcome) onOutcome({ kind: 'empty_content', http_status: response.status });
      throw { code: 'provider_empty_content', message: 'DeepSeek returned no resident content.' };
    }
    if (onOutcome) onOutcome({ kind: 'success', http_status: response.status, response_id: assembled.responseId });
    return {
      responseId: assembled.responseId,
      resolvedModel: assembled.resolvedModel || model,
      requestedModel: model,
      finishReason: assembled.finishReason,
      systemFingerprint: assembled.systemFingerprint,
      usage: assembled.usage,
      content: typeof assembled.content === 'string' ? assembled.content : '',
      message: assembled.message,
      toolCalls: assembled.toolCalls,
      reasoningContent: assembled.reasoningContent,
      rawReturnFrame,
    };
  }
}
