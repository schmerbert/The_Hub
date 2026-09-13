import { admitSpotlightObservation } from './observation.js';
import { deepFreeze, isPlainObject } from './canonical.js';

/**
 * The Robinhood seam is intentionally an adapter, not a Robinhood client.
 *
 * A host bridge may inject one or more already-authenticated, read-only
 * callables.  This module never owns credentials, transport, provider tool
 * names, or a generic MCP escape hatch.  It accepts only the six semantic
 * reads below and turns their bounded, host-shaped responses into the
 * provider-neutral Spotlight observation contract.
 */

export const SPOTLIGHT_ROBINHOOD_ADAPTER_API = 'spotlight-robinhood-read-adapter.v1';
export const SPOTLIGHT_ROBINHOOD_SOURCE_AUTHORITY = 'robinhood';

export const ROBINHOOD_READ_OPERATION_NAMES = Object.freeze([
  'accounts',
  'portfolio',
  'equity_positions',
  'crypto_positions',
  'equity_quote',
  'crypto_quote',
]);

export const ROBINHOOD_READ_OPERATIONS = Object.freeze({
  accounts: Object.freeze({ accountRequired: false, instrument: 'accounts' }),
  portfolio: Object.freeze({ accountRequired: true, instrument: 'portfolio' }),
  equity_positions: Object.freeze({ accountRequired: true, instrument: 'equity_positions' }),
  crypto_positions: Object.freeze({ accountRequired: true, instrument: 'crypto_positions' }),
  equity_quote: Object.freeze({ accountRequired: false, instrument: 'equity_quote' }),
  crypto_quote: Object.freeze({ accountRequired: false, instrument: 'crypto_quote' }),
});

const DEFAULT_LIMITS = Object.freeze({
  maxResponseBytes: 256_000,
  maxDepth: 12,
  maxObjects: 256,
  maxStringBytes: 2_048,
  maxPositions: 128,
  maxAccounts: 32,
});

const HOSTILE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

// IDs are deliberately removed before operation-specific unknown-field
// validation.  Non-sensitive unknown fields are rejected rather than copied.
const SENSITIVE_KEY = /^(?:id|.*(?:[_-](?:id|number|uuid|token|secret|key|credential|password|authorization|email|phone|ssn|routing|address|account|order|position|instrument|wallet|transfer|transaction|request|customer|client)(?:[_-].*)?))$/i;
const ALIAS = /^[a-z][a-z0-9_-]{1,47}$/;
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:?\d{2})$/;
const EQUITY_SYMBOL = /^[A-Z][A-Z0-9.-]{0,9}$/;
const CRYPTO_SYMBOL = /^[A-Z][A-Z0-9._-]{0,19}$/;
const CURRENCY = /^[A-Z]{3,5}$/;
const SAFE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:/#-]{0,255}$/;

export class RobinhoodReadAdapterError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'RobinhoodReadAdapterError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function fail(code, message, details = undefined) {
  throw new RobinhoodReadAdapterError(code, message, details);
}

function ownKeys(value, path) {
  if (!isPlainObject(value)) fail('spotlight_robinhood_malformed', `${path} must be a plain JSON object.`);
  const keys = Object.keys(value);
  for (const key of keys) {
    if (HOSTILE_KEYS.has(key)) fail('spotlight_robinhood_hostile', `${path} contains a hostile object key.`);
  }
  return keys;
}

function exactKeys(value, expected, path) {
  const keys = ownKeys(value, path);
  const allowed = new Set(expected);
  for (const key of keys) {
    if (!allowed.has(key) && !SENSITIVE_KEY.test(key)) fail('spotlight_robinhood_unknown_field', `Unknown field ${path}.${key}.`);
  }
  for (const key of expected) {
    if (!Object.hasOwn(value, key)) fail('spotlight_robinhood_missing_field', `Missing field ${path}.${key}.`);
  }
}

function exactRequestKeys(value, expected, path) {
  const keys = ownKeys(value, path);
  const allowed = new Set(expected);
  for (const key of keys) {
    if (!allowed.has(key)) fail('spotlight_robinhood_unknown_field', `Unknown field ${path}.${key}.`);
  }
  for (const key of expected) {
    if (!Object.hasOwn(value, key)) fail('spotlight_robinhood_missing_field', `Missing field ${path}.${key}.`);
  }
}

