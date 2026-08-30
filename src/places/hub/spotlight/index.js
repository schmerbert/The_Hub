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

export const SPOTLIGHT_PACKAGE_VERSION = 1;
