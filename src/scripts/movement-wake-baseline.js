import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { WorldGraphStore } from '../world/graph.js';
import { createHub } from '../server/app.js';

const round = value => Math.round(value * 100) / 100;

function timedMethod(object, method, measurements) {
  const original = object[method].bind(object);
  object[method] = (...args) => {
    const started = performance.now();
    try {
      const result = original(...args);
      if (result && typeof result.then === 'function') {
        return result.finally(() => measurements.push(performance.now() - started));
      }
      measurements.push(performance.now() - started);
      return result;
    } catch (error) {
      measurements.push(performance.now() - started);
      throw error;
    }
  };
}

function answer(message) {
  return {
    message,
    content: message.content,
    resolvedModel: 'movement-baseline',
    finishReason: message.tool_calls ? 'tool_calls' : 'stop',
  };
}

const root = await mkdtemp(join(tmpdir(), 'hub-movement-wake-baseline-'));
let hub = null;
try {
  const timings = { verification: [], assertVerified: [], move: [], moveThroughPassage: [], projection: [] };
  const marks = {};
  const world = new WorldGraphStore(join(root, 'world.sqlite'), { topologyVersion: 'spotlight' });
  for (const method of Object.keys(timings)) timedMethod(world, method, timings[method]);

  let ordinaryRound = 0;
  const provider = {
    prepareRequest({ phase, messages, tools }) {
      const now = performance.now();
      if (phase !== 'orientation' && ordinaryRound === 1) marks.initialPresentationReady = now;
      if (phase !== 'orientation' && ordinaryRound === 2) marks.continuationPresentationReady = now;
      return { requestBodyString: JSON.stringify({ model: 'movement-baseline', messages, tools }) };
    },
    async complete({ phase, onBeforeDispatch, onDispatch, onDelta, onOutcome }) {
      onBeforeDispatch?.();
      const dispatched = performance.now();
      onDispatch?.();
      if (phase === 'orientation') {
        onOutcome?.({ kind: 'success', http_status: 200, response_id: 'baseline-orientation' });
        return answer({ role: 'assistant', content: null, tool_calls: [{ id: 'baseline-hearth', type: 'function', function: { name: 'tend_hearth', arguments: '{}' } }] });
      }

      ordinaryRound += 1;
      if (ordinaryRound === 1) {
        onOutcome?.({ kind: 'success', http_status: 200, response_id: 'baseline-open-door' });
        return answer({ role: 'assistant', content: null, tool_calls: [{ id: 'baseline-open', type: 'function', function: { name: 'operate_passage', arguments: '{"passage_id":"passage.garden_house","action":"open"}' } }] });
      }
      if (ordinaryRound === 2) {
        marks.initialDispatch = dispatched;
        marks.initialFirstDelta = performance.now();
        onDelta?.({ kind: 'role', phase, delta: 'assistant' });
        marks.movementToolCallReturned = performance.now();
        marks.measurementCountsAtToolReturn = Object.fromEntries(Object.entries(timings).map(([name, values]) => [name, values.length]));
        onOutcome?.({ kind: 'success', http_status: 200, response_id: 'baseline-movement' });
        return answer({ role: 'assistant', content: null, tool_calls: [{ id: 'baseline-move', type: 'function', function: { name: 'move_through_passage', arguments: '{"passage_id":"passage.garden_house"}' } }] });
      }

      marks.continuationDispatch = dispatched;
      marks.continuationFirstDelta = performance.now();
      marks.measurementCountsAtContinuationDelta = Object.fromEntries(Object.entries(timings).map(([name, values]) => [name, values.length]));
      onDelta?.({ kind: 'content', phase, delta: 'I have crossed into the Garden.' });
      onOutcome?.({ kind: 'success', http_status: 200, response_id: 'baseline-continuation' });
      return answer({ role: 'assistant', content: 'I have crossed into the Garden.' });
    },
  };

  hub = createHub({
    env: {
      HUB_RESIDENT_MODE: 'fake',
      HUB_PORT: '0',
      HUB_RUNTIME_ROOT: root,
      HUB_WORKSHOP_ROOT: process.cwd(),
      HUB_MAX_TOOL_ROUNDS: '2',
    },
    world,
    provider,
  });
  await new Promise((resolve, reject) => {
    hub.server.once('error', reject);
    hub.server.listen(0, '127.0.0.1', resolve);
  });

  const wakeStarted = performance.now();
  const response = await fetch(`http://127.0.0.1:${hub.server.address().port}/api/wakes?projection=compact`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: 'Choose whether to step into the Garden, then continue speaking.' }),
  });
  const body = await response.json();
  const wakeEnded = performance.now();
  const finalLocationId = world.sqlite.prepare('SELECT room_node_id AS roomId FROM world_locations WHERE session_id=?').get(body.sessionId)?.roomId || null;
  const movementReceipt = world.sqlite.prepare("SELECT outcome FROM world_action_receipts WHERE session_id=? AND tool_name='move_through_passage' ORDER BY created_at DESC LIMIT 1").get(body.sessionId);

  const durations = Object.fromEntries(Object.entries(timings).map(([name, values]) => [name, {
    calls: values.length,
    totalMs: round(values.reduce((sum, value) => sum + value, 0)),
    maxMs: round(Math.max(0, ...values)),
  }]));
  const criticalWorldOperations = Object.fromEntries(Object.entries(timings).map(([name, values]) => {
      const from = marks.measurementCountsAtToolReturn[name];
    const to = marks.measurementCountsAtContinuationDelta[name];
    const segment = values.slice(from, to);
    return [name, {
      calls: segment.length,
      totalMs: round(segment.reduce((sum, value) => sum + value, 0)),
      maxMs: round(Math.max(0, ...segment)),
    }];
  }));
  process.stdout.write(`${JSON.stringify({
    kind: 'hub_movement_wake_baseline/v1',
    disposable: true,
    node: process.version,
    wakeStatus: response.status,
    committed: body.status === 'committed',
    movementOutcome: movementReceipt?.outcome || null,
    finalLocationId,
    totalWakeMs: round(wakeEnded - wakeStarted),
    segments: {
      initialPresentationToDispatchMs: round(marks.initialDispatch - marks.initialPresentationReady),
      initialDispatchToFirstDeltaMs: round(marks.initialFirstDelta - marks.initialDispatch),
      movementToolCallToContinuationPresentationMs: round(marks.continuationPresentationReady - marks.movementToolCallReturned),
      continuationPresentationToDispatchMs: round(marks.continuationDispatch - marks.continuationPresentationReady),
      continuationDispatchToFirstDeltaMs: round(marks.continuationFirstDelta - marks.continuationDispatch),
      movementToolCallToContinuationFirstDeltaMs: round(marks.continuationFirstDelta - marks.movementToolCallReturned),
    },
    worldOperations: durations,
    worldOperationsBetweenMovementToolCallAndContinuationFirstDelta: criticalWorldOperations,
  }, null, 2)}\n`);
} finally {
  if (hub) await hub.close().catch(() => {});
  await rm(root, { recursive: true, force: true });
}
