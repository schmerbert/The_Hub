import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ROBINHOOD_READ_OPERATION_NAMES,
  RobinhoodReadAdapterError,
  SPOTLIGHT_ROBINHOOD_ADAPTER_API,
  createRobinhoodReadAdapter,
} from '../src/places/hub/spotlight/index.js';

const OBSERVED_AT = '2026-09-01T14:00:00Z';
const RECEIVED_AT = '2026-09-01T14:00:01Z';
const accountJurisdictions = {
  primary: { readOnly: true, agentAccessible: true },
  reserve: { readOnly: false, agentAccessible: false },
};

function adapterWith(overrides = {}) {
  return createRobinhoodReadAdapter({
    accountJurisdictions,
    clock: () => RECEIVED_AT,
    operations: {},
    ...overrides,
  });
}

function response(data, extra = {}) {
  return { observedAt: OBSERVED_AT, data, ...extra };
}

test('live normalization preserves short equity quantities and account deficits', async () => {
  const adapter = adapterWith({ operations: {
    portfolio: () => response({ accountAlias: 'primary', totalValue: -12, cash: -3, buyingPower: -2 }),
    equity_positions: () => response({ accountAlias: 'primary', positions: [{ symbol: 'AAPL', quantity: -2, marketValue: -350 }] }),
    crypto_positions: () => response({ accountAlias: 'primary', positions: [{ symbol: 'BTC', quantity: -1 }] }),
  } });
  const portfolio = await adapter.observe('portfolio', { accountAlias: 'primary' });
  assert.equal(portfolio.fields.total_value.value, -12);
  assert.equal(portfolio.fields.cash.value, -3);
  assert.equal(portfolio.fields.buying_power.value, -2);
  const positions = await adapter.observe('equity_positions', { accountAlias: 'primary' });
  assert.equal(positions.fields.positions.value[0].quantity, -2);
  assert.equal(positions.fields.positions.value[0].market_value, -350);
  await assert.rejects(adapter.observe('crypto_positions', { accountAlias: 'primary' }));
});

test('exposes exactly the bounded Robinhood read allowlist and no mutation surface', () => {
  assert.deepEqual(ROBINHOOD_READ_OPERATION_NAMES, [
    'accounts', 'portfolio', 'equity_positions', 'crypto_positions', 'equity_quote', 'crypto_quote',
  ]);
  const adapter = adapterWith();
  assert.deepEqual(adapter.capabilities().operations.map(item => item.name), ROBINHOOD_READ_OPERATION_NAMES);
  assert.ok(adapter.capabilities().operations.every(item => item.allowlisted && item.readOnly && !item.financialExecution));
  assert.deepEqual(adapter.capabilities().mutationOperations, []);
  assert.equal(adapter.capabilities().credentials, false);
  assert.equal(adapter.capabilities().network, false);
  assert.equal(adapter.capabilities().apiVersion, SPOTLIGHT_ROBINHOOD_ADAPTER_API);
});

test('rejects mutation, unknown, non-callable, and credential-shaped operation injection', () => {
  assert.throws(
    () => adapterWith({ operations: { place_order: () => response({}) } }),
    error => error instanceof RobinhoodReadAdapterError && error.code === 'spotlight_robinhood_operation_not_allowlisted',
  );
  assert.throws(
    () => adapterWith({ operations: { accounts: 'not-callable' } }),
    error => error instanceof RobinhoodReadAdapterError && error.code === 'spotlight_robinhood_invalid_operation',
  );
  assert.throws(
    () => adapterWith({ operations: { api_key: () => response({}) } }),
    error => error instanceof RobinhoodReadAdapterError && error.code === 'spotlight_robinhood_operation_not_allowlisted',
  );
});

