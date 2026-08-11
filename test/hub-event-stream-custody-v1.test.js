import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { canonicalize, sha256 } from '../src/core/hash.js';
import { HubDatabase } from '../src/ledger/source.js';
import { HubEventBus } from '../src/runtime/hub-event-bus.js';

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'hub-stream-custody-'));
  const path = join(dir, 'hub.sqlite');
  const db = new HubDatabase(path);
  const state = { dir, path, db };
  state.close = async () => { try { state.db.close(); } catch {} await rm(dir, { recursive: true, force: true }); };
  return state;
}

function expectedEventHash(event) {
  return sha256(canonicalize({
    sequence: event.sequence,
    eventId: event.eventId,
    schemaVersion: event.schemaVersion,
    kind: event.kind,
    sessionId: event.sessionId,
    wakeId: event.wakeId,
    phase: event.phase,
    authority: event.authority,
    committed: event.committed,
    payload: event.payload,
    source: event.source,
    previousEventHash: event.previousEventHash,
    createdAt: event.createdAt,
  }));
}

test('wake stream journal persists before broadcast with monotonic append-only hash custody', async () => {
  const f = await fixture();
  const bus = new HubEventBus({ journal: f.db, bufferSize: 8 });
  const observed = [];
  const unsubscribe = bus.subscribe(event => {
    const persisted = f.db.getWakeStreamEvent(event.eventId);
    assert.equal(persisted.eventHash, event.eventHash);
    observed.push(event);
  });
  try {
    const first = bus.publish({
      eventId: 'stream-contract-1', kind: 'wake.started', sessionId: f.db.session.id, wakeId: 'wake-stream-a', phase: 'orientation',
      authority: 'host_receipt', committed: false, payload: { status: 'calling' }, source: { recordId: 'request-1' }, createdAt: '2026-08-10T00:00:01.000Z',
    });
    const second = bus.publish({
      eventId: 'stream-contract-2', kind: 'provider.completed', sessionId: f.db.session.id, wakeId: 'wake-stream-a', phase: 'orientation',
      authority: 'provider', committed: true, payload: { status: 'complete', usage: { promptTokens: 4 } }, source: { recordId: 'return-1' }, createdAt: '2026-08-10T00:00:02.000Z',
    });
    const third = bus.publish({
      eventId: 'stream-contract-3', kind: 'tool.completed', sessionId: f.db.session.id, wakeId: 'wake-stream-b', phase: 'ordinary',
      authority: 'host_receipt', committed: true, payload: { toolName: 'workshop_list' }, source: { actionReceiptId: 'action-1' }, createdAt: '2026-08-10T00:00:03.000Z',
    });
    assert.deepEqual([first.sequence, second.sequence, third.sequence], [1, 2, 3]);
    assert.ok([first, second, third].every(event => Number.isInteger(event.sequence) && event.eventHash === expectedEventHash(event)));
    assert.equal(first.previousEventHash, null);
    assert.equal(second.previousEventHash, first.eventHash);
    assert.equal(third.previousEventHash, second.eventHash);
    assert.deepEqual(observed.map(event => event.eventId), ['stream-contract-1', 'stream-contract-2', 'stream-contract-3']);
    assert.deepEqual(f.db.getWakeStreamEvent(first.eventId), first);
    assert.deepEqual(f.db.listWakeStreamEvents({ afterSequence: 0, limit: 3 }), [first, second, third]);
    assert.deepEqual(f.db.listWakeStreamEventsAfter(1).map(event => event.eventId), ['stream-contract-2', 'stream-contract-3']);
    assert.deepEqual(f.db.listWakeStreamEventsByWake('wake-stream-a').map(event => event.eventId), ['stream-contract-1', 'stream-contract-2']);
    assert.deepEqual(f.db.listRecentWakeStreamEvents({ limit: 2 }), [second, third]);
    assert.equal(f.db.getLatestWakeStreamSequence(), 3);
    const storedBeforeReopen = f.db.sqlite.prepare('SELECT * FROM wake_stream_events ORDER BY sequence').all();
    assert.throws(() => f.db.sqlite.prepare("UPDATE wake_stream_events SET kind='wake.failed' WHERE sequence=1").run(), /append-only table/);
    assert.throws(() => f.db.sqlite.prepare('DELETE FROM wake_stream_events WHERE sequence=1').run(), /append-only table/);

    unsubscribe();
    bus.close();
    f.db.close();
    f.db = new HubDatabase(f.path);
    const reopened = f.db.listWakeStreamEvents();
    assert.deepEqual(reopened, [first, second, third]);
    assert.equal(reopened[2].previousEventHash, reopened[1].eventHash);
    assert.deepEqual(f.db.sqlite.prepare('SELECT * FROM wake_stream_events ORDER BY sequence').all(), storedBeforeReopen);
    assert.throws(() => f.db.sqlite.prepare("UPDATE wake_stream_events SET kind='wake.failed' WHERE sequence=1").run(), /append-only table/);
  } finally {
    bus.close();
    await f.close();
  }
});

