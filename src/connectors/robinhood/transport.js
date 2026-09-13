import { Buffer } from 'node:buffer';

export const ROBINHOOD_MCP_ENDPOINT = 'https://agent.robinhood.com/mcp/trading';

export const ROBINHOOD_TRANSPORT_LIMITS = Object.freeze({
  requestMs: 20_000,
  responseBytes: 256_000,
  responseObjects: 512,
  responseDepth: 16,
});

export class RobinhoodTransportError extends Error {
  constructor(code, message = code, details = undefined) {
    super(message);
    this.name = 'RobinhoodTransportError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function fail(code, message = code, details = undefined) {
  throw new RobinhoodTransportError(code, message, details);
}

function numberLimit(value, fallback) {
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

export function transportLimits(configured = {}) {
  if (!configured || typeof configured !== 'object' || Array.isArray(configured)) {
    fail('robinhood_transport_invalid_limits');
  }
  const limits = {
    requestMs: numberLimit(configured.requestMs, ROBINHOOD_TRANSPORT_LIMITS.requestMs),
    responseBytes: numberLimit(configured.responseBytes, ROBINHOOD_TRANSPORT_LIMITS.responseBytes),
    responseObjects: numberLimit(configured.responseObjects, ROBINHOOD_TRANSPORT_LIMITS.responseObjects),
    responseDepth: numberLimit(configured.responseDepth, ROBINHOOD_TRANSPORT_LIMITS.responseDepth),
  };
  for (const key of Object.keys(configured)) {
    if (!Object.hasOwn(ROBINHOOD_TRANSPORT_LIMITS, key) || limits[key] !== configured[key]) {
      fail('robinhood_transport_invalid_limits');
    }
  }
  return Object.freeze(limits);
}

function mergeSignals(parent, timeout) {
  const controller = new AbortController();
  const abort = reason => {
    if (!controller.signal.aborted) controller.abort(reason);
  };
  const timer = setTimeout(() => abort(new Error('request_timeout')), timeout);
  const onParentAbort = () => abort(parent.reason);
  if (parent) {
    if (parent.aborted) onParentAbort();
    else parent.addEventListener('abort', onParentAbort, { once: true });
  }
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer);
      parent?.removeEventListener('abort', onParentAbort);
    },
  };
}

async function withSignal(promise, signal) {
  if (signal.aborted) fail('robinhood_transport_timeout');
  let abort;
  const interrupted = new Promise((resolve, reject) => {
    abort = () => reject(new RobinhoodTransportError('robinhood_transport_timeout'));
    signal.addEventListener('abort', abort, { once: true });
  });
  try { return await Promise.race([promise, interrupted]); }
  finally { signal.removeEventListener('abort', abort); }
}

async function boundedBody(response, limits, signal) {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await withSignal(reader.read(), signal);
      if (done) break;
      total += value.byteLength;
      if (total > limits.responseBytes) {
        void reader.cancel().catch(() => undefined);
        fail('robinhood_transport_response_oversized');
      }
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    void reader.cancel().catch(() => undefined);
    if (error instanceof RobinhoodTransportError) throw error;
    fail('robinhood_transport_response_failed');
  }
  return Buffer.concat(chunks, total);
}

/**
 * Wraps fetch so every upstream MCP response has a byte and time ceiling.
 * The wrapper buffers the bounded response before returning it, which also
 * keeps the SDK from receiving an unbounded SSE or JSON body.
 */
function requestUrl(input) {
  try { return new URL(input instanceof Request ? input.url : String(input)); } catch { fail('robinhood_transport_invalid_url'); }
}

function checkOrigin(input, allowedHosts, protectedOrigin) {
  const url = requestUrl(input);
  if (!allowedHosts) return url;
  if (url.protocol !== 'https:' || url.port || url.username || url.password || !allowedHosts.includes(url.hostname)) fail('robinhood_transport_origin_refused');
  return url;
}

