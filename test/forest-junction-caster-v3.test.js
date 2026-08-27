import test from 'node:test';
import assert from 'node:assert/strict';
import { castPolarSemanticFork } from '../src/forest/junction-caster.js';

test('polar caster selects balanced opposed sides and preserves handedness', () => {
  const candidates = [
    { entryId:'straight', score:1, vector:[1,0,0] },
    { entryId:'north', score:.8, vector:[.8,.6,0] },
    { entryId:'south', score:.8, vector:[.8,-.6,0] },
    { entryId:'same-side', score:.9, vector:[.9,.4,0] },
  ];
  const first = castPolarSemanticFork({ queryVector:[1,0,0], candidates });
  assert.deepEqual(first.offers.map(item => item.direction), ['semantic_left','semantic_straight','semantic_right']);
  assert.deepEqual(first.offers.map(item => item.entryId), ['north','straight','south']);
  const carried = castPolarSemanticFork({ queryVector:[1,0,0], candidates, priorAxis:first.axis });
  assert.deepEqual(carried.offers.map(item => item.entryId), ['north','straight','south']);
  assert.ok(first.receipt.opposition > .9);
});

test('polar caster does not invent side poles in a one-note neighborhood', () => {
  const cast = castPolarSemanticFork({ queryVector:[1,0], candidates:[
    { entryId:'straight', score:1, vector:[1,0] },
    { entryId:'near-a', score:.9, vector:[.99,.01] },
    { entryId:'near-b', score:.8, vector:[.98,.02] },
  ] });
  assert.deepEqual(cast.offers.map(item => item.direction), ['semantic_straight']);
  assert.equal(cast.receipt.reason, 'poles_unresolved');
});
