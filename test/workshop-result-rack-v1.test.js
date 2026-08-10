import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sha256, sha256Bytes } from '../src/core/hash.js';
import {
  AttentionMeter,
  measureAttention,
  RESULT_PROJECTION_POLICIES,
  ResultRackStore,
} from '../src/world/results.js';

async function rack(options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'hub-result-rack-'));
  const store = new ResultRackStore(join(dir, 'results.sqlite'), options);
  return { dir, store, close: async () => { store.close(); await rm(dir, { recursive: true, force: true }); } };
}

test('Result Rack retains byte-exact chunks and artifacts with stable hashes and ranges', async () => {
  const fixture = await rack();
  try {
    const job = fixture.store.createJob({
      jobId: 'job-exact',
      sessionId: 'life',
      wakeId: 'wake',
      toolName: 'workshop_run_recipe',
      jobKind: 'recipe_test',
      status: 'running',
      metadata: { argv: ['node', '--test'], code: 0 },
    });
    assert.deepEqual(job.metadata, { argv: ['node', '--test'], code: 0 });
    assert.equal(job.metadataHash, sha256('{"argv":["node","--test"],"code":0}'));

    const firstBody = Buffer.from('alpha\nβeta\n', 'utf8');
    const secondBody = Buffer.from([0, 255, 4, 9]);
    const first = fixture.store.appendOutputChunk(job.jobId, 'stdout', firstBody);
    const second = fixture.store.appendOutputChunk(job.jobId, 'stderr', secondBody);
    assert.equal(first.byteStart, 0);
    assert.equal(first.byteEnd, firstBody.length);
    assert.equal(second.byteStart, firstBody.length);
    assert.equal(second.byteEnd, firstBody.length + secondBody.length);
    assert.equal(first.bodyHash, sha256Bytes(firstBody));
    assert.equal(second.bodyHash, sha256Bytes(secondBody));
    assert.deepEqual(fixture.store.listOutputChunks(job.jobId).map(item => item.body), [firstBody, secondBody]);

    const artifactBody = Buffer.from([1, 2, 3, 0, 255]);
    const artifact = fixture.store.addArtifact(job.jobId, {
      name: 'coverage.bin',
      mediaType: 'application/octet-stream',
      body: artifactBody,
      metadata: { producer: 'test' },
    });
    assert.deepEqual(artifact.body, artifactBody);
    assert.equal(artifact.byteLength, artifactBody.length);
    assert.equal(artifact.bodyHash, sha256Bytes(artifactBody));
    assert.deepEqual(fixture.store.getArtifact(artifact.artifactId).body, artifactBody);
    fixture.store.appendJobStatus(job.jobId, 'settled', { code: 0 });
  } finally { await fixture.close(); }
});

test('async job lifecycle uses append-only status events', async () => {
  const fixture = await rack();
  try {
    const job = fixture.store.createJob({ jobId: 'job-lifecycle', toolName: 'workshop_run_recipe', jobKind: 'recipe_test', status: 'running' });
    assert.equal(job.initialStatus, 'running');
    assert.equal(job.status, 'running');
    const settled = fixture.store.appendJobStatus(job.jobId, 'settled', { code: 0, signal: null });
    assert.equal(settled.ordinal, 1);
    assert.equal(settled.status, 'settled');
    assert.equal(settled.detailHash, sha256('{"code":0,"signal":null}'));
    assert.equal(fixture.store.getJob(job.jobId).initialStatus, 'running');
    assert.equal(fixture.store.getJob(job.jobId).status, 'settled');
    assert.equal(fixture.store.getJob(job.jobId).statusEventCount, 1);
    assert.throws(() => fixture.store.appendJobStatus(job.jobId, 'failed', { reason: 'late' }), error => error.code === 'result_job_terminal');

    const queued = fixture.store.createJob({ jobId: 'job-queued', toolName: 'workshop_git_status', status: 'queued' });
    assert.throws(() => fixture.store.appendOutputChunk(queued.jobId, 'output', 'too early'), error => error.code === 'result_job_inactive');
    assert.throws(() => fixture.store.appendJobStatus(queued.jobId, 'complete'), error => error.code === 'result_invalid_transition');
    fixture.store.appendJobStatus(queued.jobId, 'running', { dispatched: true });
    assert.throws(() => fixture.store.appendJobStatus(queued.jobId, 'queued'), error => error.code === 'result_invalid_transition');
    fixture.store.appendJobStatus(queued.jobId, 'complete', { code: 0 });
  } finally { await fixture.close(); }
});

