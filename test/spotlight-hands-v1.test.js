import test from 'node:test';
import assert from 'node:assert/strict';
import { SPOTLIGHT_CAPABILITY_MATRIX, SPOTLIGHT_TOOL_APPROVAL_CLASS, SPOTLIGHT_TOOL_NAMES, SPOTLIGHT_TOOLS, createSpotlightCapabilityService } from '../src/places/hub/spotlight/index.js';
import { CEILING_WIRES, mountedToolNames } from '../src/world/ceiling.js';
import { TOOL_NAMES } from '../src/world/tools.js';
import { WORLD_TOOL_HANDLER_NAMES, dispatchWorldToolImmediate } from '../src/world/gateway/dispatch.js';

test('Spotlight hands are one complete provider-neutral installed surface', () => {
  assert.equal(SPOTLIGHT_TOOL_NAMES.length, 10);
  assert.deepEqual(new Set(SPOTLIGHT_TOOL_NAMES), new Set(Object.keys(SPOTLIGHT_CAPABILITY_MATRIX)));
  assert.deepEqual(new Set(SPOTLIGHT_TOOL_NAMES), new Set(SPOTLIGHT_TOOLS.map(tool => tool.function.name)));
  assert.deepEqual(new Set(['move_through_door', ...SPOTLIGHT_TOOL_NAMES]), new Set(mountedToolNames('room.spotlight')));
  assert.deepEqual(new Set(SPOTLIGHT_TOOL_NAMES), new Set(CEILING_WIRES.filter(wire => wire.groupId === 'spotlight').map(wire => wire.name)));
  assert.deepEqual(new Set(SPOTLIGHT_TOOL_NAMES), new Set(WORLD_TOOL_HANDLER_NAMES.filter(name => name.startsWith('spotlight_'))));
  assert.ok(SPOTLIGHT_TOOL_NAMES.every(name => TOOL_NAMES.has(name)));
  assert.equal(SPOTLIGHT_TOOL_APPROVAL_CLASS.spotlight_trade_execute, 'confirm');
  assert.equal(SPOTLIGHT_TOOL_APPROVAL_CLASS.spotlight_ring_adjust, 'confirm');
  assert.ok(SPOTLIGHT_TOOL_NAMES.filter(name => !['spotlight_trade_execute', 'spotlight_ring_adjust'].includes(name)).every(name => SPOTLIGHT_TOOL_APPROVAL_CLASS[name] === 'auto'));
});

test('default Spotlight capability service is deterministic and fail-closed', () => {
  const service = createSpotlightCapabilityService();
  const first = service.status();
  const second = service.status();
  assert.deepEqual(first, second);
  assert.equal(first.hands.length, SPOTLIGHT_TOOL_NAMES.length);
  assert.equal(first.hands.find(hand => hand.name === 'spotlight_capability_status').usable, true);
  for (const hand of first.hands.filter(hand => hand.name !== 'spotlight_capability_status')) {
    assert.equal(hand.usable, false, hand.name);
    assert.equal(hand.status, 'withheld', hand.name);
    assert.ok(hand.missingRequirements.length, hand.name);
    assert.ok(hand.missingRequirements.some(item => ['socket', 'custody', 'law'].includes(item.kind)), hand.name);
    assert.equal(hand.missingRequirements.every(item => item.state === 'optional_unwired'), true);
  }
  const withheld = service.invoke('spotlight_observe', { hostile: 'x'.repeat(100_000) });
  assert.equal(withheld.status, 'withheld');
  assert.equal(withheld.availability, 'unavailable');
  assert.equal(withheld.attempted, false);
  assert.equal(withheld.network, false);
  assert.equal(withheld.mutated, false);
  assert.equal(withheld.approvalCreated, false);
  assert.ok(!JSON.stringify(withheld).includes('hostile'));
});

test('Spotlight dispatch keeps every gated hand side-effect free and status accepts no arguments', () => {
  const service = createSpotlightCapabilityService();
  for (const name of SPOTLIGHT_TOOL_NAMES.filter(item => item !== 'spotlight_capability_status')) {
    const outcome = dispatchWorldToolImmediate(name, { spotlight: service, args: { payload: 'ignored' } });
    assert.equal(outcome.source, null);
    assert.equal(outcome.changedRoom, false);
    assert.equal(outcome.result.status, 'withheld');
    assert.equal(outcome.result.network, false);
    assert.equal(outcome.result.mutated, false);
  }
  assert.throws(() => dispatchWorldToolImmediate('spotlight_capability_status', { spotlight: service, args: { extra: true } }), error => error.code === 'spotlight_invalid_argument');
});
