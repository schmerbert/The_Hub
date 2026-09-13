import { scrubHostReturn } from '../scrub/host-return.js';

export const REST_FOR_TOOL_NAME = 'rest_for';
export const REST_FOR_TOOL = Object.freeze({ type: 'function', function: {
  name: REST_FOR_TOOL_NAME,
  description: 'Sit at the current verified footing and schedule a self-directed wake here after a bounded delay. This preserves continuity but grants only autonomous exploration authority on return.',
  parameters: { type: 'object', properties: { seconds: { type: 'integer', minimum: 60, maximum: 86400 }, intention: { type: 'string', maxLength: 1000 } }, required: ['seconds'], additionalProperties: false },
} });

export const AUTONOMOUS_WORLD_TOOLS = Object.freeze(new Set([
  'move_through_door', 'move_through_passage', 'operate_passage', 'inspect_fixture', 'engage_fixture', 'disengage_fixture',
  'workshop_list', 'workshop_read', 'workshop_document_outline', 'workshop_document_read', 'workshop_search', 'workshop_search_regex',
  'workshop_glob', 'workshop_tree', 'workshop_stat', 'workshop_file_hash', 'workshop_git_status', 'workshop_git_diff', 'workshop_git_log',
  'workshop_git_show', 'workshop_git_branch_list', 'workshop_tool_catalog',
  'spotlight_capability_status', 'spotlight_observation_list', 'spotlight_observation_read',
]));

export function autonomousToolAllowed(name, { forestToolNames = [] } = {}) {
  return name === REST_FOR_TOOL_NAME || name === 'reopen_result' || AUTONOMOUS_WORLD_TOOLS.has(name) || forestToolNames.includes(name);
}

export function renderAutonomousWakeGround(origin) {
  if (!origin || origin.kind !== 'self_directed') return null;
  const intention = origin.plan.intention?.trim() || 'No fixed errand was retained. Wander, notice, or rest as seems fitting.';
  return `Autonomous wake ground: this is a self-directed return in the same Resident lifespan, not a human message and not a second Resident. You wake at the verified seat where you chose to rest. Your loose intention was: ${JSON.stringify(intention)} You may explore freely for up to 24 tool rounds within the tools actually mounted for this wake, change direction, find nothing, or rest again. Consequential hands are capped; absent tools are unavailable, not forgotten. Your path and final speech receive ordinary custody.`;
}

function sameSeat(left, right) {
  return left?.world?.roomId === right?.world?.roomId && (left?.world?.engagedFixtureId || null) === (right?.world?.engagedFixtureId || null) &&
    Boolean(left?.forest?.active) === Boolean(right?.forest?.active) && (!left?.forest?.active ||
      left.forest.journeyId === right.forest.journeyId && left.forest.junctionId === right.forest.junctionId && left.forest.currentEntryId === right.forest.currentEntryId && left.forest.stepsFromEntrance === right.forest.stepsFromEntrance);
}

