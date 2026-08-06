import { canonicalize, sha256, sha256Bytes } from '../core/hash.js';

const POLICY_NAME = 'provider_return_exact_selection';
const POLICY_VERSION = 'v1';
const RETURN_BRAND = Symbol('ScrubbedProviderReturn');

function invalid(message) { return Object.assign(new Error(message), { code: 'return_scrub_invalid' }); }

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function exactBytes(rawReturn) {
  if (!rawReturn || typeof rawReturn !== 'object' || typeof rawReturn.record_id !== 'string') throw invalid('Return scrub requires a Spine raw-return pointer.');
  if (typeof rawReturn.raw_body_base64 !== 'string') throw invalid('Spine raw-return pointer has no exact body bytes.');
  const bytes = Buffer.from(rawReturn.raw_body_base64, 'base64');
  if (bytes.length !== rawReturn.body_byte_length || sha256Bytes(bytes) !== rawReturn.body_sha256) throw invalid('Spine raw-return pointer does not match its exact bytes.');
  return bytes;
}

function selectedMessage(payload) {
  const message = payload?.choices?.[0]?.message;
  if (!message || typeof message !== 'object' || Array.isArray(message) || message.role !== 'assistant') throw invalid('Provider return contains no assistant message subtree.');
  if (Object.hasOwn(message, 'content') && message.content !== null && typeof message.content !== 'string') throw invalid('Provider assistant content has an invalid shape.');
  if (Object.hasOwn(message, 'tool_calls') && !Array.isArray(message.tool_calls)) throw invalid('Provider assistant tool_calls has an invalid shape.');
  return structuredClone(message);
}

export function scrubProviderReturn(rawReturn) {
  const bytes = exactBytes(rawReturn);
  let payload;
  try { payload = JSON.parse(bytes.toString('utf8')); } catch { throw invalid('Provider raw return is not valid JSON.'); }
  const message = selectedMessage(payload);
  const receipt = {
    receiptId: `return_scrub_${rawReturn.record_id}`,
    policyName: POLICY_NAME,
    policyVersion: POLICY_VERSION,
    source: {
      spineRecordId: rawReturn.record_id,
      recordHash: rawReturn.record_hash,
      byteLength: bytes.length,
      sha256: sha256Bytes(bytes),
    },
    selectionPath: ['choices', 0, 'message'],
    selectedMessageHash: sha256(canonicalize(message)),
    selectedMessageJson: JSON.stringify(message),
  };
  return freeze({ [RETURN_BRAND]: true, message, receipt });
}

export function assertScrubbedProviderReturn(value) {
  if (!value || value[RETURN_BRAND] !== true || !value.message || !value.receipt) throw invalid('Only a validated provider return Scrub result may enter session history.');
  const receipt = value.receipt;
  if (receipt.policyName !== POLICY_NAME || receipt.policyVersion !== POLICY_VERSION || !receipt.source ||
    typeof receipt.receiptId !== 'string' || typeof receipt.source.spineRecordId !== 'string' || !Number.isInteger(receipt.source.byteLength) ||
    typeof receipt.source.sha256 !== 'string' || receipt.selectedMessageHash !== sha256(canonicalize(value.message)) ||
    receipt.selectedMessageJson !== JSON.stringify(value.message) || JSON.stringify(receipt.selectionPath) !== JSON.stringify(['choices', 0, 'message'])) {
    throw invalid('Provider return Scrub receipt does not match its exact selected message.');
  }
  return value;
}

export function isScrubbedProviderReturn(value) {
  try { assertScrubbedProviderReturn(value); return true; } catch { return false; }
}

export const PROVIDER_RETURN_SCRUB_POLICY = Object.freeze({ name: POLICY_NAME, version: POLICY_VERSION });
