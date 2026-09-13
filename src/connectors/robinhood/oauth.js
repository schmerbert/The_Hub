import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';

export const DEFAULT_ROBINHOOD_AUTH_PATH = '.runtime/spotlight/robinhood-auth.dpapi';
export const ROBINHOOD_AUTH_SCHEMA = 'spotlight-robinhood-auth.v1';
const MAX_AUTH_BYTES = 64 * 1024;

export class RobinhoodAuthError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'RobinhoodAuthError';
    this.code = code;
  }
}

function fail(code, message = code) {
  throw new RobinhoodAuthError(code, message);
}

function asBytes(value) {
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === 'string') return Buffer.from(value, 'utf8');
  fail('robinhood_auth_cipher_invalid');
}

function text(value, max = MAX_AUTH_BYTES) {
  const bytes = asBytes(value);
  if (bytes.length > max) fail('robinhood_auth_oversized');
  return bytes.toString('utf8');
}

function validObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateEnvelope(value) {
  if (!validObject(value) || value.schema !== ROBINHOOD_AUTH_SCHEMA) fail('robinhood_auth_invalid');
  const allowed = new Set(['schema', 'clientInformation', 'tokens', 'codeVerifier', 'discoveryState']);
  if (Object.keys(value).some(key => !allowed.has(key))) fail('robinhood_auth_invalid');
  if (value.clientInformation !== undefined && !validObject(value.clientInformation)) fail('robinhood_auth_invalid');
  if (value.tokens !== undefined && !validObject(value.tokens)) fail('robinhood_auth_invalid');
  if (value.codeVerifier !== undefined && (typeof value.codeVerifier !== 'string' || value.codeVerifier.length > 512)) fail('robinhood_auth_invalid');
  if (value.discoveryState !== undefined && !validObject(value.discoveryState)) fail('robinhood_auth_invalid');
  return value;
}

function emptyEnvelope() {
  return { schema: ROBINHOOD_AUTH_SCHEMA };
}

function safeError() {
  return new RobinhoodAuthError('robinhood_auth_unavailable');
}

function runPowerShell(script, input, { sync = false } = {}) {
  if (process.platform !== 'win32') throw safeError();
  const args = ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script];
  if (sync) {
    const result = spawnSync('powershell.exe', args, {
      input,
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: MAX_AUTH_BYTES * 2,
      timeout: 10_000,
      shell: false,
    });
    if (result.error || result.status !== 0) throw safeError();
    return String(result.stdout || '').trim();
  }
  return new Promise((resolveResult, reject) => {
    const child = spawn('powershell.exe', args, { windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    const timer = setTimeout(() => { child.kill(); reject(safeError()); }, 10_000);
    child.stdin.on('error', () => { child.kill(); reject(safeError()); });
    const output = [];
    let total = 0;
    // Drain stderr even though its contents are never disclosed. A failing
    // PowerShell process must not block because its diagnostic pipe filled.
    child.stderr.resume();
    child.stdout.on('data', chunk => {
      total += chunk.length;
      if (total <= MAX_AUTH_BYTES * 2) output.push(chunk);
    });
    child.on('error', () => { clearTimeout(timer); reject(safeError()); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0 || total > MAX_AUTH_BYTES * 2) reject(safeError());
      else resolveResult(Buffer.concat(output).toString('utf8').trim());
    });
    child.stdin.end(input);
  });
}

const DPAPI_ENCRYPT = "$ErrorActionPreference='Stop';[void][Reflection.Assembly]::LoadWithPartialName('System.Security');$b=[Text.Encoding]::UTF8.GetBytes([Console]::In.ReadToEnd());$e=[Security.Cryptography.ProtectedData]::Protect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::Out.Write([Convert]::ToBase64String($e))";
const DPAPI_DECRYPT = "$ErrorActionPreference='Stop';[void][Reflection.Assembly]::LoadWithPartialName('System.Security');$b=[Convert]::FromBase64String([Console]::In.ReadToEnd());$p=[Security.Cryptography.ProtectedData]::Unprotect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::Out.Write([Text.Encoding]::UTF8.GetString($p))";