function optionalKeys(value, allowed, path) {
  const keys = ownKeys(value, path);
  const accepted = new Set(allowed);
  for (const key of keys) {
    if (!accepted.has(key) && !SENSITIVE_KEY.test(key)) fail('spotlight_robinhood_unknown_field', `Unknown field ${path}.${key}.`);
  }
}

function positiveInteger(value, path) {
  if (!Number.isSafeInteger(value) || value < 1) fail('spotlight_robinhood_malformed', `${path} must be a positive safe integer.`);
  return value;
}

function finiteNumber(value, path, { nullable = false, min = null } = {}) {
  if (value === null && nullable) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) fail('spotlight_robinhood_malformed', `${path} must be a finite number${nullable ? ' or null' : ''}.`);
  if (min !== null && value < min) fail('spotlight_robinhood_malformed', `${path} must be at least ${min}.`);
  return value;
}

function text(value, path, { nullable = false, maxBytes = DEFAULT_LIMITS.maxStringBytes } = {}) {
  if (value === null && nullable) return null;
  if (typeof value !== 'string' || !value.trim()) fail('spotlight_robinhood_malformed', `${path} must be a non-empty string${nullable ? ' or null' : ''}.`);
  if (Buffer.byteLength(value, 'utf8') > maxBytes) fail('spotlight_robinhood_oversized', `${path} exceeds the bounded string size.`);
  return value;
}

function timestamp(value, path) {
  if (typeof value !== 'string' || !ISO_DATE_TIME.test(value) || !Number.isFinite(Date.parse(value))) {
    fail('spotlight_robinhood_timestamp', `${path} must be a valid ISO timestamp.`);
  }
  return value;
}

function bool(value, path) {
  if (typeof value !== 'boolean') fail('spotlight_robinhood_malformed', `${path} must be a boolean.`);
  return value;
}

function symbol(value, path, kind) {
  const normalized = text(value, path).trim().toUpperCase();
  const valid = kind === 'equity' ? EQUITY_SYMBOL.test(normalized) : CRYPTO_SYMBOL.test(normalized);
  if (!valid) fail('spotlight_robinhood_symbol', `${path} is not a valid ${kind} symbol.`);
  return normalized;
}

function currency(value, path) {
  const normalized = text(value, path).trim().toUpperCase();
  if (!CURRENCY.test(normalized)) fail('spotlight_robinhood_malformed', `${path} must be a currency code.`);
  return normalized;
}

function limitsOf(configured = {}) {
  if (!isPlainObject(configured)) fail('spotlight_robinhood_invalid_limits', 'Robinhood adapter limits must be an object.');
  const limits = { ...DEFAULT_LIMITS };
  for (const key of Object.keys(configured)) {
    if (!Object.hasOwn(DEFAULT_LIMITS, key) || !Number.isSafeInteger(configured[key]) || configured[key] < 1) {
      fail('spotlight_robinhood_invalid_limits', `Invalid Robinhood adapter limit: ${key}.`);
    }
    limits[key] = configured[key];
  }
  return Object.freeze(limits);
}

function validateAlias(value, path) {
  const alias = text(value, path).trim();
  if (!ALIAS.test(alias) || /^\d+$/.test(alias) || /^[0-9a-f]{8,}(-[0-9a-f-]+)?$/i.test(alias)) {
    fail('spotlight_robinhood_account_alias', `${path} must be a stable opaque host-chosen alias.`);
  }
  return alias;
}

function validateJurisdictions(configured) {
  if (configured === undefined) return Object.freeze({});
  const keys = ownKeys(configured, '$.accountJurisdictions');
  if (keys.length > DEFAULT_LIMITS.maxAccounts) fail('spotlight_robinhood_oversized', 'Too many account jurisdictions.');
  const jurisdictions = {};
  for (const rawAlias of keys) {
    const alias = validateAlias(rawAlias, '$.accountJurisdictions alias');
    if (alias !== rawAlias) fail('spotlight_robinhood_account_alias', 'Account jurisdiction aliases must be canonical.');
    const value = configured[rawAlias];
    exactKeys(value, ['readOnly', 'agentAccessible'], `$.accountJurisdictions.${rawAlias}`);
    jurisdictions[alias] = Object.freeze({
      alias,
      readOnly: bool(value.readOnly, `$.accountJurisdictions.${rawAlias}.readOnly`),
      agentAccessible: bool(value.agentAccessible, `$.accountJurisdictions.${rawAlias}.agentAccessible`),
    });
  }
  return Object.freeze(jurisdictions);
}

