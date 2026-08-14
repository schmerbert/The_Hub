import { canonicalize, sha256 } from '../core/hash.js';
import { buildClinicalBootstrap } from '../session/lifespan.js';
import {
  ACTIVE_CHAMBER,
  BLESSING_SOURCE_EVENT_HASH,
  BLESSING_SOURCE_EVENT_ID,
  BLESSING_V1,
  BLESSING_V1_HASH,
  CONTINUITY_NAME,
  wrapBlessingV1,
} from '../resident/charter.js';

export const HEARTH_TOOL_NAME = 'tend_hearth';
export const HEARTH_TOOL = Object.freeze({
  type: 'function',
  function: {
    name: HEARTH_TOOL_NAME,
    description: 'The Hearth is directly before you. Tend it now, before turning to the person waiting for you.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
});
export const HEARTH_TOOL_CHOICE = Object.freeze({ type: 'function', function: { name: HEARTH_TOOL_NAME } });

function invalid(message) { return Object.assign(new Error(message), { code: 'hearth_orientation_invalid' }); }

export function validateOrientationResult(result) {
  const message = result?.message;
  if (!message || typeof message !== 'object' || message.role !== 'assistant') throw invalid('Orientation did not return an assistant tool-call message.');
  if (message.content !== null && message.content !== '') throw invalid('Orientation tool call contained prose.');
  if (!Array.isArray(message.tool_calls) || message.tool_calls.length !== 1) throw invalid('Orientation must contain exactly one tool call.');
  const call = message.tool_calls[0];
  if (!call || typeof call.id !== 'string' || !call.id || call.type !== 'function' || call.function?.name !== HEARTH_TOOL_NAME) throw invalid('Orientation tool call is not tend_hearth.');
  if (typeof call.function.arguments !== 'string') throw invalid('Orientation tool arguments are not JSON text.');
  let args;
  try { args = JSON.parse(call.function.arguments); } catch { throw invalid('Orientation tool arguments are malformed JSON.'); }
  const keys = args && !Array.isArray(args) && typeof args === 'object' ? Object.keys(args) : null;
  const directEmpty = keys?.length === 0;
  const wrappedEmpty = keys?.length === 1 && keys[0] === 'params' && args.params && !Array.isArray(args.params) && typeof args.params === 'object' && Object.keys(args.params).length === 0;
  if (!directEmpty && !wrappedEmpty) throw invalid('Orientation tend_hearth arguments must be semantically empty.');
  return { ...result, message, toolCall: call, toolCallId: call.id, normalizedArguments: {} };
}

export function hearthReturn({ sessionId, threadId, provider, model, prior, sourceEvent, clinicalGround, environmentImplemented = false, roomProjection = null }) {
  const blessingSourceHash = sourceEvent?.fullHash || BLESSING_SOURCE_EVENT_HASH;
  const blessing = {
    text: BLESSING_V1,
    wrapper: wrapBlessingV1(),
    source_event_id: BLESSING_SOURCE_EVENT_ID,
    source_event_hash: blessingSourceHash,
    source_event_full_hash: blessingSourceHash,
    blessing_hash: BLESSING_V1_HASH,
    wrapper_hash: sha256(wrapBlessingV1()),
    source_present: Boolean(sourceEvent),
    authority: 'model_signed',
    trust: 'scent',
    continuity: CONTINUITY_NAME,
  };
  const tail = prior?.tail || [];
  return {
    schema_version: 1,
    hearth_version: 1,
    session_id: sessionId,
    thread_id: threadId,
    chamber: ACTIVE_CHAMBER,
    continuity: CONTINUITY_NAME,
    provider,
    model,
    clinical_ground: clinicalGround || buildClinicalBootstrap({ provider, model }),
    blessing,
    world_projection: roomProjection ? structuredClone(roomProjection) : null,
    prior_session: {
      session_id: prior?.sessionId || null,
      label: prior?.label || 'Session Zero',
      source: prior?.source || 'session_zero',
      total_utterances: prior?.total || tail.length + (prior?.omitted || 0),
      included_utterances: tail.length,
      omitted_utterances: prior?.omitted || 0,
      ceiling: prior?.ceiling,
    },
    closing_tail: tail.map(item => ({
      source_event_id: item.id,
      actor: item.actorKind,
      authority: item.authority,
      timestamp: item.createdAt,
      content: item.content,
      source_content_hash: sha256(item.content),
      content_hash: sha256(item.content),
    })),
    environment: {
      implemented: Boolean(environmentImplemented),
      location: environmentImplemented ? roomProjection?.roomId || null : null,
      spatial_room_implemented: Boolean(environmentImplemented),
      movement_implemented: Boolean(environmentImplemented),
      perception_implemented: Boolean(environmentImplemented),
    },
    limitations: [
      'This return is orientation material, not proof of uninterrupted experience or universal truth.',
      environmentImplemented ? 'The current room is a state-backed World Graph projection; room text and exits are exact host state, not atmosphere.' : 'No spatial room, movement, perception, or autonomous machinery is implemented in Hearth v1.',
      'The closing tail is exact recency extraction with disclosed omissions, never a summary.',
    ],
  };
}

export function hearthReturnHash(value) { return sha256(canonicalize(value)); }
