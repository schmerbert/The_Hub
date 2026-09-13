import { createHash } from 'node:crypto';
import { RobinhoodConnectionError, fail } from './errors.js';
const ACCOUNT_KEYS = ['account_number', 'accountNumber'];
const SYMBOL_KEYS = ['symbol', 'ticker', 'stock_symbol', 'trading_pair', 'pair'];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:?\d{2})$/;

export function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function bounded(value, limits, depth = 0, count = { value: 0 }) {
  if (depth > limits.responseDepth) fail('robinhood_upstream_oversized');
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') {
    if (typeof value === 'string' && Buffer.byteLength(value, 'utf8') > limits.responseBytes) fail('robinhood_upstream_oversized');
    if (typeof value === 'number' && !Number.isFinite(value)) fail('robinhood_upstream_malformed');
    return value;
  }
  if (Array.isArray(value)) {
    count.value += value.length;
    if (count.value > limits.responseObjects) fail('robinhood_upstream_oversized');
    return value.map(item => bounded(item, limits, depth + 1, count));
  }
  if (object(value)) {
    count.value += Object.keys(value).length;
    if (count.value > limits.responseObjects) fail('robinhood_upstream_oversized');
    const copy = {};
    for (const [key, child] of Object.entries(value)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) fail('robinhood_upstream_malformed');
      copy[key] = bounded(child, limits, depth + 1, count);
    }
    return copy;
  }
  fail('robinhood_upstream_malformed');
}

function parseText(value, limits) {
  if (typeof value !== 'string') return null;
  if (Buffer.byteLength(value, 'utf8') > limits.responseBytes) fail('robinhood_upstream_oversized');
  try { return bounded(JSON.parse(value), limits); } catch (error) {
    if (error instanceof RobinhoodConnectionError) throw error;
    return null;
  }
}

export function extractMcpPayload(result, limits) {
  if (!object(result)) fail('robinhood_upstream_malformed');
  if (result.isError === true) fail('robinhood_upstream_failed');
  if (object(result.structuredContent)) {
    const value = bounded(result.structuredContent, limits);
    if (Buffer.byteLength(JSON.stringify(value)) > limits.responseBytes) fail('robinhood_upstream_oversized');
    return value;
  }
  if (Array.isArray(result.content)) {
    for (const part of result.content) {
      if (part?.type === 'text') {
        const parsed = parseText(part.text, limits);
        if (parsed !== null) return parsed;
      }
    }
  }
  fail('robinhood_upstream_malformed');
}

export function valueOf(value, keys) {
  if (!object(value)) return undefined;
  for (const key of keys) if (Object.hasOwn(value, key)) return value[key];
  return undefined;
}

function recordArray(data, keys) {
  if (Array.isArray(data)) return data;
  if (!object(data)) return [];
  for (const key of keys) if (Array.isArray(data[key])) return data[key];
  return [];
}

function dataOf(payload) {
  if (object(payload) && Object.hasOwn(payload, 'data')) return payload.data;
  return payload;
}

function sourceTimestamp(...candidates) {
  const keys = ['observedAt', 'asOf', 'as_of', 'updatedAt', 'updated_at', 'timestamp', 'quoteTime', 'quote_time'];
  for (const candidate of candidates) {
    const value = valueOf(candidate, keys);
    if (typeof value === 'string' && ISO_DATE.test(value) && Number.isFinite(Date.parse(value))) return value;
  }
  return null;
}

function nowValue(clock) {
  const value = clock();
  if (typeof value !== 'string' || !ISO_DATE.test(value) || !Number.isFinite(Date.parse(value))) fail('robinhood_clock_invalid');
  return value;
}

function providerId(record) {
  const value = valueOf(record, ACCOUNT_KEYS) ?? valueOf(record, ['id', 'uuid']);
  if ((typeof value !== 'string' && typeof value !== 'number') || String(value).trim() === '') fail('robinhood_account_identifier_missing');
  return String(value);
}

export function aliasFor(id) {
  return `acct_${createHash('sha256').update(id, 'utf8').digest('hex').slice(0, 20)}`;
}

