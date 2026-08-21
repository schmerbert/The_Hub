import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ResultRackStore } from '../src/result-rack/store.js';
import { HubDatabase } from '../src/ledger/source.js';
import {
  REOPEN_RESULT_TOOL, buildResultTrailSign, parseReopenResultArguments,
  recoverablePointerFromHostReceipt,
} from '../src/context/result-exhale.js';
import { planOldToolExchangeOmissions } from '../src/context/tool-pairs.js';
import { sha256 } from '../src/core/hash.js';
import { createHub } from '../src/server/app.js';

async function rackFixture() {
  const dir = await mkdtemp(join(tmpdir(), 'hub-exhale-v2-'));
  const store = new ResultRackStore(join(dir, 'results.sqlite'), { projectionMaxBytes: 500, projectionMaxLines: 8 });
  return { dir, store, close: async () => { store.close(); await rm(dir, { recursive: true, force: true }); } };
}

test('Result Exhale reopens only a verified bounded same-session projection', async () => {
  const f = await rackFixture();
  try {
    const job = f.store.createJob({ jobId: 'exhale-job', sessionId: 'life-a', wakeId: 'wake-a', toolName: 'workshop_read' });
    f.store.appendOutputChunk(job.jobId, 'output', 'exact retained bytes\n');
    f.store.appendJobStatus(job.jobId, 'complete', { captured: true });
    const projection = f.store.createProjection(job.jobId, { maxBytes: 500, maxLines: 8 });
    const reopened = f.store.reopenProjection(projection.exactPointer, { sessionId: 'life-a' });
    assert.equal(reopened.content, projection.content);
    assert.equal(reopened.custody.rawBody, false);
    assert.equal(reopened.custody.generatedSummary, false);
    assert.throws(() => f.store.reopenProjection('result-rack://missing', { sessionId: 'life-a' }), error => error.code === 'result_pointer_not_found');
    assert.throws(() => f.store.reopenProjection(projection.exactPointer, { sessionId: 'life-b' }), error => error.code === 'result_session_ineligible');
    assert.throws(() => f.store.reopenProjection(projection.exactPointer, { sessionId: 'life-a', maxBytes: 192, maxLines: 1 }), error => error.code === 'result_projection_limit');
    f.store.sqlite.exec('DROP TRIGGER result_output_chunks_append_only_update');
    f.store.sqlite.prepare("UPDATE result_output_chunks SET body=x'6576696c' WHERE job_id='exhale-job'").run();
    assert.throws(() => f.store.reopenProjection(projection.exactPointer, { sessionId: 'life-a' }), error => error.code === 'result_custody_mismatch');
  } finally { await f.close(); }
});

test('trail signs are source-free deterministic pointers and omission is fail-closed', () => {
  const pointer = { exactPointer: 'result-rack://jobs/j/output/hash', projectionId: 'projection', projectionHash: sha256('projection'), sourceHash: sha256('source'), settlement: 'failed', byteLength: 20, lineCount: 2, toolName: 'workshop_read', sessionId: 'life', wakeId: 'wake' };
  const sign = buildResultTrailSign(pointer);
  assert.equal(sign.kind, 'result_trail_sign');
  assert.match(sign.message.content, /Settlement: failed/);
  assert.doesNotMatch(sign.message.content, /source text|exact retained bytes/);
  assert.equal(sign.receipt.custody.forestExhaleEligible, false);
  const history = [
    { ordinal: 1, wakeId: 'old', messageKind: 'assistant_tool_call', messageJson: JSON.stringify({ role: 'assistant', content: null, tool_calls: [{ id: 'call', function: { name: 'workshop_read' } }] }) },
    { ordinal: 2, wakeId: 'old', messageKind: 'tool_result', scrubReceiptId: 'missing', messageJson: JSON.stringify({ role: 'tool', tool_call_id: 'call', content: 'body' }) },
    { ordinal: 3, wakeId: 'new', messageKind: 'user', messageJson: JSON.stringify({ role: 'user', content: 'now' }) },
  ];
  const plan = planOldToolExchangeOmissions(history, { currentWakeId: 'new', retainExchanges: 0, pointerResolver: () => null });
  assert.deepEqual(plan.omissions, []);
  const recursive = [...history];
  recursive[0] = { ...recursive[0], messageJson: JSON.stringify({ role: 'assistant', content: null, tool_calls: [{ id: 'call', function: { name: 'reopen_result' } }] }) };
  const recursivePlan = planOldToolExchangeOmissions(recursive, { currentWakeId: 'new', retainExchanges: 0, pointerResolver: () => pointer });
  assert.deepEqual(recursivePlan.omissions, []);
});