export function createBoundedFetch({ fetchFn = globalThis.fetch, limits = {}, allowedHosts, protectedOrigin } = {}) {
  if (typeof fetchFn !== 'function') fail('robinhood_transport_invalid_fetch');
  const bounded = transportLimits(limits);
  return async (input, init = {}) => {
    const url = checkOrigin(input, allowedHosts, protectedOrigin);
    const requestHeaders = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined));
    const method = (init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    // This bounded reader has no server-push subscription. POST replies may use finite SSE.
    if (url.href === ROBINHOOD_MCP_ENDPOINT && method === 'GET') return new Response(null, { status: 405 });
    if (protectedOrigin && url.origin !== new URL(protectedOrigin).origin && requestHeaders.has('authorization')) {
      fail('robinhood_transport_auth_header_refused');
    }
    const signal = mergeSignals(init.signal, bounded.requestMs);
    try {
      const response = await withSignal(fetchFn(input, { ...init, headers: requestHeaders, redirect: 'error', signal: signal.signal }), signal.signal);
      const declared = Number(response.headers?.get?.('content-length'));
      if (Number.isFinite(declared) && declared > bounded.responseBytes) {
        void response.body?.cancel?.().catch(() => undefined);
        fail('robinhood_transport_response_oversized');
      }
      const body = await boundedBody(response, bounded, signal.signal);
      return new Response(body.length ? body : null, { status: response.status, statusText: response.statusText, headers: response.headers });
    } catch (error) {
      if (error instanceof RobinhoodTransportError) throw error;
      if (signal.signal.aborted) fail('robinhood_transport_timeout');
      fail('robinhood_transport_network_failed');
    } finally {
      signal.dispose();
    }
  };
}

export async function loadRobinhoodSdk() {
  try {
    const [clientModule, transportModule] = await Promise.all([
      import('@modelcontextprotocol/sdk/client/index.js'),
      import('@modelcontextprotocol/sdk/client/streamableHttp.js'),
    ]);
    return {
      Client: clientModule.Client,
      StreamableHTTPClientTransport: transportModule.StreamableHTTPClientTransport,
    };
  } catch {
    fail('robinhood_transport_sdk_unavailable');
  }
}

export async function createRobinhoodMcpSession({
  endpoint = ROBINHOOD_MCP_ENDPOINT,
  provider,
  fetchFn,
  limits = {},
  sdk,
  clientFactory,
  transportFactory,
} = {}) {
  const url = endpoint instanceof URL ? endpoint : new URL(endpoint);
  if (url.href !== ROBINHOOD_MCP_ENDPOINT) fail('robinhood_transport_origin_refused');
  const officialOrigins = ['agent.robinhood.com', 'robinhood.com', 'api.robinhood.com'];
  const boundedFetch = createBoundedFetch({ fetchFn, limits, allowedHosts: officialOrigins, protectedOrigin: url });
  const loaded = sdk || await loadRobinhoodSdk();
  if (typeof clientFactory === 'function') {
    const session = await clientFactory({ endpoint: url, provider, fetch: boundedFetch, sdk: loaded });
    if (!session || typeof session.client?.connect !== 'function') fail('robinhood_transport_invalid_client');
    return { ...session, fetch: boundedFetch };
  }
  if (typeof loaded.Client !== 'function' || typeof loaded.StreamableHTTPClientTransport !== 'function') {
    fail('robinhood_transport_sdk_unavailable');
  }
  const options = { authProvider: provider, fetch: boundedFetch };
  const transport = typeof transportFactory === 'function'
    ? await transportFactory({ endpoint: url, options, sdk: loaded })
    : new loaded.StreamableHTTPClientTransport(url, options);
  const client = new loaded.Client({ name: 'the-hub-spotlight', version: '1.0.0' });
  return { client, transport, fetch: boundedFetch };
}

export function sanitizeTransportError(error) {
  if (error instanceof RobinhoodTransportError) return error;
  const status = Number(error?.code ?? error?.status ?? error?.statusCode);
  if (status === 401 || /unauthori[sz]ed|authentication|oauth|token/i.test(`${error?.name || ''} ${error?.constructor?.name || ''}`)) {
    return new RobinhoodTransportError('robinhood_authentication_required');
  }
  if (status === 403) return new RobinhoodTransportError('robinhood_access_refused');
  return new RobinhoodTransportError('robinhood_transport_failed');
}
