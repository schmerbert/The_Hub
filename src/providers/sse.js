const STREAM_POLICY_NAME = 'openai_data_only_sse';
const STREAM_POLICY_VERSION = 'v1';

function protocolError(message) {
  return Object.assign(new Error(message), { code: 'provider_sse_invalid' });
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stableField(state, key, value, label) {
  if (value === undefined || value === null) return;
  if (typeof value !== 'string' || !value) throw protocolError(`Provider SSE ${label} has an invalid shape.`);
  if (state[key] !== null && state[key] !== value) throw protocolError(`Provider SSE changed ${label} mid-stream.`);
  state[key] = value;
}

function emit(callback, envelope) {
  if (callback) callback(Object.freeze(envelope));
}

/**
 * Incremental parser and deterministic assembler for OpenAI-compatible,
 * data-only SSE chat completion streams. It accepts CRLF, LF, or CR line
 * endings and uses a fatal streaming UTF-8 decoder so split code points are
 * reconstructed without replacement characters.
 */
export class OpenAiSseAccumulator {
  constructor({ onDelta } = {}) {
    this.onDelta = onDelta;
    this.decoder = new TextDecoder('utf-8', { fatal: true });
    this.line = '';
    this.pendingCr = false;
    this.dataLines = [];
    this.finalized = false;
    this.state = {
      responseId: null,
      model: null,
      systemFingerprint: null,
      role: null,
      contentParts: [],
      contentSeen: false,
      reasoningParts: [],
      reasoningSeen: false,
      tools: new Map(),
      finishReason: null,
      choiceSeen: false,
      terminalChoiceSeen: false,
      usage: null,
      jsonEventCount: 0,
      done: false,
    };
  }

  push(chunk) {
    if (this.finalized) throw protocolError('Provider SSE received bytes after finalization.');
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk instanceof Uint8Array ? chunk : String(chunk ?? ''), 'utf8');
    let text;
    try { text = this.decoder.decode(bytes, { stream: true }); }
    catch { throw protocolError('Provider SSE is not valid UTF-8.'); }
    this.#consumeText(text);
  }

  finish() {
    if (this.finalized) throw protocolError('Provider SSE was finalized more than once.');
    this.finalized = true;
    let tail;
    try { tail = this.decoder.decode(); }
    catch { throw protocolError('Provider SSE ended inside an invalid UTF-8 sequence.'); }
    this.#consumeText(tail);
    if (this.pendingCr) {
      this.pendingCr = false;
      this.#consumeLine();
    } else if (this.line.length) {
      this.#consumeLine();
    }
    if (this.dataLines.length) this.#dispatchEvent();

    const state = this.state;
    if (!state.done) throw protocolError('Provider SSE ended without [DONE].');
    if (!state.choiceSeen) throw protocolError('Provider SSE contains no assistant choice.');
    if (!state.finishReason) throw protocolError('Provider SSE contains no terminal finish reason.');
    if (!state.responseId || !state.model) throw protocolError('Provider SSE contains no stable response identity.');

    const indexes = [...state.tools.keys()].sort((left, right) => left - right);
    if (indexes.some((index, ordinal) => index !== ordinal)) throw protocolError('Provider SSE tool-call indices are not contiguous from zero.');
    const toolCalls = indexes.map(index => {
      const tool = state.tools.get(index);
      if (!tool.id || tool.type !== 'function' || !tool.nameSeen || !tool.name || !tool.argumentsSeen) {
        throw protocolError(`Provider SSE tool call ${index} is incomplete.`);
      }
      return { id: tool.id, type: tool.type, function: { name: tool.name, arguments: tool.arguments } };
    });
    if (toolCalls.length && state.finishReason !== 'tool_calls') throw protocolError('Provider SSE emitted tool calls without a tool_calls finish reason.');
    if (!toolCalls.length && state.finishReason === 'tool_calls') throw protocolError('Provider SSE declared tool_calls without any tool calls.');
    if (!toolCalls.length && state.finishReason !== 'stop') throw protocolError(`Provider SSE ended with unsupported finish reason ${state.finishReason}.`);
    if (!toolCalls.length && !state.contentSeen) throw protocolError('Provider SSE stopped without a content delta.');

    const content = state.contentSeen ? state.contentParts.join('') : (toolCalls.length ? null : '');
    const message = { role: 'assistant', content };
    if (state.reasoningSeen) message.reasoning_content = state.reasoningParts.join('');
    if (toolCalls.length) message.tool_calls = toolCalls;
    return {
      responseId: state.responseId,
      resolvedModel: state.model,
      finishReason: state.finishReason,
      systemFingerprint: state.systemFingerprint,
      usage: state.usage ? structuredClone(state.usage) : null,
      content,
      message,
      toolCalls: toolCalls.length ? toolCalls : null,
      reasoningContent: state.reasoningSeen ? message.reasoning_content : undefined,
      eventCount: state.jsonEventCount,
      doneObserved: true,
    };
  }

  #consumeText(text) {
    for (const character of text) {
      if (this.pendingCr) {
        this.pendingCr = false;
        this.#consumeLine();
        if (character === '\n') continue;
      }
      if (character === '\r') this.pendingCr = true;
      else if (character === '\n') this.#consumeLine();
      else this.line += character;
    }
  }

  #consumeLine() {
    const line = this.line;
    this.line = '';
    if (!line) {
      if (this.dataLines.length) this.#dispatchEvent();
      return;
    }
    if (line.startsWith(':')) return;
    const separator = line.indexOf(':');
    const field = separator === -1 ? line : line.slice(0, separator);
    let value = separator === -1 ? '' : line.slice(separator + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field !== 'data') throw protocolError(`Provider SSE contains unsupported ${field || 'empty'} field.`);
    this.dataLines.push(value);
  }

  #dispatchEvent() {
    const data = this.dataLines.join('\n');
    this.dataLines = [];
    if (data === '[DONE]') {
      if (this.state.done) throw protocolError('Provider SSE contains duplicate [DONE] markers.');
      this.state.done = true;
      return;
    }
    if (this.state.done) throw protocolError('Provider SSE contains data after [DONE].');
    let payload;
    try { payload = JSON.parse(data); }
    catch { throw protocolError('Provider SSE contains invalid JSON data.'); }
    this.#consumePayload(payload);
  }

  #consumePayload(payload) {
    if (!isPlainObject(payload)) throw protocolError('Provider SSE JSON event must be an object.');
    const state = this.state;
    state.jsonEventCount += 1;
    stableField(state, 'responseId', payload.id, 'response id');
    stableField(state, 'model', payload.model, 'model');
    if (payload.system_fingerprint !== undefined && payload.system_fingerprint !== null) {
      stableField(state, 'systemFingerprint', payload.system_fingerprint, 'system fingerprint');
    }
    if (Object.hasOwn(payload, 'usage') && payload.usage !== null) {
      if (!isPlainObject(payload.usage)) throw protocolError('Provider SSE usage has an invalid shape.');
      if (state.usage && JSON.stringify(state.usage) !== JSON.stringify(payload.usage)) throw protocolError('Provider SSE changed usage mid-stream.');
      state.usage = structuredClone(payload.usage);
    }
    if (!Array.isArray(payload.choices)) throw protocolError('Provider SSE choices has an invalid shape.');
    if (payload.choices.length === 0) {
      if (!isPlainObject(payload.usage)) throw protocolError('Provider SSE empty choices event contains no usage.');
      return;
    }
    if (payload.choices.length !== 1) throw protocolError('Provider SSE must contain exactly one choice.');
    if (state.terminalChoiceSeen) throw protocolError('Provider SSE contains choice data after the terminal choice.');
    const choice = payload.choices[0];
    if (!isPlainObject(choice) || choice.index !== 0 || !isPlainObject(choice.delta)) throw protocolError('Provider SSE choice has an invalid shape or index.');
    if (choice.finish_reason !== null && choice.finish_reason !== undefined && typeof choice.finish_reason !== 'string') throw protocolError('Provider SSE finish reason has an invalid shape.');
    state.choiceSeen = true;
    const delta = choice.delta;
    if (Object.hasOwn(delta, 'role')) {
      if (delta.role !== null) {
        if (delta.role !== 'assistant' || (state.role && state.role !== delta.role)) throw protocolError('Provider SSE assistant role is invalid or conflicting.');
        state.role = delta.role;
      }
    }
    this.#consumeTextDelta(delta, 'reasoning_content', state.reasoningParts, 'reasoningSeen');
    this.#consumeTextDelta(delta, 'content', state.contentParts, 'contentSeen');
    if (Object.hasOwn(delta, 'tool_calls')) this.#consumeToolDeltas(delta.tool_calls);
    if (typeof choice.finish_reason === 'string') {
      state.finishReason = choice.finish_reason;
      state.terminalChoiceSeen = true;
    }
  }

  #consumeTextDelta(delta, key, parts, seenKey) {
    if (!Object.hasOwn(delta, key) || delta[key] === null) return;
    if (typeof delta[key] !== 'string') throw protocolError(`Provider SSE ${key} delta has an invalid shape.`);
    this.state[seenKey] = true;
    parts.push(delta[key]);
    emit(this.onDelta, { kind: key, responseId: this.state.responseId, model: this.state.model, choiceIndex: 0, delta: delta[key] });
  }

  #consumeToolDeltas(toolDeltas) {
    if (!Array.isArray(toolDeltas)) throw protocolError('Provider SSE tool_calls delta has an invalid shape.');
    const seen = new Set();
    for (const call of toolDeltas) {
      if (!isPlainObject(call) || !Number.isInteger(call.index) || call.index < 0 || seen.has(call.index)) throw protocolError('Provider SSE tool-call index is invalid or duplicated in one event.');
      seen.add(call.index);
      let tool = this.state.tools.get(call.index);
      if (!tool) {
        tool = { id: null, type: null, name: '', nameSeen: false, arguments: '', argumentsSeen: false };
        this.state.tools.set(call.index, tool);
      }
      const envelope = { kind: 'tool_call', responseId: this.state.responseId, model: this.state.model, choiceIndex: 0, index: call.index };
      let fieldSeen = false;
      if (Object.hasOwn(call, 'id') && call.id !== null) {
        if (typeof call.id !== 'string' || !call.id) throw protocolError('Provider SSE tool-call id has an invalid shape.');
        if (tool.id && tool.id !== call.id) throw protocolError(`Provider SSE tool call ${call.index} changed id mid-stream.`);
        tool.id = call.id;
        envelope.id = call.id;
        fieldSeen = true;
      }
      if (Object.hasOwn(call, 'type') && call.type !== null) {
        if (call.type !== 'function' || (tool.type && tool.type !== call.type)) throw protocolError(`Provider SSE tool call ${call.index} has an invalid or conflicting type.`);
        tool.type = call.type;
        envelope.type = call.type;
        fieldSeen = true;
      }
      if (Object.hasOwn(call, 'function')) {
        if (!isPlainObject(call.function)) throw protocolError('Provider SSE tool-call function delta has an invalid shape.');
        envelope.function = {};
        if (Object.hasOwn(call.function, 'name') && call.function.name !== null) {
          if (typeof call.function.name !== 'string') throw protocolError('Provider SSE tool-call name delta has an invalid shape.');
          tool.name += call.function.name;
          tool.nameSeen = true;
          envelope.function.name = call.function.name;
          fieldSeen = true;
        }
        if (Object.hasOwn(call.function, 'arguments') && call.function.arguments !== null) {
          if (typeof call.function.arguments !== 'string') throw protocolError('Provider SSE tool-call arguments delta has an invalid shape.');
          tool.arguments += call.function.arguments;
          tool.argumentsSeen = true;
          envelope.function.arguments = call.function.arguments;
          fieldSeen = true;
        }
      }
      if (fieldSeen) emit(this.onDelta, envelope);
    }
  }
}

export function parseOpenAiSseBytes(bytes, options) {
  const parser = new OpenAiSseAccumulator(options);
  parser.push(bytes);
  return parser.finish();
}

export function encodeOpenAiDataOnlySse(payloads, { lineEnding = '\n' } = {}) {
  const separator = `${lineEnding}${lineEnding}`;
  return Buffer.from(`${payloads.map(payload => `data: ${typeof payload === 'string' ? payload : JSON.stringify(payload)}`).join(separator)}${separator}`, 'utf8');
}

export const OPENAI_SSE_POLICY = Object.freeze({ name: STREAM_POLICY_NAME, version: STREAM_POLICY_VERSION });
