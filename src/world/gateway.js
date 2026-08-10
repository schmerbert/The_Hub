import { scrubHostReturn } from '../scrub/host-return.js';
import { TOOL_APPROVAL_CLASS, TOOL_NAMES, toolCatalogEntries } from './tools.js';
import { listRecipes, RecipeRunner } from './recipes.js';
import { WorkshopGit } from './git.js';
import { KILN_FIXTURE_ID } from './graph.js';
import { applySandboxPromotion } from './promotion.js';
import { sha256 } from '../core/hash.js';

function fail(code, message) { throw Object.assign(new Error(message), { code }); }
function parseArguments(call) {
  if (!call || call.type !== 'function' || typeof call.id !== 'string' || !call.id || typeof call.function?.name !== 'string' || typeof call.function?.arguments !== 'string') fail('world_tool_invalid', 'Tool intent is malformed.');
  if (!TOOL_NAMES.has(call.function.name)) fail('world_tool_unknown', 'The requested capability is not installed.');
  let args; try { args = JSON.parse(call.function.arguments || '{}'); } catch { fail('world_tool_invalid', 'Tool arguments are not valid JSON.'); }
  if (!args || Array.isArray(args) || typeof args !== 'object') fail('world_tool_invalid', 'Tool arguments must be an object.');
  return { call, name: call.function.name, args };
}