test('reopen arguments and persisted host receipt pointers are typed and exact', () => {
  assert.deepEqual(parseReopenResultArguments('{"exact_pointer":"result-rack://jobs/j/output/h"}'), { exactPointer: 'result-rack://jobs/j/output/h' });
  assert.throws(() => parseReopenResultArguments('{"exact_pointer":"result-rack://x","extra":1}'), error => error.code === 'result_reopen_invalid_arguments');
  const result = { ok: true, status: 'settled', kind: 'workshop_read' };
  const receipt = { schemaVersion: 1, toolName: 'workshop_read', policy: 'result_rack_projection_v1', mode: 'projection', receiptId: 'host', sourceResultHash: sha256(JSON.stringify(result)), projectionId: 'projection', projectionHash: sha256('projection'), sourceCustodyHash: sha256('source'), exactPointer: 'result-rack://jobs/j/output/h' };
  const pointer = recoverablePointerFromHostReceipt({ sessionId: 'life', wakeId: 'wake', receiptJson: JSON.stringify(receipt), resultJson: JSON.stringify(result) }, { sessionId: 'life' });
  assert.equal(pointer.exactPointer, receipt.exactPointer);
  assert.equal(recoverablePointerFromHostReceipt({ ...pointer, receiptJson: JSON.stringify({ ...receipt, policy: 'identity' }), resultJson: JSON.stringify(result) }, { sessionId: 'life' }), null);
});

test('Roots exposure custody is append-only, non-respirable, and idempotent', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-roots-exhale-'));
  const db = new HubDatabase(join(dir, 'hub.sqlite'));
  try {
    const created = db.createSessionWake({ provider: 'fake', model: 'test', content: 'exhale' });
    const input = { sessionId: created.sessionId, wakeId: created.wakeId, phase: 'ordinary', exposureKind: 'result_trail_sign', pointer: { exactPointer: 'result-rack://jobs/j/output/h', projectionId: 'p', sourceHash: sha256('source') }, packet: { kind: 'result_trail_sign' }, glassOrdinal: 1, scrubReceiptHash: sha256('scrub'), spineRecordId: 'spine', spineRecordHash: sha256('spine') };
    const first = db.roots.recordAttentionExposure(input);
    assert.equal(db.roots.recordAttentionExposure(input).deduplicated, true);
    db.roots.recordAttentionExposureDisposition({ artifactId: first.artifactId, disposition: 'never_dispatched' });
    const rooted = db.roots.inspectWake(created.wakeId).find(item => item.kind === 'attention_exposure');
    assert.equal(rooted.payload.custody.respiration, 'prohibited');
    assert.equal(rooted.payload.custody.forestExhaleEligible, false);
    assert.equal(db.verifyRoots().verified, true);
    assert.throws(() => db.sqlite.prepare('UPDATE root_attention_exposures SET phase=\'tampered\'').run(), /append-only/);
  } finally { db.close(); await rm(dir, { recursive: true, force: true }); }
});

test('reopen_result is a universal read-only tool schema, not a World action', () => {
  assert.equal(REOPEN_RESULT_TOOL.function.name, 'reopen_result');
  assert.equal(REOPEN_RESULT_TOOL.function.parameters.additionalProperties, false);
  assert.deepEqual(REOPEN_RESULT_TOOL.function.parameters.required, ['exact_pointer']);
});

