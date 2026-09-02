function fail(code, message) { throw Object.assign(new Error(message), { code }); }
function outcome(result) { return { result, source: null, changedRoom: false }; }

function invoke(spotlight, name, context) {
  if (!spotlight || typeof spotlight.invoke !== 'function') {
    return outcome({
      kind: 'spotlight_hand_result',
      apiVersion: 'spotlight-capability-gate.v1',
      roomId: 'room.spotlight',
      toolName: name,
      status: 'withheld',
      availability: 'unavailable',
      reason: 'missing_requirements',
      missingRequirements: [{ id: 'law.spotlight_hands_activation', kind: 'law', state: 'optional_unwired', ready: false }],
      missing: ['law.spotlight_hands_activation'],
      attempted: false,
      network: false,
      mutated: false,
      approvalCreated: false,
    });
  }
  // Gated hand arguments are intentionally not forwarded until a room-owned
  // adapter, validator, and custody law are adopted together.  This ensures a
  // withheld call cannot echo hostile or unbounded provider input.
  return outcome(spotlight.invoke(name, {}, context));
}

export const SPOTLIGHT_HANDLERS = Object.freeze({
  spotlight_capability_status: ({ spotlight, args }) => {
    if (Object.keys(args || {}).length) fail('spotlight_invalid_argument', 'Spotlight capability status accepts no arguments.');
    return outcome(spotlight.status());
  },
  spotlight_observation_list: ({ spotlight, ...context }) => invoke(spotlight, 'spotlight_observation_list', context),
  spotlight_observation_read: ({ spotlight, ...context }) => invoke(spotlight, 'spotlight_observation_read', context),
  spotlight_observe: ({ spotlight, ...context }) => invoke(spotlight, 'spotlight_observe', context),
  spotlight_packet_build: ({ spotlight, ...context }) => invoke(spotlight, 'spotlight_packet_build', context),
  spotlight_replay: ({ spotlight, ...context }) => invoke(spotlight, 'spotlight_replay', context),
  spotlight_trade_propose: ({ spotlight, ...context }) => invoke(spotlight, 'spotlight_trade_propose', context),
  spotlight_trade_execute: ({ spotlight, ...context }) => invoke(spotlight, 'spotlight_trade_execute', context),
  spotlight_ring_propose: ({ spotlight, ...context }) => invoke(spotlight, 'spotlight_ring_propose', context),
  spotlight_ring_adjust: ({ spotlight, ...context }) => invoke(spotlight, 'spotlight_ring_adjust', context),
});