test('event vocabulary is future-facing while lossy JSON and credential-shaped data are refused before append', async () => {
  const f = await fixture();
  try {
    const kinds = ['wake.started', 'phase.completed', 'provider.delta', 'provider.thinking.delta', 'tool_call.ready', 'tool.failed', 'approval.pending', 'card.updated', 'message.completed'];
    for (const [index, kind] of kinds.entries()) f.db.appendWakeStreamEvent({ eventId: `vocabulary-${index}`, kind, payload: { ordinal: index }, source: {} });
    const baseline = f.db.getLatestWakeStreamSequence();
    assert.equal(baseline, kinds.length);
    const circular = {}; circular.self = circular;
    const symbolKey = { safe: true }; symbolKey[Symbol('hidden')] = 'lost';
    const sparse = []; sparse.length = 1;
    const rejected = [
      { kind: 'stream.started', payload: {}, source: {} },
      { kind: 'message.delta', payload: Buffer.from('bytes'), source: {} },
      { kind: 'message.delta', payload: { value: Number.NaN }, source: {} },
      { kind: 'message.delta', payload: { value: () => true }, source: {} },
      { kind: 'message.delta', payload: { value: undefined }, source: {} },
      { kind: 'message.delta', payload: circular, source: {} },
      { kind: 'message.delta', payload: { apiKey: 'credential' }, source: {} },
      { kind: 'message.delta', payload: { nested: { token: 'credential' } }, source: {} },
      { kind: 'message.delta', payload: { authorization: 'Bearer abcdefgh' }, source: {} },
      { kind: 'message.delta', payload: { text: 'Bearer abcdefgh' }, source: {} },
      { kind: 'message.delta', payload: { value: new Date() }, source: {} },
      { kind: 'message.delta', payload: symbolKey, source: {} },
      { kind: 'message.delta', payload: { sparse }, source: {} },
      { kind: 'message.delta', payload: {}, source: { providerKey: 'credential' } },
    ];
    for (const input of rejected) assert.throws(() => f.db.appendWakeStreamEvent(input), error => /^wake_stream_/.test(error.code));
    assert.equal(f.db.getLatestWakeStreamSequence(), baseline);
  } finally { await f.close(); }
});

test('provider delta custody refuses credentials reconstructed across fragment boundaries', async () => {
  const f = await fixture();
  const cases = [
    { kind: 'provider.content.delta', requestId: 'bearer', parts: ['Bea', 'rer ', 'abcdefgh'], full: 'Bearer abcdefgh' },
    { kind: 'provider.thinking.delta', requestId: 'sk', parts: ['sk-12', '34567890'], full: 'sk-1234567890' },
    { kind: 'provider.content.delta', requestId: 'token', parts: ['tok', 'en=supervalue'], full: 'token=supervalue' },
    { kind: 'provider.thinking.delta', requestId: 'password', parts: ['pass', 'word: hun', 'ter2value'], full: 'password: hunter2value' },
    { kind: 'provider.tool_call.delta', requestId: 'tool-arguments', parts: ['Bea', 'rer ', 'toolsecret'], full: 'Bearer toolsecret', toolField: 'arguments' },
    { kind: 'provider.tool_call.delta', requestId: 'tool-name', parts: ['sk-12', '34567890'], full: 'sk-1234567890', toolField: 'name' },
  ];
  try {
    for (const item of cases) {
      const before = f.db.getLatestWakeStreamSequence();
      let refused = false;
      for (const [index, part] of item.parts.entries()) {
        const payload = item.toolField
          ? { index: 0, function: { [item.toolField]: part } }
          : { delta: part };
        try {
          f.db.appendWakeStreamEvent({
            kind: item.kind,
            sessionId: f.db.session.id,
            wakeId: `wake-${item.requestId}`,
            phase: 'ordinary',
            authority: 'provider_provisional',
            committed: false,
            payload,
            source: { providerRequestId: `request-${item.requestId}` },
          });
        } catch (error) {
          assert.equal(error.code, 'wake_stream_delta_secret_refused', `${item.requestId} fragment ${index}`);
          refused = true;
          break;
        }
      }
      assert.equal(refused, true, item.requestId);
      const stored = f.db.listWakeStreamEventsByWake(`wake-${item.requestId}`);
      const reconstructed = stored.map(event => item.toolField ? event.payload.function[item.toolField] : event.payload.delta).join('');
      assert.equal(reconstructed.includes(item.full), false);
      assert.ok(f.db.getLatestWakeStreamSequence() >= before);
    }
  } finally { await f.close(); }
});

