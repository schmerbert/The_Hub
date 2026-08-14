import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProvisionalCollector } from '../src/runtime/provisional-collector.js';
import { createHub } from '../src/server/app.js';

function event(kind, text, index = 0) {
  return {
    kind, sessionId: 'session-1', wakeId: 'wake-1', phase: 'ordinary', authority: 'provider_provisional', committed: false,
    payload: kind === 'provider.tool_call.delta'
      ? { choiceIndex: 0, index, type: null, function: { name: text }, argumentsOmitted: false }
      : { choiceIndex: 0, delta: text },
    source: { providerRequestId: 'request-1', spineRecordId: 'spine-1' },
  };
}

test('collector coalesces only one exact request/phase/kind/channel and preserves channel order', () => {
  const emitted = [];
  const collector = new ProvisionalCollector({ emit: item => emitted.push(item), flushMs: 1000 });
  collector.collect(event('provider.thinking.delta', 'one '));
  collector.collect(event('provider.thinking.delta', 'two'));
  collector.collect(event('provider.content.delta', 'answer'));
  collector.collect(event('provider.tool_call.delta', 'workshop_', 0));
  collector.collect(event('provider.tool_call.delta', 'read', 0));
  collector.collect(event('provider.tool_call.delta', 'other', 1));
  collector.flush();
  assert.deepEqual(emitted.map(item => item.kind), ['provider.thinking.delta', 'provider.content.delta', 'provider.tool_call.delta', 'provider.tool_call.delta']);
  assert.equal(emitted[0].payload.delta, 'one two');
  assert.equal(emitted[1].payload.delta, 'answer');
  assert.equal(emitted[2].payload.function.name, 'workshop_read');
  assert.equal(emitted[3].payload.index, 1);
});

test('default collector cadence is human-visible rather than token-rate durable publication', () => {
  const collector = new ProvisionalCollector({ emit: () => {} });
  assert.equal(collector.flushMs, 200);
  collector.discard();
});

test('collector is bounded, flushes at the fragment ceiling, and discard exposes nothing', () => {
  const emitted = [];
  const collector = new ProvisionalCollector({ emit: item => emitted.push(item), maxBytes: 4096, maxFragments: 2, flushMs: 1000 });
  collector.collect(event('provider.content.delta', 'a'));
  collector.collect(event('provider.content.delta', 'b'));
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].payload.delta, 'ab');
  collector.collect(event('provider.content.delta', 'must disappear'));
  assert.ok(collector.sizeBytes > 0);
  collector.discard();
  assert.equal(collector.sizeBytes, 0);
  assert.equal(collector.sizeFragments, 0);
  assert.equal(emitted.length, 1);
});

test('timer flush emits one coalesced safe batch', async () => {
  const emitted = [];
  const collector = new ProvisionalCollector({ emit: item => emitted.push(item), flushMs: 5 });
  collector.collect(event('provider.content.delta', 'a'));
  collector.collect(event('provider.content.delta', 'b'));
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].payload.delta, 'ab');
});

test('WakeService persists coalesced safe batches instead of each fake provider fragment', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-provisional-collector-'));
  const hub = createHub({ env: { HUB_RESIDENT_MODE: 'fake', HUB_DB_PATH: join(dir, 'hub.sqlite'), HUB_SPINE_PATH: join(dir, 'spine.jsonl') } });
  try {
    const wake = await hub.wake('collect this stream');
    assert.equal(wake.status, 'committed');
    const events = hub.db.listWakeStreamEventsByWake(wake.id, { limit: 1000 });
    const provisional = events.filter(item => item.authority === 'provider_provisional');
    assert.equal(provisional.filter(item => item.phase === 'orientation' && item.kind === 'provider.thinking.delta').length, 1);
    assert.equal(provisional.filter(item => item.phase === 'orientation' && item.kind === 'provider.tool_call.delta').length, 1);
    assert.equal(provisional.filter(item => item.phase === 'response' && item.kind === 'provider.content.delta').length, 1);
    assert.equal(provisional.some(item => item.payload.delta === 'fake orientation reasoning'), true);
  } finally { await hub.close(); await rm(dir, { recursive: true, force: true }); }
});
