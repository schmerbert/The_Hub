import { createHub } from '../server/app.js';

export const DESKTOP_LOOPBACK_HOST = '127.0.0.1';

function listen(server, port) {
  return new Promise((resolve, reject) => {
    const onError = error => { server.off('listening', onListening); reject(error); };
    const onListening = () => { server.off('error', onError); resolve(); };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, DESKTOP_LOOPBACK_HOST);
  });
}

export async function startDesktopHost({ env = process.env, createHubFactory = createHub, progressiveStartup = true } = {}) {
  const hub = createHubFactory({ env: { ...env }, progressiveStartup });
  try {
    await listen(hub.server, hub.config.port);
  } catch (error) {
    try { await hub.close(); } catch {}
    throw error;
  }
  const address = hub.server.address();
  if (!address || typeof address === 'string') {
    await hub.close();
    throw new Error('The desktop Hub did not expose a loopback TCP address.');
  }
  const url = `http://${DESKTOP_LOOPBACK_HOST}:${address.port}`;
  return { hub, url, close: () => hub.close() };
}
