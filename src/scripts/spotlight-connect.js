import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_ROBINHOOD_AUTH_PATH,
  RobinhoodAuthError,
  createRobinhoodAuthStore,
  createRobinhoodOAuthProvider,
} from '../connectors/robinhood/oauth.js';
import {
  createRobinhoodMcpSession,
  ROBINHOOD_MCP_ENDPOINT,
  sanitizeTransportError,
} from '../connectors/robinhood/transport.js';
import { resolveHubConfig } from '../core/config.js';

const DEFAULT_CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_CALLBACK_PORT = 32189;

function cliError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

export function parseArgs(argv) {
  const [mode = 'status', ...rest] = argv;
  if (!['connect', 'status', 'disconnect', 'help'].includes(mode)) throw cliError('spotlight_cli_unknown_mode');
  const options = { mode, open: false };
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index];
    if (flag === '--open') { options.open = true; continue; }
    if (flag === '--help' || flag === '-h') { options.mode = 'help'; continue; }
    const match = /^--(auth-path|endpoint|port|timeout-ms)=(.*)$/.exec(flag);
    if (match) { options[match[1].replaceAll('-', '')] = match[2]; continue; }
    if (['--auth-path', '--endpoint', '--port', '--timeout-ms'].includes(flag)) {
      const value = rest[++index];
      if (!value || value.startsWith('--')) throw cliError('spotlight_cli_missing_flag_value');
      options[flag.slice(2).replaceAll('-', '')] = value;
      continue;
    }
    throw cliError('spotlight_cli_unknown_flag');
  }
  if (options.port !== undefined && (!/^\d+$/.test(options.port) || Number(options.port) > 65535)) throw cliError('spotlight_cli_invalid_port');
  if (options.timeoutms !== undefined && (!/^\d+$/.test(options.timeoutms) || Number(options.timeoutms) < 1)) throw cliError('spotlight_cli_invalid_timeout');
  return options;
}

