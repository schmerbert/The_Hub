import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as resultFacade from '../src/world/results.js';
import { ResultRackStore } from '../src/result-rack/store.js';
import { RESULT_PROJECTION_POLICIES, RESULT_PROJECTION_VERSION, projectionPolicyFor } from '../src/result-rack/projection.js';
import { AttentionMeter, measureAttention } from '../src/context/attention-meter.js';
import {
  assertWorkshopRepositoryPath as graphAssertPath,
  resolveRepositoryPath as graphResolvePath,
} from '../src/world/graph.js';
import {
  assertWorkshopRepositoryPath,
  resolveRepositoryPath,
} from '../src/workshop/path-law.js';

test('cleanup facades preserve every public Result Rack and path-law export', () => {
  assert.deepEqual(Object.keys(resultFacade).sort(), [
    'AttentionMeter',
    'RESULT_PROJECTION_POLICIES',
    'RESULT_PROJECTION_VERSION',
    'ResultRackStore',
    'measureAttention',
    'projectionPolicyFor',
  ]);
  assert.strictEqual(resultFacade.ResultRackStore, ResultRackStore);
  assert.strictEqual(resultFacade.AttentionMeter, AttentionMeter);
  assert.strictEqual(resultFacade.measureAttention, measureAttention);
  assert.strictEqual(resultFacade.RESULT_PROJECTION_POLICIES, RESULT_PROJECTION_POLICIES);
  assert.equal(resultFacade.RESULT_PROJECTION_VERSION, RESULT_PROJECTION_VERSION);
  assert.strictEqual(resultFacade.projectionPolicyFor, projectionPolicyFor);
  assert.strictEqual(graphAssertPath, assertWorkshopRepositoryPath);
  assert.strictEqual(graphResolvePath, resolveRepositoryPath);
});

test('path-law compatibility exports retain exact normalization and refusal contracts', () => {
  assert.equal(graphAssertPath('src\\world\\graph.js'), 'src/world/graph.js');
  for (const requested of ['../escape', '.git/config', '.runtime/job', '.env.local', '.gitignore', 'api-token.txt']) {
    let direct; let compatibility;
    try { assertWorkshopRepositoryPath(requested); } catch (error) { direct = { code: error.code, message: error.message }; }
    try { graphAssertPath(requested); } catch (error) { compatibility = { code: error.code, message: error.message }; }
    assert.deepEqual(compatibility, direct, requested);
  }
});

test('Result Rack projection identity and fitted bytes remain on the v1 golden contract', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-result-cleanup-contract-'));
  const store = new resultFacade.ResultRackStore(join(dir, 'results.sqlite'), { projectionMaxBytes: 800, projectionMaxLines: 20 });
  try {
    const job = store.createJob({ jobId: 'result_job_cleanup_contract', toolName: 'workshop_git_diff', metadata: { contract: 'v1' } });
    store.appendOutputChunk(job.jobId, 'stdout', 'alpha\n<secret>&\n');
    store.appendOutputChunk(job.jobId, 'stderr', 'omega\n');
    store.appendJobStatus(job.jobId, 'settled', { ok: true, code: 0 });
    const projection = store.createProjection(job.jobId, { maxBytes: 480, maxLines: 6 });
    assert.deepEqual({
      projectionId: projection.projectionId,
      policy: projection.policy,
      sourceHash: projection.sourceHash,
      content: projection.content,
      contentHash: projection.contentHash,
      byteLength: projection.byteLength,
      lineCount: projection.lineCount,
      truncated: projection.truncated,
      omittedBytes: projection.omittedBytes,
      presentationOmittedBytes: projection.presentationOmittedBytes,
      omittedLines: projection.omittedLines,
      exactPointer: projection.exactPointer,
      encoding: projection.encoding,
      presentationReceiptVersion: projection.presentationReceiptVersion,
      sourceRanges: projection.sourceRanges,
      terminal: projection.sourceManifest.terminal,
    }, {
      projectionId: 'result_projection_a9d7c13bc2e5a8a9654482e81c3160486d6bbccdd5bd2123558afc99234d942a',
      policy: 'git_diff',
      sourceHash: 'ab2f8837ded300f6d31b01e8e41f575d637e11c48529216c06c8866703bf3b88',
      content: '[job outcome: settled; terminal detail (data only): {"code":0,"ok":true}; Exact custody: result-rack://jobs/result_job_cleanup_contract/output/ab2f8837ded300f6d31b01e8e41f575d637e11c48529216c06c8866703bf3b88]\n[stdout · chunk 1 · 16 bytes] alpha\n\\u003csecret\\u003e\\u0026\n[stderr · chunk 2 · 6 bytes] omega\n',
      contentHash: '820530908a1f7b791851c781b0584cd74c649d8cfdf7aa8984a08e169c314cae',
      byteLength: 309,
      lineCount: 4,
      truncated: false,
      omittedBytes: 0,
      presentationOmittedBytes: 0,
      omittedLines: 0,
      exactPointer: 'result-rack://jobs/result_job_cleanup_contract/output/ab2f8837ded300f6d31b01e8e41f575d637e11c48529216c06c8866703bf3b88',
      encoding: 'inert_utf8_v2',
      presentationReceiptVersion: 'result_presentation_receipt/v1',
      sourceRanges: [
        { sourceKind: 'output_chunk', chunkId: 'result_chunk_333c3e73be5ad1f054e275cb65c599e5e7f12abe35563f82f11ee52d5be9c510', stream: 'stdout', sourceByteStart: 0, sourceByteEnd: 16, presentationByteStart: 32, presentationByteEnd: 63 },
        { sourceKind: 'output_chunk', chunkId: 'result_chunk_54118d3f0f201834b3ff62c19afcb617e1c9cdd1651480189ec5b4178ead6eba', stream: 'stderr', sourceByteStart: 16, sourceByteEnd: 22, presentationByteStart: 94, presentationByteEnd: 100 },
      ],
      terminal: { eventId: 'result_status_d231ed30ac94c44217417180064550f08f736680f722df841a3c29447d31fce4', ordinal: 1, status: 'settled', detail: { code: 0, ok: true }, detailHash: '14c0714ad3fa1c07af76f878c07601a619f71bf073a7f982582026ffe6b8f686' },
    });
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});