test('normalizes account jurisdictions to stable aliases and strips provider identifiers', async () => {
  const seen = [];
  const adapter = adapterWith({
    operations: {
      accounts: request => {
        seen.push(request);
        return response({ accounts: [
          { alias: 'reserve', readOnly: false, agentAccessible: false, account_id: 'acct-secret-1', account_number: '123456789' },
          { alias: 'primary', readOnly: true, agentAccessible: true, account_id: 'acct-secret-2', order_id: 'order-secret' },
        ], account_number: 'top-secret' });
      },
    },
  });
  const observation = await adapter.observe('accounts');
  assert.deepEqual(seen, [{}]);
  assert.equal(observation.apiVersion, 'spotlight-observation.v1');
  assert.equal(observation.authority.observationalOnly, true);
  assert.equal(observation.authority.financialExecution, false);
  assert.deepEqual(observation.fields.accounts.value, [
    { alias: 'primary', read_only: true, agent_accessible: true },
    { alias: 'reserve', read_only: false, agent_accessible: false },
  ]);
  assert.equal(JSON.stringify(observation).includes('acct-secret'), false);
  assert.equal(JSON.stringify(observation).includes('123456789'), false);
  assert.equal(JSON.stringify(observation).includes('order-secret'), false);
  assert.equal(Object.isFrozen(observation), true);
});

test('requires explicit account jurisdiction and rejects ambiguous or mismatched selection', async () => {
  const adapter = adapterWith({ operations: { portfolio: () => response({ accountAlias: 'primary', totalValue: 12, cash: 3, currency: 'USD' }) } });
  await assert.rejects(
    () => adapter.observe('portfolio'),
    error => error instanceof RobinhoodReadAdapterError && error.code === 'spotlight_robinhood_ambiguous_account',
  );
  await assert.rejects(
    () => adapter.observe('portfolio', { accountAlias: 'missing' }),
    error => error instanceof RobinhoodReadAdapterError && error.code === 'spotlight_robinhood_account_unavailable',
  );
  const mismatch = adapterWith({ operations: { portfolio: () => response({ accountAlias: 'reserve', totalValue: 12, cash: 3, currency: 'USD' }) } });
  await assert.rejects(
    () => mismatch.observe('portfolio', { accountAlias: 'primary' }),
    error => error instanceof RobinhoodReadAdapterError && error.code === 'spotlight_robinhood_account_mismatch',
  );
});

test('normalizes portfolio and positions while preserving declared omissions as missing fields', async () => {
  const adapter = adapterWith({
    operations: {
      portfolio: () => response({ accountAlias: 'primary', totalValue: 100, cash: 40, currency: 'USD' }),
      equity_positions: ({ accountAlias }) => response({ accountAlias, positions: [{ symbol: 'aapl', quantity: 2, marketValue: 350, position_id: 'pos-secret' }] }),
      crypto_positions: ({ accountAlias }) => response({ accountAlias, positions: [{ symbol: 'btc-usd', quantity: 0.1, averageCost: 40000, currency: 'USD' }] }),
    },
  });
  const portfolio = await adapter.observe('portfolio', { accountAlias: 'primary' });
  assert.equal(portfolio.fields.total_value.value, 100);
  assert.equal(portfolio.fields.buying_power.status, 'missing');
  assert.equal(portfolio.completeness.status, 'partial');
  const equities = await adapter.observe('equity_positions', { accountAlias: 'primary' });
  assert.deepEqual(equities.fields.positions.value, [{ symbol: 'AAPL', quantity: 2, market_value: 350 }]);
  assert.equal(JSON.stringify(equities).includes('pos-secret'), false);
  const crypto = await adapter.observe('crypto_positions', { accountAlias: 'primary' });
  assert.deepEqual(crypto.fields.positions.value, [{ symbol: 'BTC-USD', quantity: 0.1, average_cost: 40000, currency: 'USD' }]);
});

test('normalizes equity and crypto quotes and refuses mismatched symbols', async () => {
  const adapter = adapterWith({
    operations: {
      equity_quote: ({ symbol }) => response({ symbol: symbol.toLowerCase(), price: 123.45, bid: 123.4, ask: 123.5, currency: 'usd', quote_id: 'quote-secret' }),
      crypto_quote: ({ symbol }) => response({ symbol, price: 62000, currency: 'USD' }),
    },
  });
  const equity = await adapter.observe('equity_quote', { symbol: 'aapl' });
  assert.equal(equity.instrument.id, 'AAPL');
  assert.equal(equity.fields.symbol.value, 'AAPL');
  assert.equal(equity.fields.price.value, 123.45);
  assert.equal(JSON.stringify(equity).includes('quote-secret'), false);
  const crypto = await adapter.observe('crypto_quote', { symbol: 'BTC-USD' });
  assert.equal(crypto.fields.symbol.value, 'BTC-USD');
  const mismatch = adapterWith({ operations: { equity_quote: () => response({ symbol: 'MSFT', price: 1 }) } });
  await assert.rejects(
    () => mismatch.observe('equity_quote', { symbol: 'AAPL' }),
    error => error instanceof RobinhoodReadAdapterError && error.code === 'spotlight_robinhood_symbol_mismatch',
  );
});