function validateRequest(operation, request, jurisdictions) {
  if (!ROBINHOOD_READ_OPERATIONS[operation]) fail('spotlight_robinhood_operation_not_allowlisted', `Robinhood operation is not allowlisted: ${operation}.`);
  if (!isPlainObject(request)) fail('spotlight_robinhood_malformed', 'Robinhood read arguments must be an object.');
  const config = ROBINHOOD_READ_OPERATIONS[operation];
  if (operation === 'accounts') {
    exactRequestKeys(request, [], '$.request');
    return Object.freeze({});
  }
  if (config.accountRequired) {
    const keys = ownKeys(request, '$.request');
    if (keys.some(key => !['accountAlias', 'symbol'].includes(key))) fail('spotlight_robinhood_unknown_field', '$.request contains an unknown field.');
    if (!Object.hasOwn(request, 'accountAlias')) fail('spotlight_robinhood_ambiguous_account', `${operation} requires an explicit accountAlias.`);
    const accountAlias = validateAlias(request.accountAlias, '$.request.accountAlias');
    if (!Object.hasOwn(jurisdictions, accountAlias)) fail('spotlight_robinhood_account_unavailable', `Unknown account jurisdiction alias: ${accountAlias}.`);
    const normalized = { accountAlias };
    if (Object.hasOwn(request, 'symbol')) {
      normalized.symbol = symbol(request.symbol, '$.request.symbol', operation === 'crypto_positions' ? 'crypto' : 'equity');
    }
    return Object.freeze(normalized);
  }
  exactRequestKeys(request, ['symbol'], '$.request');
  return Object.freeze({ symbol: symbol(request.symbol, '$.request.symbol', operation === 'crypto_quote' ? 'crypto' : 'equity') });
}

// Walk before redaction so an oversized secret cannot evade the source bound
// merely by being omitted from the admitted observation.
function boundedResponse(value, path, limits, depth = 0, count = { objects: 0 }) {
  if (depth > limits.maxDepth) fail('spotlight_robinhood_oversized', `${path} exceeds the bounded nesting depth.`);
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'string') {
    if (Buffer.byteLength(value, 'utf8') > limits.maxStringBytes) fail('spotlight_robinhood_oversized', `${path} exceeds the bounded string size.`);
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('spotlight_robinhood_malformed', `${path} must contain finite numbers.`);
    return;
  }
  if (Array.isArray(value)) {
    count.objects += value.length;
    if (value.length > limits.maxObjects || count.objects > limits.maxObjects * 2) fail('spotlight_robinhood_oversized', `${path} exceeds the bounded array size.`);
    value.forEach((child, index) => boundedResponse(child, `${path}[${index}]`, limits, depth + 1, count));
    return;
  }
  if (isPlainObject(value)) {
    const keys = ownKeys(value, path);
    count.objects += keys.length;
    if (keys.length > limits.maxObjects || count.objects > limits.maxObjects * 2) fail('spotlight_robinhood_oversized', `${path} exceeds the bounded object size.`);
    for (const key of keys) boundedResponse(value[key], `${path}.${key}`, limits, depth + 1, count);
    return;
  }
  fail('spotlight_robinhood_malformed', `${path} contains a non-JSON value.`);
}

function redactSensitive(value) {
  if (Array.isArray(value)) return value.map(redactSensitive);
  if (!isPlainObject(value)) return value;
  const result = {};
  for (const key of Object.keys(value)) {
    if (SENSITIVE_KEY.test(key)) continue;
    result[key] = redactSensitive(value[key]);
  }
  return result;
}

function responseOf(value, limits) {
  if (!isPlainObject(value)) fail('spotlight_robinhood_malformed', 'Robinhood operation response must be a plain JSON object.');
  boundedResponse(value, '$.response', limits);
  let serialized;
  try { serialized = JSON.stringify(value); } catch { fail('spotlight_robinhood_malformed', 'Robinhood operation response must be JSON serializable.'); }
  if (Buffer.byteLength(serialized, 'utf8') > limits.maxResponseBytes) fail('spotlight_robinhood_oversized', 'Robinhood operation response exceeds the bounded byte size.');
  const redacted = redactSensitive(value);
  exactKeys(redacted, ['observedAt', 'data'], '$.response');
  return {
    observedAt: timestamp(redacted.observedAt, '$.response.observedAt'),
    data: redacted.data,
  };
}

