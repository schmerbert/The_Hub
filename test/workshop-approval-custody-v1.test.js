import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorldGraphStore } from '../src/world/graph.js';
import { WorldActionGateway } from '../src/world/gateway.js';
import { WorkshopAdapter } from '../src/places/hub/workshop/index.js';

async function fixture(prefix = 'hub-approval-custody-') {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  const root = join(dir, 'repo');
  await mkdir(root, { recursive: true });
  const world = new WorldGraphStore(join(dir, 'world.sqlite'), { topologyVersion: 'b1' });
  world.ensureLifespan('life');
  world.move({ sessionId: 'life', wakeId: 'move', doorId: 'door.workshop' });
  const gateway = new WorldActionGateway({ world, workshop: new WorkshopAdapter(root), approvalMode: 'confirm' });
  return { dir, root, world, gateway };
}

function toolCall(id, name, args) {
  return { id, type: 'function', function: { name, arguments: JSON.stringify(args) } };
}

async function pendingDelete(f, path = 'target.txt', wakeId = 'delete') {
  return f.gateway.execute({
    sessionId: 'life',
    wakeId,
    requestRecordId: `request-${wakeId}`,
    spineRecordId: `spine-${wakeId}`,
    intent: toolCall(`call-${wakeId}`, 'workshop_delete_path', { path }),
  });
}

function receiptRow(world, receiptId) {
  return world.sqlite.prepare('SELECT * FROM world_approval_receipts WHERE receipt_id=?').get(receiptId);
}

function actionRow(world, receiptId) {
  return world.sqlite.prepare('SELECT * FROM world_action_receipts WHERE receipt_id=?').get(receiptId);
}