export class AutonomousWakeController {
  constructor({ db, world, forestTraversal = null, wakeService, ready = () => true, clock = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout }) {
    this.db = db; this.world = world; this.forestTraversal = forestTraversal; this.wakeService = wakeService;
    this.ready = ready; this.clock = clock; this.setTimer = setTimer; this.clearTimer = clearTimer; this.timer = null; this.closed = false;
  }
  seat(sessionId) {
    const world = this.world.projection(sessionId); const traversal = typeof this.forestTraversal === 'function' ? this.forestTraversal() : this.forestTraversal; const forest = traversal?.projection(sessionId) || { active: false };
    return { world: { roomId: world.roomId, engagedFixtureId: world.engagedFixtureId || null, revision: world.revision }, forest: forest.active ? { active: true, journeyId: forest.journeyId, junctionId: forest.junctionId, currentEntryId: forest.currentEntryId || null, stepsFromEntrance: forest.stepsFromEntrance } : { active: false } };
  }
  schedule({ sessionId, wakeId = null, seconds, intention = null }) {
    if (!this.db.sessionHasOrientation(sessionId)) throw Object.assign(new Error('Self-directed rest requires a tended Hearth in this lifespan.'), { code: 'autonomous_wake_hearth_required' });
    if (!Number.isInteger(seconds) || seconds < 60 || seconds > 86400) throw Object.assign(new Error('Rest duration must be an integer from 60 to 86400 seconds.'), { code: 'autonomous_wake_invalid' });
    if (intention !== null && (typeof intention !== 'string' || intention.length > 1000)) throw Object.assign(new Error('Rest intention must be at most 1000 characters.'), { code: 'autonomous_wake_invalid' });
    const dueAt = new Date(this.clock() + seconds * 1000).toISOString();
    const plan = this.db.autonomous.schedule({ sessionId, createdWakeId: wakeId, dueAt, intention: intention?.trim() || null, seat: this.seat(sessionId) });
    this.arm(); return plan;
  }
  executeRestTool({ sessionId, wakeId, call }) {
    let args; try { args = JSON.parse(call?.function?.arguments || '{}'); } catch { throw Object.assign(new Error('Rest arguments must be valid JSON.'), { code: 'autonomous_wake_invalid' }); }
    if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).some(key => !['seconds','intention'].includes(key))) throw Object.assign(new Error('Rest arguments are invalid.'), { code: 'autonomous_wake_invalid' });
    const plan = this.schedule({ sessionId, wakeId, seconds: args.seconds, intention: args.intention ?? null });
    const result = { ok: true, kind: 'autonomous_wake_scheduled', status: 'scheduled', planId: plan.planId, origin: plan.origin, dueAt: plan.dueAt, intention: plan.intention, seat: plan.seat, authorityOnReturn: 'autonomous_exploration_v1' };
    const scrub = scrubHostReturn({ toolName: REST_FOR_TOOL_NAME, toolCallId: call?.id || null, arguments: args, result, roomId: plan.seat.world.roomId, actionReceiptId: plan.eventId });
    return { name: REST_FOR_TOOL_NAME, result, scrub, actionReceipt: { receiptId: plan.eventId }, resultRack: null, wild: [] };
  }
  status(sessionId) { return { version: 'autonomous_wakes/v1', pending: this.db.autonomous.pending(sessionId), recent: this.db.autonomous.recent(sessionId), wakeInProgress: this.wakeService.wakeInProgress }; }
  manual({ sessionId, intention = null }) {
    if (!this.db.sessionHasOrientation(sessionId)) throw Object.assign(new Error('Self-directed waking requires a tended Hearth in this lifespan.'), { code: 'autonomous_wake_hearth_required' });
    const plan = this.db.autonomous.schedule({ sessionId, dueAt: new Date(this.clock()).toISOString(), intention: intention?.trim() || null, seat: this.seat(sessionId) });
    this.arm(); return plan;
  }
  arm() {
    if (this.closed) return;
    if (this.timer) { this.clearTimer(this.timer); this.timer = null; }
    const plan = this.db.autonomous.pending(); if (!plan) return;
    const delay = Math.max(0, Math.min(Date.parse(plan.dueAt) - this.clock(), 2_147_000_000));
    this.timer = this.setTimer(() => { this.timer = null; void this.dispatch(plan.planId); }, delay);
  }
  async dispatch(planId) {
    if (this.closed) return;
    const plan = this.db.autonomous.pending();
    if (!plan || plan.planId !== planId) { this.arm(); return; }
    if (this.wakeService.wakeInProgress || !this.ready()) { this.timer = this.setTimer(() => { this.timer = null; void this.dispatch(planId); }, 1000); return; }
    const currentSeat = this.seat(plan.sessionId);
    if (!sameSeat(plan.seat, currentSeat)) {
      const claimed = this.db.autonomous.claim(planId);
      if (claimed) this.db.autonomous.settle(planId, null, 'failed', { code: 'autonomous_wake_seat_stale', currentSeat });
      this.arm(); return;
    }
    const claimed = this.db.autonomous.claim(planId); if (!claimed) { this.arm(); return; }
    let record;
    try {
      record = await this.wakeService.wake('', { origin: { kind: 'self_directed', plan }, completionProjection: 'compact' });
      const outcome = record.status === 'committed' && !record.custodyFailureCode ? 'completed' : 'failed';
      this.db.autonomous.settle(planId, record.id, outcome, outcome === 'completed' ? {} : { code: record.failureCode || record.custodyFailureCode || 'autonomous_wake_failed' });
    } catch (error) {
      this.db.autonomous.settle(planId, record?.id || null, 'failed', { code: error?.code || 'autonomous_wake_failed', message: error?.message || 'Autonomous wake failed before admission.' });
    }
    this.arm();
  }
  close() { this.closed = true; if (this.timer) this.clearTimer(this.timer); this.timer = null; }
}
