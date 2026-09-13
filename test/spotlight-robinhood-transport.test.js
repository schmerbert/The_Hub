import assert from 'node:assert/strict';
import test from 'node:test';
import {
  aliasFor,
  createRobinhoodConnection,
  RobinhoodConnectionError,
} from '../src/connectors/robinhood/connection.js';
import { createBoundedFetch, RobinhoodTransportError, sanitizeTransportError } from '../src/connectors/robinhood/transport.js';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import { projectQuoteResponse, projectPositionsResponse, extractMcpPayload } from '../src/connectors/robinhood/projection.js';

const NOW = '2026-09-11T14:00:01.000Z';
const ACCOUNT_ID = 'acct-opaque-provider-id';
const ALIAS = aliasFor(ACCOUNT_ID);

function authStore({ connected = true } = {}) {
  return {
    inspectSync: () => connected
      ? { state: 'connected', code: 'test_connected' }
      : { state: 'authentication_required', code: 'test_auth_missing' },
    async load() { return { schema: 'spotlight-robinhood-auth.v1', tokens: connected ? { access_token: 'test-token' } : undefined }; },
    async save() {},
  };
}

function catalog() {
  return { tools: [
    { name: 'get_accounts', inputSchema: { type: 'object', properties: {} } },
    { name: 'get_portfolio', inputSchema: { type: 'object', properties: {} } },
    { name: 'get_equity_positions', inputSchema: { type: 'object', properties: {} } },
    { name: 'get_crypto_positions', inputSchema: { type: 'object', properties: {} } },
    { name: 'get_equity_quotes', inputSchema: { type: 'object', properties: { symbols: { type: 'array' } }, required: ['symbols'] } },
    { name: 'get_crypto_quote', inputSchema: { type: 'object', properties: { symbol: { type: 'string' } }, required: ['symbol'] } },
    { name: 'place_equity_order', inputSchema: { type: 'object', properties: { symbol: { type: 'string' } } } },
  ] };
}

function textResult(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] };
}

function fakeClient(callLog) {
  return {
    async connect() { callLog.push(['connect']); },
    async listTools() { callLog.push(['listTools']); return catalog(); },
    async callTool(params) {
      callLog.push(['callTool', params]);
      if (params.name === 'get_accounts') return textResult({ data: { accounts: [{ account_number: ACCOUNT_ID, rhs_account_number: 'rhs-private-id', agentic_allowed: true }] } });
      if (params.name === 'get_portfolio') return textResult({ data: { account_number: ACCOUNT_ID, total_value: '100.25', cash: '40.00', buying_power: { buying_power: '60.25' }, currency: 'USD' } });
      if (params.name === 'get_equity_positions') return textResult({ data: { positions: [{ account_number: ACCOUNT_ID, symbol: 'AAPL', quantity: '2', average_buy_price: '120.00' }] } });
      if (params.name === 'get_equity_quotes') return textResult({ data: { results: [{ quote: { symbol: 'AAPL', last_trade_price: '123.45', bid_price: '123.40', ask_price: '123.50' } }] } });
      if (params.name === 'get_crypto_positions') return textResult({ data: { results: [{ account_id: 'uuid-private-id', currency: { code: 'BTC' }, quantity: '0.25' }], next: null } });
      return textResult({ data: { results: [{ symbol: 'BTCUSD', mark_price: '62000', bid_price: '61999', ask_price: '62001', updated_at: '2026-09-11T14:00:00Z' }] } });
    },
    async close() { callLog.push(['close']); },
  };
}

