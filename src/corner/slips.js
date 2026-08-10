function parsed(value, fallback = {}) {
  try { return typeof value === 'string' ? JSON.parse(value) : value || fallback; } catch { return fallback; }
}

function roomLabel(roomId) {
  if (roomId === 'room.workshop') return 'Workshop';
  if (roomId === 'room.center') return 'Center';
  return roomId || 'the next room';
}

function fixtureLabel(fixtureId) {
  return String(fixtureId || 'fixture').replace(/^fixture\./, '').replace(/^workshop_/, '').replaceAll('_', ' ');
}

export function approvalSummary(approval) {
  const preview = approval?.preview || {};
  const path = preview.path || preview.toPath || preview.fromPath || (Array.isArray(preview.paths) ? preview.paths.join(', ') : null);
  if (approval?.kind === 'delete_path') return `Delete · ${path || 'path'}`;
  if (approval?.kind === 'git_checkout') return `Checkout · ${preview.branch || 'branch'}`;
  if (approval?.kind === 'commit') return `Commit · ${preview.message || 'message'}`;
  if (approval?.kind === 'git_add') return `Stage · ${path || 'paths'}`;
  if (approval?.kind === 'rename_path') return `Rename · ${preview.fromPath || '?'} → ${preview.toPath || '?'}`;
  if (approval?.kind === 'write_file') return `Write · ${path || 'file'}`;
  if (approval?.kind === 'create_path') return `Create · ${path || 'path'}`;
  if (approval?.kind === 'patch' || approval?.kind === 'unified_diff') return `Patch · ${path || 'diff'}`;
  return `${approval?.kind || 'cut'}${path ? ` · ${path}` : ''}`;
}

function pendingLabel(toolName, result) {
  const preview = result?.preview || {};
  const path = preview.path || preview.toPath || preview.fromPath;
  if (toolName === 'workshop_delete_path' || result?.kind === 'workshop_delete_path') return `Delete waiting · ${path || 'path'}`;
  if (toolName === 'workshop_git_checkout' || result?.kind === 'workshop_git_checkout') return `Checkout waiting · ${preview.branch || 'branch'}`;
  if (path) return `Cut waiting · ${path}`;
  return 'Cut waiting on the workbench';
}

function appliedLabel(result) {
  const outcome = result?.outcome || {};
  const path = outcome.path || outcome.toPath || outcome.fromPath || result?.approval?.preview?.path;
  if (result?.approval?.kind === 'commit') return `Commit landed · ${result.approval.preview?.message || 'message'}`;
  if (result?.approval?.kind === 'git_add') return 'Staged on the ledger';
  if (path) return `Cut applied · ${path}`;
  return 'Cut applied';
}

function actionLabel(receipt) {
  const args = parsed(receipt.arguments_json);
  const result = parsed(receipt.result_json);
  if (receipt.outcome === 'refused') return { kind: 'outcome', label: `Refused · ${result.error || 'action_refused'}`, detail: result.message || undefined };
  if (receipt.tool_name === 'tend_hearth') return null;
  if (receipt.tool_name === 'move_through_door') return { kind: 'action', label: `Steps through to ${roomLabel(result.toRoom || result.projection?.roomId)}` };
  if (receipt.tool_name === 'inspect_fixture') return { kind: 'action', label: `Looks at the ${fixtureLabel(result.fixtureId || args.fixture_id)}` };
  if (receipt.tool_name === 'engage_fixture') return { kind: 'action', label: `Engages the ${fixtureLabel(result.fixtureId || args.fixture_id)}` };
  if (receipt.tool_name === 'disengage_fixture') return { kind: 'action', label: 'Steps back from the fixture' };
  if (['workshop_list', 'workshop_read', 'workshop_search', 'workshop_search_regex', 'workshop_glob', 'workshop_tree', 'workshop_stat', 'workshop_file_hash'].includes(receipt.tool_name)) return { kind: 'action', label: 'Looks through the Workshop' };
  if (receipt.tool_name.startsWith('workshop_') && result.status === 'pending_approval') {
    return {
      kind: 'pending',
      label: pendingLabel(receipt.tool_name, result),
      approvalId: result.approvalId,
      decidable: Boolean(result.approvalId),
      detail: approvalSummary({ kind: result.preview?.kind || receipt.tool_name.replace(/^workshop_/, ''), preview: result.preview }),
    };
  }
  if (result.kind === 'workshop_approval_confirmed') return { kind: 'action', label: appliedLabel(result) };
  if (receipt.tool_name === 'workshop_run_recipe' && result.status === 'started') return { kind: 'action', label: 'Kiln started · leave anytime' };
  if (receipt.tool_name === 'workshop_timer_set') return { kind: 'action', label: 'Sets a timer' };
  return null;
}

export function projectWakeSlips({ wake, history = [], world = null, pendingApprovals = [] }) {
  const slips = [];
  const approvalsById = new Map(pendingApprovals.map(approval => [approval.approvalId, approval]));
  const receipts = world?.sqlite?.prepare('SELECT * FROM world_action_receipts WHERE wake_id=? ORDER BY created_at, receipt_id').all(wake.id) || [];
  const receiptsByRequest = new Map();
  const orphanReceipts = [];
  const phaseIds = new Set((wake?.phases || []).map(phase => phase.id));
  for (const receipt of receipts) {
    if (!receipt.request_record_id || !phaseIds.has(receipt.request_record_id)) {
      orphanReceipts.push(receipt);
      continue;
    }
    const group = receiptsByRequest.get(receipt.request_record_id) || [];
    group.push(receipt);
    receiptsByRequest.set(receipt.request_record_id, group);
  }
  const appendReceipt = receipt => {
    const slip = actionLabel(receipt);
    if (!slip) return;
    if (slip.kind === 'pending') {
      const approval = approvalsById.get(slip.approvalId);
      if (!approval || approval.status !== 'pending') return;
    }
    slips.push({ id: `action:${receipt.receipt_id}`, ...slip, createdAt: receipt.created_at });
  };
  for (const phase of wake?.phases || []) {
    const label = phase.phase === 'orientation' ? 'Orienting' : 'Considering…';
    slips.push({ id: `phase:${phase.id}`, kind: 'phase', label, createdAt: phase.createdAt });
    const thinking = phase.responseMessage?.reasoning_content;
    if (typeof thinking === 'string' && thinking.trim()) slips.push({ id: `thinking:${phase.id}`, kind: 'thinking', label: 'Thinking', detail: thinking, expandable: true, createdAt: phase.completedAt || phase.createdAt });
    for (const receipt of receiptsByRequest.get(phase.id) || []) appendReceipt(receipt);
  }
  for (const receipt of orphanReceipts) appendReceipt(receipt);
  for (const approval of pendingApprovals.filter(item => item.wakeId === wake?.id && item.status === 'pending')) {
    if (slips.some(slip => slip.kind === 'pending' && slip.approvalId === approval.approvalId)) continue;
    slips.push({
      id: `pending:${approval.approvalId}`,
      kind: 'pending',
      label: pendingLabel(`workshop_${approval.kind}`, { preview: approval.preview, kind: `workshop_${approval.kind}` }),
      approvalId: approval.approvalId,
      decidable: true,
      detail: approvalSummary(approval),
      createdAt: approval.createdAt || wake.completedAt || wake.startedAt,
    });
  }
  return { wakeId: wake?.id || null, status: wake?.status || 'unknown', slips };
}
