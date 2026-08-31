import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  decideApproval,
  getActiveThread,
  getApprovals,
  getEventHistory,
  getHealth,
  getWake,
  getWakeSlips,
  getWorld,
  request,
  submitWake,
} from '../public/corner-api.js';

async function withFetch(handler, callback) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = handler;
  try { return await callback(); }
  finally { globalThis.fetch = originalFetch; }
}

test('Corner renderer delegates HTTP transport while retaining live stream ownership', async () => {
  const [app, api] = await Promise.all([
    readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/corner-api.js', import.meta.url), 'utf8'),
  ]);
  assert.match(app, /from '\.\/corner-api\.js'/);
  assert.doesNotMatch(app, /\bfetch\s*\(/);
  assert.doesNotMatch(app, /function request\(/);
  assert.match(api, /fetch\(path, options\)/);
  assert.doesNotMatch(api, /EventSource/);
});

test('Corner API preserves same-origin endpoint paths and request shapes', async () => {
  const calls = [];
  await withFetch(async (path, options) => {
    calls.push({ path, options });
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  }, async () => {
    await getWorld();
    await getApprovals();
    await getWake('wake/one?two');
    await getHealth();
    await getActiveThread();
    await getWakeSlips('wake/slips');
    await getEventHistory(12, 1000);
    await decideApproval('approval/one?two', 'confirm');
    await submitWake('  preserve exact text  ');
  });

  assert.deepEqual(calls.map(call => [call.path, call.options?.method || 'GET']), [
    ['/api/world', 'GET'],
    ['/api/approvals', 'GET'],
    ['/api/wakes/wake%2Fone%3Ftwo', 'GET'],
    ['/api/health', 'GET'],
    ['/api/thread?scope=active', 'GET'],
    ['/api/wakes/wake%2Fslips/slips', 'GET'],
    ['/api/events/history?after=12&limit=1000', 'GET'],
    ['/api/approvals/approval%2Fone%3Ftwo/decide', 'POST'],
    ['/api/wakes?projection=compact', 'POST'],
  ]);
  assert.deepEqual(calls[7].options.headers, { 'content-type': 'application/json' });
  assert.deepEqual(JSON.parse(calls[7].options.body), { decision: 'confirm' });
  assert.deepEqual(calls[8].options.headers, { 'content-type': 'application/json' });
  assert.deepEqual(JSON.parse(calls[8].options.body), { content: '  preserve exact text  ' });
});

test('Corner API translates malformed and failed host responses without changing failure codes', async () => {
  await withFetch(async () => new Response('not json', { status: 503 }), async () => {
    await assert.rejects(request('/api/health'), error => {
      assert.deepEqual(error, { code: 'host_unavailable', message: 'Host returned HTTP 503.' });
      return true;
    });
  });

  await withFetch(async () => new Response(JSON.stringify({ failureCode: 'provider_http_error', failureMessage: 'provider refused' }), { status: 502 }), async () => {
    assert.deepEqual(await request('/api/wakes?projection=compact'), {
      failureCode: 'provider_http_error', failureMessage: 'provider refused', __failedWake: true,
    });
  });

  await withFetch(async () => new Response(JSON.stringify({ error: { code: 'world_projection_drift', message: 'drift' } }), { status: 409 }), async () => {
    await assert.rejects(request('/api/world'), error => {
      assert.deepEqual(error, { code: 'world_projection_drift', message: 'drift' });
      return true;
    });
  });
});
