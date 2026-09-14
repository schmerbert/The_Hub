import { DatabaseSync } from 'node:sqlite';
import { canonicalize, sha256 } from '../core/hash.js';
import {
  WORLD_PROJECTOR_VERSION, WORLD_EVENT_GENESIS_HASH, WORLD_EVENT_KINDS,
  WORLD_EVENT_JOURNAL_TABLE_SQL,
  WORLD_INTEGRITY_TRIGGER_SQL, WORLD_A2_PROJECTION_TABLE_SQL, WORLD_PROJECTION_TABLE_SQL,
  WORLD_CUSTODY_TABLE_SQL, NODE_COLUMNS, EDGE_COLUMNS, LOCATION_COLUMNS,
  FIXTURE_RUNTIME_COLUMNS, TIMER_COLUMNS, BRIEF_COLUMNS, APPROVAL_COLUMNS,
  ACTION_RECEIPT_COLUMNS, APPROVAL_RECEIPT_COLUMNS, PASSAGE_COLUMNS, OBJECT_STATE_COLUMNS,
} from './event-contract.js';
import {
  computeWorldEventHash, custodyRowHash, readWorldA2Projection,
  readWorldPhysicalProjection, readWorldProjection,
} from './event-journal.js';
import { emptyWorldState, reduceWorldEvent } from './event-reducer.js';

