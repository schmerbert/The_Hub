export class HearthWakeController {
  constructor({ intervalSeconds = 0, db, world, wakeService, autonomousWakes, ready = () => true, clock = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout }) {
    this.intervalMs = intervalSeconds * 1000;
    this.db = db; this.world = world; this.wakeService = wakeService; this.autonomousWakes = autonomousWakes;
    this.ready = ready; this.clock = clock; this.setTimer = setTimer; this.clearTimer = clearTimer;
    this.timer = null; this.next = null; this.closed = false; this.last = null;
  }
  status() { return { version: 'hearth_wakes/v1', enabled: this.intervalMs >= 60_000, intervalMs: this.intervalMs || null, next: this.next, last: this.last }; }
  arm() {
    if (this.closed || this.intervalMs < 60_000) return;
    if (this.timer) this.clearTimer(this.timer);
    const scheduledMs = this.clock(); const dueMs = scheduledMs + this.intervalMs;
    this.next = { scheduledAt: new Date(scheduledMs).toISOString(), dueAt: new Date(dueMs).toISOString() };
    this.timer = this.setTimer(() => { this.timer = null; void this.dispatch(); }, this.intervalMs);
  }
  async runNow() {
    if (this.closed) throw Object.assign(new Error('The Hearth wake clock is closed.'), { code: 'hearth_wake_unavailable' });
    if (this.wakeService.wakeInProgress) throw Object.assign(new Error('Another wake is already in progress.'), { code: 'wake_in_progress' });
    if (!this.ready()) throw Object.assign(new Error('The Hub is not ready for a Hearth-origin wake.'), { code: 'hearth_wake_unavailable' });
    if (this.autonomousWakes.status(this.db.session.id).pending) throw Object.assign(new Error('A bench promise is pending and takes precedence over an ordinary wake.'), { code: 'hearth_wake_bench_pending' });
    const at = new Date(this.clock()).toISOString();
    return this.dispatch({ timingOverride: { scheduledAt: at, dueAt: at, wokeAt: at, intervalMs: 0, latenessMs: 0 }, rearm: false });
  }
  async dispatch({ timingOverride = null, rearm = true } = {}) {
    if (this.closed || (!this.next && !timingOverride)) return;
    if (!timingOverride && (this.wakeService.wakeInProgress || !this.ready() || this.autonomousWakes.status(this.db.session.id).pending)) {
      this.timer = this.setTimer(() => { this.timer = null; void this.dispatch(); }, 1000);
      return;
    }
    const wokeMs = this.clock();
    const timing = timingOverride || { ...this.next, wokeAt: new Date(wokeMs).toISOString(), intervalMs: this.intervalMs, latenessMs: Math.max(0, wokeMs - Date.parse(this.next.dueAt)) };
    if (!timingOverride) this.next = null;
    let record = null;
    try {
      const session = this.db.beginHearthLifespan();
      this.world.ensureLifespan(session.id);
      record = await this.wakeService.wake('', { origin: { kind: 'hearth_origin', timing }, completionProjection: 'compact' });
      this.last = { wakeId: record.id, sessionId: session.id, status: record.status === 'committed' && !record.custodyFailureCode ? 'completed' : 'failed', timing };
    } catch (error) {
      this.last = { wakeId: record?.id || null, sessionId: this.db.session?.id || null, status: 'failed', code: error?.code || 'hearth_wake_failed', timing };
    }
    if (rearm) this.arm();
    return this.last;
  }
  close() { this.closed = true; if (this.timer) this.clearTimer(this.timer); this.timer = null; this.next = null; }
}
