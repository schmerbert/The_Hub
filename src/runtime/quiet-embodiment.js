import { isSimpleEmbodiedAction } from './reasoning-posture.js';

export const QUIET_EMBODIMENT_LIMIT_CODE = 'quiet_embodiment_limit';
export const QUIET_EMBODIMENT_DEFAULT_ACTIONS = 4;

/**
 * Hearth rereading is a settled continuity affordance, not part of the
 * ordinary pre-speech movement horizon.  Keep the membership test here so
 * fitting and execution share one policy owner.
 */
export function isQuietEmbodimentAction(name) {
  return isSimpleEmbodiedAction(name) && name !== 'tend_hearth';
}

export function countQuietEmbodimentCalls(calls = []) {
  if (!Array.isArray(calls)) return 0;
  return calls.filter(call => isQuietEmbodimentAction(call?.function?.name)).length;
}

export function quietEmbodimentRemaining({ limit, attempted = 0 } = {}) {
  if (!Number.isInteger(limit) || limit < 0 || !Number.isInteger(attempted) || attempted < 0) return 0;
  return Math.max(limit - attempted, 0);
}

function bearingName(id) {
  const names = {
    'place.garden': 'Garden',
    'place.house': 'House',
    'place.forest': 'Forest',
    'place.threshold': 'Threshold',
    'room.center': 'Center',
    'room.workshop': 'Workshop',
    'room.spotlight': 'Spotlight Observatory',
  };
  return names[id] || String(id || 'unknown place');
}

function bearingContext(id) {
  const contexts = {
    'place.garden': 'the Forest threshold and open-air crossings',
    'place.house': 'the Hearth and domestic continuity',
    'place.threshold': 'threshold material and arrivals',
    'room.center': 'the Hub junction and installed rooms',
    'room.workshop': 'repository work and exact source inspection',
    'room.spotlight': 'sheltered observatory readings',
    'place.forest': 'walkable continuity terrain',
  };
  return contexts[id] || 'its installed local context';
}

function placeBearings(projection) {
  const candidates = [
    ...(Array.isArray(projection?.exits) ? projection.exits : []),
    ...(Array.isArray(projection?.passages) ? projection.passages : []),
    ...(Array.isArray(projection?.boundaries) ? projection.boundaries : []),
  ];
  const seen = new Set();
  return candidates.flatMap(edge => {
    const id = edge?.to;
    if (!id || seen.has(id) || id === projection?.roomId) return [];
    seen.add(id);
    return [`${bearingName(id)} may hold ${bearingContext(id)}`];
  });
}

/**
 * This is a short optional invitation, not a router.  The bearings are
 * derived from the verified World projection and deliberately make no claim
 * that a destination is relevant to the human's message.
 */
export function renderQuietEmbodimentHorizon({ remaining = 0, projection = null, finalOpportunity = false } = {}) {
  const available = Number.isInteger(remaining) && remaining > 0 ? remaining : 0;
  const preamble = finalOpportunity
    ? 'Quiet embodiment is complete for this wake; stay and speak now.'
    : 'Quiet embodiment is optional: you may stay and speak now, or quietly move, look, or gather what is relevant before speaking.';
  const budget = finalOpportunity
    ? 'The reserved final response is now available.'
    : available
      ? `Up to ${available} simple embodied action${available === 1 ? '' : 's'} remain${available === 1 ? 's' : ''}.`
      : 'No further simple embodied actions remain in this wake.';
  const bearings = placeBearings(projection);
  const bearingText = bearings.length
    ? `Place bearings are possibilities, not relevance judgments: ${bearings.join('; ')}.`
    : 'No additional place bearings are presently fitted.';
  return `${preamble} ${budget} ${bearingText}`;
}

export function quietEmbodimentLimitError() {
  return {
    code: QUIET_EMBODIMENT_LIMIT_CODE,
    message: 'The quiet embodied-action horizon is spent; this simple embodied action was refused before World mutation.',
  };
}