test('connection is lazy, read-only, and discovers only the adopted MCP reads', async () => {
  let sessions = 0;
  const calls = [];
  const connection = createRobinhoodConnection({
    authStore: authStore(),
    clock: () => NOW,
    clientFactory: async ({ sdk }) => {
      sessions += 1;
      assert.equal(typeof sdk.Client, 'function');
      return { client: fakeClient(calls), transport: { async close() { calls.push(['transportClose']); } } };
    },
  });
  assert.equal(sessions, 0);
  assert.deepEqual(connection.status(), { state: 'connected', code: 'test_connected' });
  assert.equal(sessions, 0);
  const accounts = await connection.observe('accounts');
  assert.equal(sessions, 1);
  assert.deepEqual(accounts.fields.accounts.value, [{ alias: ALIAS, read_only: true, agent_accessible: true }]);
  assert.equal(JSON.stringify(accounts).includes(ACCOUNT_ID), false);
  assert.equal(calls.filter(item => item[0] === 'callTool').length, 1);
  const portfolio = await connection.observe('portfolio', { accountAlias: ALIAS });
  assert.equal(portfolio.fields.total_value.value, 100.25);
  assert.equal(portfolio.fields.buying_power.value, 60.25);
  const position = await connection.observe('equity_positions', { accountAlias: ALIAS });
  assert.deepEqual(position.fields.positions.value, [{ symbol: 'AAPL', quantity: 2, average_cost: 120 }]);
  const quote = await connection.observe('equity_quote', { symbol: 'AAPL' });
  assert.equal(quote.fields.price.value, 123.45);
  assert.equal(quote.fields.bid.value, 123.4);
  assert.deepEqual(calls.find(item => item[0] === 'callTool' && item[1].name === 'get_equity_quotes')[1].arguments, { symbols: ['AAPL'] });
  const cryptoPositions = await connection.observe('crypto_positions', { accountAlias: ALIAS });
  assert.deepEqual(cryptoPositions.fields.positions.value, [{ symbol: 'BTC', quantity: 0.25 }]);
  const cryptoQuote = await connection.observe('crypto_quote', { symbol: 'BTC' });
  assert.equal(cryptoQuote.fields.price.value, 62000);
  assert.equal(cryptoQuote.observedAt, '2026-09-11T14:00:00Z');
  for (const name of ['get_portfolio', 'get_equity_positions']) assert.deepEqual(calls.find(item => item[1]?.name === name)[1].arguments, { account_number: ACCOUNT_ID });
  assert.deepEqual(calls.find(item => item[1]?.name === 'get_crypto_positions')[1].arguments, { rhs_account_number: 'rhs-private-id' });
  assert.deepEqual(calls.find(item => item[1]?.name === 'get_crypto_quotes')[1].arguments, { symbols: ['BTC-USD'] });
  assert.equal(calls.some(item => item[0] === 'listTools'), false);
  await connection.close();
  await assert.rejects(() => connection.observe('place_order'), error => error instanceof RobinhoodConnectionError && error.code === 'robinhood_operation_not_allowlisted');
});

test('sampling time is marked unknown freshness when Robinhood omits a source timestamp', async () => {
  const connection = createRobinhoodConnection({
    authStore: authStore(),
    clock: () => NOW,
    clientFactory: async () => ({ client: {
      async connect() {},
      async listTools() { return catalog(); },
      async callTool() { return textResult({ data: { symbol: 'BTCUSD', mark_price: '62000' } }); },
      async close() {},
    }, transport: { async close() {} } }),
  });
  const observation = await connection.observe('crypto_quote', { symbol: 'BTC-USD' });
  assert.equal(observation.freshness.status, 'unknown');
  assert.equal(observation.freshness.asOf, null);
  assert.equal(observation.fields.price.value, 62000);
  await connection.close();
});

test('unknown or incomplete upstream catalogs refuse before any tool call', async () => {
  let calls = 0;
  const connection = createRobinhoodConnection({
    authStore: authStore(),
    toolCatalog: [{ name: 'get_accounts', inputSchema: { type: 'object' } }],
    clientFactory: async () => ({ client: {
      async connect() {},
      async listTools() { calls += 1; return { tools: [] }; },
      async callTool() { throw new Error('must not call'); },
      async close() {},
    }, transport: { async close() {} } }),
  });
  await assert.rejects(() => connection.observe('accounts'), error => error.code === 'robinhood_tool_unavailable');
  assert.equal(calls, 0);
  await connection.close();
});

test('bounded fetch refuses oversized response bodies and never exposes upstream failure text', async () => {
  const fetch = createBoundedFetch({
    limits: { responseBytes: 32, requestMs: 100 },
    fetchFn: async () => new Response('x'.repeat(33), { status: 200 }),
  });
  await assert.rejects(() => fetch('https://example.test'), error => error instanceof RobinhoodTransportError && error.code === 'robinhood_transport_response_oversized');
  const bad = new RobinhoodTransportError('robinhood_transport_network_failed', 'provider-private-secret');
  assert.equal(bad.message, 'provider-private-secret');
});

