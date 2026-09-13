import { admitSpotlightObservation } from './observation.js';
import { canonicalStringify, deepFreeze, isPlainObject } from './canonical.js';
import {
  SPOTLIGHT_GATE_API,
  createSpotlightCapabilityService,
} from './gate.js';
import { SPOTLIGHT_TOOL_NAMES } from './tools.js';

export const SPOTLIGHT_LIVE_READ_API = 'spotlight-live-read.v1';
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/#-]{0,255}$/;
const SAFE_CODE = /^[a-z][a-z0-9_.:-]{0,79}$/;
const ALIAS = /^[a-z][a-z0-9_-]{1,47}$/;
const EQUITY_SYMBOL = /^[A-Z][A-Z0-9.-]{0,9}$/;
const CRYPTO_SYMBOL = /^[A-Z][A-Z0-9._-]{0,19}$/;

export class SpotlightLiveReadError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'SpotlightLiveReadError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function fail(code, message, details = undefined) { throw new SpotlightLiveReadError(code, message, details); }
function text(value, name, max = 256) {
  if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value, 'utf8') > max) fail('spotlight_invalid_argument', `${name} is invalid.`);
  return value;
}
function idText(value, name) {
  const valueText = text(value, name);
  if (!SAFE_ID.test(valueText)) fail('spotlight_invalid_argument', `${name} is invalid.`);
  return valueText;
}
function code(value, fallback) { return typeof value === 'string' && SAFE_CODE.test(value) ? value : fallback; }
function exactKeys(value, allowed, name) {
  if (!isPlainObject(value)) fail('spotlight_invalid_argument', `${name} must be an object.`);
  const keys = Object.keys(value);
  if (keys.some(key => !allowed.includes(key))) fail('spotlight_invalid_argument', `${name} contains an unknown field.`);
  return keys;
}
function sourceState(source) {
  if (!source || typeof source.observe !== 'function' || typeof source.status !== 'function') return { state: 'unavailable', code: 'source_missing' };
  try {
    const status = source.status();
    if (!isPlainObject(status) || !['connected', 'authentication_required', 'unavailable'].includes(status.state)) return { state: 'unavailable', code: 'source_status_invalid' };
    const defaultCode = status.state === 'connected' ? 'connected' : status.state === 'authentication_required' ? 'authentication_required' : 'source_unavailable';
    return { state: status.state, code: code(status.code, defaultCode) };
  } catch {
    return { state: 'unavailable', code: 'source_status_failed' };
  }
}
function parseAlias(value, name) {
  const alias = text(value, name).trim();
  if (!ALIAS.test(alias) || /^\d+$/.test(alias) || /^[0-9a-f]{8,}(-[0-9a-f-]+)?$/i.test(alias)) fail('spotlight_invalid_instrument', `${name} is invalid.`);
  return alias;
}
function parseSymbol(value, kind, name) {
  const symbol = text(value, name);
  if (symbol !== symbol.toUpperCase()) fail('spotlight_invalid_instrument', `${name} is invalid.`);
  if (!(kind === 'crypto' ? CRYPTO_SYMBOL : EQUITY_SYMBOL).test(symbol)) fail('spotlight_invalid_instrument', `${name} is invalid.`);
  return symbol;
}
function parseInstrument(value) {
  const instrument = text(value, 'instrument_id').trim();
  if (instrument === 'accounts') return { instrumentId: instrument, operation: 'accounts', request: {} };
  const scoped = instrument.match(/^(portfolio|equity-positions|crypto-positions):(.+)$/);
  if (scoped) {
    const alias = parseAlias(scoped[2], 'instrument_id account alias');
    const operation = scoped[1] === 'portfolio' ? 'portfolio' : scoped[1] === 'equity-positions' ? 'equity_positions' : 'crypto_positions';
    return { instrumentId: `${scoped[1]}:${alias}`, providerInstrumentId: `${scoped[1]}:${alias}`, operation, request: { accountAlias: alias } };
  }
  const quote = instrument.match(/^(equity|crypto):(.+)$/);
  if (quote) {
    const symbol = parseSymbol(quote[2], quote[1], 'instrument_id symbol');
    // Robinhood's normalized quote observation is identified by the symbol;
    // the provider-neutral input grammar still accepts an explicit asset kind.
    return { instrumentId: `${quote[1]}:${symbol}`, providerInstrumentId: symbol, operation: quote[1] === 'crypto' ? 'crypto_quote' : 'equity_quote', request: { symbol } };
  }
  const symbol = parseSymbol(instrument, 'equity', 'instrument_id symbol');
  return { instrumentId: `equity:${symbol}`, providerInstrumentId: symbol, operation: 'equity_quote', request: { symbol } };
}
function contextOf(context) {
  if (!isPlainObject(context)) fail('spotlight_invalid_context', 'Spotlight observation context is invalid.');
  return {
    sessionId: idText(context.sessionId, 'sessionId'),
    wakeId: idText(context.wakeId, 'wakeId'),
    commandId: idText(context.commandId, 'commandId'),
  };
}
function observationWithoutMetadata(observation) {
  const candidate = structuredClone(observation);
  delete candidate.apiVersion;
  delete candidate.sourceReceipt;
  return candidate;
}
function sourceObservation(value) {
  try {
    // The adapter already admits the envelope. Re-admitting the payload here
    // protects the service when a host injects a look-alike source.
    if (!isPlainObject(value) || !isPlainObject(value.sourceReceipt)) fail('spotlight_source_invalid_observation', 'Source observation is invalid.');
    const admitted = admitSpotlightObservation(observationWithoutMetadata(value));
    if (canonicalStringify(value.sourceReceipt) !== canonicalStringify(admitted.sourceReceipt)) fail('spotlight_source_invalid_observation', 'Source observation receipt is invalid.');
    return deepFreeze({ ...admitted, sourceReceipt: structuredClone(value.sourceReceipt) });
  } catch (error) {
    if (error instanceof SpotlightLiveReadError) throw error;
    fail('spotlight_source_invalid_observation', 'Source observation is invalid.');
  }
}
function assertSourceIdentity(observation, parsed) {
  if (observation.source.authority !== 'robinhood') fail('spotlight_source_invalid_observation', 'Source observation authority is invalid.');
  const suffix = parsed.operation === 'accounts' ? 'all' : parsed.request.accountAlias || parsed.request.symbol;
  const expectedReference = `robinhood:${parsed.operation}:${suffix}`;
  if (observation.source.reference !== expectedReference || observation.instrument.id !== (parsed.providerInstrumentId || parsed.instrumentId)) {
    fail('spotlight_source_invalid_observation', 'Source observation identity does not match the requested read.');
  }
}
function retainedResult(name, payload = {}) {
  return deepFreeze({ kind: name, apiVersion: SPOTLIGHT_LIVE_READ_API, roomId: 'room.spotlight', toolName: name, status: 'available', availability: 'available', network: false, mutated: false, ...payload });
}
function refusal(name, reason, missing = []) {
  return deepFreeze({ kind: 'spotlight_hand_result', apiVersion: SPOTLIGHT_GATE_API, roomId: 'room.spotlight', toolName: name, status: 'withheld', availability: 'unavailable', reason, missingRequirements: missing, missing: missing.map(item => item.id), attempted: false, network: false, mutated: false, approvalCreated: false });
}
function errorResult(error, network, attempted = true) {
  const errorCode = code(error?.errorCode || error?.code, 'spotlight_source_failed');
  return { status: 'failed', availability: 'unavailable', reason: errorCode, errorCode, error: 'Spotlight source read failed.', attempted, network: network === true, mutated: false, observationId: null };
}
function settlementResult(name, settlement, { replayed = false } = {}) {
  if (settlement.status === 'succeeded') {
    return deepFreeze({ kind: 'spotlight_observation', apiVersion: SPOTLIGHT_LIVE_READ_API, roomId: 'room.spotlight', toolName: name, status: 'observed', availability: 'available', observationId: settlement.observationId, retained: true, observation: settlement.observation, attempted: !replayed, replayed, network: !replayed, mutated: false, authority: settlement.observation.authority });
  }
  return deepFreeze({ kind: 'spotlight_observation', apiVersion: SPOTLIGHT_LIVE_READ_API, roomId: 'room.spotlight', toolName: name, ...errorResult(settlement, settlement.network, !replayed), replayed });
}

