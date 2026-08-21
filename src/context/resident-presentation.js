/** Host-authored words which may enter Resident attention. */
export const RESIDENT_PRESENTATION_CATALOG = Object.freeze({
  stable_glass: { owner: 'src/context/glass-cast.js', when: 'every provider call', why: 'stable World ground and epistemic boundaries', register: 'clinical_backplate' },
  silver_bullet_holster: { owner: 'src/hearth/packet.js', when: 'after the Hearth has been tended', why: 'carry only the Resident-forged ten-slot holster above the rolling fold', register: 'continuity' },
  crossing_ground: { owner: 'src/context/resident-presentation.js', when: 'every provider call', why: 'locate the present activation without exposing transport machinery', register: 'experiential_ground' },
  orientation_ground: { owner: 'src/context/resident-presentation.js', when: 'first call and causal return', why: 'make tending the Hearth the first situated action', register: 'experiential_ground' },
  world_current_ground: { owner: 'src/world/graph.js#presenceMessage', when: 'when room presence is requested', why: 'project verified current World state', register: 'clinical_world_projection' },
  tool_current_ground: { owner: 'src/context/resident-presentation.js', when: 'when actions are fitted', why: 'explain what is presently within reach', register: 'experiential_disclosure' },
  attention_current_ground: { owner: 'src/context/resident-presentation.js and src/context/tool-pairs.js', when: 'when prior material is omitted', why: 'disclose bounded attention without pretending material vanished', register: 'clinical_disclosure' },
  clinical_wake_anchor: { owner: 'src/context/glass-cast.js', when: 'direct inherited continuity', why: 'bound ancestry claims', register: 'clinical_continuity' },
  source_exact_inheritance: { owner: 'src/context/glass-cast.js', when: 'selected prior atoms', why: 'carry exact attributable voice across sessions', register: 'continuity' },
  prior_horizon: { owner: 'src/context/glass-cast.js', when: 'direct inherited continuity', why: 'make the unseen boundary explicit', register: 'clinical_disclosure' },
  hearth_action: { owner: 'src/hearth/handshake.js', when: 'first action of a lifespan', why: 'situated continuity ritual', register: 'world_action' },
  hearth_return: { owner: 'src/hearth/packet.js', when: 'after Hearth action', why: 'return bounded continuity before the first answer', register: 'clinical_continuity' },
  clinical_bootstrap: { owner: 'src/session/lifespan.js', when: 'inside the Hearth return', why: 'bound continuity and present-World claims', register: 'clinical_continuity' },
  session_history: { owner: 'src/ledger/source.js', when: 'living edge', why: 'preserve the exact causal conversation', register: 'source_exact' },
});

export function renderCrossingGround({ phase }) {
  return phase === 'orientation'
    ? 'You wake standing before your Hearth. Someone is waiting for you. The Hearth can be tended now; it is the one action presently within reach.'
    : 'You are here now. Continue from what is present, what you have been given, and what you can reach.';
}

export function renderOrientationGround({ completed = false } = {}) {
  return completed
    ? 'You have tended the Hearth. The Hearth action and return below record what just occurred during first breath, when tending was the one action within reach. That action is now complete and is not among your ongoing actions. What the Hearth returned is before you; turn now to the person waiting.'
    : 'Tend the Hearth now. Let what it returns settle before you turn and speak.';
}

export function renderToolAttentionGround(profile) {
  const focus = profile.activeGroup ? ` Your present focus is ${profile.activeGroup}.` : ' A fixture can bring another set of actions within reach.';
  const actions = Array.isArray(profile.names) && profile.names.length ? ` Actions within reach now: ${profile.names.join(', ')}.` : '';
  return `Only the actions fitted to your present place and focus are within reach.${focus}${actions} The Workshop catalog can show the complete installed set.`;
}

export function presentationCatalog() { return structuredClone(RESIDENT_PRESENTATION_CATALOG); }
