import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHub } from '../src/server/app.js';
import { FakeResidentProvider } from '../src/providers/fake.js';
import { placeInWorkshopFromHouse } from './support/house-navigation.js';

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

async function fixture(provider = new FakeResidentProvider()) {
  const dir = await mkdtemp(join(tmpdir(), 'hub-event-runtime-'));
  const repo = join(dir, 'repo');
  await mkdir(repo);
  await writeFile(join(repo, 'delete-me.txt'), 'temporary\n', 'utf8');
  const hub = createHub({
    provider,
    env: {
      HUB_RESIDENT_MODE: 'fake',
      HUB_DB_PATH: join(dir, 'hub.sqlite'),
      HUB_SPINE_PATH: join(dir, 'spine.jsonl'),
      HUB_WORLD_PATH: join(dir, 'world.sqlite'),
      HUB_RESULT_PATH: join(dir, 'results.sqlite'),
      HUB_WORKSHOP_ROOT: repo,
    },
  });
  await new Promise(resolve => hub.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${hub.server.address().port}`;
  return { dir, repo, hub, base, async close() { await hub.close().catch(() => {}); await rm(dir, { recursive: true, force: true }); } };
}

async function nextSseEvent(reader, state = { buffer: '' }) {
  for (;;) {
    const boundary = state.buffer.indexOf('\n\n');
    if (boundary >= 0) {
      const frame = state.buffer.slice(0, boundary);
      state.buffer = state.buffer.slice(boundary + 2);
      if (!frame || frame.startsWith(':')) continue;
      const fields = Object.fromEntries(frame.split('\n').map(line => {
        const index = line.indexOf(':');
        return [line.slice(0, index), line.slice(index + 1).trimStart()];
      }));
      return { id: Number(fields.id), type: fields.event, data: JSON.parse(fields.data) };
    }
    const { value, done } = await reader.read();
    if (done) throw new Error('SSE stream ended before the expected event.');
    state.buffer += new TextDecoder().decode(value, { stream: true }).replaceAll('\r\n', '\n');
  }
}

async function readUntil(reader, predicate) {
  const state = { buffer: '' };
  for (;;) {
    const event = await nextSseEvent(reader, state);
    if (predicate(event)) return event;
  }
}

class DelayedFirstFakeProvider extends FakeResidentProvider {
  constructor(gate) { super(); this.gate = gate; this.delayed = false; }
  async complete(options) {
    const result = await super.complete(options);
    if (!this.delayed) { this.delayed = true; await this.gate.promise; }
    return result;
  }
}

test('SSE exposes persisted provisional deltas before blocking POST resolves and disconnect never cancels the wake', async () => {
  const gate = deferred();
  const f = await fixture(new DelayedFirstFakeProvider(gate));
  const abort = new AbortController();
  try {
    const stream = await fetch(`${f.base}/api/events?after=0`, { signal: abort.signal });
    assert.equal(stream.status, 200);
    assert.match(stream.headers.get('content-type'), /^text\/event-stream/);
    assert.match(stream.headers.get('cache-control'), /no-store/);
    assert.equal(stream.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(stream.headers.get('access-control-allow-origin'), null);
    const reader = stream.body.getReader();
    let postSettled = false;
    const post = fetch(`${f.base}/api/wakes`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'Stream this wake.' }),
    }).then(async response => { postSettled = true; return { response, body: await response.json() }; });
    const delta = await readUntil(reader, event => event.type === 'provider.thinking.delta');
    assert.equal(delta.data.committed, false);
    assert.equal(delta.data.authority, 'provider_provisional');
    assert.ok(f.hub.db.getWakeStreamEvent(delta.data.eventId));
    assert.equal(postSettled, false);
    await reader.cancel().catch(() => {});
    abort.abort();
    gate.resolve();
    const completed = await post;
    assert.equal(completed.response.status, 200);
    assert.equal(completed.body.status, 'committed');
    for (let attempt = 0; attempt < 20 && f.hub.eventBus.subscriberCount; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(f.hub.eventBus.subscriberCount, 0);

    const historyResponse = await fetch(`${f.base}/api/events/history?after=0&limit=100`);
    assert.equal(historyResponse.headers.get('cache-control'), 'no-store');
    const history = await historyResponse.json();
    assert.equal(history.events.at(-1).kind, 'wake.completed');
    assert.equal(history.nextAfter, history.events.at(-1).sequence);
    const kinds = history.events.map(event => event.kind);
    const index = kind => kinds.indexOf(kind);
    assert.ok(index('wake.accepted') < index('phase.started'));
    assert.ok(index('phase.started') < index('provider.thinking.delta'));
    assert.ok(index('provider.thinking.delta') < index('provider.message.ready'));
    assert.ok(index('tool_call.ready') < index('tool.started'));
    assert.ok(index('tool.started') < index('tool.completed'));
    assert.ok(index('message.committed') < index('wake.completed'));
    const sessionHistory = f.hub.db.getSessionHistory(completed.body.sessionId);
    assert.equal(sessionHistory.some(row => row.messageKind === 'provider_provisional'), false);
  } finally { gate.resolve(); await f.close(); }
});

test('admitted delivery returns durable wake identity before execution settles and still refuses a second wake', async () => {
  const gate = deferred();
  const f = await fixture(new DelayedFirstFakeProvider(gate));
  const abort = new AbortController();
  try {
    const stream = await fetch(`${f.base}/api/events?after=0`, { signal: abort.signal });
    const reader = stream.body.getReader();
    const response = await fetch(`${f.base}/api/wakes?projection=compact&delivery=accepted`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'Admit this wake without tethering the client.' }),
    });
    assert.equal(response.status, 202);
    const admission = await response.json();
    assert.equal(admission.accepted, true);
    assert.equal(admission.status, 'accepted');
    assert.match(admission.wakeId, /^wake_/);
    assert.equal(admission.sessionId, f.hub.db.session.id);
    assert.ok(Number.isInteger(admission.eventSequence));
    assert.equal(f.hub.wakeService.wakeInProgress, true);
    assert.equal(f.hub.wakeService.activeWakeId, admission.wakeId);
    assert.ok(['assembling', 'calling_provider'].includes(f.hub.db.getWake(admission.wakeId).status));

    const duplicate = await fetch(`${f.base}/api/wakes?delivery=accepted`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'Do not queue this.' }),
    });
    assert.equal(duplicate.status, 409);
    assert.equal((await duplicate.json()).error.code, 'wake_in_progress');

    gate.resolve();
    const terminal = await readUntil(reader, event => event.type === 'wake.completed');
    assert.equal(terminal.data.wakeId, admission.wakeId);
    assert.equal(f.hub.db.getWake(admission.wakeId).status, 'committed');
  } finally { gate.resolve(); abort.abort(); await f.close(); }
});

test('detached execution journals an unexpected post-admission failure and releases the active-wake gate', async () => {
  const f = await fixture();
  const abort = new AbortController();
  try {
    f.hub.wakeService.performAdmittedWake = async () => { throw Object.assign(new Error('detached failure'), { code: 'detached_test_failure' }); };
    const stream = await fetch(`${f.base}/api/events?after=0`, { signal: abort.signal });
    const reader = stream.body.getReader();
    const response = await fetch(`${f.base}/api/wakes?delivery=accepted`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'Retain this admitted failure.' }),
    });
    assert.equal(response.status, 202);
    const admission = await response.json();
    const terminal = await readUntil(reader, event => event.type === 'wake.failed');
    assert.equal(terminal.data.wakeId, admission.wakeId);
    assert.equal(terminal.data.payload.code, 'detached_test_failure');
    for (let attempt = 0; attempt < 20 && f.hub.wakeService.wakeInProgress; attempt += 1) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(f.hub.wakeService.wakeInProgress, false);
    assert.equal(f.hub.db.getWake(admission.wakeId).status, 'failed');
  } finally { abort.abort(); await f.close(); }
});

test('SSE reconnect is cursor-deduped, query cursor wins, and invalid recovery cursors fail closed', async () => {
  const f = await fixture();
  try {
    await f.hub.wake('Establish a durable event tail.');
    const latest = f.hub.db.getLatestWakeStreamSequence();
    const replayAbort = new AbortController();
    const replay = await fetch(`${f.base}/api/events`, { headers: { 'Last-Event-ID': String(latest - 1) }, signal: replayAbort.signal });
    const replayed = await readUntil(replay.body.getReader(), event => event.type !== 'resync_required');
    assert.equal(replayed.id, latest);
    replayAbort.abort();

    const liveAbort = new AbortController();
    const live = await fetch(`${f.base}/api/events?after=${latest}`, { headers: { 'Last-Event-ID': '0' }, signal: liveAbort.signal });
    const nextPromise = nextSseEvent(live.body.getReader());
    const published = f.hub.eventBus.publish({ kind: 'message.updated', sessionId: f.hub.db.session.id, payload: { safe: true }, source: { kind: 'test' } });
    const next = await nextPromise;
    assert.equal(next.id, published.sequence);
    assert.equal(next.type, 'message.updated');
    liveAbort.abort();

    const invalid = await fetch(`${f.base}/api/events/history?after=-1`);
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).error.code, 'wake_stream_invalid_argument');
    const excessive = await fetch(`${f.base}/api/events/history?limit=1001`);
    assert.equal(excessive.status, 400);

    for (let ordinal = 0; ordinal < 260; ordinal += 1) {
      f.hub.eventBus.publish({ kind: 'message.updated', sessionId: f.hub.db.session.id, payload: { ordinal }, source: { kind: 'overflow_test' } });
    }
    const resyncAbort = new AbortController();
    const resyncStream = await fetch(`${f.base}/api/events?after=0`, { signal: resyncAbort.signal });
    const resync = await readUntil(resyncStream.body.getReader(), event => event.type === 'resync_required');
    assert.equal(resync.data.payload.requestedAfterSequence, 0);
    assert.ok(resync.data.payload.earliestAvailableSequence > 1);
    resyncAbort.abort();
  } finally { await f.close(); }
});

class ApprovalProvider {
  constructor() { this.ordinary = 0; }
  async complete({ phase }) {
    if (phase === 'orientation') return { message: { role: 'assistant', content: null, tool_calls: [{ id: 'hearth', type: 'function', function: { name: 'tend_hearth', arguments: '{}' } }] }, content: null, resolvedModel: 'test-model', finishReason: 'tool_calls' };
    this.ordinary += 1;
    if (this.ordinary === 2) return { message: { role: 'assistant', content: null, tool_calls: [{ id: 'delete', type: 'function', function: { name: 'workshop_delete_path', arguments: '{"path":"delete-me.txt"}' } }] }, content: null, resolvedModel: 'test-model', finishReason: 'tool_calls' };
    return { message: { role: 'assistant', content: this.ordinary === 1 ? 'Ready.' : 'Approval recorded.' }, content: this.ordinary === 1 ? 'Ready.' : 'Approval recorded.', resolvedModel: 'test-model', finishReason: 'stop' };
  }
}

class SplitSecretProvider {
  async complete({ phase, onDelta }) {
    if (phase === 'orientation') return { message: { role: 'assistant', content: null, tool_calls: [{ id: 'hearth', type: 'function', function: { name: 'tend_hearth', arguments: '{}' } }] }, content: null, resolvedModel: 'test-model', finishReason: 'tool_calls' };
    for (const delta of [
      { kind: 'reasoning_content', delta: 'sk-12' },
      { kind: 'reasoning_content', delta: '34567890' },
      { kind: 'content', delta: 'Bea' },
      { kind: 'content', delta: 'rer ' },
      { kind: 'content', delta: 'abcdefgh' },
      { kind: 'tool_call', index: 0, function: { name: 'workshop_', arguments: '{"token":"sup' } },
      { kind: 'tool_call', index: 0, function: { name: 'read', arguments: 'ervalue"}' } },
      { kind: 'tool_call', index: 1, function: { name: 'sk-12' } },
      { kind: 'tool_call', index: 1, function: { name: '34567890' } },
    ]) onDelta?.(delta);
    const content = 'Bearer abcdefgh sk-1234567890 token=supervalue password: hunter2value';
    return { message: { role: 'assistant', content }, content, resolvedModel: 'test-model', finishReason: 'stop' };
  }
}

class UnsafeProjectionMetadataProvider {
  async complete({ phase }) {
    if (phase === 'orientation') return { message: { role: 'assistant', content: null, tool_calls: [{ id: 'hearth', type: 'function', function: { name: 'tend_hearth', arguments: '{}' } }] }, content: null, resolvedModel: 'test-model', finishReason: 'tool_calls' };
    const content = 'Canonical resident content survives its projection.';
    return { message: { role: 'assistant', content }, content, resolvedModel: 'sk-1234567890', finishReason: 'stop' };
  }
}

test('post-commit projection refusal cannot rewrite canonical wake custody', async () => {
  const f = await fixture(new UnsafeProjectionMetadataProvider());
  const publish = f.hub.eventBus.publish.bind(f.hub.eventBus);
  const messageAttempts = [];
  f.hub.eventBus.publish = event => {
    if (event.kind === 'message.committed') {
      messageAttempts.push(structuredClone(event.payload));
      assert.equal(f.hub.db.getWake(event.wakeId).status, 'committed');
      assert.ok(f.hub.db.getSessionHistory(event.sessionId).some(row => row.wakeId === event.wakeId && row.messageKind === 'resident'));
      if (messageAttempts.length === 2) throw Object.assign(new Error('projection unavailable'), { code: 'wake_stream_closed' });
    }
    return publish(event);
  };
  try {
    const wake = await f.hub.wake('Commit before projecting this response.');
    assert.equal(wake.status, 'committed');
    assert.equal(wake.failureCode, null);
    assert.deepEqual(messageAttempts, [
      { role: 'assistant', content: 'Canonical resident content survives its projection.', resolvedModel: 'sk-1234567890' },
      { role: 'assistant', content: null, contentOmitted: true },
    ]);
    const history = f.hub.db.getSessionHistory(wake.sessionId).filter(row => row.wakeId === wake.id);
    assert.equal(history.filter(row => row.messageKind === 'resident').length, 1);
    assert.equal(JSON.parse(history.find(row => row.messageKind === 'resident').messageJson).content, 'Canonical resident content survives its projection.');
    assert.equal(wake.events.filter(event => event.eventKind === 'failure').length, 0);
    const stream = f.hub.db.listWakeStreamEventsByWake(wake.id);
    assert.equal(stream.some(event => event.kind === 'wake.failed'), false);
    assert.equal(stream.at(-1).kind, 'wake.completed');
  } finally { await f.close(); }
});

test('cross-fragment credential suppression never fails or changes canonical provider custody', async () => {
  const f = await fixture(new SplitSecretProvider());
  try {
    const wake = await f.hub.wake('Keep the final Scrub custody exact.');
    assert.equal(wake.status, 'committed');
    const canonical = f.hub.db.getSessionHistory(wake.sessionId).find(row => row.wakeId === wake.id && row.messageKind === 'resident');
    assert.equal(JSON.parse(canonical.messageJson).content, 'Bearer abcdefgh sk-1234567890 token=supervalue password: hunter2value');
    assert.ok(canonical.scrubReceiptId);

    const events = f.hub.db.listWakeStreamEventsByWake(wake.id);
    const serialized = JSON.stringify(events);
    for (const credential of ['Bearer abcdefgh', 'sk-1234567890', 'token=supervalue', 'password: hunter2value']) assert.equal(serialized.includes(credential), false);
    assert.ok(events.some(event => event.kind === 'provider.content.delta' && event.payload.channelSuppressed === true));
    assert.ok(events.some(event => event.kind === 'provider.thinking.delta' && event.payload.channelSuppressed === true));
    const toolDeltas = events.filter(event => event.kind === 'provider.tool_call.delta');
    assert.ok(toolDeltas.length > 0);
    assert.ok(toolDeltas.every(event => !Object.hasOwn(event.payload.function || {}, 'arguments')));
    assert.ok(toolDeltas.some(event => event.payload.channelSuppressed === true));
    assert.equal(events.at(-1).kind, 'wake.completed');
  } finally { await f.close(); }
});

test('tool, approval, and host-projected cards publish only after their custody receipts exist', async () => {
  const f = await fixture(new ApprovalProvider());
  try {
    assert.equal((await f.hub.wake('Orient.')).status, 'committed');
    await placeInWorkshopFromHouse(f.hub.world, f.hub.gateway, f.hub.db.session.id, 'host-move');
    f.hub.eventBus.subscribe(() => { throw new Error('isolated listener'); });
    const wake = await f.hub.wake('Delete the disposable file.');
    assert.equal(wake.status, 'committed');
    const events = f.hub.db.listWakeStreamEventsByWake(wake.id);
    const pending = events.find(event => event.kind === 'approval.pending');
    const card = events.find(event => event.kind === 'card.upsert' && event.payload.cardKind === 'approval');
    const tool = events.find(event => event.kind === 'tool.completed');
    assert.ok(pending && card && tool);
    assert.ok(tool.sequence < pending.sequence && pending.sequence < card.sequence);
    assert.ok(f.hub.world.sqlite.prepare('SELECT receipt_id FROM world_action_receipts WHERE receipt_id=?').get(pending.source.actionReceiptId));
    assert.ok(f.hub.world.sqlite.prepare('SELECT receipt_id FROM world_approval_receipts WHERE receipt_id=?').get(pending.source.approvalReceiptId));
    assert.ok(f.hub.db.getEvent(tool.source.hostEventId));
    assert.equal(card.payload.cardId, `card.approval.${pending.payload.approvalId}`);
    assert.equal(card.payload.revision, 1);
    assert.ok(events.find(event => event.kind === 'card.upsert' && event.payload.cardKind === 'result' && event.payload.exactPointer));
  } finally { await f.close(); }
});

test('Hub shutdown ends open event streams and closes all subscribers', async () => {
  const f = await fixture();
  try {
    const stream = await fetch(`${f.base}/api/events`);
    const reader = stream.body.getReader();
    assert.equal(f.hub.eventBus.subscriberCount, 1);
    await f.hub.close();
    let done = false;
    for (let attempt = 0; attempt < 4 && !done; attempt += 1) ({ done } = await reader.read());
    assert.equal(done, true);
    assert.equal(f.hub.eventBus.subscriberCount, 0);
  } finally { await f.close(); }
});
