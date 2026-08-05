import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readSync } from 'node:fs';
import { dirname } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { byteLength, canonicalize, id, sha256 } from './hash.js';

const SCHEMA_VERSION = 1;

function validateOutcome(outcome) {
  if (!outcome || typeof outcome !== 'object' || typeof outcome.kind !== 'string') throw new Error('Spine provider outcome shape is invalid.');
  const status = outcome.http_status;
  const validStatus = Number.isInteger(status) && status >= 100 && status <= 599;
  if (outcome.kind === 'network_error') {
    if (Object.keys(outcome).some(key => !['kind', 'network_code'].includes(key)) || outcome.network_code !== 'fetch_failed') throw new Error('Spine network outcome shape is invalid.');
    return;
  }
  if (['http_error', 'invalid_response', 'empty_content'].includes(outcome.kind)) {
    if (!validStatus || Object.keys(outcome).some(key => !['kind', 'http_status'].includes(key))) throw new Error('Spine HTTP outcome shape is invalid.');
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
    lifecycle.set(frame.record_id, { dispatched: false, outcome: false });
    return;
  }
  const request = lifecycle.get(frame.request_record_id);
  if (!request) throw new Error('Spine receipt must reference an earlier prepared frame.');
  if (frame.frame_type === 'dispatch_attempted') {
    if (request.dispatched) throw new Error('Spine request has duplicate dispatch receipts.');
    request.dispatched = true;
  } else if (frame.frame_type === 'provider_outcome') {
    if (!request.dispatched) throw new Error('Spine outcome cannot precede dispatch.');
    if (request.outcome) throw new Error('Spine request has duplicate outcome receipts.');
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
    } else if (frame.frame_type === 'dispatch_attempted' || frame.frame_type === 'provider_outcome') {
      if (typeof frame.request_record_id !== 'string') throw new Error('Spine receipt is missing its request identifier.');
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

function lifecycleFromFrames(frames) {
  const lifecycle = new Map();
  for (const frame of frames) applyLifecycle(frame, lifecycle);
  return lifecycle;
}

export class SpineStore {
  constructor(path) {
    this.path = path;
    mkdirSync(dirname(path), { recursive: true });
    this._frames = readFrames(path);
    this._ids = new Set(this._frames.map(frame => frame.record_id));
    this._lifecycle = lifecycleFromFrames(this._frames);
    this._tail = this._frames.at(-1) || null;
  }

  append(frameType, fields = {}) {
    if (!['request_prepared', 'dispatch_attempted', 'provider_outcome'].includes(frameType)) throw new Error('Spine contains an unknown frame type.');
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

  prepareRequest({ requestBody, threadId, wakeId, provider, model, authorizationPresent }) {
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

  frames() { return this._frames.map(frame => ({ ...frame })); }
  verify() { return verifySpine(this.path); }
  close() {}
}

export function verifySpine(path) {
  const frames = readFrames(path);
  return { ok: true, frameCount: frames.length, requestCount: frames.filter(frame => frame.frame_type === 'request_prepared').length };
}

export function readSpineFrames(path) { return readFrames(path); }