export const windowsDpapiCipher = Object.freeze({
  async encrypt(plain) { return runPowerShell(DPAPI_ENCRYPT, text(plain)); },
  async decrypt(ciphertext) { return runPowerShell(DPAPI_DECRYPT, text(ciphertext)); },
  encryptSync(plain) { return runPowerShell(DPAPI_ENCRYPT, text(plain), { sync: true }); },
  decryptSync(ciphertext) { return runPowerShell(DPAPI_DECRYPT, text(ciphertext), { sync: true }); },
});

function defaultFs() {
  return { readFile, writeFile, mkdir, rename, unlink };
}

export function createRobinhoodAuthStore({ authPath = DEFAULT_ROBINHOOD_AUTH_PATH, cipher = windowsDpapiCipher, fs = defaultFs(), fsSync = { existsSync, readFileSync, unlinkSync }, now = () => Date.now() } = {}) {
  const path = resolve(authPath);
  let cache;
  const unavailable = process.platform !== 'win32' && cipher === windowsDpapiCipher;

  async function load() {
    if (cache) return structuredClone(cache);
    if (unavailable) fail('robinhood_auth_unsupported_platform');
    let raw;
    try { raw = await fs.readFile(path); } catch (error) {
      if (error?.code === 'ENOENT') return emptyEnvelope();
      fail('robinhood_auth_read_failed');
    }
    if (asBytes(raw).length > MAX_AUTH_BYTES) fail('robinhood_auth_oversized');
    try {
      const plain = await cipher.decrypt(raw);
      const value = validateEnvelope(JSON.parse(text(plain)));
      cache = structuredClone(value);
      return structuredClone(value);
    } catch (error) {
      if (error instanceof RobinhoodAuthError) throw error;
      fail('robinhood_auth_invalid');
    }
  }

  async function save(value) {
    if (unavailable) fail('robinhood_auth_unsupported_platform');
    const envelope = validateEnvelope({ ...emptyEnvelope(), ...value });
    const plain = JSON.stringify(envelope);
    if (Buffer.byteLength(plain, 'utf8') > MAX_AUTH_BYTES / 2) fail('robinhood_auth_oversized');
    let encrypted;
    try { encrypted = asBytes(await cipher.encrypt(plain)); } catch (error) {
      if (error instanceof RobinhoodAuthError) throw error;
      fail('robinhood_auth_write_failed');
    }
    if (encrypted.length > MAX_AUTH_BYTES) fail('robinhood_auth_oversized');
    const temporary = `${path}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`;
    try {
      await fs.mkdir(dirname(path), { recursive: true });
      await fs.writeFile(temporary, encrypted, { mode: 0o600, flag: 'wx' });
      await fs.rename(temporary, path);
      cache = structuredClone(envelope);
    } catch (error) {
      try { await fs.unlink(temporary); } catch {}
      fail('robinhood_auth_write_failed');
    }
  }

  async function update(patch) {
    const current = await load();
    await save({ ...current, ...patch });
  }

  function inspectSync() {
    if (unavailable) return { state: 'unavailable', code: 'robinhood_auth_unsupported_platform' };
    let present;
    try { present = fsSync.existsSync(path); } catch { return { state: 'unavailable', code: 'robinhood_auth_unavailable' }; }
    if (!present) return { state: 'authentication_required', code: 'robinhood_auth_missing' };
    let envelope;
    try {
      if (cache) envelope = cache;
      else {
        const encrypted = fsSync.readFileSync(path);
        const plain = cipher.decryptSync ? cipher.decryptSync(encrypted) : null;
        if (plain === null) return { state: 'connected', code: 'robinhood_auth_present' };
        envelope = validateEnvelope(JSON.parse(text(plain)));
        cache = structuredClone(envelope);
      }
    } catch { return { state: 'unavailable', code: 'robinhood_auth_invalid' }; }
    const tokens = envelope.tokens;
    if (!tokens?.access_token && !tokens?.refresh_token) return { state: 'authentication_required', code: 'robinhood_auth_missing' };
    const expiresAt = Number(tokens.expires_at);
    if (tokens.access_token && (!Number.isFinite(expiresAt) || expiresAt > now())) return { state: 'connected', code: 'robinhood_auth_present' };
    if (tokens.refresh_token) return { state: 'connected', code: 'robinhood_auth_refreshable' };
    return { state: 'authentication_required', code: 'robinhood_auth_expired' };
  }

  return Object.freeze({
    path,
    load,
    save,
    update,
    inspectSync,
    async clear() {
      cache = undefined;
      try { await fs.unlink(path); } catch (error) { if (error?.code !== 'ENOENT') fail('robinhood_auth_remove_failed'); }
    },
    clearSync() {
      cache = undefined;
      try { fsSync.unlinkSync(path); } catch (error) { if (error?.code !== 'ENOENT') fail('robinhood_auth_remove_failed'); }
    },
  });
}