function jurisdiction(alias, jurisdictions, path) {
  const normalizedAlias = validateAlias(alias, path);
  const selected = jurisdictions[normalizedAlias];
  if (!selected) fail('spotlight_robinhood_account_unavailable', `Unknown account jurisdiction alias: ${normalizedAlias}.`);
  return {
    alias: selected.alias,
    read_only: selected.readOnly,
    agent_accessible: selected.agentAccessible,
  };
}

function present(value) { return { status: 'present', value }; }
function missing(reason) { return { status: 'missing', reason }; }

function fieldsAndCompleteness(fields) {
  const missingFields = Object.entries(fields).filter(([, field]) => field.status === 'missing').map(([name]) => name);
  return {
    fields,
    completeness: {
      status: missingFields.length ? 'partial' : 'complete',
      missing: missingFields,
    },
  };
}

function normalizeAccounts(data, jurisdictions, limits) {
  exactKeys(data, ['accounts'], '$.response.data');
  if (!Array.isArray(data.accounts)) fail('spotlight_robinhood_malformed', '$.response.data.accounts must be an array.');
  if (data.accounts.length > limits.maxAccounts) fail('spotlight_robinhood_oversized', '$.response.data.accounts exceeds the bounded count.');
  const seen = new Set();
  const accounts = data.accounts.map((entry, index) => {
    exactKeys(entry, ['alias', 'readOnly', 'agentAccessible'], `$.response.data.accounts[${index}]`);
    const value = jurisdiction(entry.alias, jurisdictions, `$.response.data.accounts[${index}].alias`);
    if (seen.has(value.alias)) fail('spotlight_robinhood_ambiguous_account', `Duplicate account alias: ${value.alias}.`);
    seen.add(value.alias);
    if (value.read_only !== entry.readOnly || value.agent_accessible !== entry.agentAccessible) {
      fail('spotlight_robinhood_account_jurisdiction', `Account jurisdiction policy does not match host configuration for ${value.alias}.`);
    }
    return value;
  });
  accounts.sort((left, right) => left.alias.localeCompare(right.alias));
  return fieldsAndCompleteness({ accounts: present(accounts) });
}

const PORTFOLIO_FIELDS = Object.freeze(['accountAlias', 'totalValue', 'cash', 'buyingPower', 'dayChange', 'dayChangePercent', 'currency']);
function normalizePortfolio(data, request, jurisdictions) {
  optionalKeys(data, PORTFOLIO_FIELDS, '$.response.data');
  if (!Object.hasOwn(data, 'accountAlias')) fail('spotlight_robinhood_missing_field', '$.response.data.accountAlias is required.');
  const alias = validateAlias(data.accountAlias, '$.response.data.accountAlias');
  if (alias !== request.accountAlias) fail('spotlight_robinhood_account_mismatch', 'Response account does not match the requested jurisdiction.');
  const fields = { account: present(jurisdiction(alias, jurisdictions, '$.response.data.accountAlias')) };
  const numeric = [
    ['totalValue', 'total_value', null],
    ['cash', 'cash', null],
    ['buyingPower', 'buying_power', null],
    ['dayChange', 'day_change', null],
    ['dayChangePercent', 'day_change_percent', null],
  ];
  for (const [input, output, min] of numeric) {
    fields[output] = Object.hasOwn(data, input)
      ? present(finiteNumber(data[input], `$.response.data.${input}`, { nullable: true, min }))
      : missing('provider_omitted');
  }
  fields.currency = Object.hasOwn(data, 'currency') ? present(currency(data.currency, '$.response.data.currency')) : missing('provider_omitted');
  return fieldsAndCompleteness(fields);
}

