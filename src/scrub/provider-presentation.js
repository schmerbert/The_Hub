import { canonicalize, sha256 } from '../core/hash.js';

const POLICY_NAME = 'provider_history_subtractive';
const POLICY_VERSION = 'v1';
const PRESENTATION_BRAND = Symbol('ScrubbedPresentation');

function scrubError(message) {
  return Object.assign(new Error(message), { code: 'scrub_projection_invalid' });
}

function cloneMessage(message) {
  if (!message || typeof message !== 'object' || typeof message.role !== 'string' || typeof message.content !== 'string') {
    throw scrubError('Provider history messages must contain string roles and content.');
  }
  return { role: message.role, content: message.content };
}

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function messageHash(message) { return sha256(canonicalize(message)); }

function sourceLengths(sourceOrLengths) {
  if (!Array.isArray(sourceOrLengths)) throw scrubError('Provider scrub source history must be an array.');
  const lengths = sourceOrLengths.map(item => typeof item === 'number' ? item : item?.content?.length);
  if (lengths.some(length => !Number.isInteger(length) || length < 0)) throw scrubError('Provider scrub source content lengths are invalid.');
  return lengths;
}

function normalizeOmissions(omissions, sourceOrLengths) {
  if (!Array.isArray(omissions)) throw scrubError('Provider scrub omissions must be an array.');
  const lengths = sourceLengths(sourceOrLengths);
  const seen = new Map();
  return omissions.map(omission => {
    if (!omission || !Number.isInteger(omission.sourceIndex) || omission.sourceIndex < 0 || omission.sourceIndex >= lengths.length ||
      typeof omission.reason !== 'string' || !omission.reason.trim()) {
      throw scrubError('Provider scrub omission receipts require a source index, range, and reason.');
    }
    const length = lengths[omission.sourceIndex];
    const start = omission.start === undefined && omission.end === undefined ? 0 : omission.start;
    const end = omission.start === undefined && omission.end === undefined ? length : omission.end;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > length) {
      throw scrubError('Provider scrub omission ranges must use non-empty in-bounds offsets.');
    }
    const prior = seen.get(omission.sourceIndex) || [];
    if (prior.some(range => start < range.end && end > range.start)) throw scrubError('Provider scrub omission ranges must not overlap.');
    prior.push({ start, end }); seen.set(omission.sourceIndex, prior);
    return { sourceIndex: omission.sourceIndex, start, end, reason: omission.reason };
  }).sort((left, right) => left.sourceIndex - right.sourceIndex || left.start - right.start || left.end - right.end);
}

function projectionFor(sourceMessages, omissions) {
  const bySource = new Map();
  for (const omission of omissions) bySource.set(omission.sourceIndex, [...(bySource.get(omission.sourceIndex) || []), omission]);
  return sourceMessages.flatMap((message, sourceIndex) => {
    const ranges = bySource.get(sourceIndex) || [];
    if (!ranges.length) return [message];
    let cursor = 0; let content = '';
    for (const range of ranges) { content += message.content.slice(cursor, range.start); cursor = range.end; }
    content += message.content.slice(cursor);
    if (!content.length && ranges[0].start === 0 && ranges.at(-1).end === message.content.length) return [];
    return [{ role: message.role, content }];
  });
}

function fullyOmittedSourceIndexes(omissions, lengths) {
  const rangesBySource = new Map();
  for (const omission of omissions) rangesBySource.set(omission.sourceIndex, [...(rangesBySource.get(omission.sourceIndex) || []), omission]);
  const fullyOmitted = new Set();
  for (const [sourceIndex, ranges] of rangesBySource) {
    let cursor = 0;
    for (const range of ranges.sort((left, right) => left.start - right.start)) {
      if (range.start !== cursor) break;
      cursor = range.end;
    }
    if (cursor === lengths[sourceIndex]) fullyOmitted.add(sourceIndex);
  }
  return fullyOmitted;
}

function receiptFor(sourceMessages, messages, omissions) {
  return {
    policyName: POLICY_NAME,
    policyVersion: POLICY_VERSION,
    sourceCount: sourceMessages.length,
    outputCount: messages.length,
    sourceMessageHashes: sourceMessages.map(messageHash),
    sourceMessageContentLengths: sourceMessages.map(message => message.content.length),
    outputMessageHashes: messages.map(messageHash),
    omissions,
  };
}

export function scrubProviderHistory(sourceMessages, { omissions = [] } = {}) {
  if (!Array.isArray(sourceMessages)) throw scrubError('Provider scrub source history must be an array.');
  const source = sourceMessages.map(cloneMessage);
  const declaredOmissions = normalizeOmissions(omissions, source);
  const messages = projectionFor(source, declaredOmissions);
  const receipt = receiptFor(source, messages, declaredOmissions);
  return freeze({
    [PRESENTATION_BRAND]: true,
    messages,
    receipt,
  });
}

export function verifyScrubbedProjection(sourceMessages, presentation) {
  if (!Array.isArray(sourceMessages)) throw scrubError('Provider scrub verification requires source history.');
  assertScrubbedPresentation(presentation);
  const source = sourceMessages.map(cloneMessage);
  const receipt = presentation.receipt;
  const declaredOmissions = normalizeOmissions(receipt.omissions, source);
  const expected = projectionFor(source, declaredOmissions);
  if (receipt.sourceCount !== source.length ||
    JSON.stringify(receipt.sourceMessageHashes) !== JSON.stringify(source.map(messageHash)) ||
    JSON.stringify(presentation.messages) !== JSON.stringify(expected)) {
    throw scrubError('Provider scrub projection is not an exact ordered source projection.');
  }
  return true;
}

export function assertScrubbedPresentation(presentation) {
  if (!presentation || presentation[PRESENTATION_BRAND] !== true || !Array.isArray(presentation.messages) || !presentation.receipt) {
    throw scrubError('Provider dispatch requires a validated ScrubbedPresentation.');
  }
  const { receipt, messages } = presentation;
  const validSourceCount = Number.isInteger(receipt.sourceCount) && receipt.sourceCount >= 0;
  if (receipt.policyName !== POLICY_NAME || receipt.policyVersion !== POLICY_VERSION ||
    !validSourceCount || receipt.outputCount !== messages.length || !Array.isArray(receipt.sourceMessageHashes) ||
    receipt.sourceMessageHashes.length !== receipt.sourceCount ||
    !Array.isArray(receipt.sourceMessageContentLengths) || receipt.sourceMessageContentLengths.length !== receipt.sourceCount ||
    !Array.isArray(receipt.outputMessageHashes) || receipt.outputMessageHashes.length !== messages.length ||
    JSON.stringify(receipt.outputMessageHashes) !== JSON.stringify(messages.map(messageHash))) {
    throw scrubError('ScrubbedPresentation receipt does not match its provider-visible messages.');
  }
  messages.forEach(cloneMessage);
  const omissions = normalizeOmissions(receipt.omissions, receipt.sourceMessageContentLengths);
  const fullyOmitted = fullyOmittedSourceIndexes(omissions, receipt.sourceMessageContentLengths);
  if (receipt.outputCount !== receipt.sourceCount - fullyOmitted.size) throw scrubError('ScrubbedPresentation omission receipt does not reconcile source and output counts.');
  return presentation;
}

export function isScrubbedPresentation(value) {
  try { assertScrubbedPresentation(value); return true; } catch { return false; }
}

export const PROVIDER_SCRUB_POLICY = Object.freeze({ name: POLICY_NAME, version: POLICY_VERSION });
