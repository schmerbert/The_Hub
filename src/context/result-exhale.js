import { canonicalize, sha256 } from '../core/hash.js';

export const RESULT_EXHALE_POLICY_VERSION = 'result_exhale/v1';
export const RESULT_TRAIL_SIGN_VERSION = 'result_trail_sign/v1';
export const RESULT_REOPEN_TOOL_NAME = 'reopen_result';
export const RESULT_TRAIL_SIGN_LIMIT = 8;

export const REOPEN_RESULT_TOOL = Object.freeze({
  type: 'function',
  function: {
    name: RESULT_REOPEN_TOOL_NAME,
    description: 'Reopen one exact, same-session Result Rack projection by its displayed pointer. Read-only; no action or mutation authority.',
    parameters: {
      type: 'object',
      properties: { exact_pointer: { type: 'string', minLength: 1, maxLength: 500 } },
      required: ['exact_pointer'],
      additionalProperties: false,
    },
  },
});

function fail(code, message) { throw Object.assign(new Error(message), { code }); }

function bounded(value, max) {
  return typeof value === 'string' ? value.slice(0, max) : null;
}

export function parseReopenResultArguments(raw) {
  if (typeof raw !== 'string') fail('result_reopen_invalid_arguments', 'Result reopening arguments must be a JSON object.');
  let value;
  try { value = JSON.parse(raw); } catch { fail('result_reopen_invalid_arguments', 'Result reopening arguments are not valid JSON.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    typeof value.exact_pointer !== 'string' || !value.exact_pointer.startsWith('result-rack://') || value.exact_pointer.length > 500 ||
    Object.keys(value).some(key => key !== 'exact_pointer')) {
    fail('result_reopen_invalid_arguments', 'Result reopening requires one exact_pointer and no other arguments.');
  }
  return { exactPointer: value.exact_pointer };
}

export function recoverablePointerFromHostReceipt(row, { sessionId = null } = {}) {
  if (!row || typeof row.receiptJson !== 'string' || typeof row.resultJson !== 'string') return null;
  let receipt; let result;
  try { receipt = JSON.parse(row.receiptJson); result = JSON.parse(row.resultJson); } catch { return null; }
  if (receipt?.schemaVersion !== 1 || receipt?.policy !== 'result_rack_projection_v1' ||
    receipt?.mode !== 'projection' || typeof receipt.exactPointer !== 'string' || !receipt.exactPointer.startsWith('result-rack://') ||
    typeof receipt.projectionId !== 'string' || typeof receipt.projectionHash !== 'string' || typeof receipt.sourceCustodyHash !== 'string' ||
    sha256(JSON.stringify(result)) !== receipt.sourceResultHash || receipt.toolName === RESULT_REOPEN_TOOL_NAME) return null;
  if (sessionId && row.sessionId !== sessionId) return null;
  return Object.freeze({
    exactPointer: receipt.exactPointer,
    projectionId: receipt.projectionId,
    projectionHash: receipt.projectionHash,
    sourceHash: receipt.sourceCustodyHash,
    hostReturnReceiptId: receipt.receiptId,
    toolName: receipt.toolName,
    sessionId: row.sessionId,
    wakeId: row.wakeId,
    settlement: result?.status || result?.result?.status || (result?.ok === false ? 'failed' : 'unknown'),
  });
}

/**
 * The sign is a deterministic custody label, not a semantic description of
 * the result. It contains no body text and never claims that the pointer is
 * the result itself.
 */
export function buildResultTrailSign(pointer, { ordinal = null } = {}) {
  if (!pointer || typeof pointer.exactPointer !== 'string' || !pointer.exactPointer.startsWith('result-rack://') ||
    pointer.exactPointer.length > 500 || /[\r\n]/.test(pointer.exactPointer) ||
    typeof pointer.projectionId !== 'string' || typeof pointer.projectionHash !== 'string' || typeof pointer.sourceHash !== 'string') {
    fail('result_trail_sign_invalid', 'Trail signs require a verified Result Rack projection pointer.');
  }
  const settlement = bounded(pointer.terminal?.status || pointer.settlement || 'unknown', 64);
  const extent = Number.isInteger(pointer.byteLength) && Number.isInteger(pointer.lineCount)
    ? `${pointer.byteLength} bytes/${pointer.lineCount} lines`
    : 'bounded extent held in Result Rack custody';
  const text = [
    '[Result Rack trail sign]',
    `Settlement: ${settlement}.`,
    `Extent: ${extent}.`,
    `Exact pointer: ${pointer.exactPointer}`,
    `Projection hash: ${pointer.projectionHash}. Source hash: ${pointer.sourceHash}.`,
    'This is a pointer to retained evidence, not the result, a summary, a recollection, or an action authority.',
  ].join('\n');
  const receipt = {
    schemaVersion: RESULT_TRAIL_SIGN_VERSION,
    policyVersion: RESULT_EXHALE_POLICY_VERSION,
    ordinal,
    pointer: {
      exactPointer: pointer.exactPointer,
      projectionId: pointer.projectionId,
      projectionHash: pointer.projectionHash,
      sourceHash: pointer.sourceHash,
      hostReturnReceiptId: pointer.hostReturnReceiptId || null,
      toolName: pointer.toolName || null,
      sessionId: pointer.sessionId || null,
      wakeId: pointer.wakeId || null,
    },
    settlement,
    extent,
    renderedTextHash: sha256(text),
    custody: { respiration: 'prohibited', forestExhaleEligible: false, actionAuthority: false, generatedSummary: false },
  };
  return Object.freeze({
    kind: 'result_trail_sign',
    authority: 'host_receipt',
    presentationTransform: RESULT_TRAIL_SIGN_VERSION,
    sourceEventId: null,
    message: { role: 'system', content: text },
    pointer: receipt.pointer,
    receipt,
    contentHash: sha256(text),
    renderedUtf8Bytes: Buffer.byteLength(text, 'utf8'),
  });
}

export function exposureIdentity({ sessionId, wakeId, phase, kind, pointer, packetHash }) {
  return `attention_exposure_${sha256(canonicalize({ version: RESULT_EXHALE_POLICY_VERSION, sessionId, wakeId, phase, kind, pointer, packetHash }))}`;
}