const POSITION_FIELDS = Object.freeze(['symbol', 'quantity', 'averageCost', 'marketValue', 'unrealizedPnl', 'currency']);
function normalizePositions(data, operation, request, limits) {
  exactKeys(data, ['accountAlias', 'positions'], '$.response.data');
  const kind = operation === 'crypto_positions' ? 'crypto' : 'equity';
  const alias = validateAlias(data.accountAlias, '$.response.data.accountAlias');
  if (alias !== request.accountAlias) fail('spotlight_robinhood_account_mismatch', 'Response account does not match the requested jurisdiction.');
  if (!Array.isArray(data.positions)) fail('spotlight_robinhood_malformed', '$.response.data.positions must be an array.');
  if (data.positions.length > limits.maxPositions) fail('spotlight_robinhood_oversized', '$.response.data.positions exceeds the bounded count.');
  const positions = data.positions.map((entry, index) => {
    optionalKeys(entry, POSITION_FIELDS, `$.response.data.positions[${index}]`);
    if (!Object.hasOwn(entry, 'symbol')) fail('spotlight_robinhood_missing_field', `$.response.data.positions[${index}].symbol is required.`);
    const normalizedSymbol = symbol(entry.symbol, `$.response.data.positions[${index}].symbol`, kind);
    if (request.symbol && normalizedSymbol !== request.symbol) fail('spotlight_robinhood_symbol_mismatch', 'Position symbol does not match the requested symbol.');
    const output = { symbol: normalizedSymbol };
    for (const [input, key, min] of [['quantity', 'quantity', kind === 'equity' ? null : 0], ['averageCost', 'average_cost', 0], ['marketValue', 'market_value', kind === 'equity' ? null : 0], ['unrealizedPnl', 'unrealized_pnl', null]]) {
      if (Object.hasOwn(entry, input)) output[key] = finiteNumber(entry[input], `$.response.data.positions[${index}].${input}`, { nullable: true, min });
    }
    if (Object.hasOwn(entry, 'currency')) output.currency = currency(entry.currency, `$.response.data.positions[${index}].currency`);
    return output;
  });
  return { alias, positions };
}

const QUOTE_FIELDS = Object.freeze(['symbol', 'price', 'bid', 'ask', 'currency', 'change', 'changePercent']);
function normalizeQuote(data, operation, request) {
  optionalKeys(data, QUOTE_FIELDS, '$.response.data');
  if (!Object.hasOwn(data, 'symbol')) fail('spotlight_robinhood_missing_field', '$.response.data.symbol is required.');
  const kind = operation === 'crypto_quote' ? 'crypto' : 'equity';
  const normalizedSymbol = symbol(data.symbol, '$.response.data.symbol', kind);
  if (normalizedSymbol !== request.symbol) fail('spotlight_robinhood_symbol_mismatch', 'Quote symbol does not match the requested symbol.');
  if (!Object.hasOwn(data, 'price')) fail('spotlight_robinhood_missing_field', '$.response.data.price is required.');
  const fields = { symbol: present(normalizedSymbol), price: present(finiteNumber(data.price, '$.response.data.price', { nullable: true, min: 0 })) };
  for (const [input, output, min] of [['bid', 'bid', 0], ['ask', 'ask', 0], ['change', 'change', null], ['changePercent', 'change_percent', null]]) {
    fields[output] = Object.hasOwn(data, input)
      ? present(finiteNumber(data[input], `$.response.data.${input}`, { nullable: true, min }))
      : missing('provider_omitted');
  }
  fields.currency = Object.hasOwn(data, 'currency') ? present(currency(data.currency, '$.response.data.currency')) : missing('provider_omitted');
  return fieldsAndCompleteness(fields);
}

function instrumentFor(operation, request, data) {
  if (operation === 'accounts') return { id: 'accounts', label: 'Robinhood accounts', quote: 'USD' };
  if (operation === 'portfolio') return { id: `portfolio:${request.accountAlias}`, label: `Robinhood portfolio ${request.accountAlias}`, quote: 'USD' };
  if (operation === 'equity_positions') return { id: `equity-positions:${request.accountAlias}`, label: `Robinhood equity positions ${request.accountAlias}`, quote: 'USD' };
  if (operation === 'crypto_positions') return { id: `crypto-positions:${request.accountAlias}`, label: `Robinhood crypto positions ${request.accountAlias}`, quote: 'USD' };
  const kind = operation === 'crypto_quote' ? 'crypto' : 'equity';
  const selectedSymbol = symbol(data.symbol, '$.response.data.symbol', kind);
  return { id: selectedSymbol, label: `Robinhood ${selectedSymbol}`, quote: 'USD' };
}