export function boolOf(record, keys, fallback) {
  const value = valueOf(record, keys);
  return typeof value === 'boolean' ? value : fallback;
}

function numericValue(record, keys, { nullable = false } = {}) {
  const raw = valueOf(record, keys);
  if (raw === undefined) return undefined;
  if (raw === null && nullable) return null;
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string' && raw.trim() !== '') return Number(raw);
  return raw;
}

function putIfDefined(target, key, value) {
  if (value !== undefined) target[key] = value;
}

function accountRecords(data) {
  return recordArray(data, ['accounts', 'results']);
}

function positionRecords(data) {
  return recordArray(data, ['positions', 'equity_positions', 'crypto_positions', 'results']);
}

function quoteRecord(data, requestedSymbol) {
  const rows = recordArray(data, ['results', 'quotes']);
  const row = rows.find(item => {
    const nested = object(item?.quote) ? item.quote : item;
    return String(valueOf(nested, SYMBOL_KEYS) || '').toUpperCase() === requestedSymbol;
  }) ?? rows[0] ?? (object(data) ? data : null);
  if (!object(row)) fail('robinhood_quote_missing');
  return object(row.quote) ? row.quote : row;
}

function addSourceObservation(payload, data, clock, ...extra) {
  const declared = sourceTimestamp(payload, data, ...extra);
  return { observedAt: declared || nowValue(clock), declared, data };
}

export function projectAccountResponse(payload, clock, installAccount) {
  const data = dataOf(payload);
  const accounts = accountRecords(data).map(record => {
    if (!object(record)) fail('robinhood_upstream_malformed');
    const id = providerId(record);
    const alias = installAccount(id, record);
    return {
      alias,
      readOnly: boolOf(record, ['readOnly', 'read_only'], true),
      agentAccessible: boolOf(record, ['agentAccessible', 'agent_accessible', 'agentic_allowed'], false),
    };
  });
  if (!Array.isArray(data?.accounts)) fail('robinhood_accounts_missing');
  const sampled = addSourceObservation(payload, data, clock);
  return { response: { observedAt: sampled.observedAt, data: { accounts } }, declared: sampled.declared };
}

export function projectPortfolioResponse(payload, request, lookup, clock) {
  const data = dataOf(payload);
  const rows = recordArray(data, ['portfolios', 'results']);
  const row = rows.find(item => object(item) && accountMatches(item, lookup(request.accountAlias))) || (object(data) ? data : null);
  if (!object(row)) fail('robinhood_portfolio_missing');
  if (accountValue(row) !== undefined && accountValue(row) !== lookup(request.accountAlias)) fail('robinhood_account_mismatch');
  const out = { accountAlias: request.accountAlias };
  putIfDefined(out, 'totalValue', numericValue(row, ['totalValue', 'total_value', 'portfolio_value']));
  putIfDefined(out, 'cash', numericValue(row, ['cash', 'cash_balance']));
  const buying = valueOf(row, ['buyingPower', 'buying_power']);
  putIfDefined(out, 'buyingPower', numericValue(object(buying) ? buying : row, object(buying) ? ['buyingPower', 'buying_power'] : ['buyingPower', 'buying_power']));
  putIfDefined(out, 'dayChange', numericValue(row, ['dayChange', 'day_change']));
  putIfDefined(out, 'dayChangePercent', numericValue(row, ['dayChangePercent', 'day_change_percent']));
  putIfDefined(out, 'currency', valueOf(row, ['currency', 'display_currency']));
  const sampled = addSourceObservation(payload, data, clock);
  return { response: { observedAt: sampled.observedAt, data: out }, declared: sampled.declared };
}

function accountValue(record) {
  return valueOf(record, ACCOUNT_KEYS) ?? valueOf(record, ['id', 'uuid']);
}

function accountMatches(record, id) {
  const value = accountValue(record);
  return value === undefined || String(value) === String(id);
}

