import test from 'node:test';
import assert from 'node:assert/strict';
import { activeDisplay, COMPACT_WINDOW_SIZE, cornerBounds, EXPANDED_WINDOW_SIZE } from '../src/corner/window-geometry.js';

test('Corner geometry anchors both modes to the active display work area', () => {
  const display = { id: 2, workArea: { x: -1920, y: 40, width: 1920, height: 1040 } };
  assert.deepEqual(cornerBounds(display, COMPACT_WINDOW_SIZE), { x: -120, y: 960, width: 96, height: 96 });
  assert.deepEqual(cornerBounds(display, EXPANDED_WINDOW_SIZE), { x: -1004, y: 376, width: 980, height: 680 });
});

test('Corner geometry clamps oversized windows and chooses matching or cursor display', () => {
  const tiny = { id: 1, workArea: { x: 10, y: 20, width: 80, height: 70 } };
  assert.deepEqual(cornerBounds(tiny, COMPACT_WINDOW_SIZE), { x: 10, y: 20, width: 80, height: 70 });
  const matching = { id: 'matching', workArea: { x: 0, y: 0, width: 100, height: 100 } };
  const nearest = { id: 'nearest', workArea: { x: 100, y: 0, width: 100, height: 100 } };
  const screen = {
    getDisplayMatching: bounds => { assert.deepEqual(bounds, { x: 4, y: 5, width: 6, height: 7 }); return matching; },
    getCursorScreenPoint: () => ({ x: 150, y: 20 }),
    getDisplayNearestPoint: point => { assert.deepEqual(point, { x: 150, y: 20 }); return nearest; },
  };
  assert.equal(activeDisplay(screen, { isDestroyed: () => false, getBounds: () => ({ x: 4, y: 5, width: 6, height: 7 }) }), matching);
  assert.equal(activeDisplay(screen), nearest);
});

test('Corner geometry rejects invalid sizes and margins', () => {
  const display = { workArea: { x: 0, y: 0, width: 100, height: 100 } };
  assert.throws(() => cornerBounds(display, { width: 0, height: 4 }), TypeError);
  assert.throws(() => cornerBounds(display, COMPACT_WINDOW_SIZE, -1), TypeError);
});