test('provider delta custody retains the matching channel window across heavy interleaving', async () => {
  const f = await fixture();
  const common = {
    sessionId: f.db.session.id,
    wakeId: 'wake-interleaved',
    phase: 'ordinary',
    authority: 'provider_provisional',
    committed: false,
    source: { providerRequestId: 'request-interleaved' },
  };
  try {
    f.db.appendWakeStreamEvent({ ...common, kind: 'provider.content.delta', payload: { delta: 'sk-12' } });
    for (let index = 0; index < 80; index += 1) {
      f.db.appendWakeStreamEvent({ ...common, kind: 'provider.thinking.delta', payload: { delta: `ordinary filler ${index}` } });
    }
    assert.throws(
      () => f.db.appendWakeStreamEvent({ ...common, kind: 'provider.content.delta', payload: { delta: '34567890' } }),
      error => error.code === 'wake_stream_delta_secret_refused',
    );

    assert.doesNotThrow(() => f.db.appendWakeStreamEvent({
      ...common,
      source: { providerRequestId: 'request-isolated' },
      kind: 'provider.content.delta',
      payload: { delta: '34567890' },
    }));
    assert.doesNotThrow(() => f.db.appendWakeStreamEvent({
      ...common,
      phase: 'response',
      kind: 'provider.content.delta',
      payload: { delta: '34567890' },
    }));
    assert.doesNotThrow(() => f.db.appendWakeStreamEvent({
      ...common,
      kind: 'provider.tool_call.delta',
      payload: { index: 1, function: { name: '34567890' } },
    }));
  } finally { await f.close(); }
});

test('HubEventBus provides bounded replay, cursor resync, dedupe, isolation, and clean unsubscribe', async () => {
  const f = await fixture();
  const bus = new HubEventBus(f.db, { bufferSize: 2 });
  try {
    for (let index = 1; index <= 3; index += 1) bus.publish({ eventId: `replay-${index}`, kind: 'message.delta', payload: { index }, source: {} });
    const replay = [];
    const unsubscribeReplay = bus.subscribe(event => replay.push(event), { afterSequence: 1 });
    assert.deepEqual(replay.map(event => event.sequence), [2, 3]);
    const overflow = [];
    const unsubscribeOverflow = bus.subscribe(event => overflow.push(event), { afterSequence: 0 });
    assert.equal(overflow.length, 1);
    assert.equal(overflow[0].kind, 'resync_required');
    assert.deepEqual(overflow[0].payload, { requestedAfterSequence: 0, earliestAvailableSequence: 2, latestSequence: 3 });

    const isolated = [];
    const unsubscribeThrowing = bus.subscribe(event => { event.payload.index = 999; throw new Error('listener failure'); });
    const unsubscribeIsolated = bus.subscribe(event => isolated.push(event));
    const fourth = bus.publish({ eventId: 'replay-4', kind: 'message.completed', payload: { index: 4 }, source: {} });
    assert.equal(fourth.sequence, 4);
    assert.deepEqual(replay.map(event => event.sequence), [2, 3, 4]);
    assert.deepEqual(isolated.map(event => event.payload.index), [4]);
    assert.deepEqual(f.db.getWakeStreamEvent('replay-4').payload, { index: 4 });

    assert.equal(unsubscribeReplay(), true);
    assert.equal(unsubscribeReplay(), false);
    assert.equal(unsubscribeOverflow(), true);
    assert.equal(unsubscribeThrowing(), true);
    assert.equal(unsubscribeIsolated(), true);
    assert.equal(bus.subscriberCount, 0);
    bus.publish({ eventId: 'replay-5', kind: 'wake.completed', payload: {}, source: {} });
    assert.deepEqual(replay.map(event => event.sequence), [2, 3, 4]);
    bus.close();
    assert.throws(() => bus.publish({ kind: 'wake.started', payload: {}, source: {} }), error => error.code === 'wake_stream_closed');
    assert.throws(() => bus.subscribe(() => {}), error => error.code === 'wake_stream_closed');
  } finally {
    bus.close();
    await f.close();
  }
});
