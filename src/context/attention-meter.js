import { sha256 } from '../core/hash.js';

function fail(code, message) { throw Object.assign(new Error(message), { code }); }

function thresholdStatus(totalBytes, warnBytes, refuseBytes) {
  return totalBytes >= refuseBytes ? 'refuse' : totalBytes >= warnBytes ? 'warn' : 'ok';
}
function validateThresholds(warnBytes, refuseBytes) {
  if (!Number.isInteger(warnBytes) || warnBytes < 0 || !Number.isInteger(refuseBytes) || refuseBytes <= warnBytes) {
    fail('attention_invalid_threshold', 'Attention thresholds require 0 <= warnBytes < refuseBytes.');
  }
}
function validateOmissionPlan(messages, declaredOmissions) {
  if (!Array.isArray(declaredOmissions)) fail('attention_invalid_omission', 'Declared omissions must be an array.');
  const used = new Set();
  return declaredOmissions.map(item => {
    if (!item || item.reason !== 'old_tool_pair' || !Number.isInteger(item.assistantMessageIndex) || !Number.isInteger(item.toolMessageIndex)) {
      fail('attention_invalid_omission', 'Only indexed old_tool_pair omissions may be declared.');
    }
    const assistant = messages[item.assistantMessageIndex];
    const tool = messages[item.toolMessageIndex];
    if (!assistant || assistant.role !== 'assistant' || !tool || tool.role !== 'tool' || item.toolMessageIndex !== item.assistantMessageIndex + 1) {
      fail('attention_invalid_omission', 'Declared old tool pairs do not match assistant/tool message roles and order.');
    }
    if ((assistant.content !== null && assistant.content !== '') || !Array.isArray(assistant.tool_calls) || assistant.tool_calls.length !== 1) {
      fail('attention_invalid_omission', 'Declared old tool pairs must be a tool-only assistant call with exactly one result.');
    }
    if (item.toolMessageIndex >= messages.length - 1) fail('attention_invalid_omission', 'The current or tail tool pair cannot be declared old.');
    if (used.has(item.assistantMessageIndex) || used.has(item.toolMessageIndex)) fail('attention_invalid_omission', 'Declared omissions overlap.');
    if (typeof tool.tool_call_id !== 'string' || !tool.tool_call_id || assistant.tool_calls[0]?.id !== tool.tool_call_id) {
      fail('attention_invalid_omission', 'Declared tool result does not belong to its assistant tool call.');
    }
    if (typeof item.replacementPointer !== 'string' || !item.replacementPointer.startsWith('result-rack://') || typeof item.replacementHash !== 'string' || !/^[a-f0-9]{64}$/.test(item.replacementHash)) {
      fail('attention_invalid_omission', 'Declared old tool pairs require a Result Rack replacement pointer and SHA-256 hash.');
    }
    used.add(item.assistantMessageIndex); used.add(item.toolMessageIndex);
    return {
      reason: item.reason,
      assistantMessageIndex: item.assistantMessageIndex,
      toolMessageIndex: item.toolMessageIndex,
      assistantMessageHash: sha256(JSON.stringify(assistant)),
      toolMessageHash: sha256(JSON.stringify(tool)),
      replacementPointer: item.replacementPointer,
      replacementHash: item.replacementHash,
    };
  });
}

function serialized(value) { return JSON.stringify(value) ?? 'null'; }

export class AttentionMeter {
  constructor({ warnBytes = 80000, refuseBytes = 120000, replacementVerifier = null } = {}) {
    validateThresholds(warnBytes, refuseBytes);
    if (replacementVerifier !== null && typeof replacementVerifier !== 'function') fail('attention_invalid_input', 'Attention replacement verifier must be a function.');
    this.warnBytes = warnBytes;
    this.refuseBytes = refuseBytes;
    this.replacementVerifier = replacementVerifier;
  }
  measure({ messages = [], tools = [], estimatedAdditionalBytes = 0, declaredOmissions = [] } = {}) {
    if (!Array.isArray(messages) || !Array.isArray(tools)) fail('attention_invalid_input', 'Attention messages and tools must be arrays.');
    if (!Number.isInteger(estimatedAdditionalBytes) || estimatedAdditionalBytes < 0) fail('attention_invalid_input', 'Estimated additional bytes must be a non-negative integer.');
    const messageDetails = messages.map((message, index) => ({ index, role: message?.role || null, bytes: Buffer.byteLength(serialized(message), 'utf8'), hash: sha256(serialized(message)) }));
    const toolDetails = tools.map((tool, index) => ({ index, name: tool?.function?.name || tool?.name || null, bytes: Buffer.byteLength(serialized(tool), 'utf8'), hash: sha256(serialized(tool)) }));
    const payloadBytes = Buffer.byteLength(JSON.stringify({ messages, tools }), 'utf8');
    const totalBytes = payloadBytes + estimatedAdditionalBytes;
    const declarations = validateOmissionPlan(messages, declaredOmissions).map(declaration => {
      let custodyVerified = false;
      if (this.replacementVerifier) {
        try {
          const custody = this.replacementVerifier(declaration.replacementPointer);
          custodyVerified = custody?.bodyHash === declaration.replacementHash || custody?.sourceHash === declaration.replacementHash;
        } catch {}
      }
      return { ...declaration, custodyVerified };
    });
    const omittedIndexes = new Set(declarations.flatMap(item => [item.assistantMessageIndex, item.toolMessageIndex]));
    const plannedMessages = messages.filter((_, index) => !omittedIndexes.has(index));
    const plannedPayloadBytes = Buffer.byteLength(JSON.stringify({ messages: plannedMessages, tools }), 'utf8');
    const projectedTotalBytes = plannedPayloadBytes + estimatedAdditionalBytes;
    return {
      schemaVersion: 1,
      phase: 'pre_dispatch',
      status: thresholdStatus(totalBytes, this.warnBytes, this.refuseBytes),
      dispatchAllowed: totalBytes < this.refuseBytes,
      thresholds: { warnBytes: this.warnBytes, refuseBytes: this.refuseBytes },
      payloadBytes,
      estimatedAdditionalBytes,
      totalBytes,
      messages: { count: messages.length, bytes: messageDetails.reduce((sum, item) => sum + item.bytes, 0), items: messageDetails },
      toolSchemas: { count: tools.length, bytes: toolDetails.reduce((sum, item) => sum + item.bytes, 0), items: toolDetails },
      omissionPlan: {
        applied: false,
        readyToApply: declarations.length > 0 && declarations.every(item => item.custodyVerified),
        reason: declarations.length ? 'declared_old_tool_pairs' : 'none',
        declarations,
        projectedMessageCount: plannedMessages.length,
        projectedPayloadBytes: plannedPayloadBytes,
        projectedTotalBytes,
        projectedStatus: thresholdStatus(projectedTotalBytes, this.warnBytes, this.refuseBytes),
        estimatedSavingsBytes: totalBytes - projectedTotalBytes,
      },
    };
  }
}

export function measureAttention(input, thresholds = {}) {
  return new AttentionMeter(thresholds).measure(input);
}
