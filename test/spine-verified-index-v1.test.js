import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalize, sha256 } from '../src/core/hash.js';
import { SpineStore, sessionSpinePath } from '../src/spine/store.js';
import { buildSpineVerifiedIndex, createSpineVerifiedProof, spineForestView, validateSpineVerifiedProof } from '../src/spine/verified-index.js';

async function temp() { return mkdtemp(join(tmpdir(), 'hub-spine-proof-')); }

function requestBody(content = 'hello') {
  return JSON.stringify({ model: 'test-model', messages: [{ role: 'user', content }], stream: false, thinking: { type: 'disabled' } });
}

function seed(path, { sessionId = null, body = requestBody() } = {}) {
  const spine = new SpineStore(path, { sessionId });
  const prepared = spine.prepareRequest({ requestBody: body, threadId: 'thread-1', wakeId: `wake-${sessionId || 'base'}`, provider: 'deepseek', model: 'test-model', authorizationPresent: true, requestPhase: 'ordinary' });
  spine.dispatchAttempted(prepared.record_id);
  spine.providerRawReturn(prepared.record_id, { body: JSON.stringify({ id: 'response', choices: [] }), httpStatus: 200, contentType: 'application/json', phase: 'ordinary' });
  spine.providerOutcome(prepared.record_id, { kind: 'success', http_status: 200, response_id: `response-${sessionId || 'base'}` });
  spine.close();
  return prepared.record_id;
}

test('Spine proof retains compact prepared/lifecycle custody and equivalent Forest view', async () => {
  const dir = await temp();
  const path = join(dir, 'spine.jsonl');
  try {
    seed(path);
    const proof = createSpineVerifiedProof(path);
    assert.equal(proof.mode, 'full');
    assert.equal(proof.ledgerCount, 1);
    assert.equal(proof.frameCount, 4);
    assert.equal(proof.requestCount, 1);
    assert.equal(proof.ledgers[0].frameCount, 4);
    assert.equal(proof.ledgers[0].byteBoundary, (await readFile(path)).length);
    assert.match(proof.ledgers[0].terminalRecordHash, /^[a-f0-9]{64}$/);
    assert.equal(proof.preparedRequests[0].requestBody, requestBody());
    assert.equal(proof.preparedRequests[0].rawReturn.bodySha256.length, 64);
    assert.equal(Object.hasOwn(proof.preparedRequests[0].rawReturn, 'body'), false);
    assert.doesNotMatch(JSON.stringify(proof), /raw_body_base64/);
    const view = spineForestView(proof);
    assert.equal(view.preparedFrames[0].request_body, requestBody());
    assert.equal(view.lifecycleByRequest.get(proof.preparedRequests[0].recordId).dispatched, true);
    assert.equal(view.lifecycleByRequest.get(proof.preparedRequests[0].recordId).outcome.kind, 'success');
    assert.equal(buildSpineVerifiedIndex(path).compactIndexHash, proof.compactIndexHash);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('Spine proof validates unchanged and lawful appended suffixes without decoding old raw returns', async () => {
  const dir = await temp();
  const path = join(dir, 'spine.jsonl');
  try {
    const firstId = seed(path);
    const proof = createSpineVerifiedProof(path);
    const unchanged = validateSpineVerifiedProof(path, proof);
    assert.equal(unchanged.mode, 'checkpoint_unchanged');
    assert.equal(unchanged.appendedFrameCount, 0);

    const spine = new SpineStore(path);
    const second = spine.prepareRequest({ requestBody: requestBody('later'), threadId: 'thread-1', wakeId: 'wake-later', provider: 'deepseek', model: 'test-model', authorizationPresent: true, requestPhase: 'ordinary' });
    spine.dispatchAttempted(second.record_id);
    spine.providerOutcome(second.record_id, { kind: 'network_error', network_code: 'fetch_failed' });
    spine.close();
    const appended = validateSpineVerifiedProof(path, proof);
    assert.equal(appended.mode, 'checkpoint_suffix');
    assert.equal(appended.appendedFrameCount, 3);
    assert.equal(appended.frameCount, 7);
    assert.equal(appended.preparedRequests.length, 2);
    assert.equal(appended.preparedRequests.find(request => request.recordId === firstId).rawReturn.bodySha256.length, 64);
    assert.equal(appended.lifecycleByRequest.get(second.record_id).outcome.network_code, 'fetch_failed');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('Spine proof rejects truncation, partial suffixes, broken links, and incompatible versions', async () => {
  const dir = await temp();
  const path = join(dir, 'spine.jsonl');
  try {
    seed(path);
    const proof = createSpineVerifiedProof(path);
    const original = await readFile(path);

    await writeFile(path, original.subarray(0, -1));
    assert.throws(() => validateSpineVerifiedProof(path, proof), /shorter than its retained|prefix changed/);
    await writeFile(path, original);

    await appendFile(path, '{"partial":true}', 'utf8');
    assert.throws(() => validateSpineVerifiedProof(path, proof), /partial/);
    await writeFile(path, original);

    const broken = { schema_version: 1, frame_type: 'dispatch_attempted', record_id: 'spine_broken', previous_record_hash: proof.ledgers[0].terminalRecordHash, request_record_id: 'missing' };
    broken.record_hash = sha256(canonicalize(broken));
    await appendFile(path, `${JSON.stringify(broken)}\n`, 'utf8');
    assert.throws(() => validateSpineVerifiedProof(path, proof), /prepared frame/);
    await writeFile(path, original);

    const incompatible = { ...proof, verifierVersion: 'spine_verifier/v2' };
    assert.throws(() => validateSpineVerifiedProof(path, incompatible), error => error.code === 'spine_version_incompatible');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('Spine proof rejects changed ledger sets and cross-ledger duplicates but admits a new empty session ledger', async () => {
  const dir = await temp();
  const path = join(dir, 'spine.jsonl');
  try {
    const firstId = seed(path);
    const proof = createSpineVerifiedProof(path);

    const extraPath = sessionSpinePath(path, 'session_new');
    await mkdir(join(dir, 'sessions'), { recursive: true });
    await writeFile(extraPath, '', 'utf8');
    const withEmptyLedger = validateSpineVerifiedProof(path, proof);
    assert.equal(withEmptyLedger.mode, 'checkpoint_suffix');
    assert.equal(withEmptyLedger.ledgerCount, 2);
    assert.equal(withEmptyLedger.frameCount, proof.frameCount);

    await writeFile(extraPath, `${(await readFile(path, 'utf8'))}`, 'utf8');
    assert.throws(() => validateSpineVerifiedProof(path, proof), /duplicate record ID/);
    await rm(extraPath);

    const sessionPath = sessionSpinePath(path, 'session_retained');
    seed(path, { sessionId: 'session_retained', body: requestBody('session') });
    const withSession = createSpineVerifiedProof(path);
    await rm(sessionPath);
    assert.throws(() => validateSpineVerifiedProof(path, withSession), error => error.code === 'spine_ledger_set_changed');
    assert.equal(firstId.startsWith('spine_'), true);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