function tableExists(sqlite, name) { return Boolean(sqlite.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=?").get(name)); }
function boundedDiagnostic(value, depth = 0) {
  if (typeof value === 'string') return value.length <= 512 ? value : `${value.slice(0, 160)}…[${value.length} chars; sha256:${sha256(value)}]`;
  if (!value || typeof value !== 'object' || depth >= 3) return value;
  if (Array.isArray(value)) return value.slice(0, 20).map(item => boundedDiagnostic(item, depth + 1));
  return Object.fromEntries(Object.entries(value).slice(0, 30).map(([key, nested]) => [key, boundedDiagnostic(nested, depth + 1)]));
}
function addMismatch(mismatches, limit, mismatch) { if (mismatches.length < limit) mismatches.push(boundedDiagnostic(mismatch)); }
function normalizeTriggerSql(sql) {
  return String(sql || '').toLowerCase().replace(/create\s+trigger\s+if\s+not\s+exists/, 'create trigger').replace(/\s+/g, '').replace(/;+$/g, '');
}
function normalizeTableSql(sql) {
  return String(sql || '').toLowerCase().replace(/create\s+table\s+if\s+not\s+exists/, 'create table').replace(/["`\[\]]/g, '').replace(/\s+/g, '').replace(/;+$/g, '');
}
function compareRows(actual, expected, columns, table, mismatches, limit, identityColumns = [columns[0]]) {
  const identityOf = row => identityColumns.map(column => String(row[column])).join(':');
  const actualByKey = new Map(actual.map(row => [identityOf(row), row])); const expectedByKey = new Map(expected.map(row => [identityOf(row), row]));
  const counts = new Map();
  for (const row of actual) { const identity = identityOf(row); counts.set(identity, (counts.get(identity) || 0) + 1); }
  for (const [identity, count] of counts) if (count > 1) addMismatch(mismatches, limit, { code: 'projection_duplicate_row', table, identity, count });
  for (const [identity, row] of expectedByKey) {
    const found = actualByKey.get(identity);
    if (!found) { addMismatch(mismatches, limit, { code: 'projection_missing_row', table, identity }); continue; }
    for (const column of columns) if (found[column] !== row[column]) addMismatch(mismatches, limit, { code: column.startsWith('last_event_') ? 'projection_pointer_mismatch' : 'projection_column_mismatch', table, identity, column, expected: row[column], actual: found[column] });
  }
  for (const identity of actualByKey.keys()) if (!expectedByKey.has(identity)) addMismatch(mismatches, limit, { code: 'projection_extra_row', table, identity });
}

const ACTION_EVENT_COMPATIBILITY = Object.freeze({
  move_through_door: ['location.moved/v1'], engage_fixture: ['fixture.engaged/v1'], disengage_fixture: ['fixture.disengaged/v1'],
  move_through_passage: ['location.crossed/v1'], operate_passage: ['passage.operated/v1'], turn_fixture: ['fixture.turned/v1'],
  workshop_read: ['source.inspected/v1'], workshop_document_read: ['source.inspected/v1'], workshop_search: ['source.inspected/v1'], workshop_search_regex: ['source.inspected/v1'],
  workshop_timer_set: ['timer.set/v1'], workshop_timer_cancel: ['timer.cleared/v1'], workshop_brief_upsert: ['brief.revised/v1'],
  workshop_run_recipe: ['fixture_runtime.replaced/v1'], workshop_recipe_cancel: ['fixture_runtime.replaced/v1'],
  workshop_apply_patch: ['approval.opened/v1', 'approval.applying/v1', 'approval.resolved/v1'], workshop_apply_unified_diff: ['approval.opened/v1', 'approval.applying/v1', 'approval.resolved/v1'],
  workshop_write_file: ['approval.opened/v1', 'approval.applying/v1', 'approval.resolved/v1'], workshop_create_path: ['approval.opened/v1', 'approval.applying/v1', 'approval.resolved/v1'],
  workshop_delete_path: ['approval.opened/v1', 'approval.applying/v1', 'approval.resolved/v1'], workshop_rename_path: ['approval.opened/v1', 'approval.applying/v1', 'approval.resolved/v1'],
  workshop_git_add: ['approval.opened/v1', 'approval.applying/v1', 'approval.resolved/v1'], workshop_git_commit: ['approval.opened/v1', 'approval.applying/v1', 'approval.resolved/v1'], workshop_git_checkout: ['approval.opened/v1', 'approval.applying/v1', 'approval.resolved/v1'],
  workshop_sandbox_promote: ['approval.opened/v1', 'approval.applying/v1', 'approval.resolved/v1'], workshop_approval_confirm: ['approval.applying/v1', 'approval.resolved/v1'], workshop_approval_reject: ['approval.resolved/v1'], workshop_approval_cancel: ['approval.cancelled/v1'],
});

function linkedEventForReceipt(row, eventBySequence, type, mismatches, limit) {
  const hasSequence = row.world_event_sequence !== null; const hasHash = row.world_event_hash !== null;
  if (hasSequence !== hasHash) { addMismatch(mismatches, limit, { code: 'custody_event_pointer_partial', table: type, receiptId: row.receipt_id }); return null; }
  if (!hasSequence) return null;
  const event = eventBySequence.get(row.world_event_sequence);
  if (!event || event.event_hash !== row.world_event_hash) { addMismatch(mismatches, limit, { code: 'custody_event_pointer_mismatch', table: type, receiptId: row.receipt_id, sequence: row.world_event_sequence }); return null; }
  return event;
}

function actionEventSemanticsMatch(row, event, args, result) {
  let payload; try { payload = JSON.parse(event.payload_json); } catch { return false; }
  if (row.tool_name === 'move_through_door') return payload.doorIdentity === args?.door_id && result?.edgeId === payload.edgeId;
  if (row.tool_name === 'move_through_passage') return row.room_node_id === payload.toLocationId && payload.passageId === args?.passage_id && result?.edgeId === payload.edgeId && result?.toLocationId === payload.toLocationId;
  if (row.tool_name === 'operate_passage') return row.room_node_id === payload.fromLocationId && payload.passageId === args?.passage_id && payload.operation === args?.action && canonicalize(result?.state) === canonicalize(payload.nextState);
  if (row.tool_name === 'turn_fixture') return row.room_node_id === payload.fromLocationId && payload.fixtureId === args?.fixture_id && result?.turnCount === payload.nextTurnCount;
  if (row.tool_name === 'engage_fixture') return payload.fixtureId === args?.fixture_id;
  if (row.tool_name === 'disengage_fixture') return result?.previousFixtureId === payload.fixtureId;
  if (['workshop_read', 'workshop_document_read', 'workshop_search', 'workshop_search_regex'].includes(row.tool_name)) return (result?.source?.path || result?.path || null) === payload.source;
  if (row.tool_name === 'workshop_timer_set') return payload.seconds === args?.seconds;
  if (row.tool_name === 'workshop_brief_upsert') return payload.objective === args?.objective;
  if (row.tool_name === 'workshop_run_recipe') return payload.state?.status === 'running' && payload.state?.recipe === args?.recipe;
  if (row.tool_name === 'workshop_recipe_cancel') return payload.state?.status === 'cancelled';
  if (event.event_kind.startsWith('approval.')) {
    const approvalId = result?.approvalId || result?.approval?.approvalId || args?.approval_id || null;
    if (approvalId !== event.aggregate_id) return false;
    if (row.tool_name === 'workshop_approval_confirm') return event.event_kind === 'approval.applying/v1' || event.event_kind === 'approval.resolved/v1' && payload.status === 'confirmed';
    if (row.tool_name === 'workshop_approval_reject') return event.event_kind === 'approval.resolved/v1' && payload.status === 'rejected';
    return row.tool_name !== 'workshop_approval_cancel' || event.event_kind === 'approval.cancelled/v1';
  }
  return true;
}

function verifyCustody(sqlite, events, state, mismatches, limit) {
  const actionRows = sqlite.prepare(`SELECT ${ACTION_RECEIPT_COLUMNS.join(',')} FROM world_action_receipts ORDER BY receipt_id`).all();
  const approvalRows = sqlite.prepare(`SELECT ${APPROVAL_RECEIPT_COLUMNS.join(',')} FROM world_approval_receipts ORDER BY receipt_id`).all();
  const eventBySequence = new Map(events.map(event => [event.sequence, event])); const actionById = new Map(actionRows.map(row => [row.receipt_id, row]));
  const legacyActions = new Map(state.legacyCustody.actionReceipts.map(row => [row.receiptId, row.rowSha256]));
  const legacyApprovals = new Map(state.legacyCustody.approvalReceipts.map(row => [row.receiptId, row.rowSha256]));
  const actionLinks = new Map(); const approvalLinks = new Map();
  for (const row of actionRows) {
    const event = linkedEventForReceipt(row, eventBySequence, 'world_action_receipts', mismatches, limit);
    if (event) actionLinks.set(event.sequence, [...(actionLinks.get(event.sequence) || []), row]);
    const legacy = legacyActions.get(row.receipt_id) === custodyRowHash(row, 'action');
    if (row.outcome === 'refused' && event) addMismatch(mismatches, limit, { code: 'refusal_event_linked', receiptId: row.receipt_id });
    if (!event && legacyActions.has(row.receipt_id) && !legacy) addMismatch(mismatches, limit, { code: 'legacy_custody_hash_mismatch', table: 'world_action_receipts', receiptId: row.receipt_id });
    let result = null; let args = null;
    try { result = JSON.parse(row.result_json); } catch { addMismatch(mismatches, limit, { code: 'custody_json_invalid', table: 'world_action_receipts', receiptId: row.receipt_id }); }
    try { args = JSON.parse(row.arguments_json); } catch { addMismatch(mismatches, limit, { code: 'custody_json_invalid', table: 'world_action_receipts', receiptId: row.receipt_id }); }
    const compatible = ACTION_EVENT_COMPATIBILITY[row.tool_name];
    const conditionalNoEvent = row.tool_name === 'workshop_recipe_cancel' && !result?.cancelled || row.tool_name === 'workshop_timer_cancel' && result?.cancelled === false;
    if (row.outcome === 'committed' && compatible && !conditionalNoEvent && !event && !legacy) addMismatch(mismatches, limit, { code: 'state_action_event_missing', receiptId: row.receipt_id, toolName: row.tool_name });
    if (event && (!compatible || !compatible.includes(event.event_kind) || event.session_id !== row.session_id || (event.wake_id || null) !== (row.wake_id || null))) addMismatch(mismatches, limit, { code: 'state_action_event_incompatible', receiptId: row.receipt_id, toolName: row.tool_name, eventKind: event.event_kind });
    else if (event && !actionEventSemanticsMatch(row, event, args, result)) addMismatch(mismatches, limit, { code: 'state_action_event_semantics_mismatch', receiptId: row.receipt_id, toolName: row.tool_name, eventKind: event.event_kind });
    if (event && legacyActions.has(row.receipt_id)) addMismatch(mismatches, limit, { code: 'legacy_custody_event_linked', table: 'world_action_receipts', receiptId: row.receipt_id });
  }
  for (const row of approvalRows) {
    const event = linkedEventForReceipt(row, eventBySequence, 'world_approval_receipts', mismatches, limit); const legacy = legacyApprovals.get(row.receipt_id) === custodyRowHash(row, 'approval');
    if (event) approvalLinks.set(event.sequence, [...(approvalLinks.get(event.sequence) || []), row]);
    if (!event && legacyApprovals.has(row.receipt_id) && !legacy) addMismatch(mismatches, limit, { code: 'legacy_custody_hash_mismatch', table: 'world_approval_receipts', receiptId: row.receipt_id });
    if (!event && !legacy) addMismatch(mismatches, limit, { code: 'approval_receipt_event_missing', receiptId: row.receipt_id, phase: row.phase });
    if (event) {
      const expectedKind = row.phase === 'pending' ? 'approval.opened/v1' : row.phase === 'applying' ? 'approval.applying/v1' : row.phase === 'cancelled' ? 'approval.cancelled/v1' : row.phase === 'reconciliation_required' ? 'approval.reconciliation_required/v1' : 'approval.resolved/v1';
      const action = actionById.get(row.action_receipt_id);
      if (event.event_kind !== expectedKind || event.aggregate_id !== row.approval_id || event.session_id !== row.session_id || (event.wake_id || null) !== (row.wake_id || null)) addMismatch(mismatches, limit, { code: 'approval_receipt_event_incompatible', receiptId: row.receipt_id, phase: row.phase, eventKind: event.event_kind });
      if (!action || action.world_event_sequence !== row.world_event_sequence || action.world_event_hash !== row.world_event_hash) addMismatch(mismatches, limit, { code: 'approval_action_event_link_mismatch', receiptId: row.receipt_id, actionReceiptId: row.action_receipt_id });
      let payload = null; try { payload = JSON.parse(event.payload_json); } catch {}
      if (row.phase === 'confirmed' && payload?.status !== 'confirmed' || row.phase === 'rejected' && payload?.status !== 'rejected') addMismatch(mismatches, limit, { code: 'approval_receipt_event_semantics_mismatch', receiptId: row.receipt_id, phase: row.phase });
      if (legacyApprovals.has(row.receipt_id)) addMismatch(mismatches, limit, { code: 'legacy_custody_event_linked', table: 'world_approval_receipts', receiptId: row.receipt_id });
    }
  }
  for (const [receiptId] of legacyActions) if (!actionById.has(receiptId)) addMismatch(mismatches, limit, { code: 'legacy_custody_row_missing', table: 'world_action_receipts', receiptId });
  const approvalIds = new Set(approvalRows.map(row => row.receipt_id)); for (const [receiptId] of legacyApprovals) if (!approvalIds.has(receiptId)) addMismatch(mismatches, limit, { code: 'legacy_custody_row_missing', table: 'world_approval_receipts', receiptId });
  const custodyBoundary = state.operationalBoundary?.sequence || 0;
  const commandActors = new Set(['resident_tool', 'builder']);
  for (const event of events) {
    if (event.sequence <= custodyBoundary) continue;
    if (event.command_id === null) {
      if (commandActors.has(event.actor)) addMismatch(mismatches, limit, { code: 'resident_event_command_missing', sequence: event.sequence, eventKind: event.event_kind, actor: event.actor });
      continue;
    }
    if (!commandActors.has(event.actor)) addMismatch(mismatches, limit, { code: 'command_event_actor_invalid', sequence: event.sequence, eventKind: event.event_kind, actor: event.actor });
    const linkedActions = actionLinks.get(event.sequence) || [];
    if (linkedActions.length !== 1) addMismatch(mismatches, limit, { code: linkedActions.length ? 'command_event_action_receipt_duplicate' : 'command_event_action_receipt_missing', sequence: event.sequence, eventKind: event.event_kind, count: linkedActions.length });
    if (event.event_kind.startsWith('approval.')) {
      const linkedApprovals = approvalLinks.get(event.sequence) || [];
      if (linkedApprovals.length !== 1) addMismatch(mismatches, limit, { code: linkedApprovals.length ? 'command_event_approval_receipt_duplicate' : 'command_event_approval_receipt_missing', sequence: event.sequence, eventKind: event.event_kind, count: linkedApprovals.length });
    }
  }
}

export function verifyWorldSqlite(sqlite, { mismatchLimit = 50, scope = 'b1', requireHearth = true, requireForest = false, requireBinderWindow = false, requireSpotlight = false, requireSpotlightDoor = false } = {}) {
  if (scope === 'b1' && requireForest && tableExists(sqlite, 'world_event_journal')) {
    let forest = null;
    try { forest = sqlite.prepare("SELECT sequence FROM world_event_journal WHERE event_kind='topology.forest_installed/v1' LIMIT 1").get(); } catch {}
    if (!forest) {
      const hearth = verifyWorldSqlite(sqlite, { mismatchLimit, scope, requireHearth: true, requireForest: false });
      if (hearth.verified) return { ...hearth, verified: false, status: 'upgrade_required', upgradeRequired: true, projectorVersion: WORLD_PROJECTOR_VERSION, mismatches: [{ code: 'forest_upgrade_required', message: 'The exact Hearth World requires the explicit backup-confirmed Forest-place migration.' }] };
    }
  }
  if (scope === 'b1' && requireHearth && tableExists(sqlite, 'world_event_journal')) {
    let hearth = null;
    try { hearth = sqlite.prepare("SELECT sequence FROM world_event_journal WHERE event_kind='topology.hearth_installed/v1' LIMIT 1").get(); } catch {}
    if (!hearth) {
      const b1 = verifyWorldSqlite(sqlite, { mismatchLimit, scope, requireHearth: false });
      if (b1.verified) return {
        ...b1, verified: false, status: 'upgrade_required', upgradeRequired: true, projectorVersion: WORLD_PROJECTOR_VERSION,
        mismatches: [{ code: 'hearth_upgrade_required', message: 'The exact B1 World requires the explicit backup-confirmed House Hearth migration.' }],
      };
    }
  }
  if (scope === 'b1' && requireBinderWindow && tableExists(sqlite, 'world_event_journal')) {
    let binderWindow = null;
    try { binderWindow = sqlite.prepare("SELECT sequence FROM world_event_journal WHERE event_kind='topology.binder_window_installed/v1' LIMIT 1").get(); } catch {}
    if (!binderWindow) {
      const forest = verifyWorldSqlite(sqlite, { mismatchLimit, scope, requireHearth: true, requireForest: true, requireBinderWindow: false });
      if (forest.verified) return { ...forest, verified: false, status: 'upgrade_required', upgradeRequired: true, projectorVersion: WORLD_PROJECTOR_VERSION, mismatches: [{ code: 'binder_window_upgrade_required', message: 'The exact Forest World requires the explicit backup-confirmed Binder Window migration.' }] };
    }
  }
  if (scope === 'b1' && requireSpotlight && tableExists(sqlite, 'world_event_journal')) {
    let spotlight = null;
    try { spotlight = sqlite.prepare("SELECT sequence FROM world_event_journal WHERE event_kind='topology.spotlight_installed/v1' LIMIT 1").get(); } catch {}
    if (!spotlight) {
      const binderWindow = verifyWorldSqlite(sqlite, { mismatchLimit, scope, requireHearth: true, requireForest: true, requireBinderWindow: true, requireSpotlight: false });
      if (binderWindow.verified) return { ...binderWindow, verified: false, status: 'upgrade_required', upgradeRequired: true, projectorVersion: WORLD_PROJECTOR_VERSION, mismatches: [{ code: 'spotlight_upgrade_required', message: 'The exact Binder Window World requires the explicit backup-confirmed Spotlight Observatory migration.' }] };
    }
  }
  if (scope === 'b1' && requireSpotlightDoor && tableExists(sqlite, 'world_event_journal')) {
    let spotlightDoor = null;
    try { spotlightDoor = sqlite.prepare("SELECT sequence FROM world_event_journal WHERE event_kind='topology.spotlight_door_installed/v1' LIMIT 1").get(); } catch {}
    if (!spotlightDoor) {
      const spotlight = verifyWorldSqlite(sqlite, { mismatchLimit, scope, requireHearth: true, requireForest: true, requireBinderWindow: true, requireSpotlight: true, requireSpotlightDoor: false });
      if (spotlight.verified) return { ...spotlight, verified: false, status: 'upgrade_required', upgradeRequired: true, projectorVersion: WORLD_PROJECTOR_VERSION, mismatches: [{ code: 'spotlight_door_upgrade_required', message: 'The exact Spotlight Observatory World requires the explicit backup-confirmed Spotlight door migration.' }] };
    }
  }
  if (scope === 'b1' && tableExists(sqlite, 'world_event_journal')) {
    let extension = null;
    try { extension = sqlite.prepare("SELECT sequence FROM world_event_journal WHERE event_kind='topology.extended/v1' LIMIT 1").get(); } catch {}
    if (!extension) {
      const a2 = verifyWorldSqlite(sqlite, { mismatchLimit, scope: 'a2' });
      const b1Artifacts = ['world_passages', 'world_object_states', 'world_passages_append_only_update', 'world_passages_append_only_delete']
        .filter(name => sqlite.prepare("SELECT 1 AS ok FROM sqlite_master WHERE name=? AND type IN ('table','trigger')").get(name));
      if (a2.verified && !b1Artifacts.length) return {
        ...a2, verified: false, status: 'upgrade_required', upgradeRequired: true, projectorVersion: WORLD_PROJECTOR_VERSION,
        mismatches: [{ code: 'b1_upgrade_required', message: 'The exact A2 World requires the explicit backup-confirmed B1 topology migration.' }],
      };
    }
  }
  const mismatches = [];
  const a1ProjectionTables = ['world_nodes', 'world_edges', 'world_locations'];
  const a2ProjectionTables = ['world_fixture_runtime', 'world_timers', 'world_work_briefs', 'world_approvals'];
  const b1ProjectionTables = ['world_passages', 'world_object_states'];
  const requiredTables = ['world_event_journal', ...a1ProjectionTables, ...(['a2', 'b1'].includes(scope) ? [...a2ProjectionTables, ...Object.keys(WORLD_CUSTODY_TABLE_SQL)] : []), ...(scope === 'b1' ? b1ProjectionTables : [])];
  for (const table of requiredTables) if (!tableExists(sqlite, table)) addMismatch(mismatches, mismatchLimit, { code: 'schema_missing', table });
  if (mismatches.length) return { verified: false, eventCount: 0, journalHead: null, projectorVersion: WORLD_PROJECTOR_VERSION, mismatches };
  const journalTable = sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='world_event_journal'").get();
  const actualJournalSchema = normalizeTableSql(journalTable?.sql); const expectedJournalSchema = normalizeTableSql(WORLD_EVENT_JOURNAL_TABLE_SQL);
  if (actualJournalSchema !== expectedJournalSchema) {
    addMismatch(mismatches, mismatchLimit, { code: 'schema_definition_invalid', table: 'world_event_journal', expectedSha256: sha256(expectedJournalSchema), actualSha256: sha256(actualJournalSchema) });
    let eventCount = 0; try { eventCount = sqlite.prepare('SELECT COUNT(*) AS count FROM world_event_journal').get().count; } catch {}
    return { verified: false, eventCount, journalHead: null, projectorVersion: WORLD_PROJECTOR_VERSION, mismatches };
  }
  const expectedProjectionDefinitions = scope === 'b1' ? WORLD_PROJECTION_TABLE_SQL : WORLD_A2_PROJECTION_TABLE_SQL;
  for (const [table, expectedDefinition] of Object.entries(expectedProjectionDefinitions).filter(([table]) => scope !== 'a1' || a1ProjectionTables.includes(table))) {
    const row = sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table);
    const actual = normalizeTableSql(row?.sql); const expected = normalizeTableSql(expectedDefinition);
    if (actual !== expected) addMismatch(mismatches, mismatchLimit, { code: 'schema_definition_invalid', table, expectedSha256: sha256(expected), actualSha256: sha256(actual) });
  }
  if (['a2', 'b1'].includes(scope)) for (const [table, expectedDefinition] of Object.entries(WORLD_CUSTODY_TABLE_SQL)) {
    const row = sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table);
    const actual = normalizeTableSql(row?.sql); const expected = normalizeTableSql(expectedDefinition);
    if (actual !== expected) addMismatch(mismatches, mismatchLimit, { code: 'schema_definition_invalid', table, expectedSha256: sha256(expected), actualSha256: sha256(actual) });
  }
  for (const [trigger, expectedDefinition] of Object.entries(WORLD_INTEGRITY_TRIGGER_SQL).filter(([trigger]) => {
    if (scope !== 'b1' && trigger.startsWith('world_passages_')) return false;
    return ['a2', 'b1'].includes(scope) || !trigger.includes('_receipts_');
  })) {
    const row = sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?").get(trigger);
    if (!row) addMismatch(mismatches, mismatchLimit, { code: trigger.startsWith('world_event_journal_') ? 'journal_trigger_missing' : 'projection_trigger_missing', trigger });
    else {
      const actual = normalizeTriggerSql(row.sql); const expected = normalizeTriggerSql(expectedDefinition);
      if (actual !== expected) addMismatch(mismatches, mismatchLimit, { code: 'trigger_definition_invalid', trigger, expectedSha256: sha256(expected), actualSha256: sha256(actual) });
    }
  }
  const events = sqlite.prepare('SELECT * FROM world_event_journal ORDER BY sequence').all();
  const rootKinds = new Set(['topology.installed/v1', 'legacy_snapshot.imported/v1']);
  if (!events.length) addMismatch(mismatches, mismatchLimit, { code: 'journal_root_missing' });
  else if (events[0].sequence !== 1 || !rootKinds.has(events[0].event_kind)) addMismatch(mismatches, mismatchLimit, { code: 'journal_root_invalid', sequence: events[0].sequence, eventKind: events[0].event_kind });
  for (const event of events.slice(1)) if (rootKinds.has(event.event_kind)) addMismatch(mismatches, mismatchLimit, { code: 'journal_root_invalid', sequence: event.sequence, eventKind: event.event_kind });
  let state = emptyWorldState(); let previousHash = WORLD_EVENT_GENESIS_HASH;
  const aggregateRevisions = new Map();
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]; const expectedSequence = index + 1;
    if (event.sequence !== expectedSequence) addMismatch(mismatches, mismatchLimit, { code: 'sequence_gap', sequence: event.sequence, expected: expectedSequence });
    if (event.previous_event_hash !== previousHash) addMismatch(mismatches, mismatchLimit, { code: 'previous_event_hash_mismatch', sequence: event.sequence });
    let payload = null; let causation = null;
    try { payload = JSON.parse(event.payload_json); } catch { addMismatch(mismatches, mismatchLimit, { code: 'payload_json_invalid', sequence: event.sequence }); }
    try { causation = JSON.parse(event.causation_json); } catch { addMismatch(mismatches, mismatchLimit, { code: 'causation_json_invalid', sequence: event.sequence }); }
    if (payload !== null && (!payload || typeof payload !== 'object' || Array.isArray(payload))) addMismatch(mismatches, mismatchLimit, { code: 'payload_schema_invalid', sequence: event.sequence });
    if (causation !== null && (!causation || typeof causation !== 'object' || Array.isArray(causation))) addMismatch(mismatches, mismatchLimit, { code: 'causation_schema_invalid', sequence: event.sequence });
    if (payload && canonicalize(payload) !== event.payload_json) addMismatch(mismatches, mismatchLimit, { code: 'payload_not_canonical', sequence: event.sequence });
    if (causation && canonicalize(causation) !== event.causation_json) addMismatch(mismatches, mismatchLimit, { code: 'causation_not_canonical', sequence: event.sequence });
    if (sha256(event.payload_json) !== event.payload_sha256) addMismatch(mismatches, mismatchLimit, { code: 'payload_hash_mismatch', sequence: event.sequence });
    try { if (computeWorldEventHash(event) !== event.event_hash) addMismatch(mismatches, mismatchLimit, { code: 'event_hash_mismatch', sequence: event.sequence }); }
    catch { addMismatch(mismatches, mismatchLimit, { code: 'event_hash_input_invalid', sequence: event.sequence }); }
    const registration = WORLD_EVENT_KINDS[event.event_kind];
    if (!registration || registration.installed === false) addMismatch(mismatches, mismatchLimit, { code: 'event_kind_unknown', sequence: event.sequence, eventKind: event.event_kind });
    else if (scope === 'a1' && registration.stretch !== 'A1') addMismatch(mismatches, mismatchLimit, { code: 'later_event_present', sequence: event.sequence, eventKind: event.event_kind });
    else if (scope === 'a2' && registration.stretch === 'B1') addMismatch(mismatches, mismatchLimit, { code: 'b1_event_present', sequence: event.sequence, eventKind: event.event_kind });
    else if (!requireHearth && registration.stretch === 'H1') addMismatch(mismatches, mismatchLimit, { code: 'hearth_event_present', sequence: event.sequence, eventKind: event.event_kind });
    else if (!requireForest && registration.stretch === 'F1') addMismatch(mismatches, mismatchLimit, { code: 'forest_event_present', sequence: event.sequence, eventKind: event.event_kind });
    else if (!requireBinderWindow && registration.stretch === 'BW1') addMismatch(mismatches, mismatchLimit, { code: 'binder_window_event_present', sequence: event.sequence, eventKind: event.event_kind });
    else if (!requireSpotlight && registration.stretch === 'SP1') addMismatch(mismatches, mismatchLimit, { code: 'spotlight_event_present', sequence: event.sequence, eventKind: event.event_kind });
    else if (!requireSpotlight && registration.stretch === 'SP2') addMismatch(mismatches, mismatchLimit, { code: 'spotlight_door_event_present', sequence: event.sequence, eventKind: event.event_kind });
    else if (registration.schemaVersion !== event.event_schema_version) addMismatch(mismatches, mismatchLimit, { code: 'event_schema_version_unknown', sequence: event.sequence, eventKind: event.event_kind, version: event.event_schema_version });
    const aggregateKey = `${event.aggregate_kind}:${event.aggregate_id}`;
    const expectedRevision = (aggregateRevisions.get(aggregateKey) || 0) + 1;
    if (event.aggregate_revision !== expectedRevision) addMismatch(mismatches, mismatchLimit, { code: 'aggregate_revision_gap', sequence: event.sequence, aggregateKind: event.aggregate_kind, aggregateId: event.aggregate_id, expected: expectedRevision, actual: event.aggregate_revision });
    aggregateRevisions.set(aggregateKey, event.aggregate_revision);
    try {
      state = reduceWorldEvent(state, event);
      if (event.event_kind === 'legacy_snapshot.imported/v1') for (const row of state.locations) aggregateRevisions.set(`lifespan:${row.session_id}`, row.revision);
      if (event.event_kind === 'operational_snapshot.imported/v1') {
        for (const row of state.fixtureRuntimes) aggregateRevisions.set(`fixture_runtime:${row.fixture_id}`, row.revision);
        for (const row of state.timers) aggregateRevisions.set(`timer:${row.session_id}`, row.revision);
        for (const row of state.briefs) aggregateRevisions.set(`brief:${row.session_id}`, Math.max(aggregateRevisions.get(`brief:${row.session_id}`) || 0, row.revision));
        for (const row of state.approvals) aggregateRevisions.set(`approval:${row.approval_id}`, row.revision);
      }
      if (event.event_kind === 'topology.extended/v1') for (const row of state.objectStates) aggregateRevisions.set(`world_object:${row.object_id}`, row.revision);
    } catch (error) { addMismatch(mismatches, mismatchLimit, { code: 'replay_error', sequence: event.sequence, message: error.message }); }
    previousHash = event.event_hash;
  }
  let actual = emptyWorldState();
  try { actual = scope === 'b1' ? readWorldProjection(sqlite) : scope === 'a2' ? readWorldA2Projection(sqlite) : { ...emptyWorldState(), ...readWorldPhysicalProjection(sqlite) }; }
  catch (error) { addMismatch(mismatches, mismatchLimit, { code: 'projection_schema_invalid', message: error.message }); }
  compareRows(actual.nodes, state.nodes, NODE_COLUMNS, 'world_nodes', mismatches, mismatchLimit);
  compareRows(actual.edges, state.edges, EDGE_COLUMNS, 'world_edges', mismatches, mismatchLimit);
  compareRows(actual.locations, state.locations, LOCATION_COLUMNS, 'world_locations', mismatches, mismatchLimit);
  if (['a2', 'b1'].includes(scope)) {
    compareRows(actual.fixtureRuntimes, state.fixtureRuntimes, FIXTURE_RUNTIME_COLUMNS, 'world_fixture_runtime', mismatches, mismatchLimit);
    compareRows(actual.timers, state.timers, TIMER_COLUMNS, 'world_timers', mismatches, mismatchLimit);
    compareRows(actual.briefs, state.briefs, BRIEF_COLUMNS, 'world_work_briefs', mismatches, mismatchLimit, ['session_id', 'revision']);
    compareRows(actual.approvals, state.approvals, APPROVAL_COLUMNS, 'world_approvals', mismatches, mismatchLimit);
    const custodySchemasValid = Object.entries(WORLD_CUSTODY_TABLE_SQL).every(([table, expected]) => normalizeTableSql(sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table)?.sql) === normalizeTableSql(expected));
    if (custodySchemasValid) verifyCustody(sqlite, events, state, mismatches, mismatchLimit);
  }
  if (scope === 'b1') {
    const extensionEvents = events.filter(event => event.event_kind === 'topology.extended/v1');
    if (extensionEvents.length !== 1) addMismatch(mismatches, mismatchLimit, { code: extensionEvents.length ? 'b1_extension_duplicate' : 'b1_extension_missing', count: extensionEvents.length });
    compareRows(actual.passages, state.passages, PASSAGE_COLUMNS, 'world_passages', mismatches, mismatchLimit);
    compareRows(actual.objectStates, state.objectStates, OBJECT_STATE_COLUMNS, 'world_object_states', mismatches, mismatchLimit);
    if (requireBinderWindow) {
      const binderWindowEvents = events.filter(event => event.event_kind === 'topology.binder_window_installed/v1');
      if (binderWindowEvents.length !== 1) addMismatch(mismatches, mismatchLimit, { code: binderWindowEvents.length ? 'binder_window_extension_duplicate' : 'binder_window_extension_missing', count: binderWindowEvents.length });
    }
    if (requireSpotlight) {
      const spotlightEvents = events.filter(event => event.event_kind === 'topology.spotlight_installed/v1');
      if (spotlightEvents.length !== 1) addMismatch(mismatches, mismatchLimit, { code: spotlightEvents.length ? 'spotlight_extension_duplicate' : 'spotlight_extension_missing', count: spotlightEvents.length });
    }
    if (requireSpotlightDoor) {
      const spotlightDoorEvents = events.filter(event => event.event_kind === 'topology.spotlight_door_installed/v1');
      if (spotlightDoorEvents.length !== 1) addMismatch(mismatches, mismatchLimit, { code: spotlightDoorEvents.length ? 'spotlight_door_extension_duplicate' : 'spotlight_door_extension_missing', count: spotlightDoorEvents.length });
    }
  }
  const head = events.at(-1) || null;
  return {
    verified: mismatches.length === 0, eventCount: events.length,
    journalHead: head ? { sequence: head.sequence, eventId: boundedDiagnostic(head.event_id), eventHash: boundedDiagnostic(head.event_hash), occurredAt: boundedDiagnostic(head.occurred_at) } : null,
    projectorVersion: scope === 'a1' ? 1 : scope === 'a2' ? 2 : WORLD_PROJECTOR_VERSION, mismatches,
  };
}