function tokenEnvelope(tokens, now) {
  if (!validObject(tokens) || typeof tokens.access_token !== 'string' || !tokens.access_token) fail('robinhood_auth_invalid');
  const result = { ...tokens };
  const expiresIn = Number(tokens.expires_in);
  if (Number.isFinite(expiresIn) && expiresIn > 0) result.expires_at = now() + expiresIn * 1000;
  return result;
}

export function createRobinhoodOAuthProvider({
  authStore,
  authPath,
  redirectUrl,
  onAuthorizationUrl,
  clientName = 'The Hub Spotlight',
  clientUri,
  now = () => Date.now(),
  randomState = () => randomBytes(24).toString('base64url'),
} = {}) {
  if (!redirectUrl) fail('robinhood_auth_redirect_required');
  const store = authStore || createRobinhoodAuthStore({ authPath, now });
  let stateValue;
  let authorizationUrl;
  let loaded;
  const metadata = Object.freeze({
    redirect_uris: [String(redirectUrl)],
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    client_name: clientName,
    ...(clientUri ? { client_uri: clientUri } : {}),
  });
  async function state() {
    stateValue ||= randomState();
    return stateValue;
  }
  async function read() {
    loaded ||= await store.load();
    return loaded;
  }
  async function patch(value) {
    const current = await read();
    loaded = { ...current, ...value };
    await store.save(loaded);
  }
  return {
    get redirectUrl() { return redirectUrl; },
    get clientMetadata() { return metadata; },
    clientInformation: async () => (await read()).clientInformation,
    saveClientInformation: info => patch({ clientInformation: info }),
    tokens: async () => (await read()).tokens,
    saveTokens: async tokens => patch({ tokens: tokenEnvelope(tokens, now) }),
    redirectToAuthorization: async url => {
      authorizationUrl = String(url);
      let destination;
      try { destination = new URL(authorizationUrl); } catch { fail('robinhood_auth_redirect_invalid'); }
      if (destination.protocol !== 'https:' || destination.port || destination.username || destination.password || !(['robinhood.com', 'agent.robinhood.com', 'api.robinhood.com'].includes(destination.hostname))) fail('robinhood_auth_redirect_refused');
      if (typeof onAuthorizationUrl === 'function') await onAuthorizationUrl(new URL(authorizationUrl));
    },
    saveCodeVerifier: verifier => patch({ codeVerifier: verifier }),
    codeVerifier: async () => {
      const value = (await read()).codeVerifier;
      if (!value) fail('robinhood_auth_code_verifier_missing');
      return value;
    },
    state,
    currentState: () => stateValue,
    authorizationUrl: () => authorizationUrl,
    saveDiscoveryState: value => patch({ discoveryState: value }),
    discoveryState: async () => (await read()).discoveryState,
    invalidateCredentials: async scope => {
      if (scope === 'all' || scope === 'tokens') await patch({ tokens: undefined });
      if (scope === 'all' || scope === 'client') await patch({ clientInformation: undefined });
      if (scope === 'all' || scope === 'verifier') await patch({ codeVerifier: undefined });
      if (scope === 'all' || scope === 'discovery') await patch({ discoveryState: undefined });
    },
  };
}

export function authStatusSync(options = {}) {
  const store = options.authStore || createRobinhoodAuthStore(options);
  return store.inspectSync();
}
