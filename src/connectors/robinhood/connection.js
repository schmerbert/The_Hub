import { RobinhoodConnectionError, fail } from './errors.js';
import { object, valueOf, boolOf, aliasFor, extractMcpPayload, projectAccountResponse, projectPortfolioResponse, projectPositionsResponse, projectQuoteResponse } from './projection.js';
export { RobinhoodConnectionError } from './errors.js';
import { resolveHubConfig } from '../../core/config.js';
import { admitSpotlightObservation } from '../../places/hub/spotlight/observation.js';
import { createRobinhoodReadAdapter, ROBINHOOD_READ_OPERATIONS } from '../../places/hub/spotlight/robinhood.js';
import { createRobinhoodOAuthProvider, createRobinhoodAuthStore } from './oauth.js';
import {
  createRobinhoodMcpSession,
  ROBINHOOD_MCP_ENDPOINT,
  RobinhoodTransportError,
  sanitizeTransportError,
  transportLimits,
} from './transport.js';

export const ROBINHOOD_CONNECTION_API = 'spotlight-robinhood-connection.v1';
const TOOL_CANDIDATES = Object.freeze({
  accounts: ['get_accounts'],
  portfolio: ['get_portfolio'],
  equity_positions: ['get_equity_positions'],
  crypto_positions: ['get_crypto_positions'],
  equity_quote: ['get_equity_quotes'],
  crypto_quote: ['get_crypto_quotes'],
});
const KNOWN_TOOL_DEFINITIONS = Object.freeze({
  accounts: { name: 'get_accounts', schema: { type: 'object', properties: {} } },
  portfolio: { name: 'get_portfolio', schema: { type: 'object', properties: { account_number: { type: 'string' } }, required: ['account_number'] } },
  equity_positions: { name: 'get_equity_positions', schema: { type: 'object', properties: { account_number: { type: 'string' } }, required: ['account_number'] } },
  crypto_positions: { name: 'get_crypto_positions', schema: { type: 'object', properties: { rhs_account_number: { type: 'string' } }, required: ['rhs_account_number'] } },
  equity_quote: { name: 'get_equity_quotes', schema: { type: 'object', properties: { symbols: { type: 'array' } }, required: ['symbols'] } },
  crypto_quote: { name: 'get_crypto_quotes', schema: { type: 'object', properties: { symbols: { type: 'array' } }, required: ['symbols'] } },
});
const ACCOUNT_KEYS = ['account_number', 'accountNumber', 'account_id', 'accountId', 'rhs_account_number', 'rhsAccountNumber'];
function argumentKey(schema, candidates) {
  const properties = object(schema?.properties) ? Object.keys(schema.properties) : [];
  return candidates.find(key => properties.includes(key));
}

function requiredUnknown(schema, used) {
  return (Array.isArray(schema?.required) ? schema.required : []).some(key => !used.has(key));
}

function toolArguments(operation, request, tool, providerIdValue) {
  const schema = tool?.schema;
  if (!object(schema) || schema.type !== 'object') fail('robinhood_tool_schema_invalid');
  const args = {};
  const used = new Set();
  if (operation === 'accounts') {
    if (requiredUnknown(schema, used)) fail('robinhood_tool_schema_unsupported');
    return args;
  }
  if (ROBINHOOD_READ_OPERATIONS[operation].accountRequired) {
    const key = argumentKey(schema, ACCOUNT_KEYS);
    if (key) { args[key] = providerIdValue; used.add(key); }
  }
  if (operation.endsWith('_quote')) {
    const key = argumentKey(schema, ['symbol', 'ticker', 'stock_symbol', 'trading_pair', 'pair', 'symbols']);
    if (key) {
      const symbol = operation === 'crypto_quote' && !request.symbol.endsWith('-USD') ? `${request.symbol}-USD` : request.symbol;
      args[key] = key === 'symbols' ? [symbol] : symbol;
      used.add(key);
    }
  }
  if (requiredUnknown(schema, used)) fail('robinhood_tool_schema_unsupported');
  return args;
}