test('rejects non-sensitive unknown fields but redacts sensitive unknown fields exactly', async () => {
  const adapter = adapterWith({
    operations: {
      equity_quote: () => response({ symbol: 'AAPL', price: 1, account_id: 'acct-secret', order_id: 'order-secret', unexpected: 'reject-me' }),
    },
  });
  await assert.rejects(
    () => adapter.observe('equity_quote', { symbol: 'AAPL' }),
    error => error instanceof RobinhoodReadAdapterError && error.code === 'spotlight_robinhood_unknown_field',
  );
  const accepted = adapterWith({
    operations: {
      equity_quote: () => response({ symbol: 'AAPL', price: 1, account_id: 'acct-secret', order_id: 'order-secret', instrument_id: 'instrument-secret' }),
    },
  });
  const observation = await accepted.observe('equity_quote', { symbol: 'AAPL' });
  assert.equal(JSON.stringify(observation).includes('secret'), false);
});

test('fails closed for malformed, hostile, oversized, unavailable, and failing operations', async () => {
  const unavailable = adapterWith();
  await assert.rejects(
    () => unavailable.observe('equity_quote', { symbol: 'AAPL' }),
    error => error instanceof RobinhoodReadAdapterError && error.code === 'spotlight_robinhood_operation_unavailable',
  );
  const malformed = adapterWith({ operations: { equity_quote: () => ({ observedAt: OBSERVED_AT, data: { symbol: 'AAPL', price: 'not-a-number' } }) } });
  await assert.rejects(() => malformed.observe('equity_quote', { symbol: 'AAPL' }), /finite number/);
  const hostile = adapterWith({ operations: { equity_quote: () => {
    const data = { symbol: 'AAPL', price: 1 };
    Object.defineProperty(data, '__proto__', { enumerable: true, value: { polluted: true } });
    return response(data);
  } } });
  await assert.rejects(
    () => hostile.observe('equity_quote', { symbol: 'AAPL' }),
    error => error instanceof RobinhoodReadAdapterError && error.code === 'spotlight_robinhood_hostile',
  );
  const oversized = adapterWith({ operations: { equity_quote: () => response({ symbol: 'AAPL', price: 1, note: 'x'.repeat(5000) }) } });
  await assert.rejects(
    () => oversized.observe('equity_quote', { symbol: 'AAPL' }),
    error => error instanceof RobinhoodReadAdapterError && error.code === 'spotlight_robinhood_oversized',
  );
  const byteOversized = adapterWith({
    limits: { maxResponseBytes: 80 },
    operations: { equity_quote: () => response({ symbol: 'AAPL', price: 1, account_id: 'x'.repeat(40) }) },
  });
  await assert.rejects(
    () => byteOversized.observe('equity_quote', { symbol: 'AAPL' }),
    error => error instanceof RobinhoodReadAdapterError && error.code === 'spotlight_robinhood_oversized',
  );
  const failed = adapterWith({ operations: { equity_quote: () => { throw new Error('provider-secret failure'); } } });
  await assert.rejects(
    () => failed.observe('equity_quote', { symbol: 'AAPL' }),
    error => error instanceof RobinhoodReadAdapterError && error.code === 'spotlight_robinhood_operation_failed' && !error.message.includes('provider-secret'),
  );
});

test('does not invoke an injected callable when request validation fails', async () => {
  let calls = 0;
  const adapter = adapterWith({ operations: { equity_quote: () => { calls += 1; return response({ symbol: 'AAPL', price: 1 }); } } });
  await assert.rejects(() => adapter.observe('equity_quote', { symbol: 'AAPL', account_id: 'do-not-pass' }));
  await assert.rejects(() => adapter.observe('equity_quote', { symbol: '' }));
  assert.equal(calls, 0);
});
