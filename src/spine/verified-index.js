import { createHash } from 'node:crypto';
import { closeSync, existsSync, openSync, readSync, statSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { byteLength, canonicalize, sha256, sha256Bytes } from '../core/hash.js';
import { spineLedgerPaths } from './store.js';

/**
 * The Spine proof is deliberately an in-memory domain payload. Persistence is
 * owned by src/integrity; this module only proves canonical JSONL custody and
 * produces the payload that a checkpoint owner may retain.
 */
export const SPINE_PROOF_VERSION = 'spine_verified_proof/v1';
export const SPINE_VERIFIER_VERSION = 'spine_verifier/v1';
export const SPINE_SCHEMA_VERSION = 1;

const FRAME_TYPES = new Set(['request_prepared', 'dispatch_attempted', 'raw_return', 'provider_outcome']);
const REQUEST_PHASES = new Set(['orientation', 'response', 'ordinary']);

function refusal(message, code = 'spine_checkpoint_refused') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function validateOutcome(outcome) {
  if (!outcome || typeof outcome !== 'object' || typeof outcome.kind !== 'string') throw refusal('Spine provider outcome shape is invalid.');
  const status = outcome.http_status;
  const validStatus = Number.isInteger(status) && status >= 100 && status <= 599;
  if (outcome.kind === 'network_error') {
    const codes = new Set(['fetch_failed', 'aborted', 'stream_interrupted']);
    const hasStatus = Object.hasOwn(outcome, 'http_status');
    if (Object.keys(outcome).some(key => !['kind', 'network_code', 'http_status'].includes(key)) || !codes.has(outcome.network_code)
      || (hasStatus && !validStatus)
      || (outcome.network_code === 'fetch_failed' && hasStatus)
      || (outcome.network_code === 'stream_interrupted' && !hasStatus)) throw refusal('Spine network outcome shape is invalid.');
    return;
  }
  if (['http_error', 'invalid_response', 'empty_content'].includes(outcome.kind)) {
    if (!validStatus || Object.keys(outcome).some(key => !['kind', 'http_status'].includes(key))) throw refusal('Spine HTTP outcome shape is invalid.');
    return;
  }
  if (outcome.kind === 'oversized_response') {
    if (!validStatus || !Number.isInteger(outcome.limit_bytes) || outcome.limit_bytes < 1
      || !Number.isInteger(outcome.observed_bytes) || outcome.observed_bytes <= outcome.limit_bytes
      || Object.keys(outcome).some(key => !['kind', 'http_status', 'limit_bytes', 'observed_bytes'].includes(key))) throw refusal('Spine oversized response outcome shape is invalid.');
    return;
  }
  if (outcome.kind === 'success') {
    if (!validStatus || status < 200 || status >= 300
      || Object.keys(outcome).some(key => !['kind', 'http_status', 'response_id'].includes(key))
      || (outcome.response_id !== null && typeof outcome.response_id !== 'string')) throw refusal('Spine success outcome shape is invalid.');
    return;
  }
  throw refusal('Spine contains an unknown provider outcome kind.');
}

function copyLifecycle(source) {
  const result = new Map();
  for (const [id, state] of source || []) result.set(id, {
    ...state,
    rawReturn: state.rawReturn ? { ...state.rawReturn } : null,
    outcome: state.outcome ? clone(state.outcome) : null,
  });
  return result;
}

function applyLifecycle(frame, lifecycle) {
  if (frame.frame_type === 'request_prepared') {
    if (lifecycle.has(frame.record_id)) throw refusal('Spine contains a duplicate request lifecycle.');
    lifecycle.set(frame.record_id, {
      recordId: frame.record_id,
      preparedRecordHash: frame.record_hash,
      previousRecordHash: frame.previous_record_hash,
      requestBody: frame.request_body,
      bodyByteLength: frame.body_byte_length,
      bodySha256: frame.body_sha256,
      threadId: frame.thread_id,
      wakeId: frame.wake_id,
      provider: frame.provider,
      model: frame.model,
      authorizationPresent: frame.authorization_present,
      requestPhase: frame.request_phase || null,
      returnCustodyVersion: frame.return_custody_version ?? null,
      requiresRawReturn: frame.return_custody_version === 1 && Boolean(frame.request_phase),
      dispatched: false,
      rawReturn: null,
      outcome: null,
      outcomeRecordId: null,
    });
    return;
  }

  const request = lifecycle.get(frame.request_record_id);
  if (!request) throw refusal('Spine receipt must reference an earlier prepared frame.');
  if (frame.frame_type === 'dispatch_attempted') {
    if (request.dispatched) throw refusal('Spine request has duplicate dispatch receipts.');
    request.dispatched = true;
  } else if (frame.frame_type === 'raw_return') {
    if (!request.dispatched) throw refusal('Spine raw return cannot precede dispatch.');
    if (request.outcome) throw refusal('Spine raw return cannot follow provider outcome.');
    if (frame.request_phase && frame.request_phase !== request.requestPhase) throw refusal('Spine raw return phase does not match its request.');
    if (request.rawReturn) throw refusal('Spine request has duplicate raw returns.');
    request.rawReturn = {
      recordId: frame.record_id,
      recordHash: frame.record_hash,
      bodyByteLength: frame.body_byte_length,
      bodySha256: frame.body_sha256,
      httpStatus: frame.http_status,
      contentType: frame.content_type,
      requestPhase: frame.request_phase || null,
    };
  } else if (frame.frame_type === 'provider_outcome') {
    if (!request.dispatched) throw refusal('Spine outcome cannot precede dispatch.');
    if (request.outcome) throw refusal('Spine request has duplicate outcome receipts.');
    if (request.requiresRawReturn && frame.outcome.kind !== 'network_error' && !request.rawReturn) throw refusal('Spine provider outcome requires an earlier raw return.');
    validateOutcome(frame.outcome);
    request.outcome = clone(frame.outcome);
    request.outcomeRecordId = frame.record_id;
  }
}

function validateFrame(frame, { decodeRawReturn = true } = {}) {
  if (!frame || typeof frame !== 'object') throw refusal('Spine frame is not an object.');
  if (frame.schema_version !== SPINE_SCHEMA_VERSION) throw refusal('Spine contains an unknown schema version.', 'spine_version_incompatible');
  if (typeof frame.record_id !== 'string' || typeof frame.record_hash !== 'string') throw refusal('Spine frame is missing its record identity.');
  if (!FRAME_TYPES.has(frame.frame_type)) throw refusal('Spine contains an unknown frame type.');

  if (frame.frame_type === 'request_prepared') {
    if (typeof frame.request_body !== 'string' || typeof frame.thread_id !== 'string' || typeof frame.wake_id !== 'string'
      || typeof frame.provider !== 'string' || typeof frame.model !== 'string' || typeof frame.authorization_present !== 'boolean'
      || frame.body_byte_length !== byteLength(frame.request_body) || frame.body_sha256 !== sha256(frame.request_body)) {
      throw refusal('Spine request body length or hash mismatch.');
    }
    if (frame.request_phase !== undefined && !REQUEST_PHASES.has(frame.request_phase)) throw refusal('Spine request phase is invalid.');
    if (frame.return_custody_version !== undefined && frame.return_custody_version !== 1) throw refusal('Spine return custody generation is invalid.');
  } else if (frame.frame_type === 'dispatch_attempted' || frame.frame_type === 'provider_outcome') {
    if (typeof frame.request_record_id !== 'string') throw refusal('Spine receipt is missing its request identifier.');
    if (frame.frame_type === 'provider_outcome') validateOutcome(frame.outcome);
  } else if (frame.frame_type === 'raw_return') {
    if (typeof frame.request_record_id !== 'string' || typeof frame.raw_body_base64 !== 'string') throw refusal('Spine raw return body length or hash mismatch.');
    if (decodeRawReturn) {
      const body = Buffer.from(frame.raw_body_base64, 'base64');
      if (body.toString('base64') !== frame.raw_body_base64 || frame.body_byte_length !== body.length || frame.body_sha256 !== sha256Bytes(body)) throw refusal('Spine raw return body length or hash mismatch.');
    } else if (!Number.isInteger(frame.body_byte_length) || frame.body_byte_length < 0 || typeof frame.body_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(frame.body_sha256)) {
      throw refusal('Spine raw return body metadata is invalid.');
    }
    if (!Number.isInteger(frame.http_status) || frame.http_status < 100 || frame.http_status > 599) throw refusal('Spine raw return HTTP status is invalid.');
    if (frame.content_type !== null && typeof frame.content_type !== 'string') throw refusal('Spine raw return content type is invalid.');
    if (frame.request_phase !== undefined && !REQUEST_PHASES.has(frame.request_phase)) throw refusal('Spine raw return phase is invalid.');
  }

  const { record_hash: ignored, ...withoutHash } = frame;
  if (sha256(canonicalize(withoutHash)) !== frame.record_hash) throw refusal('Spine record hash mismatch.');
}

function ledgerDescriptor(basePath, ledgerPath, { logicalStoreName = null } = {}) {
  const extension = extname(basePath) || '.jsonl';
  const stem = basename(basePath, extname(basePath));
  const name = logicalStoreName || stem || 'default';
  const filename = basename(ledgerPath, extension);
  const sessionPrefix = `${stem}.session.`;
  const sessionPrefixUnderscore = `${stem}.session_`;
  const isBase = ledgerPath === basePath || filename === stem;
  const sessionName = !isBase && filename.startsWith(sessionPrefix)
    ? filename.slice(sessionPrefix.length)
    : (!isBase && filename.startsWith(sessionPrefixUnderscore) ? filename.slice(sessionPrefixUnderscore.length) : null);
  if (!isBase && !sessionName) throw refusal(`Spine ledger name ${filename} is not a lawful configured ledger.`, 'spine_ledger_set_changed');
  const role = isBase ? 'base' : 'session';
  const ledgerName = isBase ? 'base' : sessionName;
  return {
    role,
    name: ledgerName,
    logicalId: `spine:${name}:${role}:${ledgerName}`,
  };
}

function readHash(path, end = null) {
  const fd = openSync(path, 'r');
  const digest = createHash('sha256');
  const buffer = Buffer.allocUnsafe(64 * 1024);
  let offset = 0;
  try {
    while (end === null || offset < end) {
      const wanted = end === null ? buffer.length : Math.min(buffer.length, end - offset);
      const count = readSync(fd, buffer, 0, wanted, offset);
      if (!count) break;
      digest.update(buffer.subarray(0, count));
      offset += count;
    }
  } finally { closeSync(fd); }
  if (end !== null && offset !== end) throw refusal('Spine ledger ended before its retained checkpoint boundary.', 'spine_ledger_truncated');
  return digest.digest('hex');
}

function scanLedger(path, {
  startOffset = 0,
  previousHash = null,
  knownIds = new Set(),
  lifecycle = new Map(),
  decodeRawReturn = true,
} = {}) {
  const fileSize = statSync(path).size;
  if (startOffset > fileSize) throw refusal('Spine ledger is shorter than its retained checkpoint boundary.', 'spine_ledger_truncated');
  const fd = openSync(path, 'r');
  const decoder = new StringDecoder('utf8');
  const buffer = Buffer.allocUnsafe(64 * 1024);
  const frames = [];
  const recordIds = [];
  const recordHashes = [];
  const preparedIds = [];
  let carry = '';
  let offset = startOffset;
  let lineStart = startOffset;
  let readAny = false;
  let endedWithNewline = startOffset === fileSize;
  let firstRecordHash = null;
  let terminalRecordHash = previousHash;
  const localLifecycle = copyLifecycle(lifecycle);

  const consume = line => {
    if (!line) throw refusal('Spine contains an empty frame.');
    let frame;
    try { frame = JSON.parse(line); } catch { throw refusal('Spine contains malformed JSON.'); }
    validateFrame(frame, { decodeRawReturn });
    if (knownIds.has(frame.record_id)) throw refusal('Spine contains a duplicate record ID across session ledgers.');
    if (frame.previous_record_hash !== terminalRecordHash) throw refusal('Spine hash-chain ancestry is broken.');
    applyLifecycle(frame, localLifecycle);
    knownIds.add(frame.record_id);
    recordIds.push(frame.record_id);
    recordHashes.push(frame.record_hash);
    if (!firstRecordHash) firstRecordHash = frame.record_hash;
    terminalRecordHash = frame.record_hash;
    if (frame.frame_type === 'request_prepared') preparedIds.push(frame.record_id);
    frames.push(frame);
  };

  try {
    let count;
    while ((count = readSync(fd, buffer, 0, buffer.length, offset)) > 0) {
      readAny = true;
      offset += count;
      carry += decoder.write(buffer.subarray(0, count));
      let newline;
      while ((newline = carry.indexOf('\n')) !== -1) {
        const line = carry.slice(0, newline);
        consume(line);
        carry = carry.slice(newline + 1);
        lineStart += Buffer.byteLength(line, 'utf8') + 1;
        endedWithNewline = true;
      }
      if (carry.length) endedWithNewline = false;
    }
    carry += decoder.end();
    let newline;
    while ((newline = carry.indexOf('\n')) !== -1) {
      const line = carry.slice(0, newline);
      consume(line);
      carry = carry.slice(newline + 1);
      lineStart += Buffer.byteLength(line, 'utf8') + 1;
      endedWithNewline = true;
    }
    if (carry.length || (readAny && !endedWithNewline)) throw refusal('Spine contains a trailing partial frame.', 'spine_ledger_partial');
  } finally { closeSync(fd); }

  // A zero-byte suffix is lawful only when the retained boundary is the whole file.
  if (lineStart !== fileSize) throw refusal('Spine ledger byte boundary is not newline aligned.', 'spine_ledger_partial');
  return { frames, recordIds, recordHashes, preparedIds, lifecycle: localLifecycle, frameCount: frames.length, firstRecordHash, terminalRecordHash, byteBoundary: fileSize };
}

function stateToPreparedFrame(state) {
  return {
    schema_version: SPINE_SCHEMA_VERSION,
    frame_type: 'request_prepared',
    record_id: state.recordId,
    record_hash: state.preparedRecordHash,
    previous_record_hash: state.previousRecordHash,
    request_body: state.requestBody,
    body_byte_length: state.bodyByteLength,
    body_sha256: state.bodySha256,
    thread_id: state.threadId,
    wake_id: state.wakeId,
    provider: state.provider,
    model: state.model,
    authorization_present: state.authorizationPresent,
    ...(state.requestPhase ? { request_phase: state.requestPhase } : {}),
    ...(state.returnCustodyVersion !== null ? { return_custody_version: state.returnCustodyVersion } : {}),
  };
}

function stateToPublic(state) {
  return {
    recordId: state.recordId,
    preparedRecordHash: state.preparedRecordHash,
    previousRecordHash: state.previousRecordHash,
    requestBody: state.requestBody,
    bodyByteLength: state.bodyByteLength,
    bodySha256: state.bodySha256,
    threadId: state.threadId,
    wakeId: state.wakeId,
    provider: state.provider,
    model: state.model,
    authorizationPresent: state.authorizationPresent,
    requestPhase: state.requestPhase,
    returnCustodyVersion: state.returnCustodyVersion,
    requiresRawReturn: state.requiresRawReturn,
    dispatched: Boolean(state.dispatched),
    rawReturn: state.rawReturn ? { ...state.rawReturn } : null,
    outcome: state.outcome ? clone(state.outcome) : null,
    outcomeRecordId: state.outcomeRecordId,
    ledgerId: state.ledgerId,
  };
}

function indexBody(index) {
  const {
    compactIndexHash: ignored,
    preparedFrames: viewFrames,
    preparedById: viewPrepared,
    lifecycleByRequest: viewLifecycle,
    mode,
    frameCount,
    ledgerCount,
    requestCount,
    appendedFrameCount,
    ...body
  } = index;
  return body;
}

function sealIndex(index) {
  return { ...index, compactIndexHash: sha256(canonicalize(indexBody(index))) };
}

function buildIndex({ storeIdentity, ledgers, records, prepared }) {
  const index = {
    proofVersion: SPINE_PROOF_VERSION,
    verifierVersion: SPINE_VERIFIER_VERSION,
    schemaVersion: SPINE_SCHEMA_VERSION,
    storeIdentity,
    ledgers,
    globalRecordIds: records.map(record => record.recordId),
    globalRecordHashes: records.map(record => record.recordHash),
    preparedRequests: prepared,
  };
  index.ledgerSetHash = sha256(canonicalize(ledgers.map(ledger => ({ logicalId: ledger.logicalId, role: ledger.role, name: ledger.name }))));
  return sealIndex(index);
}

function validateIndexShape(index) {
  if (!index || typeof index !== 'object') throw refusal('Spine checkpoint payload is missing.', 'spine_version_incompatible');
  if (index.proofVersion !== SPINE_PROOF_VERSION || index.verifierVersion !== SPINE_VERIFIER_VERSION || index.schemaVersion !== SPINE_SCHEMA_VERSION) throw refusal('Spine checkpoint version is incompatible.', 'spine_version_incompatible');
  if (!Array.isArray(index.ledgers) || !Array.isArray(index.globalRecordIds) || !Array.isArray(index.globalRecordHashes) || !Array.isArray(index.preparedRequests)) throw refusal('Spine checkpoint payload is malformed.', 'spine_checkpoint_refused');
  if (index.globalRecordIds.length !== index.globalRecordHashes.length) throw refusal('Spine checkpoint global record index is malformed.', 'spine_checkpoint_refused');
  if (sha256(canonicalize(indexBody(index))) !== index.compactIndexHash) throw refusal('Spine checkpoint hash mismatch.', 'spine_checkpoint_refused');
  const ids = new Set();
  for (const id of index.globalRecordIds) {
    if (typeof id !== 'string' || ids.has(id)) throw refusal('Spine checkpoint contains duplicate record IDs.', 'spine_checkpoint_refused');
    ids.add(id);
  }
  const ledgerIds = new Set();
  for (const ledger of index.ledgers) {
    if (!ledger || typeof ledger.logicalId !== 'string' || ledgerIds.has(ledger.logicalId)) throw refusal('Spine checkpoint ledger set is malformed.', 'spine_checkpoint_refused');
    ledgerIds.add(ledger.logicalId);
    if (!Number.isInteger(ledger.byteBoundary) || ledger.byteBoundary < 0 || !Number.isInteger(ledger.frameCount) || ledger.frameCount < 0
      || (ledger.frameCount === 0 ? (ledger.firstRecordHash !== null || ledger.terminalRecordHash !== null) : (typeof ledger.firstRecordHash !== 'string' || typeof ledger.terminalRecordHash !== 'string'))
      || typeof ledger.prefixSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(ledger.prefixSha256)
      || !Array.isArray(ledger.recordIds) || ledger.recordIds.length !== ledger.frameCount) throw refusal('Spine checkpoint ledger frontier is malformed.', 'spine_checkpoint_refused');
    for (const id of ledger.recordIds) if (!ids.has(id)) throw refusal('Spine checkpoint ledger references an unknown record.', 'spine_checkpoint_refused');
  }
  const preparedIds = new Set();
  for (const request of index.preparedRequests) {
    if (!request || typeof request.recordId !== 'string' || preparedIds.has(request.recordId) || !ids.has(request.recordId)) throw refusal('Spine checkpoint prepared index is malformed.', 'spine_checkpoint_refused');
    preparedIds.add(request.recordId);
    if (typeof request.requestBody !== 'string' || request.bodySha256 !== sha256(request.requestBody) || request.bodyByteLength !== byteLength(request.requestBody)) throw refusal('Spine checkpoint request body custody is invalid.', 'spine_checkpoint_refused');
    if (typeof request.dispatched !== 'boolean' || (request.rawReturn !== null && typeof request.rawReturn !== 'object')) throw refusal('Spine checkpoint lifecycle is malformed.', 'spine_checkpoint_refused');
  }
}

function publicView(index) {
  const preparedFrames = index.preparedRequests.map(stateToPreparedFrame);
  const lifecycleByRequest = new Map(index.preparedRequests.map(request => [request.recordId, {
    dispatched: Boolean(request.dispatched),
    rawReturn: request.rawReturn ? { ...request.rawReturn } : null,
    outcome: request.outcome ? clone(request.outcome) : null,
  }]));
  const preparedById = new Map(preparedFrames.map(frame => [frame.record_id, frame]));
  return { preparedFrames, preparedById, lifecycleByRequest };
}

/**
 * Build the Spine proof from every configured ledger. This is the complete
 * verifier path and therefore decodes exact raw-return bodies once. The
 * returned object is safe to serialize after the raw-return bodies have been
 * discarded from the compact payload.
 */
export function createSpineVerifiedProof(path, { logicalStoreName = null, storeIdentity = null } = {}) {
  if (!path || !existsSync(path) && spineLedgerPaths(path).length === 0) throw refusal('Spine ledger is missing.', 'spine_missing');
  const paths = spineLedgerPaths(path);
  const name = logicalStoreName || basename(path, extname(path)) || 'default';
  const identity = storeIdentity || { domain: 'spine', name };
  const knownIds = new Set();
  const records = [];
  const prepared = [];
  const ledgers = [];

  for (const ledgerPath of paths) {
    const descriptor = ledgerDescriptor(path, ledgerPath, { logicalStoreName: name });
    const scan = scanLedger(ledgerPath, { knownIds, decodeRawReturn: true });
    const requests = [...scan.lifecycle.values()].filter(request => scan.preparedIds.includes(request.recordId));
    for (const request of requests) { request.ledgerId = descriptor.logicalId; prepared.push(stateToPublic(request)); }
    ledgers.push({
      ...descriptor,
      byteBoundary: scan.byteBoundary,
      frameCount: scan.frameCount,
      firstRecordHash: scan.firstRecordHash,
      terminalRecordHash: scan.terminalRecordHash,
      prefixSha256: readHash(ledgerPath),
      recordIds: scan.recordIds,
      recordHashes: scan.recordHashes,
      preparedRequestIds: scan.preparedIds,
    });
    for (let index = 0; index < scan.recordIds.length; index++) records.push({ recordId: scan.recordIds[index], recordHash: scan.recordHashes[index], ledgerId: descriptor.logicalId });
  }

  const proof = buildIndex({ storeIdentity: identity, ledgers, records, prepared });
  return { ...proof, ...publicView(proof), mode: 'full', frameCount: records.length, ledgerCount: ledgers.length, requestCount: prepared.length };
}

/** Alias emphasizing the compact payload role for checkpoint writers. */
export const buildSpineVerifiedIndex = createSpineVerifiedProof;
export const buildSpineCheckpointPayload = createSpineVerifiedProof;

function currentDescriptors(path, logicalStoreName) {
  return spineLedgerPaths(path).map(ledgerPath => ({ path: ledgerPath, descriptor: ledgerDescriptor(path, ledgerPath, { logicalStoreName }) }));
}

/**
 * Validate a proof against current ledgers. Existing prefixes are checked as
 * bytes only; no old JSON frame and, in particular, no old raw-return body is
 * decoded. Appended suffix frames receive the ordinary full schema, hash,
 * uniqueness, and lifecycle checks.
 */
export function validateSpineVerifiedProof(path, proof, { logicalStoreName = null, storeIdentity = null } = {}) {
  validateIndexShape(proof);
  const expectedIdentity = storeIdentity || proof.storeIdentity;
  if (canonicalize(expectedIdentity) !== canonicalize(proof.storeIdentity)) throw refusal('Spine checkpoint store identity is incompatible.', 'spine_store_incompatible');
  const name = logicalStoreName || proof.storeIdentity?.name || basename(path, extname(path)) || 'default';
  const current = currentDescriptors(path, name);
  const byLogicalId = new Map(current.map(item => [item.descriptor.logicalId, item]));
  if (byLogicalId.size !== current.length) throw refusal('Spine ledger set contains duplicate logical identities.', 'spine_ledger_set_changed');
  const oldLedgerIds = new Set(proof.ledgers.map(ledger => ledger.logicalId));
  for (const ledger of proof.ledgers) if (!byLogicalId.has(ledger.logicalId)) throw refusal('Spine ledger set lost a retained ledger.', 'spine_ledger_set_changed');
  const extras = current.filter(item => !oldLedgerIds.has(item.descriptor.logicalId));

  const knownIds = new Set(proof.globalRecordIds);
  const preparedById = new Map(proof.preparedRequests.map(request => [request.recordId, { ...request, rawReturn: request.rawReturn ? { ...request.rawReturn } : null, outcome: request.outcome ? clone(request.outcome) : null }]));
  const records = proof.globalRecordIds.map((recordId, index) => ({ recordId, recordHash: proof.globalRecordHashes[index], ledgerId: proof.ledgers.find(ledger => ledger.recordIds.includes(recordId))?.logicalId || null }));
  const nextLedgers = [];
  let suffixFrameCount = 0;

  for (const retained of proof.ledgers) {
    const currentLedger = byLogicalId.get(retained.logicalId);
    const currentSize = statSync(currentLedger.path).size;
    if (currentSize < retained.byteBoundary) throw refusal('Spine ledger is shorter than its retained checkpoint boundary.', 'spine_ledger_truncated');
    if (readHash(currentLedger.path, retained.byteBoundary) !== retained.prefixSha256) throw refusal('Spine verified ledger prefix changed.', 'spine_prefix_changed');
    const lifecycle = new Map(proof.preparedRequests.filter(request => request.ledgerId === retained.logicalId).map(request => [request.recordId, {
      ...request,
      requestPhase: request.requestPhase,
      requiresRawReturn: request.requiresRawReturn,
      rawReturn: request.rawReturn ? { ...request.rawReturn } : null,
      outcome: request.outcome ? clone(request.outcome) : null,
    }]));
    let scan = { frames: [], recordIds: [], recordHashes: [], preparedIds: [], lifecycle, frameCount: 0, firstRecordHash: null, terminalRecordHash: retained.terminalRecordHash, byteBoundary: currentSize };
    if (currentSize > retained.byteBoundary) {
      scan = scanLedger(currentLedger.path, { startOffset: retained.byteBoundary, previousHash: retained.terminalRecordHash, knownIds, lifecycle, decodeRawReturn: true });
      suffixFrameCount += scan.frameCount;
      for (const requestId of scan.preparedIds) {
        const request = scan.lifecycle.get(requestId);
        request.ledgerId = retained.logicalId;
        preparedById.set(requestId, stateToPublic(request));
      }
      for (let index = 0; index < scan.recordIds.length; index++) records.push({ recordId: scan.recordIds[index], recordHash: scan.recordHashes[index], ledgerId: retained.logicalId });
    }
    for (const [requestId, state] of scan.lifecycle) if (preparedById.has(requestId)) preparedById.set(requestId, stateToPublic({ ...state, ledgerId: retained.logicalId }));
    const allRecordIds = [...retained.recordIds, ...scan.recordIds];
    const allRecordHashes = [...(retained.recordHashes || []), ...scan.recordHashes];
    if (allRecordHashes.length !== allRecordIds.length) {
      // Older in-memory callers may not have retained all hashes. The terminal
      // and prefix bindings still remain sufficient for those payloads; newly
      // built v1 proofs always include the complete compact hash list.
      if (retained.recordHashes) throw refusal('Spine checkpoint record hash index is malformed.', 'spine_checkpoint_refused');
    }
    nextLedgers.push({ ...retained, byteBoundary: currentSize, frameCount: retained.frameCount + scan.frameCount, firstRecordHash: retained.firstRecordHash || scan.firstRecordHash, terminalRecordHash: scan.frameCount ? scan.terminalRecordHash : retained.terminalRecordHash, prefixSha256: readHash(currentLedger.path), recordIds: allRecordIds, recordHashes: allRecordHashes, preparedRequestIds: [...retained.preparedRequestIds, ...scan.preparedIds] });
  }

  // A new session/base ledger is lawful only when it is independently valid
  // from a null ancestry head. It may be empty, but it may not refer into an
  // older ledger because ledgers are session-scoped custody boundaries.
  for (const extra of extras) {
    const scan = scanLedger(extra.path, { knownIds, decodeRawReturn: true });
    for (const requestId of scan.preparedIds) {
      const request = scan.lifecycle.get(requestId);
      request.ledgerId = extra.descriptor.logicalId;
      preparedById.set(requestId, stateToPublic(request));
    }
    for (let index = 0; index < scan.recordIds.length; index++) records.push({ recordId: scan.recordIds[index], recordHash: scan.recordHashes[index], ledgerId: extra.descriptor.logicalId });
    nextLedgers.push({ ...extra.descriptor, byteBoundary: scan.byteBoundary, frameCount: scan.frameCount, firstRecordHash: scan.firstRecordHash, terminalRecordHash: scan.terminalRecordHash, prefixSha256: readHash(extra.path), recordIds: scan.recordIds, recordHashes: scan.recordHashes, preparedRequestIds: scan.preparedIds });
  }

  const nextPrepared = [...preparedById.values()];
  const next = buildIndex({ storeIdentity: proof.storeIdentity, ledgers: nextLedgers, records, prepared: nextPrepared });
  return { ...next, ...publicView(next), mode: suffixFrameCount || extras.length ? 'checkpoint_suffix' : 'checkpoint_unchanged', frameCount: records.length, ledgerCount: nextLedgers.length, requestCount: nextPrepared.length, appendedFrameCount: suffixFrameCount };
}

export const verifySpineIncrementally = validateSpineVerifiedProof;
export const validateSpineCheckpoint = validateSpineVerifiedProof;
export const verifySpineCheckpoint = validateSpineVerifiedProof;

/** Return only the Forest-compatible prepared/lifecycle projection. */
export function spineForestView(proof) {
  validateIndexShape(proof);
  return publicView(proof);
}

export const preparedLifecycleView = spineForestView;