export function verifyWorldA1Sqlite(sqlite, options = {}) { return verifyWorldSqlite(sqlite, { ...options, scope: 'a1' }); }
export function verifyWorldA2Sqlite(sqlite, options = {}) { return verifyWorldSqlite(sqlite, { ...options, scope: 'a2' }); }

export function replayWorldEvents(sqlite) {
  let state = emptyWorldState();
  for (const event of sqlite.prepare('SELECT * FROM world_event_journal ORDER BY sequence').all()) state = reduceWorldEvent(state, event);
  return state;
}

export function verifyWorldDatabase(path, options) {
  let sqlite;
  try { sqlite = new DatabaseSync(path, { readOnly: true }); return verifyWorldSqlite(sqlite, options); }
  catch (error) { return { verified: false, eventCount: 0, journalHead: null, projectorVersion: WORLD_PROJECTOR_VERSION, mismatches: [{ code: 'database_open_failed', message: error.message }] }; }
  finally { sqlite?.close(); }
}

export function inspectWorldA2UpgradeDatabase(path, { mismatchLimit = 50 } = {}) {
  let sqlite;
  try {
    sqlite = new DatabaseSync(path, { readOnly: true });
    if (!tableExists(sqlite, 'world_event_journal')) return {
      status: 'legacy_journal_migration_required', upgradeRequired: false,
      backupExpectation: 'Keep a verified byte-for-byte backup. Journal-less legacy migration is performed only by the normal explicit World legacy boundary path.',
    };
    const b1 = verifyWorldSqlite(sqlite, { mismatchLimit });
    if (b1.verified) return { status: 'current', upgradeRequired: false, verification: b1, supersededBy: 'B1' };
    const current = verifyWorldA2Sqlite(sqlite, { mismatchLimit });
    if (current.verified) return { status: 'current', upgradeRequired: false, verification: current };
    const boundary = sqlite.prepare("SELECT sequence,event_hash FROM world_event_journal WHERE event_kind='operational_snapshot.imported/v1' ORDER BY sequence LIMIT 1").get();
    const a1 = verifyWorldA1Sqlite(sqlite, { mismatchLimit });
    if (boundary) return { status: 'corrupt_or_incomplete_a2', upgradeRequired: false, boundary, verification: current };
    if (!a1.verified) return { status: 'corrupt_a1', upgradeRequired: false, verification: a1 };
    return {
      status: 'upgrade_required', upgradeRequired: true, verification: a1,
      backupExpectation: 'Create and verify a byte-for-byte backup of the World database before applying the A2 migration.',
    };
  } catch (error) {
    return { status: 'database_open_failed', upgradeRequired: false, verification: { verified: false, mismatches: [{ code: 'database_open_failed', message: error.message }] } };
  } finally { sqlite?.close(); }
}

