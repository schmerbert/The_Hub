import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { canonicalize, sha256 } from '../core/hash.js';
import { readSpineFrames } from '../spine/store.js';
import { ForestStore } from './store.js';
import { verifyForest } from './verify.js';

function exactSources(action) {
  let result;
  try { result = JSON.parse(action.result_json); } catch { throw new Error(`World action result is not valid JSON for ${action.receipt_id}.`); }
  const rows = action.tool_name === 'workshop_read'
    ? [{ path: result.source?.path, startLine: result.source?.startLine, endLine: result.source?.endLine, text: result.source?.text, hash: result.source?.hash, byteLength: result.source?.byteLength }]
    : (Array.isArray(result.matches) ? result.matches.map(match => ({ path: match.path, startLine: match.line, endLine: match.line, text: match.text, hash: match.hash, byteLength: match.byteLength })) : null);
  if (!rows || result.kind !== action.tool_name || rows.some(row => !row.path || !Number.isInteger(row.startLine) || !Number.isInteger(row.endLine) || typeof row.text !== 'string' || row.hash !== sha256(row.text))) throw new Error(`World action source result is not exact for ${action.receipt_id}.`);
  return rows;
}

export function eligibleWildActions({ operationalPath, worldPath, spinePath } = {}) {
  if (!operationalPath || !worldPath || !spinePath || !existsSync(operationalPath) || !existsSync(worldPath) || !existsSync(spinePath)) throw new Error('Wild planning requires existing Source, World, and Spine custody.');
  const op = new DatabaseSync(operationalPath, { readOnly: true });
  const world = new DatabaseSync(worldPath, { readOnly: true });
  try {
    const frames = readSpineFrames(spinePath);
    const prepared = new Map(frames.filter(frame => frame.frame_type === 'request_prepared').map(frame => [frame.record_id, frame]));
    const dispatched = new Set(frames.filter(frame => frame.frame_type === 'dispatch_attempted').map(frame => frame.request_record_id));
    const successful = new Set(frames.filter(frame => frame.frame_type === 'provider_outcome' && frame.outcome?.kind === 'success').map(frame => frame.request_record_id));
    const actions = world.prepare("SELECT * FROM world_action_receipts WHERE outcome='committed' AND tool_name IN ('workshop_read','workshop_search') ORDER BY created_at,receipt_id").all();
    return actions.map(action => {
      if (!action.request_record_id || !action.spine_record_id) throw new Error(`Wild workshop action lacks request ancestry for ${action.receipt_id}.`);
      const request = op.prepare('SELECT session_id,wake_id,spine_record_id FROM provider_requests WHERE id=?').get(action.request_record_id);
      const frame = prepared.get(action.spine_record_id);
      if (!request || request.session_id !== action.session_id || request.wake_id !== action.wake_id || request.spine_record_id !== action.spine_record_id || frame?.wake_id !== action.wake_id || !dispatched.has(action.spine_record_id) || !successful.has(action.spine_record_id)) throw new Error(`Wild workshop ancestry is invalid for ${action.receipt_id}.`);
      return { actionReceiptId: action.receipt_id, sourceKind: action.tool_name, requestRecordId: action.request_record_id, spineRecordId: action.spine_record_id, rows: exactSources(action) };
    });
  } finally { world.close(); op.close(); }
}

export function buildWildBackfillPlan({ operationalPath, worldPath, spinePath, forestPath } = {}) {
  const actions = eligibleWildActions({ operationalPath, worldPath, spinePath });
  const forest = forestPath && existsSync(forestPath) ? new DatabaseSync(forestPath, { readOnly: true }) : null;
  try {
    const existing = new Map((forest?.prepare('SELECT * FROM wild_entries').all() || []).map(row => [`${row.action_receipt_id}\0${row.repository_path}\0${row.start_line}\0${row.end_line}`, row]));
    const proposed = [];
    const conflicts = [];
    for (const action of actions) for (const row of action.rows) {
      const key = `${action.actionReceiptId}\0${row.path}\0${row.startLine}\0${row.endLine}`;
      const current = existing.get(key);
      if (!current) proposed.push({ ...action, rows: undefined, row });
      else if (current.source_kind !== action.sourceKind || current.body !== row.text || current.body_hash !== row.hash || current.request_record_id !== action.requestRecordId || current.spine_record_id !== action.spineRecordId) conflicts.push({ actionReceiptId: action.actionReceiptId, path: row.path, startLine: row.startLine, endLine: row.endLine, reason: 'existing custody differs' });
    }
    const summary = { eligibleActionCount: actions.length, eligibleSpanCount: actions.reduce((sum, action) => sum + action.rows.length, 0), existingSpanCount: existing.size, proposedSpanCount: proposed.length, conflicts };
    return { ...summary, planHash: sha256(canonicalize(summary)), proposed };
  } finally { forest?.close(); }
}

export function applyWildBackfill({ operationalPath, worldPath, spinePath, forestPath, confirmApply = false } = {}) {
  if (!confirmApply) throw Object.assign(new Error('Wild Forest catch-up requires --confirm-apply.'), { code: 'confirmation_required' });
  verifyForest({ forestPath, operationalPath, spinePath, worldPath, strictBijection: false, strictWildBijection: false });
  const plan = buildWildBackfillPlan({ operationalPath, worldPath, spinePath, forestPath });
  if (plan.conflicts.length) throw Object.assign(new Error('Wild Forest apply refused custody conflicts.'), { code: 'forest_custody_conflict', conflicts: plan.conflicts });
  const forest = new ForestStore(forestPath, { mode: 'requireExisting' });
  try {
    for (const item of plan.proposed) forest.ingestWorkshopSource({ source: item.sourceKind === 'workshop_read' ? item.row : { matches: [{ path: item.row.path, line: item.row.startLine, text: item.row.text, hash: item.row.hash, byteLength: item.row.byteLength }] }, sourceKind: item.sourceKind, actionReceiptId: item.actionReceiptId, requestRecordId: item.requestRecordId, spineRecordId: item.spineRecordId });
  } finally { forest.close(); }
  const verification = verifyForest({ forestPath, operationalPath, spinePath, worldPath, strictBijection: false, strictWildBijection: true });
  return { planHash: plan.planHash, appliedSpanCount: plan.proposedSpanCount, finalSpanCount: verification.wildCount };
}
