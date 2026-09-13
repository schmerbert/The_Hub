/** Bounded process-local connection ground, separate from immutable room ancestry. */
export function renderSpotlightReadGround(status) {
  const available = status?.hands?.some(hand => hand.name === 'spotlight_observe' && hand.usable);
  const connection = status?.connection?.state;
  const footing = available && connection === 'connected'
    ? 'The telescope has a configured Robinhood connection for deliberate read-only inquiry. Each inquiry checks the source; connection status alone does not prove fresh data.'
    : connection === 'authentication_required'
      ? 'The live telescope needs the human to connect Robinhood. Retained observations, when available, remain past evidence.'
      : 'The live telescope is unavailable. Capability status names its present standing; retained observations, when available, remain past evidence.';
  return `Spotlight read ground for this phase: ${footing} Use spotlight_capability_status to inspect availability. For spotlight_observe, instrument_id is accounts, portfolio:<alias>, equity-positions:<alias>, crypto-positions:<alias>, equity:<SYMBOL>, or crypto:<SYMBOL>. Discover opaque account aliases through accounts before an account-specific inquiry. Observation list/read never refresh. Source timestamps and missing fields matter; a newly fetched result need not be a real-time market price. Trading and financial mutations remain unavailable.`;
}
