import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startDesktopHost } from '../src/corner/desktop-host.js';

test('desktop host listens on loopback only after Hub creation and awaits idempotent shutdown', async () => {
  const runtime = await mkdtemp(join(tmpdir(), 'hub-corner-desktop-'));
  let desktop;
  try {
    desktop = await startDesktopHost({ env: { HUB_RESIDENT_MODE: 'fake', HUB_PORT: '0', HUB_RUNTIME_ROOT: runtime } });
    const address = desktop.hub.server.address();
    assert.equal(address.address, '127.0.0.1');
    assert.equal(desktop.url, `http://127.0.0.1:${address.port}`);
    const health = await fetch(`${desktop.url}/api/health`).then(response => response.json());
    assert.equal(health.ok, true);
    assert.equal(health.residentMode, 'fake');
    const page = await fetch(`${desktop.url}/`).then(response => response.text());
    assert.match(page, /The Hub/);
    const first = desktop.close();
    const second = desktop.close();
    assert.equal(first, second);
    await first;
    assert.equal(desktop.hub.server.listening, false);
  } finally {
    if (desktop?.hub.server.listening) await desktop.close().catch(() => {});
    await rm(runtime, { recursive: true, force: true });
  }
});

test('desktop host closes Hub custody if loopback listen fails', async () => {
  let closed = 0;
  const error = Object.assign(new Error('occupied'), { code: 'EADDRINUSE' });
  const fakeHub = {
    config: { port: 3000 },
    server: {
      once(name, handler) { if (name === 'error') this.errorHandler = handler; if (name === 'listening') this.listeningHandler = handler; },
      off() {},
      listen() { this.errorHandler(error); },
    },
    async close() { closed += 1; },
  };
  await assert.rejects(startDesktopHost({ createHubFactory: () => fakeHub }), candidate => candidate === error);
  assert.equal(closed, 1);
});