export async function loadDotEnv(path = '.env', env = process.env) {
  let raw;
  try { raw = await readFile(path, 'utf8'); } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw cliError('spotlight_cli_env_unavailable');
  }
  for (const line of raw.split(/\r?\n/u)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/u.exec(line);
    if (!match || match[1].startsWith('#')) continue;
    const value = match[2].replace(/^(['"])(.*)\1$/u, '$2');
    if (env[match[1]] === undefined) env[match[1]] = value;
  }
}

function jsonLine(value) {
  return `${JSON.stringify(value)}\n`;
}

function output(value, write = process.stdout.write.bind(process.stdout)) {
  write(jsonLine(value));
}

function openAuthorizationUrl(url) {
  if (process.platform !== 'win32') throw cliError('spotlight_cli_open_unsupported');
  const child = spawn('explorer.exe', [String(url)], { detached: true, stdio: 'ignore', windowsHide: true, shell: false });
  child.unref();
}

export async function listenLoopback(port) {
  let callback;
  let resolveCallback;
  let rejectCallback;
  let expectedState;
  const callbackPromise = new Promise((resolveResult, reject) => { resolveCallback = resolveResult; rejectCallback = reject; });
  const server = createServer((request, response) => {
    const url = new URL(request.url || '/', 'http://127.0.0.1');
    if (request.method !== 'GET' || (request.url?.length || 0) > 8192 || callback || url.pathname !== '/spotlight/oauth/callback') {
      response.writeHead(404); response.end(); return;
    }
    if (!expectedState || url.searchParams.get('state') !== expectedState || !url.searchParams.get('code')) {
      response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Spotlight authentication callback was refused.');
      return;
    }
    callback = url;
    response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Spotlight authentication received. You may close this window.');
    resolveCallback(url);
  });
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(Number(port ?? DEFAULT_CALLBACK_PORT), '127.0.0.1', resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === 'string') { await closeServer(server); throw cliError('spotlight_cli_callback_unavailable'); }
  return {
    server,
    redirectUrl: `http://127.0.0.1:${address.port}/spotlight/oauth/callback`,
    setExpectedState(state) { expectedState = state; },
    async wait(timeoutMs) {
      const timer = setTimeout(() => rejectCallback(cliError('spotlight_cli_callback_timeout')), timeoutMs);
      try {
        const url = await callbackPromise;
        const state = url.searchParams.get('state');
        const code = url.searchParams.get('code');
        if (!state || !code) throw cliError('spotlight_cli_callback_invalid');
        return { state, code };
      } finally { clearTimeout(timer); }
    },
    callback,
  };
}

async function closeServer(server) {
  if (!server) return;
  await new Promise(resolveClose => server.close(() => resolveClose()));
}

async function connectMode(options, env, write) {
  if (process.platform !== 'win32') {
    output({ state: 'unavailable', code: 'robinhood_auth_unsupported_platform' }, write);
    return 1;
  }
  const endpoint = options.endpoint || env.HUB_SPOTLIGHT_ROBINHOOD_ENDPOINT || ROBINHOOD_MCP_ENDPOINT;
  if (endpoint !== ROBINHOOD_MCP_ENDPOINT) throw cliError('robinhood_endpoint_refused');
  const config = resolveHubConfig(env);
  const authPath = options.authpath || env.HUB_SPOTLIGHT_AUTH_PATH || config.spotlightAuthPath || DEFAULT_ROBINHOOD_AUTH_PATH;
  const callback = await listenLoopback(options.port);
  let session;
  try {
    const store = createRobinhoodAuthStore({ authPath });
    const provider = createRobinhoodOAuthProvider({
      authStore: store,
      redirectUrl: callback.redirectUrl,
      onAuthorizationUrl: async url => { if (options.open) openAuthorizationUrl(url); },
    });
    callback.setExpectedState(await provider.state());
    session = await createRobinhoodMcpSession({ endpoint, provider });
    try {
      await session.client.connect(session.transport);
      output({ state: 'connected', code: 'robinhood_connected' }, write);
      return 0;
    } catch (error) {
      const safe = sanitizeTransportError(error);
      if (safe.code !== 'robinhood_authentication_required') throw safe;
      const authorizationUrl = provider.authorizationUrl();
      if (!authorizationUrl) throw cliError('robinhood_authentication_required');
      output({ state: 'authentication_required', code: 'robinhood_authorization_started', authorization_url: authorizationUrl }, write);
      const callbackResult = await callback.wait(Number(options.timeoutms || DEFAULT_CALLBACK_TIMEOUT_MS));
      const expectedState = await provider.state();
      if (callbackResult.state !== expectedState) throw cliError('robinhood_auth_state_mismatch');
      await session.transport.finishAuth(callbackResult.code);
      await session.client.close?.();
      await session.transport.close?.();
      session = await createRobinhoodMcpSession({ endpoint, provider });
      await session.client.connect(session.transport);
      output({ state: 'connected', code: 'robinhood_connected' }, write);
      return 0;
    }
  } catch (error) {
    const safe = error instanceof RobinhoodAuthError ? error : sanitizeTransportError(error);
    output({ state: safe.code === 'robinhood_authentication_required' ? 'authentication_required' : 'unavailable', code: safe.code }, write);
    return 1;
  } finally {
    await session?.client?.close?.().catch?.(() => undefined);
    await session?.transport?.close?.().catch?.(() => undefined);
    await closeServer(callback.server);
  }
}

export async function run(argv = process.argv.slice(2), { env = process.env, write = process.stdout.write.bind(process.stdout) } = {}) {
  await loadDotEnv('.env', env);
  const options = parseArgs(argv);
  if (options.mode === 'help') {
    output({ usage: 'node src/scripts/spotlight-connect.js <connect|status|disconnect> [--open] [--auth-path PATH]' }, write);
    return 0;
  }
  const config = resolveHubConfig(env);
  const authPath = options.authpath || env.HUB_SPOTLIGHT_AUTH_PATH || config.spotlightAuthPath || DEFAULT_ROBINHOOD_AUTH_PATH;
  const store = createRobinhoodAuthStore({ authPath });
  if (options.mode === 'status') { output(store.inspectSync(), write); return 0; }
  if (options.mode === 'disconnect') { await store.clear(); output({ state: 'authentication_required', code: 'robinhood_auth_disconnected' }, write); return 0; }
  return connectMode(options, env, write);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  run().then(code => { process.exitCode = code; }).catch(error => {
    process.stderr.write(jsonLine({ state: 'unavailable', code: error?.code || 'spotlight_cli_failed' }));
    process.exitCode = 1;
  });
}