export function projectPositionsResponse(payload, operation, request, lookup, clock) {
  const data = dataOf(payload);
  const id = lookup(request.accountAlias);
  if (data?.next) fail('robinhood_positions_incomplete');
  if (!Array.isArray(data?.positions) && !Array.isArray(data?.results)) fail('robinhood_positions_missing');
  const rows = positionRecords(data);
  if (rows.some(row => !object(row))) fail('robinhood_upstream_malformed');
  if (operation === 'equity_positions' && rows.some(row => !accountMatches(row, id))) fail('robinhood_account_mismatch');
  if (!rows.length && positionRecords(data).length && id && positionRecords(data).some(row => accountValue(row) !== undefined)) fail('robinhood_account_mismatch');
  const positions = rows.map(row => {
    const out = {};
    putIfDefined(out, 'symbol', valueOf(row, SYMBOL_KEYS));
    putIfDefined(out, 'quantity', numericValue(row, ['quantity', 'shares', 'qty']));
    putIfDefined(out, 'averageCost', numericValue(row, ['averageCost', 'average_cost', 'average_buy_price']));
    putIfDefined(out, 'marketValue', numericValue(row, ['marketValue', 'market_value', 'equity']));
    putIfDefined(out, 'unrealizedPnl', numericValue(row, ['unrealizedPnl', 'unrealized_pnl']));
    const currency = valueOf(row, ['currency', 'display_currency']);
    if (!object(currency)) putIfDefined(out, 'currency', currency);
    if (operation === 'crypto_positions' && out.symbol === undefined) {
      const code = object(currency) ? valueOf(currency, ['code', 'currency_code']) : undefined;
      if (typeof code === 'string') out.symbol = code;
    }
    return out;
  });
  const sampled = addSourceObservation(payload, data, clock);
  return { response: { observedAt: sampled.observedAt, data: { accountAlias: request.accountAlias, positions } }, declared: sampled.declared };
}

export function projectQuoteResponse(payload, operation, request, clock) {
  const data = dataOf(payload);
  const row = quoteRecord(data, request.symbol);
  const crypto = operation === 'crypto_quote';
  const returnedSymbol = valueOf(row, SYMBOL_KEYS);
  const expected = crypto ? (request.symbol.endsWith('-USD') ? request.symbol : request.symbol + '-USD') : request.symbol;
  if (typeof returnedSymbol !== 'string' || returnedSymbol.replaceAll('-', '').toUpperCase() !== expected.replaceAll('-', '')) fail('robinhood_symbol_mismatch');
  if (row.has_traded === false) fail('robinhood_quote_not_traded');
  if (row.state !== undefined && row.state !== 'active') fail('robinhood_quote_unavailable');
  let price;
  let declared = null;
  const validTime = value => typeof value === 'string' && ISO_DATE.test(value) && Number.isFinite(Date.parse(value));
  if (crypto) {
    price = numericValue(row, ['mark_price']);
    if (validTime(row.updated_at)) declared = row.updated_at;
  } else {
    const trades = [
      { price: numericValue(row, ['last_trade_price']), time: row.venue_last_trade_time },
      { price: numericValue(row, ['last_non_reg_trade_price']), time: row.venue_last_non_reg_trade_time },
    ].filter(trade => typeof trade.price === 'number' && Number.isFinite(trade.price) && trade.price > 0);
    const timed = trades.filter(trade => validTime(trade.time)).sort((left, right) => Date.parse(right.time) - Date.parse(left.time));
    const chosen = timed[0] || trades[0];
    price = chosen?.price;
    declared = validTime(chosen?.time) ? chosen.time : null;
  }
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) fail('robinhood_quote_unavailable');
  const out = { symbol: request.symbol, price };
  for (const key of ['bid', 'ask']) {
    const value = numericValue(row, [key, key + '_price']);
    if (value !== 0) putIfDefined(out, key, value);
  }
  if (crypto) out.currency = 'USD';
  else putIfDefined(out, 'currency', valueOf(row, ['currency', 'display_currency']));
  return { response: { observedAt: declared || nowValue(clock), data: out }, declared };
}