test('pending delete and manual confirmation retain applying and terminal custody phases', async () => {
  const f = await fixture();
  const target = join(f.root, 'target.txt');
  await writeFile(target, 'remove once', 'utf8');
  try {
    const pending = await pendingDelete(f);
    const approvalId = pending.result.approvalId;

    assert.equal(pending.result.status, 'pending_approval');
    assert.equal(existsSync(target), true);
    assert.equal(f.world.getApproval(approvalId).status, 'pending');
    assert.equal(pending.approvalReceipt.phase, 'pending');
    assert.equal(pending.approvalReceipt.actionReceiptId, pending.actionReceipt.receiptId);
    assert.equal(pending.approvalReceipt.hostReturnScrubReceiptId, pending.scrub.receipt.receiptId);

    const pendingRow = receiptRow(f.world, pending.approvalReceipt.receiptId);
    assert.equal(pendingRow.approval_id, approvalId);
    assert.equal(pendingRow.phase, 'pending');
    assert.equal(pendingRow.action_receipt_id, pending.actionReceipt.receiptId);
    assert.equal(JSON.parse(pendingRow.host_return_scrub_json).receiptId, pending.scrub.receipt.receiptId);
    assert.equal(actionRow(f.world, pending.actionReceipt.receiptId).tool_name, 'workshop_delete_path');
    assert.equal(actionRow(f.world, pending.actionReceipt.receiptId).outcome, 'committed');

    const confirmed = f.gateway.confirmApproval(approvalId, 'life');
    assert.equal(confirmed.approval.status, 'confirmed');
    assert.equal(existsSync(target), false);
    assert.notEqual(confirmed.actionReceipt.receiptId, pending.actionReceipt.receiptId);
    assert.equal(confirmed.approvalReceipt.phase, 'confirmed');
    assert.equal(confirmed.approvalReceipt.actionReceiptId, confirmed.actionReceipt.receiptId);
    assert.equal(confirmed.approvalReceipt.hostReturnScrubReceiptId, confirmed.scrub.receipt.receiptId);

    const confirmedAction = actionRow(f.world, confirmed.actionReceipt.receiptId);
    assert.equal(confirmedAction.tool_name, 'workshop_approval_confirm');
    assert.equal(confirmedAction.outcome, 'committed');
    const confirmedRow = receiptRow(f.world, confirmed.approvalReceipt.receiptId);
    assert.equal(confirmedRow.phase, 'confirmed');
    assert.equal(confirmedRow.action_receipt_id, confirmed.actionReceipt.receiptId);
    assert.equal(JSON.parse(confirmedRow.host_return_scrub_json).receiptId, confirmed.scrub.receipt.receiptId);

    const receipts = f.world.listApprovalReceipts(approvalId);
    assert.deepEqual(new Set(receipts.map(item => item.phase)), new Set(['pending', 'applying', 'confirmed']));
    assert.equal(receipts.length, 3);
    assert.throws(() => f.gateway.confirmApproval(approvalId, 'life'), error => error.code === 'workshop_approval_not_pending');
    assert.equal(f.world.listApprovalReceipts(approvalId).length, 3);
    assert.equal(existsSync(target), false);

    assert.throws(
      () => f.world.sqlite.prepare('UPDATE world_approval_receipts SET phase=? WHERE receipt_id=?').run('rejected', pending.approvalReceipt.receiptId),
      /append-only table/,
    );
    assert.throws(
      () => f.world.sqlite.prepare('DELETE FROM world_approval_receipts WHERE receipt_id=?').run(confirmed.approvalReceipt.receiptId),
      /append-only table/,
    );
    assert.deepEqual(new Set(f.world.listApprovalReceipts(approvalId).map(item => item.phase)), new Set(['pending', 'applying', 'confirmed']));
  } finally {
    f.gateway.close();
    f.world.close();
    await rm(f.dir, { recursive: true, force: true });
  }
});
test('rejection appends rejected completion custody and never mutates the target', async () => {
  const f = await fixture('hub-approval-reject-');
  const target = join(f.root, 'keep.txt');
  await writeFile(target, 'keep me', 'utf8');
  try {
    const pending = await pendingDelete(f, 'keep.txt', 'reject');
    const approvalId = pending.result.approvalId;
    const rejected = f.gateway.rejectApproval(approvalId, 'life');

    assert.equal(rejected.approval.status, 'rejected');
    assert.equal(await readFile(target, 'utf8'), 'keep me');
    assert.equal(rejected.approvalReceipt.phase, 'rejected');
    assert.notEqual(rejected.actionReceipt.receiptId, pending.actionReceipt.receiptId);
    assert.equal(rejected.approvalReceipt.actionReceiptId, rejected.actionReceipt.receiptId);
    assert.equal(rejected.approvalReceipt.hostReturnScrubReceiptId, rejected.scrub.receipt.receiptId);
    assert.equal(actionRow(f.world, rejected.actionReceipt.receiptId).tool_name, 'workshop_approval_reject');
    assert.equal(actionRow(f.world, rejected.actionReceipt.receiptId).outcome, 'committed');
    assert.deepEqual(new Set(f.world.listApprovalReceipts(approvalId).map(item => item.phase)), new Set(['pending', 'rejected']));
    assert.throws(() => f.gateway.confirmApproval(approvalId, 'life'), error => error.code === 'workshop_approval_not_pending');
    assert.equal(await readFile(target, 'utf8'), 'keep me');
  } finally {
    f.gateway.close();
    f.world.close();
    await rm(f.dir, { recursive: true, force: true });
  }
});

