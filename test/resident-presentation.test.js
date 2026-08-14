import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RESIDENT_PRESENTATION_CATALOG,
  renderCrossingGround,
  renderOrientationGround,
  renderToolAttentionGround,
} from '../src/context/resident-presentation.js';
import { STABLE_GLASS_TEXT, STABLE_GLASS_V1_TEXT } from '../src/context/glass-cast.js';
import { buildClinicalBootstrap } from '../src/session/lifespan.js';

test('Resident presentation catalog owns every code-authored Glass ground kind', () => {
  for (const kind of ['stable_glass', 'crossing_ground', 'orientation_ground', 'world_current_ground', 'tool_current_ground', 'attention_current_ground', 'clinical_wake_anchor', 'source_exact_inheritance', 'prior_horizon', 'hearth_action', 'hearth_return', 'clinical_bootstrap', 'session_history']) {
    const entry = RESIDENT_PRESENTATION_CATALOG[kind];
    assert.ok(entry, `missing presentation owner for ${kind}`);
    assert.ok(entry.owner && entry.when && entry.why && entry.register);
  }
});

test('Hearth presentation is situated while enforcement stays out of Resident ground', () => {
  const presented = [STABLE_GLASS_TEXT, buildClinicalBootstrap({ provider: 'example', model: 'example' }), renderCrossingGround({ phase: 'orientation' }), renderOrientationGround(), renderOrientationGround({ completed: true }), renderToolAttentionGround({ activeGroup: 'fixtures' })].join('\n');
  assert.match(presented, /Hearth/);
  assert.doesNotMatch(presented, /forced|native function|empty arguments|provider|requested model|byte|schema/i);
  assert.match(STABLE_GLASS_V1_TEXT, /native tend_hearth function/);
  assert.match(STABLE_GLASS_TEXT, /^Glass v2/);
});
