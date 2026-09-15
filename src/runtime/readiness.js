const STAGES = Object.freeze(['shell', 'conversation', 'forest']);
const STATES = new Set(['pending', 'ready', 'failed', 'inactive']);

function wallClock() { return new Date().toISOString(); }
function monotonic() { return performance.now(); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }

function stableCode(stage, state, code) {
  if (typeof code === 'string' && code.length > 0 && code.length <= 96) return code;
  if (state === 'pending') return `${stage}_pending`;
  if (state === 'ready') return `${stage}_ready`;
  if (state === 'failed') return `${stage}_failed`;
  return `${stage}_inactive`;
}

function stageRecord(stage, state, code, startedAt, startedMono, settledAt = null, settledMono = null) {
  return {
    state,
    code: stableCode(stage, state, code),
    startedAt,
    settledAt,
    elapsedMs: settledMono === null ? null : Math.max(0, Math.round(settledMono - startedMono)),
  };
}

/**
 * Process-local startup observations. This module owns no domain authority;
 * it only records bounded state and monotonic durations at runtime crossings.
 */
export class ReadinessProjection {
  constructor({ clock = monotonic, timestamp = wallClock } = {}) {
    if (typeof clock !== 'function' || typeof timestamp !== 'function') throw new TypeError('Readiness clocks must be functions.');
    this.clock = clock;
    this.timestamp = timestamp;
    this.stages = new Map();
    this.timings = new Map();
  }

  begin(stage, { code = null } = {}) {
    if (!STAGES.includes(stage)) throw new TypeError(`Unknown readiness stage: ${stage}`);
    const now = this.clock();
    const startedAt = this.timestamp();
    this.stages.set(stage, { state: 'pending', code: stableCode(stage, 'pending', code), startedAt, startedMono: now, settledAt: null, settledMono: null });
    return this.stage(stage);
  }

  settle(stage, state, { code = null } = {}) {
    if (!STATES.has(state) || state === 'pending') throw new TypeError('Readiness stage settlement must be ready, failed, or inactive.');
    const prior = this.stages.get(stage) || (() => { this.begin(stage); return this.stages.get(stage); })();
    if (prior.state !== 'pending') return this.stage(stage);
    const settledMono = this.clock();
    const settledAt = this.timestamp();
    this.stages.set(stage, { ...prior, state, code: stableCode(stage, state, code), settledAt, settledMono });
    return this.stage(stage);
  }

  revoke(stage, { code = null } = {}) {
    if (!STAGES.includes(stage)) throw new TypeError(`Unknown readiness stage: ${stage}`);
    const prior = this.stages.get(stage);
    if (!prior || prior.state !== 'ready') return this.stage(stage);
    const settledMono = this.clock();
    const settledAt = this.timestamp();
    this.stages.set(stage, { ...prior, state: 'failed', code: stableCode(stage, 'failed', code), settledAt, settledMono });
    return this.stage(stage);
  }

  beginTiming(name) {
    if (typeof name !== 'string' || !name || name.length > 64) throw new TypeError('Readiness timing name is invalid.');
    if (!this.timings.has(name)) this.timings.set(name, { startedMono: this.clock(), elapsedMs: null });
    return this.timing(name);
  }

  timing(name) {
    const prior = this.timings.get(name);
    if (!prior) return null;
    return prior.elapsedMs === null ? Math.max(0, Math.round(this.clock() - prior.startedMono)) : prior.elapsedMs;
  }

  settleTiming(name) {
    const prior = this.timings.get(name);
    if (!prior) return this.beginTiming(name) && this.settleTiming(name);
    if (prior.elapsedMs === null) prior.elapsedMs = Math.max(0, Math.round(this.clock() - prior.startedMono));
    return prior.elapsedMs;
  }

  stage(stage) {
    const value = this.stages.get(stage);
    if (!value) return null;
    return stageRecord(stage, value.state, value.code, value.startedAt, value.startedMono, value.settledAt, value.settledMono);
  }

  is(stage, state = 'ready') { return this.stages.get(stage)?.state === state; }

  projection() {
    const stages = Object.fromEntries(STAGES.map(stage => [stage, this.stage(stage) || stageRecord(stage, 'inactive', null, null, 0)]));
    const timings = Object.fromEntries([...this.timings].map(([name, value]) => [name, value.elapsedMs === null ? Math.max(0, Math.round(this.clock() - value.startedMono)) : value.elapsedMs]));
    return clone({ ...stages, timings });
  }
}

export const READINESS_STAGES = STAGES;
