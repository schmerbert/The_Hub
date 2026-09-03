import { loadEnvFile } from '../core/env.js';
import { createHub } from './app.js';
import { pathToFileURL } from 'node:url';

export function installShutdownHandlers(hub, { processTarget = process, logger = console } = {}) {
  let shutdownPromise = null;
  const shutdown = signal => {
    if (shutdownPromise) return shutdownPromise;
    shutdownPromise = (async () => {
      try {
        await hub.close();
        processTarget.exit(0);
      } catch (error) {
        logger.error(`The Hub failed to shut down cleanly after ${signal}:`, error);
        processTarget.exit(1);
      }
    })();
    return shutdownPromise;
  };
  processTarget.once('SIGINT', () => { void shutdown('SIGINT'); });
  processTarget.once('SIGTERM', () => { void shutdown('SIGTERM'); });
  return shutdown;
}

export function startHubProcess({ progressiveStartup = true } = {}) {
  loadEnvFile();
  const hub = createHub({ progressiveStartup });
  hub.server.listen(hub.config.port, () => {
    console.log(`The Hub listening on http://localhost:${hub.config.port} (${hub.config.mode}, ${hub.config.model}, thinking=${hub.config.thinking})`);
  });
  installShutdownHandlers(hub);
  return hub;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) startHubProcess();