export function inspectWorldB1UpgradeDatabase(path, { mismatchLimit = 50 } = {}) {
  let sqlite;
  try {
    sqlite = new DatabaseSync(path, { readOnly: true });
    if (!tableExists(sqlite, 'world_event_journal')) return {
      status: 'legacy_journal_migration_required', upgradeRequired: false,
      backupExpectation: 'Keep a verified byte-for-byte backup. Journal-less legacy admission occurs only on a disposable or intentionally maintained World database.',
    };
    const current = verifyWorldSqlite(sqlite, { mismatchLimit, requireHearth: false });
    if (current.verified) return { status: 'current', upgradeRequired: false, verification: current };
    const extension = sqlite.prepare("SELECT sequence,event_hash FROM world_event_journal WHERE event_kind='topology.extended/v1' ORDER BY sequence LIMIT 1").get();
    const partialArtifacts = ['world_passages', 'world_object_states', 'world_passages_append_only_update', 'world_passages_append_only_delete']
      .filter(name => sqlite.prepare("SELECT 1 AS ok FROM sqlite_master WHERE name=? AND type IN ('table','trigger')").get(name));
    if (extension || partialArtifacts.length) return { status: 'corrupt_or_incomplete_b1', upgradeRequired: false, extension: extension || null, partialArtifacts, verification: current };
    const a2 = verifyWorldA2Sqlite(sqlite, { mismatchLimit });
    if (!a2.verified) return { status: 'corrupt_a2', upgradeRequired: false, verification: a2 };
    return {
      status: 'upgrade_required', upgradeRequired: true, verification: a2,
      backupExpectation: 'Create and verify a byte-for-byte backup of the World database before applying the B1 migration.',
    };
  } catch (error) {
    return { status: 'database_open_failed', upgradeRequired: false, verification: { verified: false, mismatches: [{ code: 'database_open_failed', message: error.message }] } };
  } finally { sqlite?.close(); }
}