test('startup reconciliation appends cancelled completion custody for a prior lifespan', async () => {
  const f = await fixture('hub-approval-restart-');
  const target = join(f.root, 'stale.txt');
  await writeFile(target, 'still here', 'utf8');
  try {
    const pending = await pendingDelete(f, 'stale.txt', 'restart');
    const approvalId = pending.result.approvalId;
    const reconciled = f.gateway.reconcileStartup('life-next');

    assert.deepEqual(reconciled.lifespan.cancelledApprovalIds, [approvalId]);
    assert.equal(reconciled.cancelledApprovalReceipts.length, 1);
    const cancelled = reconciled.cancelledApprovalReceipts[0];
    assert.equal(cancelled.approval.status, 'cancelled');
    assert.equal(cancelled.reason, 'server_restart');
    assert.equal(cancelled.approvalReceipt.phase, 'cancelled');
    assert.equal(cancelled.approvalReceipt.actionReceiptId, cancelled.actionReceipt.receiptId);
    assert.equal(cancelled.approvalReceipt.hostReturnScrubReceiptId, cancelled.scrub.receipt.receiptId);
    assert.equal(actionRow(f.world, cancelled.actionReceipt.receiptId).tool_name, 'workshop_approval_cancel');
    assert.equal(actionRow(f.world, cancelled.actionReceipt.receiptId).outcome, 'committed');
    assert.deepEqual(new Set(f.world.listApprovalReceipts(approvalId).map(item => item.phase)), new Set(['pending', 'cancelled']));
    assert.equal(await readFile(target, 'utf8'), 'still here');
    assert.throws(() => f.gateway.confirmApproval(approvalId, 'life'), error => error.code === 'workshop_approval_not_pending');
  } finally {
    f.gateway.close();
    f.world.close();
    await rm(f.dir, { recursive: true, force: true });
  }
});

test('auto-class mutation records applying and confirmed receipts with no false pending phase', async () => {
  const f = await fixture('hub-approval-auto-');
  const target = join(f.root, 'created.txt');
  try {
    const applied = await f.gateway.execute({
      sessionId: 'life',
      wakeId: 'auto-write',
      requestRecordId: 'request-auto-write',
      spineRecordId: 'spine-auto-write',
      intent: toolCall('call-auto-write', 'workshop_write_file', { path: 'created.txt', content: 'created once' }),
    });
    const approvalId = applied.result.approval.approvalId;

    assert.equal(applied.result.kind, 'workshop_approval_confirmed');
    assert.equal(applied.result.approval.status, 'confirmed');
    assert.equal(await readFile(target, 'utf8'), 'created once');
    assert.equal(applied.approvalReceipt.phase, 'confirmed');
    assert.equal(applied.approvalReceipt.actionReceiptId, applied.actionReceipt.receiptId);
    assert.equal(applied.approvalReceipt.hostReturnScrubReceiptId, applied.scrub.receipt.receiptId);
    assert.equal(actionRow(f.world, applied.actionReceipt.receiptId).tool_name, 'workshop_write_file');

    const receipts = f.world.listApprovalReceipts(approvalId);
    assert.equal(receipts.length, 2);
    assert.deepEqual(receipts.map(item => item.phase), ['applying', 'confirmed']);
    assert.equal(receipts.some(item => item.phase === 'pending'), false);
    assert.equal(receipts[1].actionReceiptId, applied.actionReceipt.receiptId);
    assert.equal(receipts[1].hostReturnScrub.receiptId, applied.scrub.receipt.receiptId);
  } finally {
    f.gateway.close();
    f.world.close();
    await rm(f.dir, { recursive: true, force: true });
  }
});

test('Result Rack failure after mutation is separate custody refusal and preserves confirmed action truth', async () => {
  const f = await fixture('hub-rack-isolation-');
  const target = join(f.root, 'survives-rack.txt');
  f.gateway.resultRack = {
    createJob() { throw Object.assign(new Error('injected projection storage failure'), { code: 'injected_rack_failure' }); },
  };
  try {
    const applied = await f.gateway.execute({
      sessionId: 'life', wakeId: 'rack-write', requestRecordId: 'request-rack-write', spineRecordId: 'spine-rack-write',
      intent: toolCall('call-rack-write', 'workshop_write_file', { path: 'survives-rack.txt', content: 'authoritative mutation' }),
    });

    assert.equal(await readFile(target, 'utf8'), 'authoritative mutation');
    assert.equal(applied.result.approval.status, 'confirmed');
    assert.equal(applied.actionReceipt.receiptId, applied.approvalReceipt.actionReceiptId);
    assert.equal(actionRow(f.world, applied.actionReceipt.receiptId).outcome, 'committed');
    assert.equal(applied.resultRack, null);
    assert.equal(applied.resultCustodyFailure.error, 'injected_rack_failure');
    assert.equal(applied.resultCustodyFailure.sourceActionReceiptId, applied.actionReceipt.receiptId);
    const failureRow = actionRow(f.world, applied.resultCustodyFailureReceipt.receiptId);
    assert.equal(failureRow.tool_name, 'workshop_result_custody_failure');
    assert.equal(failureRow.outcome, 'refused');
    assert.equal(JSON.parse(failureRow.result_json).sourceActionReceiptId, applied.actionReceipt.receiptId);
    assert.equal(f.world.listApprovalReceipts(applied.result.approval.approvalId).at(-1).phase, 'confirmed');
    assert.equal(
      f.world.sqlite.prepare("SELECT COUNT(*) AS count FROM world_action_receipts WHERE tool_name='workshop_write_file' AND outcome='refused'").get().count,
      0,
    );
  } finally {
    f.gateway.close();
    f.world.close();
    await rm(f.dir, { recursive: true, force: true });
  }
});