function chooseTools(tools) {
  if (!Array.isArray(tools)) fail('robinhood_tool_catalog_invalid');
  const byName = new Map(tools.filter(tool => object(tool) && typeof tool.name === 'string').map(tool => [tool.name, tool]));
  const selected = {};
  for (const operation of Object.keys(TOOL_CANDIDATES)) {
    const name = TOOL_CANDIDATES[operation].find(candidate => byName.has(candidate));
    if (!name) fail('robinhood_tool_unavailable');
    selected[operation] = { name, schema: byName.get(name).inputSchema };
  }
  return selected;
}

function unknownFreshness(observation) {
  const { apiVersion, sourceReceipt, ...payload } = observation;
  return admitSpotlightObservation({ ...payload, freshness: { status: 'unknown', asOf: null } });
}

export function createRobinhoodConnection({
  endpoint = ROBINHOOD_MCP_ENDPOINT,
  authPath,
  authStore,
  provider,
  redirectUrl = 'http://127.0.0.1:32189/spotlight/oauth/callback',
  clientFactory,
  transportFactory,
  sdk,
  toolCatalog,
  fetchFn,
  limits = {},
  clock = () => new Date().toISOString(),
  now = () => Date.now(),
} = {}) {
  const boundedLimits = transportLimits(limits);
  const resolvedAuthPath = authPath || resolveHubConfig(process.env).spotlightAuthPath;
  const store = authStore || createRobinhoodAuthStore({ authPath: resolvedAuthPath, now });
  const oauthProvider = provider || createRobinhoodOAuthProvider({ authStore: store, redirectUrl, now });
  let session;
  let tools;
  let closed = false;
  let statusOverride;
  let accountIds = new Map();
  let accountDetails = new Map();
  let accountAliases = new Map();
  let jurisdictions = {};
  let accountMapPromise;
  let operationTail = Promise.resolve();
  let queued = 0;
  let lastSourceDeclared = true;
  const adapterLimitKeys = new Set(['maxResponseBytes', 'maxDepth', 'maxObjects', 'maxStringBytes', 'maxPositions', 'maxAccounts']);
  const adapterLimits = Object.fromEntries(Object.entries(limits).filter(([key]) => adapterLimitKeys.has(key)));

  function installAccount(id, record) {
    const alias = aliasFor(id);
    const previous = accountAliases.get(alias);
    if (previous && previous !== id) fail('robinhood_account_alias_collision');
    accountIds.set(alias, id);
    accountAliases.set(alias, id);
    accountDetails.set(alias, {
      primary: id,
      rhs: valueOf(record, ['rhs_account_number', 'rhsAccountNumber']),
    });
    jurisdictions[alias] = {
      readOnly: boolOf(record, ['readOnly', 'read_only'], true),
      agentAccessible: boolOf(record, ['agentAccessible', 'agent_accessible', 'agentic_allowed'], false),
    };
    return alias;
  }

  function accountId(alias, operation = '') {
    const details = accountDetails.get(alias);
    const id = operation === 'crypto_positions' ? details?.rhs : accountIds.get(alias);
    if (!id) fail('robinhood_account_unavailable');
    return id;
  }

  async function ensureSession() {
    if (closed) fail('robinhood_connection_closed');
    if (session) return session;
    try {
      session = await createRobinhoodMcpSession({ endpoint, provider: oauthProvider, fetchFn, limits: boundedLimits, sdk, clientFactory, transportFactory });
      if (closed) { await closeSession(); fail('robinhood_connection_closed'); }
      await session.client.connect(session.transport);
      if (closed) { await closeSession(); fail('robinhood_connection_closed'); }
      tools = toolCatalog ? chooseTools(toolCatalog) : KNOWN_TOOL_DEFINITIONS;
      statusOverride = undefined;
      return session;
    } catch (error) {
      const safe = error instanceof RobinhoodConnectionError
        ? new RobinhoodTransportError(error.code)
        : sanitizeTransportError(error);
      statusOverride = safe.code === 'robinhood_authentication_required'
        ? { state: 'authentication_required', code: safe.code }
        : undefined;
      await closeSession();
      throw safe;
    }
  }

  async function call(operation, request) {
    await ensureSession();
    const tool = tools[operation];
    const args = toolArguments(operation, request, tool, request.accountAlias ? accountId(request.accountAlias, operation) : undefined);
    try {
      const result = await session.client.callTool({ name: tool.name, arguments: args }, undefined, { timeout: boundedLimits.requestMs });
      return extractMcpPayload(result, boundedLimits);
    } catch (error) {
      if (error instanceof RobinhoodConnectionError) throw error;
      throw sanitizeTransportError(error);
    }
  }

  async function discoverAccounts(force = false) {
    if (accountMapPromise && !force) return accountMapPromise;
    accountMapPromise = (async () => {
      const payload = await call('accounts', {});
      accountIds.clear(); accountDetails.clear(); accountAliases.clear(); jurisdictions = {};
      const projected = projectAccountResponse(payload, clock, installAccount);
      lastSourceDeclared = Boolean(projected.declared);
      return projected;
    })().catch(error => { accountMapPromise = undefined; throw error; });
    return accountMapPromise;
  }

  function makeAdapter(operations) {
    return createRobinhoodReadAdapter({ accountJurisdictions: jurisdictions, operations, limits: adapterLimits, clock });
  }

  async function perform(operation, request) {
    if (!Object.hasOwn(ROBINHOOD_READ_OPERATIONS, operation)) fail('robinhood_operation_not_allowlisted');
    if (closed) fail('robinhood_connection_closed');
    const discoveredAccounts = operation === 'accounts' ? await discoverAccounts(true) : null;
    if (ROBINHOOD_READ_OPERATIONS[operation].accountRequired) await discoverAccounts(true);
    const operations = {
      [operation]: async normalized => {
        if (operation === 'accounts') {
          lastSourceDeclared = discoveredAccounts.declared;
          return discoveredAccounts.response;
        }
        const payload = await call(operation, normalized);
        let projected;
        if (operation === 'portfolio') projected = projectPortfolioResponse(payload, normalized, alias => accountId(alias, operation), clock);
        else if (operation === 'equity_positions' || operation === 'crypto_positions') projected = projectPositionsResponse(payload, operation, normalized, alias => accountId(alias, operation), clock);
        else projected = projectQuoteResponse(payload, operation, normalized, clock);
        lastSourceDeclared = projected.declared;
        return projected.response;
      },
    };
    const adapter = makeAdapter(operations);
    const observation = await adapter.observe(operation, request);
    return lastSourceDeclared ? observation : unknownFreshness(observation);
  }

  function observe(operation, request = {}) {
    if (queued >= 8) return Promise.reject(new RobinhoodConnectionError('robinhood_connection_busy'));
    queued += 1;
    const next = operationTail.then(() => perform(operation, request)).finally(() => { queued -= 1; });
    operationTail = next.catch(() => undefined);
    return next;
  }

  async function closeSession() {
    const current = session;
    session = undefined;
    tools = undefined;
    accountMapPromise = undefined;
    if (!current) return;
    try { await current.client?.close?.(); } catch {}
    try { await current.transport?.close?.(); } catch {}
  }

  return Object.freeze({
    apiVersion: ROBINHOOD_CONNECTION_API,
    observe,
    status() {
      if (closed) return { state: 'unavailable', code: 'robinhood_connection_closed' };
      if (statusOverride) return { ...statusOverride };
      if (typeof store.inspectSync === 'function') return store.inspectSync();
      if (typeof oauthProvider.statusSync === 'function') return oauthProvider.statusSync();
      return { state: 'authentication_required', code: 'robinhood_authentication_unknown' };
    },
    async close() {
      closed = true;
      await closeSession();
      await operationTail.catch(() => undefined);
    },
    authorizationProvider: oauthProvider,
  });
}

export { TOOL_CANDIDATES, aliasFor };
