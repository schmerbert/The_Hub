import { byteLength, sha256 } from '../core/hash.js';

function custodyConflict(message) { return Object.assign(new Error(message), { code: 'forest_custody_conflict' }); }

export function identityScrubV1(input) {
  if (typeof input !== 'string') throw new Error('Utterance body must be a string.');
  return { body: input, policyName: 'utterance_identity', policyVersion: 'v1', operations: [], changed: false };
}

export function normalizeAdmissionEvent(event) {
  if (!event || event.eventKind !== 'utterance' || !['user', 'resident'].includes(event.actorKind)) {
    throw new Error('Only user and resident utterance events may enter the Forest.');
  }
  return event;
}

export function verifyAdmissionScrub(event, scrubbed) {
  if (!scrubbed || scrubbed.policyName !== 'utterance_identity' || scrubbed.policyVersion !== 'v1' ||
    scrubbed.body !== event.content || scrubbed.changed !== false || !Array.isArray(scrubbed.operations) || scrubbed.operations.length !== 0) {
    throw custodyConflict('Identity scrub receipt does not prove unchanged content.');
  }
  const inputHash = sha256(event.content);
  if (sha256(scrubbed.body) !== inputHash || byteLength(scrubbed.body) !== byteLength(event.content)) {
    throw custodyConflict('Identity scrub output hash or length mismatch.');
  }
  return { inputHash, outputHash: inputHash };
}

export function metadataForEvent(event) {
  return JSON.stringify({ provider: event.provider || null, model: event.model || null });
}