test('runtime roots every visible trail and reopening without World authority or recursive result custody', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-exhale-runtime-'));
  let responseRound = 0;
  let reopenedPointer = null;
  const provider = {
    async complete({ phase, presentation }) {
      if (phase === 'orientation') return { message: { role: 'assistant', content: null, tool_calls: [{ id: 'hearth', type: 'function', function: { name: 'tend_hearth', arguments: '{}' } }] }, content: null, resolvedModel: 'test-model', finishReason: 'tool_calls' };
      responseRound += 1;
      if (responseRound === 1) return { message: { role: 'assistant', content: null, tool_calls: [{ id: 'inspect', type: 'function', function: { name: 'inspect_fixture', arguments: '{"fixture_id":"fixture.hearth"}' } }] }, content: null, resolvedModel: 'test-model', finishReason: 'tool_calls' };
      if (responseRound === 2) return { message: { role: 'assistant', content: 'The Hearth inspection is held.' }, content: 'The Hearth inspection is held.', resolvedModel: 'test-model', finishReason: 'stop' };
      if (responseRound === 3) {
        const trail = presentation.messages.find(message => typeof message.content === 'string' && message.content.startsWith('[Result Rack trail sign]'));
        assert.ok(trail);
        reopenedPointer = trail.content.match(/Exact pointer: (result-rack:\/\/[^\n]+)/)?.[1] || null;
        assert.ok(reopenedPointer);
        return { message: { role: 'assistant', content: null, tool_calls: [{ id: 'reopen', type: 'function', function: { name: 'reopen_result', arguments: JSON.stringify({ exact_pointer: reopenedPointer }) } }] }, content: null, resolvedModel: 'test-model', finishReason: 'tool_calls' };
      }
      const reopened = presentation.messages.find(message => message.role === 'tool' && message.tool_call_id === 'reopen');
      assert.ok(reopened);
      return { message: { role: 'assistant', content: 'The retained evidence is visible again.' }, content: 'The retained evidence is visible again.', resolvedModel: 'test-model', finishReason: 'stop' };
    },
  };
  const hub = createHub({
    env: {
      HUB_RESIDENT_MODE: 'fake', HUB_DB_PATH: join(dir, 'hub.sqlite'), HUB_SPINE_PATH: join(dir, 'spine.jsonl'),
      HUB_WORLD_PATH: join(dir, 'world.sqlite'), HUB_RESULT_PATH: join(dir, 'results.sqlite'), HUB_WORKSHOP_ROOT: process.cwd(),
      HUB_RETAINED_TOOL_PAIRS: '0',
    },
    provider,
  });
  try {
    const first = await hub.wake('Inspect the Hearth.');
    assert.equal(first.status, 'committed');
    const second = await hub.wake('Follow the retained trail.');
    assert.equal(second.status, 'committed');
    assert.ok(reopenedPointer);
    assert.equal(hub.world.sqlite.prepare("SELECT COUNT(*) AS count FROM world_action_receipts WHERE tool_name='reopen_result'").get().count, 0);
    assert.equal(hub.results.sqlite.prepare("SELECT COUNT(*) AS count FROM result_jobs WHERE tool_name='reopen_result'").get().count, 0);
    const exposures = hub.db.sqlite.prepare('SELECT exposure_kind AS kind FROM root_attention_exposures WHERE wake_id=? ORDER BY created_at,artifact_id').all(second.id);
    assert.ok(exposures.some(item => item.kind === 'result_trail_sign'));
    assert.ok(exposures.some(item => item.kind === 'result_reopen'));
    assert.equal(hub.db.sqlite.prepare("SELECT COUNT(*) AS count FROM root_edges e JOIN root_attention_exposures x ON x.artifact_id=e.from_artifact_id WHERE x.wake_id=? AND e.relation='preceded_scroll_row'").get(second.id).count, exposures.length);
    assert.equal(hub.db.verifyRoots().verified, true);
  } finally {
    await hub.close();
    await rm(dir, { recursive: true, force: true });
  }
});
