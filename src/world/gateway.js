import { scrubHostReturn } from '../scrub/host-return.js';
import { TOOL_APPROVAL_CLASS, TOOL_NAMES, toolCatalogEntries } from './tools.js';
import { listRecipes, RecipeRunner } from './recipes.js';
import { WorkshopGit } from './git.js';
import { KILN_FIXTURE_ID } from './graph.js';

function fail(code, message) { throw Object.assign(new Error(message), { code }); }
function parseArguments(call) {
  if (!call || call.type !== 'function' || typeof call.id !== 'string' || !call.id || typeof call.function?.name !== 'string' || typeof call.function?.arguments !== 'string') fail('world_tool_invalid', 'Tool intent is malformed.');
  if (!TOOL_NAMES.has(call.function.name)) fail('world_tool_unknown', 'The requested capability is not installed.');
  let args; try { args = JSON.parse(call.function.arguments || '{}'); } catch { fail('world_tool_invalid', 'Tool arguments are not valid JSON.'); }
  if (!args || Array.isArray(args) || typeof args !== 'object') fail('world_tool_invalid', 'Tool arguments must be an object.');
  return { call, name: call.function.name, args };
}

export class WorldActionGateway {
  constructor({ world, workshop, forest = null, approvalMode = 'confirm', recipeTimeoutMs = 120000 }) {
    this.world = world;
    this.workshop = workshop;
    this.forest = forest;
    this.approvalMode = approvalMode === 'auto' ? 'auto' : 'confirm';
    this.recipes = new RecipeRunner(workshop.root, { timeoutMs: recipeTimeoutMs, maxOutputBytes: workshop.limits.maxBytes });
    this.git = new WorkshopGit(workshop.root, { maxBytes: workshop.limits.maxBytes });
  }
  schemas(sessionId) { return this.world.availableTools(sessionId); }
  assertToolMounted(sessionId, name) {
    const available = this.world.availableTools(sessionId);
    if (!available.includes(name)) fail('world_wrong_station', `Tool ${name} is not mounted for the current room.`);
  }
  fixtureContents(sessionId, fixtureId) {
    if (fixtureId === 'fixture.workshop_clipboard') return { kind: 'clipboard', brief: this.world.getBrief(sessionId) };
    if (fixtureId === 'fixture.workshop_workbench') {
      const pending = this.world.listApprovals(sessionId, { pendingOnly: true })
        .map(approval => ({ approvalId: approval.approvalId, kind: approval.kind, status: approval.status }));
      return { kind: 'workbench', pendingApprovals: pending.length, pending };
    }
    if (fixtureId === KILN_FIXTURE_ID) return { kind: 'kiln', ...(this.world.getFixtureRuntime(fixtureId) || { status: 'idle' }) };
    if (fixtureId === 'fixture.workshop_ledger') {
      const status = this.git.status();
      const lines = status.stdout.split(/\r?\n/).filter(Boolean);
      const branch = lines.find(line => line.startsWith('## ')) || null;
      const changes = lines.filter(line => !line.startsWith('## '));
      return { kind: 'ledger', ok: status.ok, branch, dirty: changes.length > 0, truncated: Boolean(status.truncated), changeCount: changes.length };
    }
    if (fixtureId === 'fixture.workshop_shelves') {
      const listing = this.workshop.list('.');
      const entries = listing.entries.slice(0, 40).map(entry => ({ name: entry.name, type: entry.type }));
      return { kind: 'shelves', entries, truncated: listing.entries.length > entries.length };
    }
    return { kind: 'fixture', text: this.world.node(fixtureId)?.resident_text || '' };
  }
  pendingConfirm(sessionId, wakeId, kind, payload, preview, toolName) {
    const approval = this.world.createApproval({ sessionId, wakeId, kind, payload, preview });
    const toolClass = TOOL_APPROVAL_CLASS[toolName] || 'confirm';
    if (this.approvalMode === 'auto' || toolClass === 'auto') return this.confirmApproval(approval.approvalId, sessionId);
    return { kind: toolName, status: 'pending_approval', approvalId: approval.approvalId, preview };
  }
  async execute({ sessionId, wakeId, requestRecordId, spineRecordId, intent }) {
    const parsed = parseArguments(intent);
    this.assertToolMounted(sessionId, parsed.name);
    let result; let source = null; let changedRoom = false;
    if (parsed.name === 'move_through_door') {
      result = this.world.move({ sessionId, wakeId, doorId: parsed.args.door_id });
      changedRoom = true;
    } else if (parsed.name === 'inspect_fixture') {
      result = this.world.inspectFixture({ sessionId, fixtureId: parsed.args.fixture_id });
      result.contents = this.fixtureContents(sessionId, parsed.args.fixture_id);
    } else if (parsed.name === 'engage_fixture') {
      result = this.world.engageFixture({ sessionId, wakeId, fixtureId: parsed.args.fixture_id });
      result.contents = this.fixtureContents(sessionId, parsed.args.fixture_id);
    }
    else if (parsed.name === 'disengage_fixture') result = this.world.disengageFixture({ sessionId, wakeId });
    else if (parsed.name === 'workshop_list') result = this.workshop.list(parsed.args.path || '.');
    else if (parsed.name === 'workshop_read') { result = this.workshop.read(parsed.args.path, parsed.args.start_line || 1, parsed.args.line_count || undefined); this.world.inspect(sessionId, result.source.path); source = { sourceKind: 'workshop_read', source: result.source }; }
    else if (parsed.name === 'workshop_search') { result = this.workshop.search(parsed.args.query, parsed.args.path || '.', parsed.args.max_results || undefined); this.world.inspect(sessionId, result.path); source = { sourceKind: 'workshop_search', source: result }; }
    else if (parsed.name === 'workshop_search_regex') { result = this.workshop.searchRegex(parsed.args.pattern, parsed.args.path || '.', parsed.args.max_results || undefined, parsed.args.flags || ''); this.world.inspect(sessionId, result.path); source = { sourceKind: 'workshop_search', source: result }; }
    else if (parsed.name === 'workshop_glob') result = this.workshop.glob(parsed.args.pattern, parsed.args.path || '.', parsed.args.max_results || undefined);
    else if (parsed.name === 'workshop_tree') result = this.workshop.tree(parsed.args.path || '.', parsed.args.depth || 3, parsed.args.max_entries || undefined);
    else if (parsed.name === 'workshop_stat') result = this.workshop.stat(parsed.args.path);
    else if (parsed.name === 'workshop_file_hash') result = this.workshop.fileHash(parsed.args.path);
    else if (parsed.name === 'workshop_brief_upsert') result = this.world.upsertBrief({ sessionId, objective: parsed.args.objective, scopePaths: parsed.args.scope_paths || [], acceptance: parsed.args.acceptance || [], nonGoals: parsed.args.non_goals || [] });
    else if (parsed.name === 'workshop_brief_get') result = this.world.getBrief(sessionId);
    else if (parsed.name === 'workshop_pending_diff') result = { kind: 'workshop_pending_diff', approvals: this.world.listApprovals(sessionId, { pendingOnly: true }) };
    else if (parsed.name === 'workshop_approval_status') {
      if (parsed.args.approval_id) {
        const approval = this.world.getApproval(parsed.args.approval_id);
        if (!approval || approval.sessionId !== sessionId) fail('workshop_approval_not_found', 'Approval not found for this lifespan.');
        result = { kind: 'workshop_approval_status', approval };
      } else result = { kind: 'workshop_approval_status', approvals: this.world.listApprovals(sessionId) };
    } else if (parsed.name === 'workshop_approval_list') result = { kind: 'workshop_approval_list', approvals: this.world.listApprovals(sessionId, { pendingOnly: Boolean(parsed.args.pending_only) }) };
    else if (parsed.name === 'workshop_tool_catalog') result = { kind: 'workshop_tool_catalog', tools: toolCatalogEntries(this.world.availableTools(sessionId)) };
    else if (parsed.name === 'workshop_apply_patch') {
      const preview = this.workshop.previewPatch(parsed.args.path, parsed.args.old_text, parsed.args.new_text);
      result = this.pendingConfirm(sessionId, wakeId, 'patch', { path: parsed.args.path, oldText: parsed.args.old_text, newText: parsed.args.new_text }, preview, parsed.name);
    } else if (parsed.name === 'workshop_apply_unified_diff') {
      const preview = this.workshop.previewUnifiedDiff(parsed.args.diff);
      result = this.pendingConfirm(sessionId, wakeId, 'unified_diff', { diff: parsed.args.diff }, preview, parsed.name);
    } else if (parsed.name === 'workshop_write_file') {
      const preview = this.workshop.previewWriteFile(parsed.args.path, parsed.args.content);
      result = this.pendingConfirm(sessionId, wakeId, 'write_file', { path: parsed.args.path, content: parsed.args.content }, preview, parsed.name);
    } else if (parsed.name === 'workshop_create_path') {
      const preview = this.workshop.previewCreatePath(parsed.args.path, parsed.args.kind);
      result = this.pendingConfirm(sessionId, wakeId, 'create_path', { path: parsed.args.path, kind: parsed.args.kind }, preview, parsed.name);
    } else if (parsed.name === 'workshop_delete_path') {
      const preview = this.workshop.previewDeletePath(parsed.args.path);
      result = this.pendingConfirm(sessionId, wakeId, 'delete_path', { path: parsed.args.path }, preview, parsed.name);
    } else if (parsed.name === 'workshop_rename_path') {
      const preview = this.workshop.previewRenamePath(parsed.args.from_path, parsed.args.to_path);
      result = this.pendingConfirm(sessionId, wakeId, 'rename_path', { fromPath: parsed.args.from_path, toPath: parsed.args.to_path }, preview, parsed.name);
    } else if (parsed.name === 'workshop_git_status') result = this.git.status();
    else if (parsed.name === 'workshop_git_diff') result = this.git.diff(parsed.args.path);
    else if (parsed.name === 'workshop_git_log') result = this.git.log(parsed.args.max_count || 20);
    else if (parsed.name === 'workshop_git_show') result = this.git.show(parsed.args.revision, parsed.args.path);
    else if (parsed.name === 'workshop_git_branch_list') result = this.git.branchList();
    else if (parsed.name === 'workshop_git_add') {
      const preview = this.git.previewAdd({ paths: parsed.args.paths || [], update: parsed.args.update });
      result = this.pendingConfirm(sessionId, wakeId, 'git_add', { paths: parsed.args.paths || [], update: Boolean(parsed.args.update) }, preview, parsed.name);
    } else if (parsed.name === 'workshop_git_commit') {
      const preview = this.git.previewCommit({ message: parsed.args.message, paths: parsed.args.paths || [] });
      result = this.pendingConfirm(sessionId, wakeId, 'commit', { message: parsed.args.message, paths: parsed.args.paths || [] }, preview, parsed.name);
    } else if (parsed.name === 'workshop_git_checkout') {
      const preview = this.git.previewCheckout(parsed.args.branch);
      result = this.pendingConfirm(sessionId, wakeId, 'git_checkout', { branch: parsed.args.branch }, preview, parsed.name);
    } else if (parsed.name === 'workshop_recipe_list') result = { kind: 'workshop_recipe_list', recipes: listRecipes() };
    else if (parsed.name === 'workshop_run_recipe') {
      try {
        this.noteKiln({ status: 'running', recipe: parsed.args.recipe });
        result = this.recipes.start(parsed.args.recipe, { path: parsed.args.path, script: parsed.args.script }, {
          onComplete: (finalResult) => this.noteKiln(this.kilnStateFromRecipeResult(finalResult)),
        });
      } catch (error) {
        this.noteKiln({ status: 'failed', recipe: parsed.args.recipe, reason: error?.message || 'recipe_failed' });
        throw error;
      }
    } else if (parsed.name === 'workshop_recipe_status') {
      const runner = this.recipes.status();
      const kiln = this.world.getFixtureRuntime(KILN_FIXTURE_ID) || { status: 'idle' };
      result = { ...runner, kiln };
    } else if (parsed.name === 'workshop_recipe_cancel') {
      result = this.recipes.cancel('cancelled_by_tool');
      if (result.cancelled) this.noteKiln({ status: 'cancelled', recipe: this.recipes.lastRecipe || null, reason: 'cancelled_by_tool' });
    } else if (parsed.name === 'workshop_timer_set') result = this.world.setTimer(sessionId, parsed.args.seconds);
    else if (parsed.name === 'workshop_timer_status') result = this.world.getTimer(sessionId);
    else if (parsed.name === 'workshop_timer_cancel') result = this.world.cancelTimer(sessionId);
    else fail('world_tool_unknown', 'The requested capability is not installed.');
    const actionReceipt = this.world.actionReceipt({ sessionId, wakeId, roomNodeId: this.world.current(sessionId).room_node_id, toolName: parsed.name, arguments: parsed.args, result, outcome: 'committed', requestRecordId, spineRecordId });
    const scrub = scrubHostReturn({ toolName: parsed.name, toolCallId: parsed.call.id, arguments: parsed.args, result, roomId: this.world.current(sessionId).room_node_id, actionReceiptId: actionReceipt.receiptId, requestRecordId, spineRecordId });
    const wild = source && this.forest ? this.forest.ingestWorkshopSource({ ...source, actionReceiptId: actionReceipt.receiptId, spineRecordId, requestRecordId }) : [];
    return { ...parsed, result, scrub, actionReceipt, wild, changedRoom, projection: this.world.projection(sessionId) };
  }
  confirmApproval(approvalId, sessionId) {
    const approval = this.world.getApproval(approvalId);
    if (!approval || approval.sessionId !== sessionId) fail('workshop_approval_not_found', 'Approval not found for this lifespan.');
    if (approval.status !== 'pending') fail('workshop_approval_not_pending', 'Approval is no longer pending.');
    let outcome;
    if (approval.kind === 'patch') outcome = this.workshop.applyPatch(approval.payload.path, approval.payload.oldText, approval.payload.newText);
    else if (approval.kind === 'unified_diff') outcome = this.workshop.applyUnifiedDiff(approval.payload.diff);
    else if (approval.kind === 'write_file') outcome = this.workshop.writeFile(approval.payload.path, approval.payload.content);
    else if (approval.kind === 'create_path') outcome = this.workshop.createPath(approval.payload.path, approval.payload.kind);
    else if (approval.kind === 'delete_path') outcome = this.workshop.deletePath(approval.payload.path, approval.preview);
    else if (approval.kind === 'rename_path') outcome = this.workshop.renamePath(approval.payload.fromPath, approval.payload.toPath);
    else if (approval.kind === 'git_add') outcome = this.git.add({ paths: approval.payload.paths || [], update: approval.payload.update });
    else if (approval.kind === 'commit') outcome = this.git.commit({ message: approval.payload.message, paths: approval.payload.paths || [] });
    else if (approval.kind === 'git_checkout') outcome = this.git.checkout(approval.payload.branch);
    else fail('workshop_invalid_argument', 'Unknown approval kind.');
    const decided = this.world.decideApproval(approvalId, 'confirm', outcome);
    return { kind: 'workshop_approval_confirmed', approval: decided, outcome };
  }
  rejectApproval(approvalId, sessionId) {
    const approval = this.world.getApproval(approvalId);
    if (!approval || approval.sessionId !== sessionId) fail('workshop_approval_not_found', 'Approval not found for this lifespan.');
    const decided = this.world.decideApproval(approvalId, 'reject', { rejected: true });
    return { kind: 'workshop_approval_rejected', approval: decided };
  }
  reconcileStartup(sessionId) {
    const lifespan = this.world.activateLifespan(sessionId, 'server_restart');
    const kiln = this.world.getFixtureRuntime(KILN_FIXTURE_ID);
    if (kiln?.status === 'running') {
      this.noteKiln({
        status: 'cancelled',
        recipe: kiln.recipe || null,
        code: kiln.code ?? null,
        signal: kiln.signal ?? null,
        reason: 'server_restart',
        summaryTail: kiln.summaryTail,
      });
    }
    return { lifespan, kilnReconciled: kiln?.status === 'running' };
  }
  close(reason = 'hub_close') {
    const result = this.recipes.cancel(reason);
    if (result.cancelled) this.noteKiln({ status: 'cancelled', recipe: this.recipes.lastRecipe || null, reason });
    return result;
  }
  noteKiln(state) {
    const summaryTail = typeof state.summaryTail === 'string' ? state.summaryTail.slice(0, 240) : undefined;
    this.world.setFixtureRuntime(KILN_FIXTURE_ID, {
      status: state.status || 'idle',
      recipe: state.recipe || null,
      code: state.code ?? null,
      signal: state.signal ?? null,
      reason: state.reason || null,
      ...(summaryTail ? { summaryTail } : {}),
    });
  }
  kilnStateFromRecipeResult(result) {
    if (result?.cancelled) return { status: 'cancelled', recipe: result.recipe, code: result.code, signal: result.signal, reason: result.cancelled, summaryTail: (result.stderr || result.stdout || '').slice(0, 240) };
    if (result?.ok) return { status: 'settled', recipe: result.recipe, code: result.code, signal: result.signal, summaryTail: (result.stdout || '').slice(0, 240) };
    return { status: 'failed', recipe: result?.recipe || null, code: result?.code ?? null, signal: result?.signal ?? null, reason: result?.error || null, summaryTail: (result?.stderr || result?.stdout || '').slice(0, 240) };
  }
  refuse({ sessionId, wakeId, requestRecordId, spineRecordId = null, intent, error }) {
    const name = intent?.function?.name || 'unknown'; const room = this.world.current(sessionId).room_node_id;
    let refusedArguments = { raw_arguments: intent?.function?.arguments || '' }; try { refusedArguments = JSON.parse(intent?.function?.arguments || '{}'); } catch {}
    const result = { ok: false, error: error?.code || 'world_tool_refused', message: error?.message || 'The action was refused.' };
    const receipt = this.world.actionReceipt({ sessionId, wakeId, roomNodeId: room, toolName: name, arguments: refusedArguments, result, outcome: 'refused', requestRecordId, spineRecordId });
    const scrub = scrubHostReturn({ toolName: name, toolCallId: intent?.id || null, arguments: refusedArguments, result, roomId: room, actionReceiptId: receipt.receiptId, requestRecordId, spineRecordId });
    return { name, result, scrub, actionReceipt: receipt, wild: [] };
  }
}

export { parseArguments as parseWorldToolIntent };