test('equity quote price and time stay paired across extended-hours trades', () => {
  const quote = { symbol: 'AAPL', has_traded: true, state: 'active', last_trade_price: '200', venue_last_trade_time: '2026-09-11T12:00:00Z', last_non_reg_trade_price: '201', venue_last_non_reg_trade_time: '2026-09-11T13:00:00Z', updated_at: NOW };
  const project = row => projectQuoteResponse({ data: { results: [{ quote: row }] } }, 'equity_quote', { symbol: 'AAPL' }, () => NOW);
  assert.equal(project(quote).response.data.price, 201);
  assert.equal(project(quote).declared, '2026-09-11T13:00:00Z');
  assert.equal(project({ ...quote, last_non_reg_trade_price: null }).declared, '2026-09-11T12:00:00Z');
  assert.throws(() => project({ ...quote, has_traded: false }), { code: 'robinhood_quote_not_traded' });
  assert.throws(() => project({ ...quote, symbol: 'MSFT' }), { code: 'robinhood_symbol_mismatch' });
});

test('position pagination and malformed rows cannot become complete holdings', () => {
  const project = data => projectPositionsResponse({ data }, 'equity_positions', { accountAlias: ALIAS }, () => ACCOUNT_ID, () => NOW);
  assert.throws(() => project({ positions: [], next: 'https://provider.test/next' }), { code: 'robinhood_positions_incomplete' });
  assert.throws(() => project({ positions: [null] }), { code: 'robinhood_upstream_malformed' });
  assert.throws(() => project({}), { code: 'robinhood_positions_missing' });
  assert.deepEqual(project({ positions: [], next: null }).response.data.positions, []);
});

test('structured payload bounds reject hostile keys and combined oversized strings', () => {
  const limits = { responseBytes: 32, responseDepth: 8, responseObjects: 32 };
  assert.throws(() => extractMcpPayload({ structuredContent: JSON.parse('{"__proto__":{}}') }, limits), { code: 'robinhood_upstream_malformed' });
  assert.throws(() => extractMcpPayload({ structuredContent: { a: 'x'.repeat(20), b: 'y'.repeat(20) } }, limits), { code: 'robinhood_upstream_oversized' });
});

test('transport pins destination and disables redirects before sending credentials', async () => {
  let calls = 0;
  const fetch = createBoundedFetch({ allowedHosts: ['agent.robinhood.com'], protectedOrigin: 'https://agent.robinhood.com', fetchFn: async (url, init) => { calls++; assert.equal(init.redirect, 'error'); return new Response(null, { status: 204 }); } });
  for (const url of ['https://evil.test', 'https://agent.robinhood.com:8443', 'https://user@agent.robinhood.com']) await assert.rejects(() => fetch(url), { code: 'robinhood_transport_origin_refused' });
  assert.equal(calls, 0);
  await fetch('https://agent.robinhood.com/mcp/trading', { method: 'POST' });
  assert.equal(calls, 1);
  assert.equal((await fetch('https://agent.robinhood.com/mcp/trading')).status, 405);
  assert.equal(calls, 1);
});

test('transient connection failure permits a later deliberate retry', async () => {
  let sessions = 0;
  const connection = createRobinhoodConnection({ authStore: authStore(), clock: () => NOW, clientFactory: async () => {
    sessions++;
    const client = fakeClient([]);
    if (sessions === 1) client.connect = async () => { throw new Error('private upstream message'); };
    return { client, transport: { async close() {} } };
  } });
  try {
    await assert.rejects(() => connection.observe('accounts'), { code: 'robinhood_transport_failed' });
    assert.equal(connection.status().state, 'connected');
    assert.equal((await connection.observe('accounts')).fields.accounts.value.length, 1);
  } finally { await connection.close(); }
});

test('SDK authorization-required errors retain their safe actionable classification', () => {
  assert.equal(sanitizeTransportError(new UnauthorizedError()).code, 'robinhood_authentication_required');
  assert.equal(sanitizeTransportError(new Error('private provider detail')).message, 'robinhood_transport_failed');
});

test('transport bounds stalled fetches and stalled response streams', async () => {
  const stalledFetch = createBoundedFetch({ limits: { requestMs: 30 }, fetchFn: () => new Promise(() => {}) });
  await assert.rejects(() => stalledFetch('https://example.test'), { code: 'robinhood_transport_timeout' });
  let cancelled = false;
  const stalledBody = createBoundedFetch({ limits: { requestMs: 30 }, fetchFn: async () => new Response(new ReadableStream({ cancel() { cancelled = true; } })) });
  await assert.rejects(() => stalledBody('https://example.test'), { code: 'robinhood_transport_timeout' });
  assert.equal(cancelled, true);
});
