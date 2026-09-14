import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fitToolContinuationRound,
  publishToolCallsReady,
  publishToolStarted,
  settleToolAction,
} from '../src/runtime/tool-continuation.js';

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

test('tool lifecycle publication preserves ready, running, settlement, approval, and card custody', () => {
  const created = { sessionId: 'session_1', wakeId: 'wake_1' };
  const phase = 'continuation_1';
  const call = { id: 'call_1', function: { name: 'ask_permission' } };
  const response = {
    requestId: 'request_1',
    result: { message: { role: 'assistant', tool_calls: [call] } },
    returnScrub: { receipt: { receiptId: 'return_1' } },
  };
  const records = [];
  const publications = [];
  const cards = [];
  const db = {
    recordToolCall: input => { records.push(['call', input]); return 'event_call_1'; },
    recordToolResult: input => { records.push(['result', input]); return 'event_result_1'; },
  };
  const publish = (type, event) => publications.push([type, event]);
  const toolCardPayload = (toolCallId, toolName, state, extra) => ({ toolCallId, toolName, state, ...extra });

  const toolCallEventId = publishToolCallsReady({ calls: [call], response, created, phase, db, publish, toolCardPayload });
  publishToolStarted({ call, response, toolCallEventId, created, phase, publish, toolCardPayload });
  const action = {
    name: 'ask_permission',
    result: { ok: true, status: 'pending_approval', approvalId: 'approval_1' },
    actionReceipt: { receiptId: 'action_1' },
    approvalReceipt: { receiptId: 'approval_receipt_1' },
    scrub: { receipt: { receiptId: 'host_return_1' } },
  };
  const settled = settleToolAction({
    call, action, created, phase, db, publish,
    publishCards: (...args) => cards.push(args),
    toolCardPayload,
  });

  assert.equal(toolCallEventId, 'event_call_1');
  assert.deepEqual(publications.map(([type]) => type), ['tool_call.ready', 'tool.started', 'tool.completed', 'approval.pending']);
  assert.deepEqual(publications[0][1].source, { toolCallEventId: 'event_call_1', returnScrubReceiptId: 'return_1' });
  assert.deepEqual(publications[2][1].source, { hostEventId: 'event_result_1', actionReceiptId: 'action_1', hostReturnReceiptId: 'host_return_1' });
  assert.deepEqual(publications[3][1].source, { hostEventId: 'event_result_1', actionReceiptId: 'action_1', approvalReceiptId: 'approval_receipt_1' });
  assert.deepEqual(cards, [[created, phase, call, action, 'event_result_1']]);
  assert.deepEqual(settled, { toolName: 'ask_permission', hostEventId: 'event_result_1', refused: false });
  assert.equal(records[0][0], 'call');
  assert.equal(records[1][0], 'result');
});

test('movement settlement preserves physical Forest return notification', () => {
  const returns = [];
  const events = [];
  const call = { id: 'move_1', function: { name: 'move_through_passage' } };
  const action = {
    result: { ok: true, toLocationId: 'place.garden' },
    scrub: { receipt: { receiptId: 'host_return_1' } },
  };
  settleToolAction({
    call,
    action,
    created: { sessionId: 'session_1', wakeId: 'wake_1' },
    phase: 'continuation_1',
    db: { recordToolResult: () => 'event_result_1' },
    publish: (type, event) => events.push([type, event]),
    publishCards: () => {},
    toolCardPayload: (toolCallId, toolName, state, extra) => ({ toolCallId, toolName, state, ...extra }),
    forestTraversalService: { completePhysicalReturn: input => returns.push(input) },
  });
  assert.deepEqual(returns, [{ sessionId: 'session_1', wakeId: 'wake_1', toolCallId: 'move_1', toPlaceId: 'place.garden' }]);
  assert.equal(events[0][0], 'tool.completed');
});