test('post-effect custody failure leaves a durable non-retryable applying approval across restart', async () => {
  const f = await fixture('hub-approval-applying-'); const target = join(f.root, 'applied-once.txt');
  let reopenedWorld = null; let reopenedGateway = null; let originalClosed = false;
  try {
    const original = f.world.recordApprovalReceipt;
    f.world.recordApprovalReceipt = function injected(args) {
      if (args.phase === 'confirmed') throw new Error('injected resolved custody failure');
      return original.call(this, args);
    };
    await assert.rejects(f.gateway.execute({
      sessionId: 'life', wakeId: 'apply-failure',
      intent: toolCall('call-apply-failure', 'workshop_write_file', { path: 'applied-once.txt', content: 'external effect\n' }),
    }), /injected resolved custody failure/);
    f.world.recordApprovalReceipt = original;
    const approvalId = f.world.sqlite.prepare("SELECT approval_id FROM world_approvals WHERE status='applying'").get().approval_id;
    assert.equal(await readFile(target, 'utf8'), 'external effect\n');
    const applying = f.world.getApproval(approvalId);
    assert.equal(applying.status, 'applying');
    assert.match(applying.application.attemptId, /^approval_attempt_/);
    assert.equal(applying.application.evidence.postcondition.contentSha256, (await import('../src/core/hash.js')).sha256('external effect\n'));
    assert.equal(f.world.sqlite.prepare("SELECT COUNT(*) AS count FROM world_event_journal WHERE event_kind='approval.resolved/v1' AND aggregate_id=?").get(approvalId).count, 0);
    assert.deepEqual(f.world.listApprovalReceipts(approvalId).map(row => row.phase), ['applying']);
    assert.equal(f.world.verification().verified, true);

    await f.gateway.close(); f.world.close(); originalClosed = true;
    reopenedWorld = new WorldGraphStore(join(f.dir, 'world.sqlite'), { topologyVersion: 'b1' });
    reopenedGateway = new WorldActionGateway({ world: reopenedWorld, workshop: new WorkshopAdapter(f.root), approvalMode: 'confirm' });
    const reconciled = reopenedGateway.reconcileStartup('life-next');
    assert.equal(reconciled.lifespan.cancelledApprovalIds.includes(approvalId), false);
    assert.equal(reopenedWorld.getApproval(approvalId).status, 'applying');
    assert.throws(() => reopenedGateway.confirmApproval(approvalId, 'life'), error => error.code === 'workshop_approval_not_pending');
    assert.throws(() => reopenedGateway.rejectApproval(approvalId, 'life'), error => error.code === 'workshop_approval_not_pending');
    assert.equal(await readFile(target, 'utf8'), 'external effect\n');
  } finally {
    await reopenedGateway?.close().catch(() => {}); reopenedWorld?.close();
    if (!originalClosed) { await f.gateway.close().catch(() => {}); f.world.close(); }
    await rm(f.dir, { recursive: true, force: true });
  }
});
