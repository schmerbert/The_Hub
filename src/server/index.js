import { createHub } from './app.js';

const hub = createHub();
hub.server.listen(hub.config.port, () => {
  console.log(`The Hub listening on http://localhost:${hub.config.port} (${hub.config.mode}, ${hub.config.model})`);
});
process.on('SIGINT', () => { hub.close(); process.exit(0); });
process.on('SIGTERM', () => { hub.close(); process.exit(0); });