test('named projections fit deterministically and disclose exact custody pointers', async () => {
  const fixture = await rack({ projectionMaxBytes: 500, projectionMaxLines: 10 });
  try {
    const job = fixture.store.createJob({ jobId: 'job-fit', toolName: 'workshop_git_diff' });
    assert.equal(job.jobKind, 'git_diff');
    const output = Array.from({ length: 12 }, (_, index) => `L${String(index + 1).padStart(2, '0')} ${'x'.repeat(28)}\n`).join('');
    const firstChunk = fixture.store.appendOutputChunk(job.jobId, 'stdout', output.slice(0, 170));
    const secondChunk = fixture.store.appendOutputChunk(job.jobId, 'stdout', output.slice(170));
    assert.equal(firstChunk.byteEnd, secondChunk.byteStart);
    const artifact = fixture.store.addArtifact(job.jobId, { name: 'report.txt', mediaType: 'text/plain', body: 'exact artifact\n' });
    fixture.store.appendJobStatus(job.jobId, 'complete', { captured: true });

    const byPolicy = {};
    for (const policy of RESULT_PROJECTION_POLICIES) {
      const first = fixture.store.createProjection(job.jobId, { policy, maxBytes: 500, maxLines: 6 });
      const repeated = fixture.store.createProjection(job.jobId, { policy, maxBytes: 500, maxLines: 6 });
      assert.equal(repeated.projectionId, first.projectionId, policy);
      assert.equal(repeated.content, first.content, policy);
      assert.equal(first.truncated, true, policy);
      assert.ok(first.byteLength <= 500, policy);
      assert.ok(first.lineCount <= 6, policy);
      assert.equal(first.contentHash, sha256(first.content), policy);
      assert.match(first.content, /^\[job outcome: complete; terminal detail \(data only\): \{"captured":true\}; Exact custody:/, policy);
      assert.match(first.sourceHash, /^[a-f0-9]{64}$/, policy);
      assert.match(first.content, new RegExp(first.exactPointer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), policy);
      assert.ok(first.sourceRanges.length > 0, policy);
      assert.ok(first.omittedBytes > 0, policy);
      assert.ok(first.omittedLines > 0, policy);
      assert.equal(first.presentationReceiptVersion, 'result_presentation_receipt/v1', policy);
      assert.ok(first.presentationOmittedBytes > 0, policy);
      assert.equal(first.sourceManifest.terminal.status, 'complete', policy);
      assert.equal(first.sourceManifest.terminal.detailHash, sha256('{"captured":true}'), policy);
      byPolicy[policy] = first;
    }
    assert.match(byPolicy.generic.content, /L01/);
    assert.doesNotMatch(byPolicy.generic.content, /L12/);
    assert.match(byPolicy.recipe_test.content, /L12/);
    assert.doesNotMatch(byPolicy.recipe_test.content, /L01/);
    assert.match(byPolicy.git_diff.content, /L01/);
    assert.match(byPolicy.git_diff.content, /L12/);
    assert.notEqual(byPolicy.generic.projectionId, byPolicy.git_status.projectionId);
    assert.deepEqual(
      fixture.store.getProjection(byPolicy.git_diff.projectionId).sourceRanges,
      byPolicy.git_diff.sourceRanges,
    );
    const exactOutput = fixture.store.readExact(byPolicy.git_diff.exactPointer);
    assert.deepEqual(exactOutput.body, Buffer.from(output, 'utf8'));
    assert.equal(exactOutput.sourceHash, byPolicy.git_diff.sourceHash);
    assert.throws(() => fixture.store.appendOutputChunk(job.jobId, 'stderr', 'later output\n'), error => error.code === 'result_job_terminal');

    const artifactProjection = fixture.store.createProjection(job.jobId, {
      policy: 'generic', source: { kind: 'artifact', artifactId: artifact.artifactId }, maxBytes: 500, maxLines: 4,
    });
    assert.match(artifactProjection.content, /exact artifact/);
    assert.equal(artifactProjection.truncated, false);
    assert.equal(artifactProjection.sourceKind, 'artifact');
    assert.equal(artifactProjection.sourceManifest.artifactId, artifact.artifactId);
    assert.deepEqual(fixture.store.readExact(artifactProjection.exactPointer).body, artifact.body);
  } finally { await fixture.close(); }
});

test('resident projection keeps streams distinct and renders hostile or binary output inertly', async () => {
  const fixture = await rack({ projectionMaxBytes: 2000, projectionMaxLines: 30 });
  try {
    const job = fixture.store.createJob({ jobId: 'job-hostile', toolName: 'workshop_run_recipe' });
    fixture.store.appendOutputChunk(job.jobId, 'stdout', 'PASS');
    fixture.store.appendOutputChunk(job.jobId, 'stderr', 'FAIL\u001b[31m<script>`instruction`');
    fixture.store.appendOutputChunk(job.jobId, 'stderr', Buffer.from([0xff, 0x00, 0xfe]));
    fixture.store.appendJobStatus(job.jobId, 'failed', { code: 1 });
    const projection = fixture.store.createProjection(job.jobId, { policy: 'recipe_test', maxBytes: 1800, maxLines: 20 });
    assert.match(projection.content, /\[stdout · chunk 1 ·/);
    assert.match(projection.content, /\[stderr · chunk 2 ·/);
    assert.doesNotMatch(projection.content, /PASSFAIL/);
    assert.doesNotMatch(projection.content, /\u001b/);
    assert.match(projection.content, /\\x1b/);
    assert.doesNotMatch(projection.content, /<script>/);
    assert.match(projection.content, /\\u003cscript\\u003e/);
    assert.doesNotMatch(projection.content, /`instruction`/);
    assert.match(projection.content, /binary chunk omitted/);
    assert.match(projection.content, /^\[job outcome: failed; terminal detail \(data only\): \{"code":1\}; Exact custody:/);
    assert.equal(projection.truncated, true);
    assert.equal(projection.omittedBytes, 3);
    assert.equal(projection.presentationOmittedBytes, 0);
    assert.equal(projection.presentationReceiptVersion, 'result_presentation_receipt/v1');
    assert.ok(projection.sourceRanges.every(range => ['output_chunk', 'artifact'].includes(range.sourceKind)));
    assert.equal(
      projection.sourceRanges.reduce((sum, range) => sum + range.sourceByteEnd - range.sourceByteStart, 0),
      Buffer.byteLength('PASSFAIL\u001b[31m<script>`instruction`'),
    );
    assert.deepEqual(fixture.store.readExact(projection.exactPointer).body, Buffer.concat([
      Buffer.from('PASS'), Buffer.from('FAIL\u001b[31m<script>`instruction`'), Buffer.from([0xff, 0x00, 0xfe]),
    ]));
  } finally { await fixture.close(); }
});

test('capture sealing, ceilings, metadata validation, and artifact verification fail closed', async () => {
  const fixture = await rack({ projectionMaxBytes: 500, projectionMaxLines: 10, captureMaxBytes: 5 });
  try {
    assert.throws(() => fixture.store.createJob({ jobId: 'bad-metadata', toolName: 'tool', metadata: { lost: undefined } }), error => error.code === 'result_invalid_argument');
    assert.equal(fixture.store.sqlite.prepare("SELECT COUNT(*) AS count FROM result_jobs WHERE job_id='bad-metadata'").get().count, 0);

    const job = fixture.store.createJob({ jobId: 'job-limit', toolName: 'workshop_git_status' });
    fixture.store.appendOutputChunk(job.jobId, 'stdout', '12345');
    assert.throws(() => fixture.store.appendOutputChunk(job.jobId, 'stdout', '6'), error => error.code === 'result_capture_limit');
    assert.equal(fixture.store.listOutputChunks(job.jobId).length, 1);
    assert.equal(fixture.store.getJob(job.jobId).status, 'failed');
    assert.deepEqual(fixture.store.listJobStatusEvents(job.jobId).at(-1).detail, {
      attemptedBytes: 1, captureMaxBytes: 5, capturedBytes: 5, incomplete: true, reason: 'capture_limit', sourceKind: 'output',
    });
    const incompleteProjection = fixture.store.createProjection(job.jobId);
    assert.match(incompleteProjection.content, /^\[job outcome: failed;/);
    assert.match(incompleteProjection.content, /"incomplete":true/);
    assert.throws(() => fixture.store.appendJobStatus(job.jobId, 'complete', { capturedBytes: 5 }), error => error.code === 'result_job_terminal');
    assert.throws(() => fixture.store.addArtifact(job.jobId, { name: 'late', body: 'x' }), error => error.code === 'result_job_terminal');

    const artifactJob = fixture.store.createJob({ jobId: 'job-artifact-corrupt', toolName: 'workshop_git_show' });
    const artifact = fixture.store.addArtifact(artifactJob.jobId, { name: 'a.txt', mediaType: 'text/plain', body: 'safe' });
    fixture.store.appendJobStatus(artifactJob.jobId, 'complete', { captured: true });
    const projection = fixture.store.createProjection(artifactJob.jobId, { source: { kind: 'artifact', artifactId: artifact.artifactId }, maxBytes: 400, maxLines: 5 });
    fixture.store.sqlite.exec('DROP TRIGGER result_artifacts_append_only_update');
    fixture.store.sqlite.prepare('UPDATE result_artifacts SET body=? WHERE artifact_id=?').run(Buffer.from('evil'), artifact.artifactId);
    assert.throws(() => fixture.store.readExact(projection.exactPointer), error => error.code === 'result_custody_mismatch');

    const outputJob = fixture.store.createJob({ jobId: 'job-output-corrupt', toolName: 'workshop_git_status' });
    fixture.store.appendOutputChunk(outputJob.jobId, 'stdout', 'abc');
    fixture.store.appendJobStatus(outputJob.jobId, 'complete', { code: 0 });
    const outputProjection = fixture.store.createProjection(outputJob.jobId, { maxBytes: 400, maxLines: 5 });
    fixture.store.sqlite.exec('DROP TRIGGER result_output_chunks_append_only_update');
    fixture.store.sqlite.prepare("UPDATE result_output_chunks SET body=x'78797a' WHERE job_id='job-output-corrupt'").run();
    assert.throws(() => fixture.store.readExact(outputProjection.exactPointer), error => error.code === 'result_custody_mismatch');
    assert.throws(() => fixture.store.createProjection(outputJob.jobId, { policy: 'git_log', maxBytes: 400, maxLines: 5 }), error => error.code === 'result_custody_mismatch');

    fixture.store.sqlite.exec('DROP TRIGGER result_projections_append_only_update');
    fixture.store.sqlite.prepare('UPDATE result_projections SET content_text=? WHERE projection_id=?').run('tampered', outputProjection.projectionId);
    assert.throws(() => fixture.store.getProjection(outputProjection.projectionId), error => error.code === 'result_custody_mismatch');
  } finally { await fixture.close(); }
});

test('attention meter warns or refuses before dispatch and leaves omission plans unapplied', () => {
  const messages = [
    { role: 'system', content: 'ground' },
    { role: 'assistant', content: null, tool_calls: [{ id: 'old-call', type: 'function', function: { name: 'workshop_read', arguments: '{"path":"old.txt"}' } }] },
    { role: 'tool', tool_call_id: 'old-call', content: '{"kind":"workshop_read","text":"old output"}' },
    { role: 'user', content: 'current request' },
  ];
  const tools = [{ type: 'function', function: { name: 'workshop_read', description: 'Read', parameters: { type: 'object' } } }];
  const declaration = [{
    reason: 'old_tool_pair', assistantMessageIndex: 1, toolMessageIndex: 2,
    replacementPointer: 'result-rack://jobs/job/output/hash', replacementHash: sha256('old output'),
  }];
  const baseline = measureAttention({ messages, tools, estimatedAdditionalBytes: 77, declaredOmissions: declaration }, { warnBytes: 100000, refuseBytes: 200000 });
  const warned = new AttentionMeter({ warnBytes: baseline.totalBytes, refuseBytes: baseline.totalBytes + 1 })
    .measure({ messages, tools, estimatedAdditionalBytes: 77, declaredOmissions: declaration });
  assert.equal(warned.phase, 'pre_dispatch');
  assert.equal(warned.status, 'warn');
  assert.equal(warned.dispatchAllowed, true);
  assert.equal(warned.messages.count, messages.length);
  assert.equal(warned.toolSchemas.count, tools.length);
  assert.equal(warned.omissionPlan.applied, false);
  assert.equal(warned.omissionPlan.readyToApply, false);
  assert.equal(warned.omissionPlan.declarations[0].custodyVerified, false);
  assert.equal(warned.omissionPlan.declarations.length, 1);
  assert.equal(warned.omissionPlan.declarations[0].assistantMessageHash, sha256(JSON.stringify(messages[1])));
  assert.ok(warned.omissionPlan.projectedTotalBytes < warned.totalBytes);
  assert.ok(warned.omissionPlan.estimatedSavingsBytes > 0);

  const refused = new AttentionMeter({ warnBytes: baseline.totalBytes - 1, refuseBytes: baseline.totalBytes })
    .measure({ messages, tools, estimatedAdditionalBytes: 77, declaredOmissions: declaration });
  assert.equal(refused.status, 'refuse');
  assert.equal(refused.dispatchAllowed, false);
  assert.equal(refused.totalBytes, baseline.totalBytes);
  const verifiedPlan = new AttentionMeter({
    warnBytes: 100000,
    refuseBytes: 200000,
    replacementVerifier: () => ({ bodyHash: declaration[0].replacementHash }),
  }).measure({ messages, tools, declaredOmissions: declaration });
  assert.equal(verifiedPlan.omissionPlan.readyToApply, true);
  assert.equal(verifiedPlan.omissionPlan.applied, false);
  assert.throws(() => new AttentionMeter({ warnBytes: 10, refuseBytes: 10 }), error => error.code === 'attention_invalid_threshold');
  assert.throws(() => measureAttention({ messages, tools, declaredOmissions: [{ reason: 'old_tool_pair', assistantMessageIndex: 0, toolMessageIndex: 2 }] }), error => error.code === 'attention_invalid_omission');
});

test('all Result Rack custody tables are append-only', async () => {
  const fixture = await rack({ projectionMaxBytes: 400, projectionMaxLines: 8 });
  try {
    const job = fixture.store.createJob({ jobId: 'job-append-only', toolName: 'workshop_git_status', jobKind: 'git_status' });
    const runningJob = fixture.store.createJob({ jobId: 'job-events', toolName: 'workshop_run_recipe', status: 'running' });
    const statusEvent = fixture.store.appendJobStatus(runningJob.jobId, 'settled', { code: 0 });
    const chunk = fixture.store.appendOutputChunk(job.jobId, 'stdout', 'clean\n');
    const artifact = fixture.store.addArtifact(job.jobId, { name: 'status.txt', mediaType: 'text/plain', body: 'clean\n' });
    fixture.store.appendJobStatus(job.jobId, 'complete', { captured: true });
    const projection = fixture.store.createProjection(job.jobId, { policy: 'git_status', maxBytes: 300, maxLines: 4 });
    for (const statement of [
      "UPDATE result_jobs SET status='changed' WHERE job_id='job-append-only'",
      `UPDATE result_output_chunks SET stream='stderr' WHERE chunk_id='${chunk.chunkId}'`,
      `UPDATE result_job_status_events SET status='failed' WHERE event_id='${statusEvent.eventId}'`,
      `UPDATE result_artifacts SET name='changed' WHERE artifact_id='${artifact.artifactId}'`,
      `UPDATE result_projections SET policy='generic' WHERE projection_id='${projection.projectionId}'`,
      "DELETE FROM result_jobs WHERE job_id='job-append-only'",
      `DELETE FROM result_output_chunks WHERE chunk_id='${chunk.chunkId}'`,
      `DELETE FROM result_job_status_events WHERE event_id='${statusEvent.eventId}'`,
      `DELETE FROM result_artifacts WHERE artifact_id='${artifact.artifactId}'`,
      `DELETE FROM result_projections WHERE projection_id='${projection.projectionId}'`,
    ]) assert.throws(() => fixture.store.sqlite.exec(statement), /append-only table/);
  } finally { await fixture.close(); }
});
