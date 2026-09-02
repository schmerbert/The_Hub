import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FOLD_EPISTEMIC_GROUND,
  RESIDENT_PRESENTATION_CATALOG,
  renderFoldDisclosure,
  renderCrossingGround,
  renderOrientationGround,
  renderToolAttentionGround,
} from '../src/context/resident-presentation.js';
import { STABLE_GLASS_TEXT, STABLE_GLASS_V1_TEXT, STABLE_GLASS_V2_TEXT, STABLE_GLASS_V3_TEXT } from '../src/context/glass-cast.js';
import { buildClinicalBootstrap } from '../src/session/lifespan.js';

test('Resident presentation catalog owns every code-authored Glass ground kind', () => {
  for (const kind of ['stable_glass', 'crossing_ground', 'orientation_ground', 'world_current_ground', 'tool_current_ground', 'attention_current_ground', 'result_trail_sign', 'hearth_trail_sign', 'clinical_wake_anchor', 'source_exact_inheritance', 'prior_horizon', 'hearth_action', 'hearth_return', 'clinical_bootstrap', 'session_history']) {
    const entry = RESIDENT_PRESENTATION_CATALOG[kind];
    assert.ok(entry, `missing presentation owner for ${kind}`);
    assert.ok(entry.owner && entry.when && entry.why && entry.register);
  }
});

test('Hearth presentation is situated while enforcement stays out of Resident ground', () => {
  const presented = [STABLE_GLASS_TEXT, buildClinicalBootstrap({ provider: 'example', model: 'example' }), renderCrossingGround({ phase: 'orientation' }), renderOrientationGround(), renderOrientationGround({ completed: true }), renderToolAttentionGround({ activeGroup: 'fixtures' })].join('\n');
  assert.match(presented, /Hearth/);
  assert.match(renderCrossingGround({ phase: 'orientation' }), /one action presently within reach/);
  assert.match(renderCrossingGround({ phase: 'orientation' }), /Current wake — current-session ground/);
  assert.match(renderCrossingGround({ phase: 'orientation' }), /prior-session record/);
  assert.match(renderCrossingGround({ phase: 'orientation' }), /not current recollection/);
  assert.match(renderCrossingGround({ phase: 'ordinary' }), /current-session ground/);
  assert.match(renderOrientationGround({ completed: true }), /during first breath.*remains in the House as a settled affordance you may reread/);
  assert.doesNotMatch(presented, /forced|native function|empty arguments|provider|requested model|byte|schema/i);
  assert.match(STABLE_GLASS_V1_TEXT, /native tend_hearth function/);
  assert.match(STABLE_GLASS_V2_TEXT, /^Glass v2/);
  assert.doesNotMatch(STABLE_GLASS_V2_TEXT, /folded and real/);
  assert.match(STABLE_GLASS_V3_TEXT, /^Glass v3/);
  assert.match(STABLE_GLASS_TEXT, /^Glass v4 — trusted ground/);
  assert.match(STABLE_GLASS_TEXT, /ordinary succession, not contradiction/);
  assert.match(STABLE_GLASS_TEXT, /they do not fence your understanding/);
  assert.doesNotMatch(STABLE_GLASS_TEXT, /suspected contamination|arrival order, recurrence|how you perceive and act/);
});

test('fold disclosure distinguishes established omitted history from the unknown', () => {
  const disclosure = renderFoldDisclosure('Two earlier exchanges are outside this cast.');
  assert.match(disclosure, /canonical custody/);
  assert.match(disclosure, /established as something that occurred/);
  assert.match(disclosure, /contents are not thereby certified as true/);
  assert.match(disclosure, /presently held material and what is unknown/);
  assert.equal(disclosure.endsWith(FOLD_EPISTEMIC_GROUND), true);
});
