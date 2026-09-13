import { createRobinhoodConnection } from '../connectors/robinhood/connection.js';
import { SpotlightObservationStore } from '../places/hub/spotlight/observation-store.js';
import { createSpotlightLiveService } from '../places/hub/spotlight/live-service.js';
import { createSpotlightCapabilityService } from '../places/hub/spotlight/gate.js';

function unavailable(code, state = 'unavailable') {
  const capped = createSpotlightCapabilityService();
  const status = () => ({ ...capped.status(), connection: { state, code }, custody: { state: 'unavailable', schemaVersion: 1 } });
  return {
    status,
    invoke: (name, args, context) => name === 'spotlight_capability_status' ? status() : capped.invoke(name, args, context),
    close: () => {},
  };
}

/** Optional composition only; credentials, observation law and SQL stay with their owners. */
export function createSpotlightRuntime({ config, source: injectedSource } = {}) {
  if (!config.spotlightEnabled) return unavailable('spotlight_not_enabled', 'inactive');
  if (config.mode !== 'live' && !injectedSource) return unavailable('spotlight_live_mode_required');
  let store;
  let source;
  try {
    store = new SpotlightObservationStore(config.spotlightObservationPath);
    source = injectedSource || createRobinhoodConnection({ authPath: config.spotlightAuthPath });
    return createSpotlightLiveService({ source, store });
  } catch {
    store?.close();
    Promise.resolve(source?.close()).catch(() => {});
    return unavailable('spotlight_initialization_failed');
  }
}
