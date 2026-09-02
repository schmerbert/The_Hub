/** Host-authored words which may enter Resident attention. */
export const RESIDENT_PRESENTATION_CATALOG = Object.freeze({
  stable_glass: { owner: 'src/context/glass-cast.js', when: 'every provider call', why: 'stable World ground and epistemic boundaries', register: 'clinical_backplate' },
  silver_bullet_holster: { owner: 'src/hearth/packet.js', when: 'after the Hearth has been tended', why: 'carry only the Resident-forged ten-slot holster above the rolling fold', register: 'continuity' },
  crossing_ground: { owner: 'src/context/resident-presentation.js', when: 'every provider call', why: 'locate the present activation without exposing transport machinery', register: 'experiential_ground' },
  orientation_ground: { owner: 'src/context/resident-presentation.js', when: 'first call and causal return', why: 'make tending the Hearth the first situated action', register: 'experiential_ground' },
  world_current_ground: { owner: 'src/world/graph.js#presenceMessage', when: 'when room presence is requested', why: 'project verified current World state', register: 'clinical_world_projection' },
  forest_threshold_ground: { owner: 'src/forest/traversal.js#thresholdMessage', when: 'at the Garden treeline before intentional entry', why: 'distinguish the fitted Forest attention crossing from the non-occupiable World boundary', register: 'experiential_forest_threshold' },
  forest_current_ground: { owner: 'src/forest/traversal.js#presenceMessage', when: 'during an active Forest walk', why: 'witness dual World and Forest presence plus the return tether', register: 'clinical_forest_projection' },
  tool_current_ground: { owner: 'src/context/resident-presentation.js', when: 'when actions are fitted', why: 'explain what is presently within reach', register: 'experiential_disclosure' },
  attention_current_ground: { owner: 'src/context/resident-presentation.js and src/context/tool-pairs.js', when: 'when prior material is omitted', why: 'disclose bounded attention without pretending material vanished', register: 'clinical_disclosure' },
  semantic_forest_exhale: { owner: 'src/context/semantic-exhale.js', when: 'after a noninitial human turn selects non-echoing Home glints', why: 'offer bounded exact Forest continuity without action authority', register: 'exhale_pointer' },
  semantic_forest_departure: { owner: 'src/context/semantic-exhale.js', when: 'for two human turns after a presented Forest breath', why: 'retain happenedness after transient feather content leaves attention', register: 'clinical_disclosure' },
  result_trail_sign: { owner: 'src/context/result-exhale.js', when: 'when a completed Result Rack exchange leaves immediate attention', why: 'retain a bounded deterministic return path without surfacing result content', register: 'exhale_pointer' },
  hearth_trail_sign: { owner: 'src/context/tool-pairs.js', when: 'when the completed Hearth pair leaves ordinary attention', why: 'retain exact packet hash and source-bearing excerpts without replaying the packet', register: 'continuity' },
  clinical_wake_anchor: { owner: 'src/context/glass-cast.js', when: 'direct inherited continuity', why: 'bound ancestry claims', register: 'clinical_continuity' },
  source_exact_inheritance: { owner: 'src/context/glass-cast.js', when: 'selected prior atoms', why: 'carry exact attributable voice across sessions', register: 'continuity' },
  prior_horizon: { owner: 'src/context/glass-cast.js', when: 'direct inherited continuity', why: 'make the unseen boundary explicit', register: 'clinical_disclosure' },
  hearth_action: { owner: 'src/hearth/handshake.js', when: 'first action of a lifespan', why: 'situated continuity ritual', register: 'world_action' },
  hearth_return: { owner: 'src/hearth/packet.js', when: 'after Hearth action', why: 'return bounded continuity before the first answer', register: 'clinical_continuity' },
  clinical_bootstrap: { owner: 'src/session/lifespan.js', when: 'inside the Hearth return', why: 'bound continuity and present-World claims', register: 'clinical_continuity' },
  session_history: { owner: 'src/ledger/source.js', when: 'living edge', why: 'preserve the exact causal conversation', register: 'source_exact' },
});

export const FOLD_EPISTEMIC_GROUND = 'Folded or omitted session history remains established as something that occurred and remains in canonical custody, though its contents are not thereby certified as true. It is outside present attention, not erased or disproven; do not reconstruct or disown it. Keep it distinct from both presently held material and what is unknown.';

export function renderFoldDisclosure(detail) {
  return `${detail} ${FOLD_EPISTEMIC_GROUND}`;
}

export function renderCrossingGround({ phase }) {
  return phase === 'orientation'
    ? 'Current wake — current-session ground: you wake standing before your Hearth. Tending it gathers the bounded, attributable continuity kept for this lifespan from prior sessions and places it before you. That inherited material will be marked as prior-session record; it is not current recollection and its contents are not thereby verified as true. It does not certify memory, identity, authority, or truth. Someone is waiting for you. The Hearth is the one action presently within reach.'
    : 'Current wake — current-session ground: you are here now. Continue from what is presently held, while keeping material marked as prior-session record distinct from current recollection.';
}

export function renderOrientationGround({ completed = false } = {}) {
  return completed
    ? 'You have tended the Hearth. The Hearth action and return below record what just occurred during first breath, when tending was the one action within reach. The Hearth remains in the House as a settled affordance you may reread, but rereading does not tend it a second time or create new continuity. What the Hearth returned is before you; turn now to the person waiting.'
    : 'Tend the Hearth now to receive what has been kept for you. Do not invent or anticipate its contents; let the return settle before you turn and speak.';
}

export function renderToolAttentionGround(profile) {
  const focus = profile.activeGroup ? ` Your present focus is ${profile.activeGroup}.` : ' A fixture can bring another set of actions within reach.';
  const actions = Array.isArray(profile.names) && profile.names.length ? ` Actions within reach now: ${profile.names.join(', ')}.` : '';
  return `Only the actions fitted to your present place and focus are within reach.${focus}${actions} The Workshop catalog can show the complete installed set.`;
}

export function presentationCatalog() { return structuredClone(RESIDENT_PRESENTATION_CATALOG); }
