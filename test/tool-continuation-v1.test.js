import test from 'node:test';
import assert from 'node:assert/strict';
import { fitToolContinuationRound } from '../src/runtime/tool-continuation.js';

const config = { workshopMaxLines: 160, workshopMaxResults: 40 };

test('tool continuation refits the mounted room profile on every provider round', () => {
  let roomId = 'place.house';
  const mounted = {
    'place.house': ['move_through_passage', 'tend_hearth'],
    'room.workshop': ['move_through_door', 'engage_fixture'],
  };
  const world = {
    current: () => ({ room_node_id: roomId, engaged_fixture_id: null }),
    availableTools: () => mounted[roomId],
  };

  const before = fitToolContinuationRound({ world, sessionId: 'session_1', config, round: 0, roundLimit: 2 });
  roomId = 'room.workshop';
  const after = fitToolContinuationRound({ world, sessionId: 'session_1', config, round: 1, roundLimit: 2 });

  assert.equal(before.roomId, 'place.house');
  assert.equal(after.roomId, 'room.workshop');
  assert.deepEqual(before.worldTools.map(tool => tool.function.name), mounted['place.house']);
  assert.deepEqual(after.worldTools.map(tool => tool.function.name), mounted['room.workshop']);
  assert.deepEqual(after.toolProfile.names.slice(0, 2), mounted['room.workshop']);
  assert.deepEqual(after.toolRoundBudget, { used: 1, remaining: 1, limit: 2, finalOpportunity: false });
});

test('final continuation opportunity carries no tool schema while retaining its witnessed profile', () => {
  const world = {
    current: () => ({ room_node_id: 'place.house', engaged_fixture_id: null }),
    availableTools: () => ['move_through_passage', 'tend_hearth'],
  };
  const fitted = fitToolContinuationRound({ world, sessionId: 'session_1', config, round: 2, roundLimit: 2 });

  assert.equal(fitted.finalOpportunity, true);
  assert.deepEqual(fitted.tools, []);
  assert.deepEqual(fitted.toolRoundBudget, { used: 2, remaining: 0, limit: 2, finalOpportunity: true });
  assert.deepEqual(fitted.toolProfile.names.slice(-2), ['reopen_result', 'rest_for']);
});