export class WorldActionGateway {
  constructor({ world, workshop, forest = null, resultRack = null, recipeRunner = null, approvalMode = 'confirm', recipeTimeoutMs = 120000 }) {
    this.world = world;
    this.workshop = workshop;
    this.forest = forest;
    this.resultRack = resultRack;
    this.approvalMode = approvalMode === 'auto' ? 'auto' : 'confirm';
    this.recipes = recipeRunner || new RecipeRunner(workshop.root, { timeoutMs: recipeTimeoutMs, maxOutputBytes: workshop.limits.maxBytes });
    this.git = new WorkshopGit(workshop.root, { maxBytes: workshop.limits.maxBytes });
    this.approvalConfirmations = new Map();
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
    if ((this.approvalMode === 'auto' && toolName !== 'workshop_sandbox_promote') || toolClass === 'auto') return this.confirmApproval(approval.approvalId, sessionId, { recordCrossing: false });
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
        result = await this.recipes.start(parsed.args.recipe, { path: parsed.args.path, script: parsed.args.script }, {
          onComplete: (finalResult) => {
            this.captureResultSafely({ sessionId, wakeId, toolName: 'workshop_recipe_completion', result: finalResult });
            this.noteKiln(this.kilnStateFromRecipeResult(finalResult));
          },
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
      result = await this.recipes.cancel('cancelled_by_tool');
      if (result.cancelled) this.noteKiln({ status: 'cancelled', recipe: this.recipes.lastRecipe || null, reason: 'cancelled_by_tool' });
    } else if (parsed.name === 'workshop_sandbox_diff') {
      if (typeof this.recipes.diff !== 'function') fail('sandbox_backend_unavailable', 'Workshop recipes are not using an isolated Sandbox Bay.');
      result = { kind: 'workshop_sandbox_diff', ...(await this.recipes.diff()) };
    } else if (parsed.name === 'workshop_sandbox_promote') {
      if (typeof this.recipes.promotionPlan !== 'function') fail('sandbox_backend_unavailable', 'Workshop recipes are not using an isolated Sandbox Bay.');
      const plan = await this.recipes.promotionPlan();
      if (!plan.promotable) fail('sandbox_promotion_stale', 'Sandbox candidate cannot be promoted because the canonical checkout is dirty or advanced.');
      const preview = this.promotionPreview({ sessionId, wakeId, plan });
      result = this.pendingConfirm(sessionId, wakeId, 'sandbox_promotion', { plan }, preview, parsed.name);
    } else if (parsed.name === 'workshop_timer_set') result = this.world.setTimer(sessionId, parsed.args.seconds);
    else if (parsed.name === 'workshop_timer_status') result = this.world.getTimer(sessionId);
    else if (parsed.name === 'workshop_timer_cancel') result = this.world.cancelTimer(sessionId);
    else fail('world_tool_unknown', 'The requested capability is not installed.');
    const actionReceipt = this.world.actionReceipt({ sessionId, wakeId, roomNodeId: this.world.current(sessionId).room_node_id, toolName: parsed.name, arguments: parsed.args, result, outcome: 'committed', requestRecordId, spineRecordId });
    const custody = this.captureResultSafely({ sessionId, wakeId, toolName: parsed.name, result, sourceActionReceiptId: actionReceipt.receiptId, requestRecordId, spineRecordId });
    const resultRack = custody.resultRack;
    const scrub = scrubHostReturn({ toolName: parsed.name, toolCallId: parsed.call.id, arguments: parsed.args, result, ...(resultRack ? { content: resultRack.projection.content, renderPolicy: 'result_rack_projection_v1', projection: resultRack.projection } : {}), roomId: this.world.current(sessionId).room_node_id, actionReceiptId: actionReceipt.receiptId, requestRecordId, spineRecordId });
    const approvalId = result?.approvalId || result?.approval?.approvalId || null;
    let approvalReceipt = null;
    if (approvalId) {
      const phase = result?.status === 'pending_approval' ? 'pending' : result?.approval?.status === 'confirmed' ? 'confirmed' : null;
      if (phase) approvalReceipt = this.world.recordApprovalReceipt({ approvalId, phase, actionReceiptId: actionReceipt.receiptId, result, hostReturnScrub: scrub });
    }
    const wild = source && this.forest ? this.forest.ingestWorkshopSource({ ...source, actionReceiptId: actionReceipt.receiptId, spineRecordId, requestRecordId }) : [];
    return {
      ...parsed, result, resultRack, resultCustodyFailure: custody.failure, resultCustodyFailureReceipt: custody.failureReceipt,
      scrub, actionReceipt, approvalReceipt, wild, changedRoom, projection: this.world.projection(sessionId),
    };
  }
  confirmApproval(approvalId, sessionId, { recordCrossing = true } = {}) {
    const approval = this.world.getApproval(approvalId);
    if (!approval || approval.sessionId !== sessionId) fail('workshop_approval_not_found', 'Approval not found for this lifespan.');
    if (approval.status !== 'pending') fail('workshop_approval_not_pending', 'Approval is no longer pending.');
    if (approval.kind === 'sandbox_promotion') return this.confirmSandboxPromotion(approval, { recordCrossing });
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
    const result = { kind: 'workshop_approval_confirmed', approval: decided, outcome };
    return recordCrossing ? this.recordApprovalCrossing({ approval: decided, phase: 'confirmed', result }) : result;
  }
  confirmSandboxPromotion(approval, { recordCrossing }) {
    const active = this.approvalConfirmations.get(approval.approvalId);
    if (active) return active;
    const confirmation = Promise.resolve().then(async () => {
      const promotion = applySandboxPromotion(this.workshop.root, approval.payload.plan);
      let reset;
      if (typeof this.recipes.reset !== 'function') {
        reset = { kind: 'sandbox_promotion_reset', reason: 'promotion_complete', ok: false, status: 'failed', error: 'sandbox_reset_unavailable', message: 'Sandbox reset is unavailable.' };
      } else {
        try {
          const resetResult = await this.recipes.reset('promotion_complete');
          reset = { kind: 'sandbox_promotion_reset', reason: 'promotion_complete', ok: true, status: 'settled', result: resetResult };
        } catch (error) {
          reset = {
            kind: 'sandbox_promotion_reset', reason: 'promotion_complete', ok: false, status: 'failed',
            error: error?.code || 'sandbox_reset_failed', message: error?.message || 'Sandbox reset failed.',
          };
        }
      }
      const outcome = {
        ...promotion,
        status: reset.ok ? 'complete' : 'promotion_applied_reset_failed',
        fullyComplete: reset.ok,
        reset,
      };
      const decided = this.world.decideApproval(approval.approvalId, 'confirm', outcome);
      const result = { kind: 'workshop_approval_confirmed', approval: decided, outcome };
      return recordCrossing ? this.recordApprovalCrossing({ approval: decided, phase: 'confirmed', result }) : result;
    });
    this.approvalConfirmations.set(approval.approvalId, confirmation);
    confirmation.then(
      () => this.approvalConfirmations.delete(approval.approvalId),
      () => this.approvalConfirmations.delete(approval.approvalId),
    );
    return confirmation;
  }
  rejectApproval(approvalId, sessionId) {
    const approval = this.world.getApproval(approvalId);
    if (!approval || approval.sessionId !== sessionId) fail('workshop_approval_not_found', 'Approval not found for this lifespan.');
    if (this.approvalConfirmations.has(approvalId)) fail('workshop_approval_in_progress', 'Approval confirmation is already applying and cannot be rejected concurrently.');
    const decided = this.world.decideApproval(approvalId, 'reject', { rejected: true });
    const result = { kind: 'workshop_approval_rejected', approval: decided };
    return this.recordApprovalCrossing({ approval: decided, phase: 'rejected', result });
  }
  reconcileStartup(sessionId) {
    const lifespan = this.world.activateLifespan(sessionId, 'server_restart');
    const cancelledApprovalReceipts = [];
    for (const approvalId of lifespan.cancelledApprovalIds || []) {
      const approval = this.world.getApproval(approvalId);
      const result = { kind: 'workshop_approval_cancelled', approval, reason: 'server_restart' };
      cancelledApprovalReceipts.push(this.recordApprovalCrossing({ approval, phase: 'cancelled', result }));
    }
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
    return { lifespan, cancelledApprovalReceipts, kilnReconciled: kiln?.status === 'running' };
  }
  recordApprovalCrossing({ approval, phase, result }) {
    const sessionId = approval.sessionId;
    const roomNodeId = this.world.current(sessionId).room_node_id;
    const toolName = phase === 'confirmed' ? 'workshop_approval_confirm' : phase === 'rejected' ? 'workshop_approval_reject' : 'workshop_approval_cancel';
    const args = { approval_id: approval.approvalId, phase };
    const actionReceipt = this.world.actionReceipt({ sessionId, wakeId: approval.wakeId, roomNodeId, toolName, arguments: args, result, outcome: phase === 'confirmed' ? 'committed' : 'refused' });
    const custody = this.captureResultSafely({ sessionId, wakeId: approval.wakeId, toolName, result, sourceActionReceiptId: actionReceipt.receiptId });
    const resultRack = custody.resultRack;
    const scrub = scrubHostReturn({ toolName, arguments: args, result, ...(resultRack ? { content: resultRack.projection.content, renderPolicy: 'result_rack_projection_v1', projection: resultRack.projection } : {}), roomId: roomNodeId, actionReceiptId: actionReceipt.receiptId });
    const approvalReceipt = this.world.recordApprovalReceipt({ approvalId: approval.approvalId, phase, actionReceiptId: actionReceipt.receiptId, result, hostReturnScrub: scrub });
    return {
      ...result, resultRack, resultCustodyFailure: custody.failure, resultCustodyFailureReceipt: custody.failureReceipt,
      actionReceipt, scrub, approvalReceipt,
    };
  }
  promotionPreview({ sessionId, wakeId, plan }) {
    if (typeof plan?.patch !== 'string' || sha256(plan.patch) !== plan.patchHash || Buffer.byteLength(plan.patch, 'utf8') !== plan.patchBytes) {
      fail('sandbox_promotion_invalid', 'Sandbox promotion preview does not match its patch hash and byte receipt.');
    }
    const inlineLimitBytes = Math.max(1, Math.min(Number.isInteger(this.workshop.limits?.maxBytes) ? this.workshop.limits.maxBytes : 120000, 32768));
    const preview = {
      kind: 'sandbox_promotion_preview', jobId: plan.jobId, promotable: plan.promotable,
      baseCommit: plan.baseCommit, patchHash: plan.patchHash, patchBytes: plan.patchBytes,
      nameStatus: plan.nameStatus, canonicalDirty: plan.canonicalDirty, planHash: plan.planHash,
      inlineLimitBytes,
    };
    if (plan.patchBytes <= inlineLimitBytes) {
      return { ...preview, patchExact: true, patchOverflow: false, patch: plan.patch };
    }
    if (!this.resultRack) fail('sandbox_promotion_preview_overflow', 'Promotion patch exceeds the inline preview ceiling and no Result Rack is available for exact custody.');
    try {
      const job = this.resultRack.createJob({
        sessionId, wakeId, toolName: 'workshop_sandbox_promotion_preview', jobKind: 'git_diff',
        metadata: { patchHash: plan.patchHash, patchBytes: plan.patchBytes, planHash: plan.planHash },
      });
      const artifact = this.resultRack.addArtifact(job.jobId, {
        name: 'sandbox-promotion.patch', mediaType: 'text/x-diff', body: plan.patch,
        metadata: { patchHash: plan.patchHash, planHash: plan.planHash },
      });
      this.resultRack.appendJobStatus(job.jobId, 'complete', { captured: true, patchHash: plan.patchHash, patchBytes: plan.patchBytes });
      const projection = this.resultRack.createProjection(job.jobId, { policy: 'git_diff', source: { kind: 'artifact', artifactId: artifact.artifactId } });
      if (artifact.bodyHash !== plan.patchHash || projection.sourceHash !== plan.patchHash) fail('result_custody_mismatch', 'Promotion patch custody is not bound to its approved patch hash.');
      return {
        ...preview,
        patchExact: false,
        patchOverflow: {
          reason: 'inline_preview_limit', inlineLimitBytes, patchBytes: plan.patchBytes,
          exactPointer: projection.exactPointer, sourceHash: projection.sourceHash, projectionId: projection.projectionId,
        },
        patchPreview: projection.content,
      };
    } catch (error) {
      if (error?.code === 'sandbox_promotion_preview_overflow') throw error;
      fail('sandbox_promotion_preview_overflow', `Promotion patch exceeded the inline ceiling and exact overflow custody failed: ${error?.code || 'result_custody_failed'}.`);
    }
  }
  captureResultSafely({ sessionId, wakeId, toolName, result, sourceActionReceiptId = null, requestRecordId = null, spineRecordId = null }) {
    try {
      return { resultRack: this.captureResult({ sessionId, wakeId, toolName, result }), failure: null, failureReceipt: null };
    } catch (error) {
      const failure = {
        kind: 'workshop_result_custody_failure', status: 'failed', sourceToolName: toolName,
        sourceActionReceiptId, resultRackJobId: error?.resultRackJobId || null,
        stage: error?.resultRackStage || 'capture_or_projection',
        error: error?.code || 'result_custody_failed', message: error?.message || 'Result Rack custody failed.',
      };
      const roomNodeId = this.world.current(sessionId).room_node_id;
      const failureReceipt = this.world.actionReceipt({
        sessionId, wakeId, roomNodeId, toolName: 'workshop_result_custody_failure',
        arguments: { source_tool_name: toolName, source_action_receipt_id: sourceActionReceiptId, result_rack_job_id: failure.resultRackJobId, stage: failure.stage },
        result: failure, outcome: 'refused', requestRecordId, spineRecordId,
      });
      return { resultRack: null, failure, failureReceipt };
    }
  }
  captureResult({ sessionId, wakeId, toolName, result }) {
    if (!this.resultRack) return null;
    let job = null;
    let stage = 'create_job';
    try {
      job = this.resultRack.createJob({ sessionId, wakeId, toolName, metadata: { resultKind: result?.kind || null } });
      const stdout = typeof result?.stdout === 'string' ? result.stdout : '';
      const stderr = typeof result?.stderr === 'string' ? result.stderr : '';
      stage = 'append_output';
      if (stdout) this.resultRack.appendOutputChunk(job.jobId, 'stdout', stdout);
      if (stderr) this.resultRack.appendOutputChunk(job.jobId, 'stderr', stderr);
      if (result?.truncated || result?.stdoutExact === false || result?.stderrExact === false) {
        this.resultRack.appendOutputChunk(job.jobId, 'output', `Upstream capture was bounded; retained stream bytes are exact, but omitted stream bytes are unavailable. stdout_bytes=${result?.stdoutBytes ?? 'unknown'} stdout_hash=${result?.stdoutHash || 'unknown'} stderr_bytes=${result?.stderrBytes ?? 'unknown'} stderr_hash=${result?.stderrHash || 'unknown'}\n`);
      }
      const exactJson = JSON.stringify(result);
      if (!stdout && !stderr) this.resultRack.appendOutputChunk(job.jobId, 'output', exactJson);
      stage = 'add_artifact';
      const artifact = this.resultRack.addArtifact(job.jobId, { name: 'machine-result.json', mediaType: 'application/json', body: exactJson, metadata: { toolName } });
      const terminalStatus = result?.cancelled || result?.status === 'cancelled'
        ? 'cancelled'
        : result?.ok === false || result?.status === 'failed' ? 'failed' : 'settled';
      stage = 'seal_job';
      this.resultRack.appendJobStatus(job.jobId, terminalStatus, { captured: true, resultStatus: result?.status || null, error: result?.error || null });
      stage = 'create_projection';
      const projection = this.resultRack.createProjection(job.jobId);
      return { jobId: job.jobId, artifactId: artifact.artifactId, projection };
    } catch (error) {
      if (error && typeof error === 'object') {
        try { error.resultRackJobId = job?.jobId || null; error.resultRackStage = stage; } catch {}
      }
      throw error;
    }
  }
  close(reason = 'hub_close') {
    const wasActive = Boolean(this.recipes.active);
    const result = typeof this.recipes.destroy === 'function' ? this.recipes.destroy(reason) : typeof this.recipes.close === 'function' ? this.recipes.close(reason) : this.recipes.cancel(reason);
    if (wasActive) this.noteKiln({ status: 'cancelled', recipe: this.recipes.lastRecipe || null, reason });
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
    const custody = this.captureResultSafely({ sessionId, wakeId, toolName: name, result, sourceActionReceiptId: receipt.receiptId, requestRecordId, spineRecordId });
    const resultRack = custody.resultRack;
    const scrub = scrubHostReturn({ toolName: name, toolCallId: intent?.id || null, arguments: refusedArguments, result, ...(resultRack ? { content: resultRack.projection.content, renderPolicy: 'result_rack_projection_v1', projection: resultRack.projection } : {}), roomId: room, actionReceiptId: receipt.receiptId, requestRecordId, spineRecordId });
    return {
      name, result, resultRack, resultCustodyFailure: custody.failure, resultCustodyFailureReceipt: custody.failureReceipt,
      scrub, actionReceipt: receipt, wild: [],
    };
  }
}

export { parseArguments as parseWorldToolIntent };
