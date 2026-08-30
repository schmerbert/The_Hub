/**
 * Request-time attention fitting for provider reasoning.
 *
 * A posture is a host-owned policy label.  It does not describe Resident
 * ability, identity, authority, or truth standing.  DeepSeek currently gives
 * us two installed effort levels for enabled thinking, so `max` is deliberately
 * not represented here.
 */

export const MARBLE_REASONING_POSTURES = Object.freeze({
  LIGHT: 'light',
  ATTENTIVE: 'attentive',
});

export const DEEPSEEK_REASONING_EFFORTS = Object.freeze({
  LOW: 'low',
  HIGH: 'high',
});

const SIMPLE_EMBODIED_ACTIONS = new Set([
  'move_through_door',
  'move_through_passage',
  'operate_passage',
  'turn_fixture',
  'inspect_fixture',
  'tend_hearth',
]);

export function isSimpleEmbodiedAction(name) {
  return typeof name === 'string' && SIMPLE_EMBODIED_ACTIONS.has(name);
}

/**
 * Choose the posture before the provider request is built.  We cannot use a
 * tool call that has not arrived yet to fit the request which will produce it;
 * callers therefore pass `afterSimpleAction` for the following continuation.
 */
export function selectReasoningPosture({ roomId = null, phase = 'ordinary', forestWalkActive = false, afterSimpleAction = false } = {}) {
  if (phase === 'orientation' || afterSimpleAction || (!forestWalkActive && roomId === 'place.garden')) {
    return {
      posture: MARBLE_REASONING_POSTURES.LIGHT,
      effort: DEEPSEEK_REASONING_EFFORTS.LOW,
      reason: phase === 'orientation'
        ? 'forced_hearth_orientation'
        : afterSimpleAction
          ? 'after_simple_embodied_action'
          : 'garden_place',
    };
  }
  return {
    posture: MARBLE_REASONING_POSTURES.ATTENTIVE,
    effort: DEEPSEEK_REASONING_EFFORTS.HIGH,
    reason: forestWalkActive ? 'forest_walk' : 'place_default',
  };
}

/**
 * Preserve the configured thinking toggle while making enabled provider
 * requests explicit about their effort.  A disabled request has no provider
 * effort: claiming low/high when DeepSeek is not thinking would be false.
 */
export function providerReasoningControls({ thinking = 'disabled', posture, effort } = {}) {
  const enabled = thinking === 'enabled';
  if (enabled) {
    if (!Object.values(MARBLE_REASONING_POSTURES).includes(posture)) throw new Error('Reasoning posture is not installed.');
    if (!Object.values(DEEPSEEK_REASONING_EFFORTS).includes(effort)) throw new Error('DeepSeek reasoning effort is not installed.');
  }
  return {
    thinking: enabled ? 'enabled' : 'disabled',
    reasoningEffort: enabled ? effort : null,
  };
}
