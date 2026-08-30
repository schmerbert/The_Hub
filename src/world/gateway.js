import { scrubHostReturn } from '../scrub/host-return.js';
import { TOOL_APPROVAL_CLASS } from './tools.js';
import { RecipeRunner } from './recipes.js';
import { WorkshopGit } from './git.js';
import { KILN_FIXTURE_ID } from './graph.js';
import { applySandboxPromotion } from './promotion.js';
import { id, sha256 } from '../core/hash.js';
import { dispatchWorldToolImmediate, parseWorldToolIntent } from './gateway/dispatch.js';
import { inspectFixtureContents } from './gateway/fixture-inspectors.js';

function fail(code, message) { throw Object.assign(new Error(message), { code }); }
const ATOMIC_CROSSING = Symbol('world_atomic_crossing');
function worldEventLink(value) {
  const source = value?.worldEventSequence ? value : value?.approval?.worldEventSequence ? value.approval : null;
  return source ? { worldEventSequence: source.worldEventSequence, worldEventHash: source.worldEventHash } : { worldEventSequence: null, worldEventHash: null };
}
function approvalEffectEvidence(approval) {
  const payload = approval.payload || {}; const preview = approval.preview || {};
  let postcondition;
  if (approval.kind === 'write_file') postcondition = { path: payload.path, contentSha256: sha256(payload.content) };
  else if (approval.kind === 'create_path') postcondition = { path: payload.path, kind: payload.kind, expected: 'present' };
  else if (approval.kind === 'delete_path') postcondition = { path: payload.path, expected: 'absent' };
  else if (approval.kind === 'rename_path') postcondition = { fromPath: payload.fromPath, toPath: payload.toPath, expected: 'renamed' };
  else if (approval.kind === 'sandbox_promotion') postcondition = { planHash: payload.plan?.planHash || null, patchHash: payload.plan?.patchHash || null };
  else postcondition = { preview };
  return { preimage: preview, postcondition };
}
export class WorldActionGateway {
  constructor({ world, workshop, forest = null, resultRack = null, recipeRunner = null, binderWindow = null, approvalMode = 'confirm', recipeTimeoutMs = 120000, readHearth = null }) {
    this.world = world;
    this.workshop = workshop;
    this.binderWindow = binderWindow;
    this.readHearth = readHearth;
    this.forest = forest;
    this.resultRack = resultRack;
    this.approvalMode = approvalMode === 'auto' ? 'auto' : 'confirm';
    this.recipes = recipeRunner || new RecipeRunner(workshop.root, { timeoutMs: recipeTimeoutMs, maxOutputBytes: workshop.limits.maxBytes });
    this.git = new WorkshopGit(workshop.root, { maxBytes: workshop.limits.maxBytes });
    this.approvalConfirmations = new Map();
    this.kilnRuns = new Map();
  }
  schemas(sessionId) { return this.world.availableTools(sessionId); }
  assertToolMounted(sessionId, name) {
    const available = this.world.availableTools(sessionId);
    if (!available.includes(name)) fail('world_wrong_station', `Tool ${name} is not mounted for the current room.`);
  }
  fixtureContents(sessionId, fixtureId) {
    return inspectFixtureContents({ world: this.world, workshop: this.workshop, git: this.git, binderWindow: this.binderWindow, sessionId, fixtureId });
  }
  pendingConfirm(sessionId, wakeId, kind, payload, preview, toolName, commandId = null) {
    const toolClass = TOOL_APPROVAL_CLASS[toolName] || 'confirm';
    const autoConfirm = (this.approvalMode === 'auto' && toolName !== 'workshop_sandbox_promote') || toolClass === 'auto';
    const approval = this.world.createApproval({ sessionId, wakeId, kind, payload, preview, commandId: autoConfirm ? null : commandId });
    if (autoConfirm) return Promise.resolve().then(() => this.confirmApproval(approval.approvalId, sessionId, { commandId, crossingToolName: toolName, crossingArguments: payload }));
    return { kind: toolName, status: 'pending_approval', approvalId: approval.approvalId, preview, worldEventSequence: approval.worldEventSequence, worldEventHash: approval.worldEventHash };
  }
  async execute({ sessionId, wakeId, requestRecordId, spineRecordId, intent }) {
    const parsed = parseWorldToolIntent(intent);
    this.assertToolMounted(sessionId, parsed.name);
    const finish = outcome => this.recordToolCrossing({ parsed, sessionId, wakeId, requestRecordId, spineRecordId, outcome });
    const commitOutcome = producer => {
      let outcome;
      const crossing = this.world.transaction(() => {
        outcome = producer();
        return finish(outcome);
      }, { verify: true });
      Object.defineProperty(outcome, ATOMIC_CROSSING, { value: crossing });
      return outcome;
    };
    const context = {
      world: this.world,
      workshop: this.workshop,
      git: this.git,
      recipes: this.recipes,
      sessionId,
      wakeId,
      commandId: parsed.call.id,
      args: parsed.args,
      fixtureContents: (targetSessionId, fixtureId) => this.fixtureContents(targetSessionId, fixtureId),
      pendingConfirm: (...args) => this.pendingConfirm(...args, parsed.call.id),
      promotionPreview: input => this.promotionPreview(input),
      commitOutcome,
      registerKilnRun: (runId, recipe, options = {}) => this.registerKilnRun(runId, recipe, { sessionId, wakeId, ...options }),
      activateKilnRun: runId => this.activateKilnRun(runId),
      compensateRecipeStart: (runId, error) => this.compensateRecipeStart(runId, error),
      cancelKilnRun: () => this.cancelKilnRunCommand({ sessionId, wakeId, commandId: parsed.call.id, commitOutcome }),
      noteKiln: (state, action) => this.noteKiln(state, { sessionId, wakeId, commandId: parsed.call.id, action }),
      onRecipeComplete: (finalResult, runId) => this.handleRecipeComplete(finalResult, { runId, sessionId, wakeId }),
      readHearth: targetSessionId => this.readHearth?.(targetSessionId),
    };
    let dispatched; let crossing;
    this.world.transaction(() => {
      dispatched = dispatchWorldToolImmediate(parsed.name, context);
      if (!dispatched || typeof dispatched.then !== 'function') crossing = finish(dispatched);
    }, { verify: true });
    if (dispatched && typeof dispatched.then === 'function') {
      const outcome = await dispatched;
      const precommitted = outcome[ATOMIC_CROSSING] || outcome.result?.[ATOMIC_CROSSING];
      crossing = precommitted
        ? { ...parsed, ...precommitted, source: outcome.source, changedRoom: outcome.changedRoom, projection: this.world.projection(sessionId) }
        : this.world.transaction(() => finish(outcome), { verify: true });
    }
    const { source, ...visibleCrossing } = crossing;
    const wild = source && this.forest ? this.forest.ingestWorkshopSource({ ...source, actionReceiptId: crossing.actionReceipt.receiptId, spineRecordId, requestRecordId }) : [];
    return { ...visibleCrossing, wild };
  }
  recordToolCrossing({ parsed, sessionId, wakeId, requestRecordId, spineRecordId, outcome }) {
    const { result, source, changedRoom } = outcome;
    const link = worldEventLink(result);
    const actionReceipt = this.world.actionReceipt({ sessionId, wakeId, roomNodeId: this.world.current(sessionId).room_node_id, toolName: parsed.name, arguments: parsed.args, result, outcome: 'committed', requestRecordId, spineRecordId, ...link });
    const custody = this.captureResultSafely({ sessionId, wakeId, toolName: parsed.name, result, sourceActionReceiptId: actionReceipt.receiptId, requestRecordId, spineRecordId });
    const resultRack = custody.resultRack;
    const hearthReread = parsed.name === 'tend_hearth' && result?.kind === 'house_hearth_reread';
    const scrub = scrubHostReturn({ toolName: parsed.name, toolCallId: parsed.call.id, arguments: parsed.args, result,
      ...(hearthReread
        ? { content: result.markdown, renderPolicy: 'house_hearth_packet_markdown_v1' }
        : resultRack ? { content: resultRack.projection.content, renderPolicy: 'result_rack_projection_v1', projection: resultRack.projection } : {}),
      roomId: this.world.current(sessionId).room_node_id, actionReceiptId: actionReceipt.receiptId, requestRecordId, spineRecordId });
    const approvalId = result?.approvalId || result?.approval?.approvalId || null;
    let approvalReceipt = null;
    if (approvalId) {
      const phase = result?.status === 'pending_approval' ? 'pending' : result?.approval?.status === 'confirmed' ? 'confirmed' : null;
      if (phase) approvalReceipt = this.world.recordApprovalReceipt({ approvalId, phase, actionReceiptId: actionReceipt.receiptId, result, hostReturnScrub: scrub, ...link });
    }
    return {
      ...parsed, result, resultRack, resultCustodyFailure: custody.failure, resultCustodyFailureReceipt: custody.failureReceipt,
      scrub, actionReceipt, approvalReceipt, source, changedRoom, projection: this.world.projection(sessionId),
    };
  }
  applyApprovalEffect(approval) {
    if (approval.kind === 'patch') return this.workshop.applyPatch(approval.payload.path, approval.payload.oldText, approval.payload.newText);
    if (approval.kind === 'unified_diff') return this.workshop.applyUnifiedDiff(approval.payload.diff);
    if (approval.kind === 'write_file') return this.workshop.writeFile(approval.payload.path, approval.payload.content);
    if (approval.kind === 'create_path') return this.workshop.createPath(approval.payload.path, approval.payload.kind);
    if (approval.kind === 'delete_path') return this.workshop.deletePath(approval.payload.path, approval.preview);
    if (approval.kind === 'rename_path') return this.workshop.renamePath(approval.payload.fromPath, approval.payload.toPath);
    if (approval.kind === 'git_add') return this.git.add({ paths: approval.payload.paths || [], update: approval.payload.update });
    if (approval.kind === 'commit') return this.git.commit({ message: approval.payload.message, paths: approval.payload.paths || [] });
    if (approval.kind === 'git_checkout') return this.git.checkout(approval.payload.branch);
    fail('workshop_invalid_argument', 'Unknown approval kind.');
  }
  beginApprovalEffect(approval, { commandId, crossingToolName, crossingArguments }) {
    const attemptId = id('approval_attempt'); const evidence = approvalEffectEvidence(approval);
    const applyingCommandId = `${commandId}:applying`;
    const applyingCrossing = this.world.transaction(() => {
      const applying = this.world.beginApprovalApplication(approval.approvalId, { attemptId, evidence, commandId: applyingCommandId });
      const result = { kind: 'workshop_approval_applying', approval: applying, attemptId, evidence };
      return this.recordApprovalCrossing({ approval: applying, phase: 'applying', result, toolName: crossingToolName, args: crossingArguments });
    }, { verify: true });
    return { approval: applyingCrossing.approval, attemptId, evidence, applyingCrossing };
  }
  confirmApproval(approvalId, sessionId, { recordCrossing = true, commandId = `approval_decision:${approvalId}:confirm`, crossingToolName = 'workshop_approval_confirm', crossingArguments = null } = {}) {
    this.world.assertVerified();
    const active = this.approvalConfirmations.get(approvalId);
    if (active) return active;
    const approval = this.world.getApproval(approvalId);
    if (!approval || approval.sessionId !== sessionId) fail('workshop_approval_not_found', 'Approval not found for this lifespan.');
    if (approval.status !== 'pending') fail('workshop_approval_not_pending', 'Approval is no longer pending.');
    const application = this.beginApprovalEffect(approval, { commandId, crossingToolName, crossingArguments: crossingArguments || { approval_id: approvalId, phase: 'applying' } });
    if (approval.kind === 'sandbox_promotion') return this.applySandboxPromotionEffect(application.approval, { ...application, recordCrossing, commandId, crossingToolName, crossingArguments });
    const outcome = this.applyApprovalEffect(application.approval);
    return this.world.transaction(() => {
      const decided = this.world.decideApproval(approvalId, 'confirm', outcome, { commandId: `${commandId}:resolved` });
      const result = { kind: 'workshop_approval_confirmed', approval: decided, outcome };
      const crossing = this.recordApprovalCrossing({ approval: decided, phase: 'confirmed', result, toolName: crossingToolName, args: crossingArguments });
      if (!recordCrossing) return crossing;
      Object.defineProperty(crossing, ATOMIC_CROSSING, { value: crossing });
      return crossing;
    }, { verify: true });
  }
  confirmSandboxPromotion(approval, { recordCrossing = true, commandId = `approval_decision:${approval.approvalId}:confirm`, crossingToolName = 'workshop_approval_confirm', crossingArguments = null } = {}) {
    this.world.assertVerified();
    const stored = this.world.getApproval(approval.approvalId);
    if (!stored) fail('workshop_approval_not_found', 'Approval not found.');
    if (stored.status === 'pending') return this.confirmApproval(stored.approvalId, stored.sessionId, { recordCrossing, commandId, crossingToolName, crossingArguments });
    fail('workshop_approval_not_pending', 'Approval is no longer pending.');
  }
  applySandboxPromotionEffect(approval, { attemptId, recordCrossing, commandId, crossingToolName, crossingArguments }) {
    const confirmation = Promise.resolve().then(async () => {
      this.world.assertVerified();
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
      return this.world.transaction(() => {
        const decided = this.world.decideApproval(approval.approvalId, 'confirm', outcome, { commandId: `${commandId}:resolved` });
        const result = { kind: 'workshop_approval_confirmed', approval: decided, outcome };
        const crossing = this.recordApprovalCrossing({ approval: decided, phase: 'confirmed', result, toolName: crossingToolName, args: crossingArguments });
        if (recordCrossing) Object.defineProperty(crossing, ATOMIC_CROSSING, { value: crossing });
        return crossing;
      }, { verify: true });
    });
    this.approvalConfirmations.set(approval.approvalId, confirmation);
    confirmation.then(
      () => this.approvalConfirmations.delete(approval.approvalId),
      () => this.approvalConfirmations.delete(approval.approvalId),
    );
    return confirmation;
  }
  rejectApproval(approvalId, sessionId, { commandId = `approval_decision:${approvalId}:reject` } = {}) {
    this.world.assertVerified();
    const approval = this.world.getApproval(approvalId);
    if (!approval || approval.sessionId !== sessionId) fail('workshop_approval_not_found', 'Approval not found for this lifespan.');
    if (this.approvalConfirmations.has(approvalId)) fail('workshop_approval_in_progress', 'Approval confirmation is already applying and cannot be rejected concurrently.');
    return this.world.transaction(() => {
      const decided = this.world.decideApproval(approvalId, 'reject', { rejected: true }, { commandId });
      const result = { kind: 'workshop_approval_rejected', approval: decided };
      return this.recordApprovalCrossing({ approval: decided, phase: 'rejected', result });
    }, { verify: true });
  }
  reconcileStartup(sessionId) {
    const { lifespan, cancelledApprovalReceipts } = this.world.transaction(() => {
      const lifespan = this.world.activateLifespan(sessionId, 'server_restart');
      const cancelledApprovalReceipts = [];
      for (const approvalId of lifespan.cancelledApprovalIds || []) {
        const approval = this.world.getApproval(approvalId);
        const result = { kind: 'workshop_approval_cancelled', approval, reason: 'server_restart' };
        cancelledApprovalReceipts.push(this.recordApprovalCrossing({ approval, phase: 'cancelled', result }));
      }
      return { lifespan, cancelledApprovalReceipts };
    }, { verify: true });
    const kiln = this.world.getFixtureRuntime(KILN_FIXTURE_ID);
    if (kiln && ['running', 'stopping'].includes(kiln.status)) {
      this.noteKiln({
        status: 'cancelled',
        runId: kiln.runId || null,
        recipe: kiln.recipe || null,
        code: kiln.code ?? null,
        signal: kiln.signal ?? null,
        reason: 'server_restart',
        summaryTail: kiln.summaryTail,
      }, { sessionId, action: 'restart_reconciled' });
    }
    return { lifespan, cancelledApprovalReceipts, kilnReconciled: Boolean(kiln && ['running', 'stopping'].includes(kiln.status)) };
  }
  recordApprovalCrossing({ approval, phase, result, toolName = null, args = null }) {
    const sessionId = approval.sessionId;
    const roomNodeId = this.world.current(sessionId).room_node_id;
    toolName ||= phase === 'confirmed' || phase === 'applying' ? 'workshop_approval_confirm' : phase === 'rejected' ? 'workshop_approval_reject' : 'workshop_approval_cancel';
    args ||= { approval_id: approval.approvalId, phase };
    const link = worldEventLink(approval);
    const actionReceipt = this.world.actionReceipt({ sessionId, wakeId: approval.wakeId, roomNodeId, toolName, arguments: args, result, outcome: 'committed', ...link });
    const custody = this.captureResultSafely({ sessionId, wakeId: approval.wakeId, toolName, result, sourceActionReceiptId: actionReceipt.receiptId });
    const resultRack = custody.resultRack;
    const scrub = scrubHostReturn({ toolName, arguments: args, result, ...(resultRack ? { content: resultRack.projection.content, renderPolicy: 'result_rack_projection_v1', projection: resultRack.projection } : {}), roomId: roomNodeId, actionReceiptId: actionReceipt.receiptId });
    const approvalReceipt = this.world.recordApprovalReceipt({ approvalId: approval.approvalId, phase, actionReceiptId: actionReceipt.receiptId, result, hostReturnScrub: scrub, ...link });
    return {
      ...result, result, resultRack, resultCustodyFailure: custody.failure, resultCustodyFailureReceipt: custody.failureReceipt,
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
  registerKilnRun(runId, recipe, { discard = false, sessionId = null, wakeId = null } = {}) {
    if (discard) { this.kilnRuns.delete(runId); return null; }
    const state = { runId, recipe, sessionId, wakeId, phase: 'starting', terminalOwner: null, queuedResult: null };
    this.kilnRuns.set(runId, state); return state;
  }
  activateKilnRun(runId) {
    const state = this.kilnRuns.get(runId); if (!state) return;
    state.phase = 'running';
    if (state.queuedResult) { const result = state.queuedResult; state.queuedResult = null; this.handleRecipeComplete(result, { runId, sessionId: state.sessionId, wakeId: state.wakeId }); }
  }
  handleRecipeComplete(finalResult, { runId, sessionId = null, wakeId = null } = {}) {
    const state = this.kilnRuns.get(runId);
    if (!state || state.phase === 'compensating' || state.terminalOwner) return false;
    if (state.phase === 'starting') { state.queuedResult = finalResult; return false; }
    sessionId ??= state.sessionId; wakeId ??= state.wakeId; state.terminalOwner = 'runtime_callback';
    this.captureResultSafely({ sessionId, wakeId, toolName: 'workshop_recipe_completion', result: finalResult });
    const action = finalResult?.cancelled === 'cancelled_timeout' ? 'recipe_timeout' : finalResult?.cancelled ? 'recipe_runtime_cancelled' : finalResult?.ok ? 'recipe_completed' : 'recipe_failed';
    try { this.noteKiln(this.kilnStateFromRecipeResult(finalResult, state), { sessionId, wakeId, action }); }
    finally { state.phase = 'terminal'; this.kilnRuns.delete(runId); }
    return true;
  }
  async compensateRecipeStart(runId, originalError) {
    const state = this.kilnRuns.get(runId); if (state) { state.phase = 'compensating'; state.terminalOwner = 'start_compensation'; }
    let compensationError = null;
    try {
      let result = null;
      if (typeof this.recipes.cancelAndWait === 'function') result = await this.recipes.cancelAndWait('world_commit_failed');
      else if (typeof this.recipes.cancel === 'function') result = await this.recipes.cancel('world_commit_failed');
      if (this.recipes.active && typeof this.recipes.destroy === 'function') await this.recipes.destroy('world_commit_failed');
      else if (this.recipes.active && typeof this.recipes.close === 'function') await this.recipes.close('world_commit_failed');
      if (this.recipes.lastExecutionPromise) await this.recipes.lastExecutionPromise.catch(() => {});
      if (this.recipes.active) throw new Error('Recipe start compensation did not terminate the active job.');
      return result;
    } catch (error) { compensationError = error; }
    finally { this.kilnRuns.delete(runId); }
    if (compensationError) throw new AggregateError([originalError, compensationError], 'World commit failed after recipe start and compensation did not complete.');
  }
  async cancelKilnRunCommand({ sessionId, wakeId, commandId, commitOutcome }) {
    const runtime = this.world.getFixtureRuntime(KILN_FIXTURE_ID);
    if (!runtime || runtime.status !== 'running') return { result: { kind: 'workshop_recipe_cancel', cancelled: false, reason: 'not_running' }, source: null, changedRoom: false };
    const tracked = this.kilnRuns.get(runtime.runId) || { runId: runtime.runId, recipe: runtime.recipe, phase: 'running', terminalOwner: null, queuedResult: null };
    this.kilnRuns.set(runtime.runId, tracked); tracked.terminalOwner = 'resident_cancel';
    const result = await (typeof this.recipes.cancelAndWait === 'function' ? this.recipes.cancelAndWait('cancelled_by_tool') : this.recipes.cancel('cancelled_by_tool'));
    if (!result?.cancelled) { tracked.terminalOwner = null; return { result, source: null, changedRoom: false }; }
    const finalResult = result.result || this.recipes.lastResult || result;
    try {
      const committed = commitOutcome(() => {
        const event = this.noteKiln(this.kilnStateFromRecipeResult({ ...finalResult, cancelled: finalResult.cancelled || 'cancelled_by_tool', recipe: runtime.recipe }, tracked), { sessionId, wakeId, commandId, action: 'recipe_cancelled' });
        return { result: { ...result, worldEventSequence: event.worldEventSequence, worldEventHash: event.worldEventHash }, source: null, changedRoom: false };
      });
      this.kilnRuns.delete(runtime.runId); return committed;
    } catch (error) {
      tracked.terminalOwner = 'runtime_compensation';
      try { this.noteKiln(this.kilnStateFromRecipeResult({ ...finalResult, cancelled: finalResult.cancelled || 'cancelled_by_tool', recipe: runtime.recipe }, tracked), { sessionId, wakeId, action: 'recipe_runtime_cancelled' }); }
      finally { this.kilnRuns.delete(runtime.runId); }
      throw error;
    }
  }
  async close(reason = 'hub_close') {
    const runtime = (() => { try { return this.world.getFixtureRuntime(KILN_FIXTURE_ID); } catch { return null; } })();
    const activeRuntime = runtime && ['running', 'stopping'].includes(runtime.status) ? runtime : null;
    const tracked = activeRuntime ? this.kilnRuns.get(activeRuntime.runId) : null;
    if (tracked) tracked.terminalOwner = 'hub_close';
    if (activeRuntime?.status === 'running') this.noteKiln({ ...activeRuntime, status: 'stopping', reason }, { action: 'hub_close_requested' });
    const result = await (typeof this.recipes.destroy === 'function'
      ? this.recipes.destroy(reason)
      : typeof this.recipes.close === 'function'
        ? this.recipes.close(reason)
        : typeof this.recipes.cancelAndWait === 'function' ? this.recipes.cancelAndWait(reason) : this.recipes.cancel(reason));
    if (activeRuntime) {
      const finalResult = result?.result || this.recipes.lastResult || null;
      if (finalResult) {
        const action = finalResult.cancelled ? 'hub_closed' : finalResult.ok ? 'recipe_completed' : 'recipe_failed';
        this.noteKiln(this.kilnStateFromRecipeResult(finalResult, activeRuntime), { action });
        this.kilnRuns.delete(activeRuntime.runId);
      }
    }
    return result;
  }
  noteKiln(state, { sessionId = null, wakeId = null, commandId = null, action = null } = {}) {
    const summaryTail = typeof state.summaryTail === 'string' ? state.summaryTail.slice(0, 240) : undefined;
    return this.world.setFixtureRuntime(KILN_FIXTURE_ID, {
      status: state.status,
      runId: state.runId || null,
      recipe: state.recipe || null,
      code: state.code ?? null,
      signal: state.signal ?? null,
      reason: state.reason || null,
      ...(summaryTail ? { summaryTail } : {}),
    }, { sessionId, wakeId, commandId, actor: action === 'recipe_started' || action === 'recipe_cancelled' ? 'resident_tool' : 'world_runtime', action });
  }
  kilnStateFromRecipeResult(result, run = {}) {
    const exact = { runId: run.runId || result?.runId || null, recipe: result?.recipe || run.recipe || null, code: result?.code ?? null, signal: result?.signal ?? null };
    if (result?.cancelled) return { ...exact, status: 'cancelled', reason: result.cancelled, summaryTail: (result.stderr || result.stdout || '').slice(0, 240) };
    if (result?.ok) return { ...exact, status: 'settled', reason: null, summaryTail: (result.stdout || '').slice(0, 240) };
    return { ...exact, status: 'failed', reason: result?.error || null, summaryTail: (result?.stderr || result?.stdout || '').slice(0, 240) };
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

export { parseWorldToolIntent } from './gateway/dispatch.js';
