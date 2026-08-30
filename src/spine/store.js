import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readdirSync, readSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { byteLength, canonicalize, id, sha256, sha256Bytes } from '../core/hash.js';

const SCHEMA_VERSION = 1;

function validateOutcome(outcome) {
  if (!outcome || typeof outcome !== 'object' || typeof outcome.kind !== 'string') throw new Error('Spine provider outcome shape is invalid.');
  const status = outcome.http_status;
  const validStatus = Number.isInteger(status) && status >= 100 && status <= 599;
  if (outcome.kind === 'network_error') {
    const codes = new Set(['fetch_failed', 'aborted', 'stream_interrupted']);
    const hasStatus = Object.hasOwn(outcome, 'http_status');
    if (Object.keys(outcome).some(key => !['kind', 'network_code', 'http_status'].includes(key)) || !codes.has(outcome.network_code)
      || (hasStatus && !validStatus)
      || (outcome.network_code === 'fetch_failed' && hasStatus)
      || (outcome.network_code === 'stream_interrupted' && !hasStatus)) throw new Error('Spine network outcome shape is invalid.');
    return;
  }
  if (['http_error', 'invalid_response', 'empty_content'].includes(outcome.kind)) {
    if (!validStatus || Object.keys(outcome).some(key => !['kind', 'http_status'].includes(key))) throw new Error('Spine HTTP outcome shape is invalid.');
    return;
  }
  if (outcome.kind === 'oversized_response') {
    if (!validStatus || !Number.isInteger(outcome.limit_bytes) || outcome.limit_bytes < 1 || !Number.isInteger(outcome.observed_bytes) || outcome.observed_bytes <= outcome.limit_bytes || Object.keys(outcome).some(key => !['kind', 'http_status', 'limit_bytes', 'observed_bytes'].includes(key))) throw new Error('Spine oversized response outcome shape is invalid.');
    return;
  }
  if (outcome.kind === 'success') {
    if (!validStatus || status < 200 || status >= 300 || Object.keys(outcome).some(key => !['kind', 'http_status', 'response_id'].includes(key)) || (outcome.response_id !== null && typeof outcome.response_id !== 'string')) throw new Error('Spine success outcome shape is invalid.');
    return;
  }
  throw new Error('Spine contains an unknown provider outcome kind.');
}

function applyLifecycle(frame, lifecycle) {
  if (frame.frame_type === 'request_prepared') {
    if (lifecycle.has(frame.record_id)) throw new Error('Spine contains a duplicate request lifecycle.');
    lifecycle.set(frame.record_id, { dispatched: false, raw_return: false, outcome: false, phase: frame.request_phase || null, requires_raw_return: frame.return_custody_version === 1 && Boolean(frame.request_phase) });
    return;
  }
  const request = lifecycle.get(frame.request_record_id);
  if (!request) throw new Error('Spine receipt must reference an earlier prepared frame.');
  if (frame.frame_type === 'dispatch_attempted') {
    if (request.dispatched) throw new Error('Spine request has duplicate dispatch receipts.');
    request.dispatched = true;
  } else if (frame.frame_type === 'raw_return') {
    if (!request.dispatched) throw new Error('Spine raw return cannot precede dispatch.');
    if (request.outcome) throw new Error('Spine raw return cannot follow provider outcome.');
    if (frame.request_phase && frame.request_phase !== request.phase) throw new Error('Spine raw return phase does not match its request.');
    if (request.raw_return) throw new Error('Spine request has duplicate raw returns.');
    request.raw_return = true;
  } else if (frame.frame_type === 'provider_outcome') {
    if (!request.dispatched) throw new Error('Spine outcome cannot precede dispatch.');
    if (request.outcome) throw new Error('Spine request has duplicate outcome receipts.');
    if (request.requires_raw_return && frame.outcome.kind !== 'network_error' && !request.raw_return) throw new Error('Spine provider outcome requires an earlier raw return.');
    validateOutcome(frame.outcome);
    request.outcome = true;
  }
}