export class SpotlightLiveReadService {
  constructor({ source = null, store = null, gate = null, bindings = {} } = {}) {
    this.source = source;
    this.store = store;
    this.gate = gate || createSpotlightCapabilityService({ bindings });
    this.inflight = new Map();
    this.closing = false;
    this.closed = false;
    this.closePromise = null;
  }

  status() {
    const connection = this.closed ? { state: 'unavailable', code: 'closed' } : sourceState(this.source);
    let custody = { state: 'unavailable', schemaVersion: 1, code: 'store_missing' };
    if (!this.closed && this.store && typeof this.store.verify === 'function') {
      try {
        const report = this.store.verify();
        custody = report?.verified ? { state: 'ready', schemaVersion: 1 } : { state: 'unavailable', schemaVersion: 1, code: code(report?.code, 'store_unavailable') };
      } catch { custody = { state: 'unavailable', schemaVersion: 1, code: 'store_unavailable' }; }
    }
    let base;
    try { base = structuredClone(this.gate.status()); } catch { base = structuredClone(createSpotlightCapabilityService().status()); }
    const liveNames = new Set(['spotlight_observation_list', 'spotlight_observation_read', 'spotlight_observe']);
    const hands = (base.hands || SPOTLIGHT_TOOL_NAMES.map(name => ({ name }))).map(hand => {
      if (!liveNames.has(hand.name)) return hand;
      const ready = custody.state === 'ready' && (hand.name !== 'spotlight_observe' || connection.state === 'connected');
      const missing = [];
      if (custody.state !== 'ready') missing.push({ id: 'custody.spotlight_observations', kind: 'custody', state: 'optional_unwired', ready: false });
      if (hand.name === 'spotlight_observe' && connection.state !== 'connected') missing.push({ id: 'socket.observation_source', kind: 'socket', state: 'optional_unwired', ready: false });
      return { ...hand, usable: ready, status: ready ? 'available' : 'withheld', missingRequirements: missing };
    });
    const missingRequirements = hands.flatMap(hand => (hand.missingRequirements || []).map(item => ({ hand: hand.name, ...item })));
    return deepFreeze({ ...base, kind: 'spotlight_capability_status', apiVersion: SPOTLIGHT_GATE_API, roomId: 'room.spotlight', status: 'available', availability: 'available', capped: hands.some(hand => !hand.usable), hands, missingRequirements, connection, custody, observationGrammar: [
      'accounts', 'portfolio:<opaque-alias>', 'equity-positions:<opaque-alias>', 'crypto-positions:<opaque-alias>', 'equity:<SYMBOL>', 'crypto:<SYMBOL>', '<SYMBOL>',
    ], network: false, mutated: false });
  }