function normalizeOperation(operation, request, response, jurisdictions, limits, receivedAt) {
  let projection;
  if (operation === 'accounts') projection = normalizeAccounts(response.data, jurisdictions, limits);
  else if (operation === 'portfolio') projection = normalizePortfolio(response.data, request, jurisdictions);
  else if (operation === 'equity_positions' || operation === 'crypto_positions') {
    const positions = normalizePositions(response.data, operation, request, limits);
    projection = fieldsAndCompleteness({
      account: present(jurisdiction(positions.alias, jurisdictions, '$.response.data.accountAlias')),
      positions: present(positions.positions),
    });
  } else projection = normalizeQuote(response.data, operation, request);

  const observation = {
    schemaVersion: 1,
    kind: 'spotlight_observation',
    source: {
      authority: SPOTLIGHT_ROBINHOOD_SOURCE_AUTHORITY,
      reference: `robinhood:${operation}:${operation === 'accounts' ? 'all' : request.accountAlias || request.symbol}`,
    },
    instrument: instrumentFor(operation, request, response.data),
    observedAt: response.observedAt,
    receivedAt,
    fields: projection.fields,
    freshness: { status: 'observed', asOf: response.observedAt },
    completeness: projection.completeness,
    authority: { observationalOnly: true, financialExecution: false },
  };
  try {
    return admitSpotlightObservation(observation);
  } catch (error) {
    if (error?.code) fail('spotlight_robinhood_observation_invalid', 'Normalized Robinhood observation failed Spotlight validation.', { validatorCode: error.code });
    throw error;
  }
}

function normalizeClock(clock) {
  if (clock === undefined) return () => new Date().toISOString();
  if (typeof clock !== 'function') fail('spotlight_robinhood_invalid_clock', 'Robinhood adapter clock must be callable.');
  return clock;
}

export class RobinhoodReadAdapter {
  constructor({ operations = {}, accountJurisdictions = {}, limits = {}, clock } = {}) {
    if (!isPlainObject(operations)) fail('spotlight_robinhood_invalid_operations', 'Robinhood operations must be an object.');
    for (const name of Object.keys(operations)) {
      if (!Object.hasOwn(ROBINHOOD_READ_OPERATIONS, name)) fail('spotlight_robinhood_operation_not_allowlisted', `Robinhood operation is not allowlisted: ${name}.`);
      if (typeof operations[name] !== 'function') fail('spotlight_robinhood_invalid_operation', `Robinhood operation ${name} must be callable.`);
    }
    this.operations = Object.freeze({ ...operations });
    this.accountJurisdictions = validateJurisdictions(accountJurisdictions);
    this.limits = limitsOf(limits);
    this.clock = normalizeClock(clock);
    Object.freeze(this);
  }

  capabilities() {
    return deepFreeze({
      apiVersion: SPOTLIGHT_ROBINHOOD_ADAPTER_API,
      authority: SPOTLIGHT_ROBINHOOD_SOURCE_AUTHORITY,
      operations: ROBINHOOD_READ_OPERATION_NAMES.map(name => ({
        name,
        allowlisted: true,
        injected: typeof this.operations[name] === 'function',
        readOnly: true,
        financialExecution: false,
      })),
      mutationOperations: [],
      credentials: false,
      network: false,
    });
  }

  async observe(operation, request = {}) {
    const normalizedRequest = validateRequest(operation, request, this.accountJurisdictions);
    const operationFn = this.operations[operation];
    if (typeof operationFn !== 'function') fail('spotlight_robinhood_operation_unavailable', `Robinhood operation is not injected: ${operation}.`);
    let result;
    try {
      result = await operationFn(normalizedRequest);
    } catch (error) {
      fail('spotlight_robinhood_operation_failed', `Robinhood operation failed: ${operation}.`);
    }
    const response = responseOf(result, this.limits);
    let receivedAt;
    try { receivedAt = timestamp(this.clock(), '$.receivedAt'); } catch (error) {
      if (error instanceof RobinhoodReadAdapterError) throw error;
      fail('spotlight_robinhood_clock_failed', 'Robinhood adapter clock failed.');
    }
    return normalizeOperation(operation, normalizedRequest, response, this.accountJurisdictions, this.limits, receivedAt);
  }

  read(operation, request = {}) { return this.observe(operation, request); }
}

export function createRobinhoodReadAdapter(options = {}) {
  return new RobinhoodReadAdapter(options);
}