export function assertWorldVerified(sqlite, options = {}) {
  const verification = verifyWorldSqlite(sqlite, options);
  if (!verification.verified) {
    const upgrade = verification.status === 'upgrade_required';
    const hearth = verification.mismatches?.some(item => item.code === 'hearth_upgrade_required');
    const binderWindow = verification.mismatches?.some(item => item.code === 'binder_window_upgrade_required');
    const spotlight = verification.mismatches?.some(item => item.code === 'spotlight_upgrade_required');
    const spotlightDoor = verification.mismatches?.some(item => item.code === 'spotlight_door_upgrade_required');
    throw Object.assign(new Error(upgrade ? (spotlightDoor ? 'Spotlight Observatory door migration is required.' : spotlight ? 'Spotlight Observatory World migration is required.' : binderWindow ? 'Binder Window World migration is required.' : hearth ? 'House Hearth World migration is required.' : 'World B1 topology migration is required.') : 'World event journal and physical projection have drifted.'), { code: upgrade ? (spotlightDoor ? 'world_spotlight_door_upgrade_required' : spotlight ? 'world_spotlight_upgrade_required' : binderWindow ? 'world_binder_window_upgrade_required' : hearth ? 'world_hearth_upgrade_required' : 'world_b1_upgrade_required') : 'world_projection_drift', verification });
  }
  return verification;
}
