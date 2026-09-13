// Canonical public surface for the production Spotlight observatory shell.
export { SPOTLIGHT } from './declaration.js';
export { SPOTLIGHT_FIXTURE_IDS, assertValidSpotlightManifest, loadSpotlightManifest, validateSpotlightManifest } from './manifest.js';
export {
  SPOTLIGHT_OBSERVATION_API,
  SPOTLIGHT_OBSERVATION_KIND,
  SpotlightObservationError,
  admitSpotlightObservation,
  createSpotlightObservationValidator,
  validateSpotlightObservation,
} from './observation.js';
export { SPOTLIGHT_PACKET_API, loadSpotlightReplayFixture, replayFirstSpotlight, runSpotlightReplay } from './replay.js';
export {
  SPOTLIGHT_GATE_API,
  SPOTLIGHT_ACTIVATION_LAW,
  SPOTLIGHT_CAPABILITY_MATRIX,
  SpotlightCapabilityService,
  createSpotlightCapabilityService,
  defaultSpotlightCapabilityMatrix,
} from './gate.js';
export { SPOTLIGHT_TOOLS, SPOTLIGHT_TOOL_NAMES, SPOTLIGHT_TOOL_APPROVAL_CLASS } from './tools.js';
export {
  ROBINHOOD_READ_OPERATIONS,
  ROBINHOOD_READ_OPERATION_NAMES,
  RobinhoodReadAdapter,
  RobinhoodReadAdapterError,
  SPOTLIGHT_ROBINHOOD_ADAPTER_API,
  SPOTLIGHT_ROBINHOOD_SOURCE_AUTHORITY,
  createRobinhoodReadAdapter,
} from './robinhood.js';

export const SPOTLIGHT_PACKAGE_VERSION = '1.2.0';

// Optional live binding; exporting constructors never installs a connection.
export { SpotlightObservationStore, SPOTLIGHT_OBSERVATION_STORE_API } from './observation-store.js';
export { SpotlightLiveReadService, createSpotlightLiveService, SPOTLIGHT_LIVE_READ_API } from './live-service.js';
export { renderSpotlightReadGround } from './presentation.js';
