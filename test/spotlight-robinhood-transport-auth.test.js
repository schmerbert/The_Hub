import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ROBINHOOD_AUTH_SCHEMA,
  createRobinhoodAuthStore,
  createRobinhoodOAuthProvider,
  windowsDpapiCipher,
} from '../src/connectors/robinhood/oauth.js';
import { parseArgs } from '../src/scripts/spotlight-connect.js';
import { listenLoopback } from '../src/scripts/spotlight-connect.js';
import { startAuthorization } from '@modelcontextprotocol/sdk/client/auth.js';

function testCipher() {
  const transform = value => Buffer.from(Buffer.from(String(value), 'utf8').map(byte => byte ^ 0x5a));
  const reverse = value => Buffer.from(Buffer.from(value).map(byte => byte ^ 0x5a)).toString('utf8');
  return {
    encrypt: async value => transform(value),
    decrypt: async value => reverse(value),
    encryptSync: value => transform(value),
    decryptSync: value => reverse(value),
  };
}

test('OAuth credentials are kept in a separate encrypted atomic store and provider state is PKCE-ready', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hub-robinhood-auth-'));
  const path = join(root, 'auth.dpapi');
  const store = createRobinhoodAuthStore({ authPath: path, cipher: testCipher(), now: () => 1_000_000 });
  try {
    assert.deepEqual(store.inspectSync(), { state: 'authentication_required', code: 'robinhood_auth_missing' });
    const provider = createRobinhoodOAuthProvider({ authStore: store, redirectUrl: 'http://127.0.0.1:43210/spotlight/oauth/callback', now: () => 1_000_000, randomState: () => 'state-for-test' });
    assert.equal(await provider.state(), 'state-for-test');
    await provider.saveClientInformation({ client_id: 'client-public' });
    await provider.saveCodeVerifier('verifier-for-test');
    await provider.saveTokens({ access_token: 'access-secret', refresh_token: 'refresh-secret', token_type: 'Bearer', expires_in: 3600 });
    const onDisk = await readFile(path, 'utf8');
    assert.equal(onDisk.includes('access-secret'), false);
    assert.equal(onDisk.includes('refresh-secret'), false);
    assert.equal((await provider.tokens()).refresh_token, 'refresh-secret');
    assert.equal(await provider.codeVerifier(), 'verifier-for-test');
    assert.deepEqual(store.inspectSync(), { state: 'connected', code: 'robinhood_auth_present' });
    const redirected = [];
    const redirecting = createRobinhoodOAuthProvider({ authStore: store, redirectUrl: 'http://127.0.0.1:43210/spotlight/oauth/callback', onAuthorizationUrl: url => redirected.push(url.toString()) });
    await redirecting.redirectToAuthorization(new URL('https://agent.robinhood.com/authorize?state=opaque'));
    assert.deepEqual(redirected, ['https://agent.robinhood.com/authorize?state=opaque']);
    await store.clear();
    assert.deepEqual(store.inspectSync(), { state: 'authentication_required', code: 'robinhood_auth_missing' });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('expired credentials remain honest and refreshable credentials remain usable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hub-robinhood-expiry-'));
  const path = join(root, 'auth.dpapi');
  const now = 10_000;
  const store = createRobinhoodAuthStore({ authPath: path, cipher: testCipher(), now: () => now });
  try {
    await store.save({ schema: ROBINHOOD_AUTH_SCHEMA, tokens: { access_token: 'expired', expires_at: 9_000 } });
    assert.deepEqual(store.inspectSync(), { state: 'authentication_required', code: 'robinhood_auth_expired' });
    await store.save({ schema: ROBINHOOD_AUTH_SCHEMA, tokens: { access_token: 'expired', refresh_token: 'refresh', expires_at: 9_000 } });
    assert.deepEqual(store.inspectSync(), { state: 'connected', code: 'robinhood_auth_refreshable' });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('CLI parser exposes explicit modes and rejects ambiguous flags', () => {
  assert.deepEqual(parseArgs(['connect', '--open', '--auth-path', 'x.dpapi', '--timeout-ms=2000']), { mode: 'connect', open: true, authpath: 'x.dpapi', timeoutms: '2000' });
  assert.deepEqual(parseArgs(['status']), { mode: 'status', open: false });
  assert.throws(() => parseArgs(['connect', '--unknown']), error => error.code === 'spotlight_cli_unknown_flag');
  assert.throws(() => parseArgs(['connect', '--port=70000']), error => error.code === 'spotlight_cli_invalid_port');
});

test('default DPAPI refuses persistence on unsupported platforms', () => {
  if (process.platform === 'win32') return;
  const store = createRobinhoodAuthStore({ authPath: join(tmpdir(), 'hub-unsupported-auth.dpapi') });
  assert.deepEqual(store.inspectSync(), { state: 'unavailable', code: 'robinhood_auth_unsupported_platform' });
  assert.rejects(() => store.save({ schema: ROBINHOOD_AUTH_SCHEMA }), error => error.code === 'robinhood_auth_unsupported_platform');
  assert.equal(typeof windowsDpapiCipher.encrypt, 'function');
});

test('SDK authorization construction binds PKCE S256 and state to the stable loopback callback', async () => {
  let auth = { schema: ROBINHOOD_AUTH_SCHEMA };
  const provider = createRobinhoodOAuthProvider({
    authStore: { load: async () => structuredClone(auth), save: async value => { auth = structuredClone(value); } },
    redirectUrl: 'http://127.0.0.1:32189/spotlight/oauth/callback',
    randomState: () => 'state-sdk-test',
  });
  const state = await provider.state();
  const started = await startAuthorization('https://agent.robinhood.com/mcp/trading', {
    metadata: {
      issuer: 'https://agent.robinhood.com/mcp/trading',
      authorization_endpoint: 'https://robinhood.com/oauth',
      token_endpoint: 'https://api.robinhood.com/oauth2/token/',
      response_types_supported: ['code'],
      code_challenge_methods_supported: ['S256'],
    },
    clientInformation: { client_id: 'client-for-test' },
    redirectUrl: provider.redirectUrl,
    state,
  });
  assert.equal(started.authorizationUrl.searchParams.get('state'), 'state-sdk-test');
  assert.equal(started.authorizationUrl.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(typeof started.authorizationUrl.searchParams.get('code_challenge'), 'string');
  assert.ok(started.authorizationUrl.searchParams.get('code_challenge').length > 20);
  await provider.saveCodeVerifier(started.codeVerifier);
  assert.equal(await provider.codeVerifier(), started.codeVerifier);
});

test('loopback callback rejects wrong state before showing success and keeps waiting for the valid callback', async () => {
  const callback = await listenLoopback(0);
  callback.setExpectedState('expected-state');
  try {
    const wait = callback.wait(2_000);
    const wrong = await fetch(`${callback.redirectUrl}?code=attacker-code&state=wrong-state`);
    assert.equal(wrong.status, 400);
    const valid = fetch(`${callback.redirectUrl}?code=valid-code&state=expected-state`);
    assert.deepEqual(await wait, { state: 'expected-state', code: 'valid-code' });
    assert.equal((await valid).status, 200);
  } finally {
    await new Promise(resolve => callback.server.close(resolve));
  }
});

test('native Windows DPAPI round-trip keeps a synthetic token out of the file', async () => {
  if (process.platform !== 'win32') return;
  const root = await mkdtemp(join(tmpdir(), 'hub-robinhood-dpapi-'));
  const path = join(root, 'auth.dpapi');
  const store = createRobinhoodAuthStore({ authPath: path });
  try {
    await store.save({ schema: ROBINHOOD_AUTH_SCHEMA, tokens: { access_token: 'synthetic-access-token', refresh_token: 'synthetic-refresh-token' } });
    const bytes = await readFile(path);
    assert.equal(bytes.toString('utf8').includes('synthetic-access-token'), false);
    assert.equal((await createRobinhoodAuthStore({ authPath: path }).load()).tokens.refresh_token, 'synthetic-refresh-token');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
