import { toolCatalogEntries } from '../../tools.js';

function fail(code, message) { throw Object.assign(new Error(message), { code }); }
function outcome(result, source = null) { return { result, source, changedRoom: false }; }
function approvalOutcome(result) { return result && typeof result.then === 'function' ? result.then(value => outcome(value)) : outcome(result); }

export const WORKSHOP_HANDLERS = Object.freeze({
  workshop_list: ({ workshop, args }) => outcome(workshop.list(args.path || '.')),
  workshop_read: ({ workshop, world, sessionId, wakeId, commandId, args }) => {
    const result = workshop.read(args.path, args.start_line || 1, args.line_count || undefined);
    const event = world.inspect(sessionId, result.source.path, { wakeId, commandId });
    return outcome({ ...result, worldEventSequence: event.worldEventSequence, worldEventHash: event.worldEventHash }, { sourceKind: 'workshop_read', source: result.source });
  },
  workshop_search: ({ workshop, world, sessionId, wakeId, commandId, args }) => {
    const result = workshop.search(args.query, args.path || '.', args.max_results || undefined);
    const event = world.inspect(sessionId, result.path, { wakeId, commandId });
    return outcome({ ...result, worldEventSequence: event.worldEventSequence, worldEventHash: event.worldEventHash }, { sourceKind: 'workshop_search', source: result });
  },
  workshop_search_regex: ({ workshop, world, sessionId, wakeId, commandId, args }) => {
    const result = workshop.searchRegex(args.pattern, args.path || '.', args.max_results || undefined, args.flags || '');
    const event = world.inspect(sessionId, result.path, { wakeId, commandId });
    return outcome({ ...result, worldEventSequence: event.worldEventSequence, worldEventHash: event.worldEventHash }, { sourceKind: 'workshop_search', source: result });
  },
  workshop_glob: ({ workshop, args }) => outcome(workshop.glob(args.pattern, args.path || '.', args.max_results || undefined)),
  workshop_tree: ({ workshop, args }) => outcome(workshop.tree(args.path || '.', args.depth || 3, args.max_entries || undefined)),
  workshop_stat: ({ workshop, args }) => outcome(workshop.stat(args.path)),
  workshop_file_hash: ({ workshop, args }) => outcome(workshop.fileHash(args.path)),
  workshop_brief_upsert: ({ world, sessionId, wakeId, commandId, args }) => outcome(world.upsertBrief({
    sessionId, wakeId, commandId, objective: args.objective, scopePaths: args.scope_paths || [], acceptance: args.acceptance || [], nonGoals: args.non_goals || [],
  })),
  workshop_brief_get: ({ world, sessionId }) => outcome(world.getBrief(sessionId)),
  workshop_pending_diff: ({ world, sessionId }) => outcome({ kind: 'workshop_pending_diff', approvals: world.listApprovals(sessionId, { pendingOnly: true }) }),
  workshop_approval_status: ({ world, sessionId, args }) => {
    if (args.approval_id) {
      const approval = world.getApproval(args.approval_id);
      if (!approval || approval.sessionId !== sessionId) fail('workshop_approval_not_found', 'Approval not found for this lifespan.');
      return outcome({ kind: 'workshop_approval_status', approval });
    }
    return outcome({ kind: 'workshop_approval_status', approvals: world.listApprovals(sessionId) });
  },
  workshop_approval_list: ({ world, sessionId, args }) => outcome({ kind: 'workshop_approval_list', approvals: world.listApprovals(sessionId, { pendingOnly: Boolean(args.pending_only) }) }),
  workshop_tool_catalog: ({ world, sessionId }) => outcome({ kind: 'workshop_tool_catalog', tools: toolCatalogEntries(world.availableTools(sessionId)) }),
  workshop_apply_patch: ({ workshop, sessionId, wakeId, args, pendingConfirm }) => {
    const preview = workshop.previewPatch(args.path, args.old_text, args.new_text);
    return approvalOutcome(pendingConfirm(sessionId, wakeId, 'patch', { path: args.path, oldText: args.old_text, newText: args.new_text }, preview, 'workshop_apply_patch'));
  },
  workshop_apply_unified_diff: ({ workshop, sessionId, wakeId, args, pendingConfirm }) => {
    const preview = workshop.previewUnifiedDiff(args.diff);
    return approvalOutcome(pendingConfirm(sessionId, wakeId, 'unified_diff', { diff: args.diff }, preview, 'workshop_apply_unified_diff'));
  },
  workshop_write_file: ({ workshop, sessionId, wakeId, args, pendingConfirm }) => {
    const preview = workshop.previewWriteFile(args.path, args.content);
    return approvalOutcome(pendingConfirm(sessionId, wakeId, 'write_file', { path: args.path, content: args.content }, preview, 'workshop_write_file'));
  },
  workshop_create_path: ({ workshop, sessionId, wakeId, args, pendingConfirm }) => {
    const preview = workshop.previewCreatePath(args.path, args.kind);
    return approvalOutcome(pendingConfirm(sessionId, wakeId, 'create_path', { path: args.path, kind: args.kind }, preview, 'workshop_create_path'));
  },
  workshop_delete_path: ({ workshop, sessionId, wakeId, args, pendingConfirm }) => {
    const preview = workshop.previewDeletePath(args.path);
    return approvalOutcome(pendingConfirm(sessionId, wakeId, 'delete_path', { path: args.path }, preview, 'workshop_delete_path'));
  },
  workshop_rename_path: ({ workshop, sessionId, wakeId, args, pendingConfirm }) => {
    const preview = workshop.previewRenamePath(args.from_path, args.to_path);
    return approvalOutcome(pendingConfirm(sessionId, wakeId, 'rename_path', { fromPath: args.from_path, toPath: args.to_path }, preview, 'workshop_rename_path'));
  },
});