  invoke(name, args = {}, context = {}) {
    if (this.closed || this.closing) fail('spotlight_service_closed', 'Spotlight live reads are closed.');
    if (name === 'spotlight_capability_status') {
      if (Object.keys(args || {}).length) fail('spotlight_invalid_argument', 'Spotlight capability status accepts no arguments.');
      return this.status();
    }
    if (name === 'spotlight_observation_list') return this.list(args);
    if (name === 'spotlight_observation_read') return this.read(args);
    if (name === 'spotlight_observe') return this.observe(args, context);
    // The original room gate remains the owner of every packet, replay,
    // proposal, ring, and execution hand. Its flags cannot activate a read.
    return this.gate.invoke(name, {}, context);
  }

  list(args = {}) {
    if (!this.store || typeof this.store.list !== 'function') return refusal('spotlight_observation_list', 'missing_requirements', [{ id: 'custody.spotlight_observations', kind: 'custody', state: 'optional_unwired', ready: false }]);
    exactKeys(args, ['instrument_id', 'limit'], 'spotlight_observation_list arguments');
    let instrumentId = null;
    if (Object.hasOwn(args, 'instrument_id')) instrumentId = parseInstrument(args.instrument_id).instrumentId;
    const observations = this.store.list({ instrumentId, limit: args.limit === undefined ? 100 : args.limit });
    return retainedResult('spotlight_observation_list', { observations, count: observations.length, retained: true });
  }

  read(args = {}) {
    if (!this.store || typeof this.store.read !== 'function') return refusal('spotlight_observation_read', 'missing_requirements', [{ id: 'custody.spotlight_observations', kind: 'custody', state: 'optional_unwired', ready: false }]);
    exactKeys(args, ['observation_id'], 'spotlight_observation_read arguments');
    const observationId = idText(args.observation_id, 'observation_id');
    const retained = this.store.read(observationId);
    if (!retained) return retainedResult('spotlight_observation_read', { status: 'not_found', availability: 'unavailable', observationId, retained: false, reason: 'observation_not_found' });
    return retainedResult('spotlight_observation_read', { observationId, retained: true, observation: retained.observation, observedAt: retained.observedAt, receivedAt: retained.receivedAt });
  }