function readFrames(path) {
  if (!existsSync(path)) return [];
  const frames = [];
  const ids = new Set();
  const lifecycle = new Map();
  let previousHash = null;
  const consume = line => {
    if (!line) throw new Error('Spine contains an empty frame.');
    let frame;
    try { frame = JSON.parse(line); } catch { throw new Error('Spine contains malformed JSON.'); }
    if (frame.schema_version !== SCHEMA_VERSION) throw new Error('Spine contains an unknown schema version.');
    if (typeof frame.record_id !== 'string' || ids.has(frame.record_id)) throw new Error('Spine contains a duplicate record ID.');
    if (frame.previous_record_hash !== previousHash) throw new Error('Spine hash-chain ancestry is broken.');
    if (typeof frame.record_hash !== 'string') throw new Error('Spine frame is missing its record hash.');
    const { record_hash: ignored, ...withoutHash } = frame;
    if (sha256(canonicalize(withoutHash)) !== frame.record_hash) throw new Error('Spine record hash mismatch.');
    if (frame.frame_type === 'request_prepared') {
      if (typeof frame.request_body !== 'string' || typeof frame.thread_id !== 'string' || typeof frame.wake_id !== 'string' || typeof frame.provider !== 'string' || typeof frame.model !== 'string' || typeof frame.authorization_present !== 'boolean' || frame.body_byte_length !== byteLength(frame.request_body) || frame.body_sha256 !== sha256(frame.request_body)) {
        throw new Error('Spine request body length or hash mismatch.');
      }
      if (frame.request_phase !== undefined && !['orientation', 'response', 'ordinary'].includes(frame.request_phase)) throw new Error('Spine request phase is invalid.');
      if (frame.return_custody_version !== undefined && frame.return_custody_version !== 1) throw new Error('Spine return custody generation is invalid.');
    } else if (frame.frame_type === 'dispatch_attempted' || frame.frame_type === 'provider_outcome') {
      if (typeof frame.request_record_id !== 'string') throw new Error('Spine receipt is missing its request identifier.');
    } else if (frame.frame_type === 'raw_return') {
      const body = typeof frame.raw_body_base64 === 'string' ? Buffer.from(frame.raw_body_base64, 'base64') : null;
      if (typeof frame.request_record_id !== 'string' || !body || Buffer.from(frame.raw_body_base64, 'base64').toString('base64') !== frame.raw_body_base64 || frame.body_byte_length !== body.length || frame.body_sha256 !== sha256Bytes(body)) {
        throw new Error('Spine raw return body length or hash mismatch.');
      }
      if (!Number.isInteger(frame.http_status) || frame.http_status < 100 || frame.http_status > 599) throw new Error('Spine raw return HTTP status is invalid.');
      if (frame.content_type !== null && typeof frame.content_type !== 'string') throw new Error('Spine raw return content type is invalid.');
      if (frame.request_phase !== undefined && !['orientation', 'response', 'ordinary'].includes(frame.request_phase)) throw new Error('Spine raw return phase is invalid.');
    } else {
      throw new Error('Spine contains an unknown frame type.');
    }
    applyLifecycle(frame, lifecycle);
    ids.add(frame.record_id);
    previousHash = frame.record_hash;
    frames.push(frame);
  };
  const fd = openSync(path, 'r');
  const decoder = new StringDecoder('utf8');
  const buffer = Buffer.allocUnsafe(64 * 1024);
  let carry = '';
  let readAny = false;
  let endedWithNewline = false;
  try {
    let count;
    while ((count = readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      readAny = true;
      carry += decoder.write(buffer.subarray(0, count));
      let newline;
      while ((newline = carry.indexOf('\n')) !== -1) {
        consume(carry.slice(0, newline));
        carry = carry.slice(newline + 1);
        endedWithNewline = true;
      }
      if (carry.length) endedWithNewline = false;
    }
    carry += decoder.end();
    let newline;
    while ((newline = carry.indexOf('\n')) !== -1) {
      consume(carry.slice(0, newline));
      carry = carry.slice(newline + 1);
      endedWithNewline = true;
    }
    if (carry.length || (readAny && !endedWithNewline)) throw new Error('Spine contains a trailing partial frame.');
  } finally { closeSync(fd); }
  return frames;
}

export function sessionSpinePath(path, sessionId) {
  if (!sessionId) return path;
  const extension = extname(path) || '.jsonl';
  const stem = basename(path, extname(path));
  return join(dirname(path), 'sessions', `${stem}.${sessionId}${extension}`);
}

export function spineLedgerPaths(path) {
  const paths = existsSync(path) ? [path] : [];
  const sessionDirectory = join(dirname(path), 'sessions');
  if (!existsSync(sessionDirectory)) return paths;
  const extension = extname(path) || '.jsonl';
  const prefix = `${basename(path, extname(path))}.session`;
  for (const entry of readdirSync(sessionDirectory, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.startsWith(prefix) && entry.name.endsWith(extension)) paths.push(join(sessionDirectory, entry.name));
  }
  return paths.sort();
}

export function spineLedgerExists(path) { return spineLedgerPaths(path).length > 0; }

export function readSpineLedgerFrames(path) {
  const frames = [];
  const ids = new Set();
  for (const ledgerPath of spineLedgerPaths(path)) {
    for (const frame of readFrames(ledgerPath)) {
      if (ids.has(frame.record_id)) throw new Error('Spine contains a duplicate record ID across session ledgers.');
      ids.add(frame.record_id);
      frames.push(frame);
    }
  }
  return frames;
}

function lifecycleFromFrames(frames) {
  const lifecycle = new Map();
  for (const frame of frames) applyLifecycle(frame, lifecycle);
  return lifecycle;
}

export class SpineStore {
  constructor(path, { sessionId = null } = {}) {
    this.basePath = path;
    this.sessionId = sessionId;
    this.path = sessionSpinePath(path, sessionId);
    mkdirSync(dirname(this.path), { recursive: true });
    this._frames = readFrames(this.path);
    this._ids = new Set(this._frames.map(frame => frame.record_id));
    this._lifecycle = lifecycleFromFrames(this._frames);
    this._tail = this._frames.at(-1) || null;
  }

  append(frameType, fields = {}) {
    if (!['request_prepared', 'dispatch_attempted', 'raw_return', 'provider_outcome'].includes(frameType)) throw new Error('Spine contains an unknown frame type.');
    const frame = {
      schema_version: SCHEMA_VERSION,
      frame_type: frameType,
      record_id: id('spine'),
      previous_record_hash: this._tail?.record_hash || null,
      ...fields,
    };
    frame.record_hash = sha256(canonicalize(frame));
    const nextLifecycle = new Map([...this._lifecycle].map(([key, value]) => [key, { ...value }]));
    applyLifecycle(frame, nextLifecycle);
    appendFileSync(this.path, `${JSON.stringify(frame)}\n`, 'utf8');
    this._frames.push(frame); this._ids.add(frame.record_id); this._lifecycle = nextLifecycle; this._tail = frame;
    return frame;
  }

  prepareRequest({ requestBody, threadId, wakeId, provider, model, authorizationPresent, requestPhase }) {
    if (typeof requestBody !== 'string') throw new Error('Spine request body must be a string.');
    return this.append('request_prepared', {
      request_body: requestBody,
      body_byte_length: byteLength(requestBody),
      body_sha256: sha256(requestBody),
      thread_id: threadId,
      wake_id: wakeId,
      provider,
      model,
      prepared_at: new Date().toISOString(),
      authorization_present: Boolean(authorizationPresent),
      safe_header_names: ['authorization', 'content-type'],
      return_custody_version: 1,
      ...(requestPhase ? { request_phase: requestPhase } : {}),
    });
  }

  dispatchAttempted(requestRecordId) {
    return this.append('dispatch_attempted', {
      request_record_id: requestRecordId,
      dispatched_at: new Date().toISOString(),
    });
  }

  providerOutcome(requestRecordId, outcome) {
    return this.append('provider_outcome', {
      request_record_id: requestRecordId,
      observed_at: new Date().toISOString(),
      outcome,
    });
  }

  providerRawReturn(requestRecordId, { body, httpStatus, contentType = null, phase = null } = {}) {
    const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body instanceof Uint8Array ? body : String(body ?? ''), 'utf8');
    return this.append('raw_return', {
      request_record_id: requestRecordId,
      raw_body_base64: bytes.toString('base64'),
      body_byte_length: bytes.length,
      body_sha256: sha256Bytes(bytes),
      http_status: httpStatus,
      content_type: contentType || null,
      ...(phase ? { request_phase: phase } : {}),
      observed_at: new Date().toISOString(),
    });
  }

  frames() { return this._frames.map(frame => ({ ...frame })); }
  verify() { return verifySpine(this.path); }
  close() {}
}

export function verifySpine(path) {
  const paths = spineLedgerPaths(path);
  const frames = readSpineLedgerFrames(path);
  return { ok: true, ledgerCount: paths.length, frameCount: frames.length, requestCount: frames.filter(frame => frame.frame_type === 'request_prepared').length };
}

export function readSpineFrames(path) { return readFrames(path); }
