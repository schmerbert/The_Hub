function fail(code, message) { throw Object.assign(new Error(message), { code }); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }

function resyncEvent({ requestedAfterSequence, earliestAvailableSequence, latestSequence }) {
  return {
    sequence: latestSequence,
    eventId: null,
    schemaVersion: 1,
    kind: 'resync_required',
    sessionId: null,
    wakeId: null,
    phase: null,
    authority: 'host_receipt',
    committed: false,
    payload: { requestedAfterSequence, earliestAvailableSequence, latestSequence },
    source: { kind: 'wake_stream_buffer' },
    previousEventHash: null,
    eventHash: null,
    createdAt: new Date().toISOString(),
  };
}

export class HubEventBus {
  constructor(journalOrOptions, options = {}) {
    const suppliedJournal = journalOrOptions?.appendWakeStreamEvent ? journalOrOptions : journalOrOptions?.journal;
    const bufferSize = journalOrOptions?.appendWakeStreamEvent ? options.bufferSize : journalOrOptions?.bufferSize;
    if (!suppliedJournal
      || typeof suppliedJournal.appendWakeStreamEvent !== 'function'
      || typeof suppliedJournal.listRecentWakeStreamEvents !== 'function'
      || typeof suppliedJournal.getLatestWakeStreamSequence !== 'function') {
      fail('wake_stream_invalid_journal', 'HubEventBus requires a wake stream journal.');
    }
    const resolvedSize = bufferSize === undefined ? 256 : bufferSize;
    if (!Number.isInteger(resolvedSize) || resolvedSize < 1 || resolvedSize > 10000) fail('wake_stream_invalid_argument', 'HubEventBus bufferSize must be an integer from 1 to 10000.');
    this.journal = suppliedJournal;
    this.bufferSize = resolvedSize;
    this.subscribers = new Set();
    this.closed = false;
    this.buffer = suppliedJournal.listRecentWakeStreamEvents({ limit: resolvedSize }).map(clone);
  }

  get latestSequence() { return this.buffer.at(-1)?.sequence || this.journal.getLatestWakeStreamSequence(); }
  get subscriberCount() { return this.subscribers.size; }

  remember(event) {
    if (this.buffer.some(candidate => candidate.sequence === event.sequence || candidate.eventId === event.eventId)) return;
    this.buffer.push(clone(event));
    this.buffer.sort((left, right) => left.sequence - right.sequence);
    if (this.buffer.length > this.bufferSize) this.buffer.splice(0, this.buffer.length - this.bufferSize);
  }

  deliver(subscriber, event) {
    if (event.kind !== 'resync_required' && event.sequence <= subscriber.lastSequence) return;
    if (event.kind !== 'resync_required') subscriber.lastSequence = event.sequence;
    try { subscriber.listener(clone(event)); } catch {}
  }

  publish(input) {
    if (this.closed) fail('wake_stream_closed', 'HubEventBus is closed.');
    const persisted = this.journal.appendWakeStreamEvent(input);
    this.remember(persisted);
    for (const subscriber of [...this.subscribers]) this.deliver(subscriber, persisted);
    return clone(persisted);
  }

  append(input) { return this.publish(input); }

  subscribe(listener, { afterSequence } = {}) {
    if (this.closed) fail('wake_stream_closed', 'HubEventBus is closed.');
    if (typeof listener !== 'function') fail('wake_stream_invalid_argument', 'HubEventBus listener must be a function.');
    if (afterSequence !== undefined && (!Number.isInteger(afterSequence) || afterSequence < 0)) fail('wake_stream_invalid_argument', 'HubEventBus afterSequence must be a non-negative integer.');
    const replayUntil = this.latestSequence;
    const subscriber = { listener, lastSequence: afterSequence === undefined ? replayUntil : afterSequence };
    if (afterSequence !== undefined) {
      const earliest = this.buffer[0]?.sequence || replayUntil + 1;
      if (afterSequence > replayUntil || afterSequence < earliest - 1) {
        this.deliver(subscriber, resyncEvent({ requestedAfterSequence: afterSequence, earliestAvailableSequence: earliest, latestSequence: replayUntil }));
        subscriber.lastSequence = replayUntil;
      } else {
        for (const event of this.buffer) {
          if (event.sequence > afterSequence && event.sequence <= replayUntil) this.deliver(subscriber, event);
        }
      }
    }
    this.subscribers.add(subscriber);
    for (const event of this.buffer) if (event.sequence > replayUntil) this.deliver(subscriber, event);
    let subscribed = true;
    return () => {
      if (!subscribed) return false;
      subscribed = false;
      return this.subscribers.delete(subscriber);
    };
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.subscribers.clear();
    this.buffer.length = 0;
  }
}