  observe(args = {}, context = {}) {
    exactKeys(args, ['instrument_id', 'observation_ref'], 'spotlight_observe arguments');
    if (!Object.hasOwn(args, 'instrument_id')) fail('spotlight_invalid_argument', 'instrument_id is required.');
    const parsed = parseInstrument(args.instrument_id);
    let observationRef = null;
    if (Object.hasOwn(args, 'observation_ref')) observationRef = idText(args.observation_ref, 'observation_ref');
    const identity = contextOf(context);
    if (!this.store || typeof this.store.recordAttempt !== 'function') return refusal('spotlight_observe', 'missing_requirements', [{ id: 'custody.spotlight_observations', kind: 'custody', state: 'optional_unwired', ready: false }]);
    if (observationRef) {
      const retained = this.store.read(observationRef);
      if (!retained) fail('spotlight_observation_ref_not_found', 'Observation reference is not retained.');
      if (retained.instrumentId !== parsed.instrumentId) fail('spotlight_observation_ref_mismatch', 'Observation reference does not match the requested instrument.');
    }
    const request = { ...parsed.request, ...(observationRef ? { observationRef } : {}) };
    const key = `${identity.sessionId}\u001f${identity.wakeId}\u001f${identity.commandId}`;
    const fingerprint = canonicalStringify({ operation: parsed.operation, instrumentId: parsed.instrumentId, request });
    const active = this.inflight.get(key);
    if (active) {
      if (active.fingerprint !== fingerprint) fail('spotlight_store_duplicate_conflict', 'Observation command identity was reused with different arguments.');
      return active.promise;
    }
    let attempt;
    try {
      attempt = this.store.recordAttempt({ ...identity, operation: parsed.operation, instrumentId: parsed.instrumentId, request });
    } catch (error) { throw error; }
    if (attempt.kind === 'settled') return settlementResult('spotlight_observe', this.store.settlementFor(identity) || attempt.settlement, { replayed: true });
    if (attempt.kind === 'pending_restart') fail('spotlight_observation_pending_restart', 'An interrupted observation requires a new deliberate call.');
    if (attempt.kind === 'pending') fail('spotlight_observation_pending', 'An observation with this command identity is already pending.');
    const work = this.performObserve({ parsed, identity, attempt });
    this.inflight.set(key, { fingerprint, promise: work });
    work.then(() => this.inflight.delete(key), () => this.inflight.delete(key));
    return work;
  }

  async performObserve({ parsed, identity, attempt }) {
    const source = sourceState(this.source);
    if (source.state !== 'connected') {
      const settlement = this.store.settleFailure({ attemptId: attempt.attempt.attempt_id, code: source.state === 'authentication_required' ? 'spotlight_authentication_required' : 'spotlight_source_unavailable', message: 'Source unavailable.', network: false });
      return settlementResult('spotlight_observe', settlement);
    }
    try {
      const value = sourceObservation(await this.source.observe(parsed.operation, parsed.request));
      assertSourceIdentity(value, parsed);
      const settlement = this.store.settleSuccess({ attemptId: attempt.attempt.attempt_id, observation: value, expectedInstrumentId: parsed.providerInstrumentId || parsed.instrumentId, requestedInstrumentId: parsed.instrumentId });
      return settlementResult('spotlight_observe', settlement);
    } catch (error) {
      const settlement = this.store.settleFailure({ attemptId: attempt.attempt.attempt_id, code: error?.code || 'spotlight_source_failed', message: 'Source read failed.', network: true });
      return settlementResult('spotlight_observe', settlement);
    }
  }

  close() {
    if (this.closed) return Promise.resolve();
    if (this.closePromise) return this.closePromise;
    this.closing = true;
    this.closePromise = (async () => {
      try {
        if (this.source && typeof this.source.close === 'function') await this.source.close();
      } finally {
        await Promise.allSettled([...this.inflight.values()].map(entry => entry.promise));
        this.inflight.clear();
        try { this.store?.close?.(); } finally { this.closed = true; }
      }
    })();
    return this.closePromise;
  }
}

export function createSpotlightLiveService(options = {}) { return new SpotlightLiveReadService(options); }
