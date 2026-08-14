const DEFAULT_MAX_BYTES = 16 * 1024;
const DEFAULT_MAX_FRAGMENTS = 128;
// Human-visible provisional display does not need token-rate persistence. A
// 200 ms cadence keeps the Corner lively while preventing synchronous SQLite
// custody writes from starving Electron's main event loop on verbose streams.
const DEFAULT_FLUSH_MS = 200;

function fail(message) { throw Object.assign(new Error(message), { code: 'provisional_collector_invalid' }); }
function bytes(value) { return Buffer.byteLength(JSON.stringify(value), 'utf8'); }

function channelOf(event) {
  const index = event.kind === 'provider.tool_call.delta' ? (event.payload?.index ?? 'unknown') : 'text';
  return `${event.source?.providerRequestId || 'unknown'}:${event.phase || 'unknown'}:${event.kind}:${index}`;
}

function mergePayload(kind, left, right) {
  if (kind === 'provider.tool_call.delta') return {
    choiceIndex: right.choiceIndex ?? left.choiceIndex ?? 0,
    index: right.index ?? left.index ?? 0,
    type: right.type || left.type || null,
    function: { name: `${left.function?.name || ''}${right.function?.name || ''}` },
    argumentsOmitted: Boolean(left.argumentsOmitted || right.argumentsOmitted),
  };
  return { choiceIndex: right.choiceIndex ?? left.choiceIndex ?? 0, delta: `${left.delta || ''}${right.delta || ''}` };
}

/**
 * A bounded, memory-only pause before provisional Scrub and durable publication.
 * Raw fragments are never exposed by this object. Only coalesced channel batches
 * cross `emit`, where the wake-stream custody validator performs the Scrub.
 */
export class ProvisionalCollector {
  constructor({ emit, maxBytes = DEFAULT_MAX_BYTES, maxFragments = DEFAULT_MAX_FRAGMENTS, flushMs = DEFAULT_FLUSH_MS } = {}) {
    if (typeof emit !== 'function') fail('Provisional collector requires an emit function.');
    if (!Number.isInteger(maxBytes) || maxBytes < 256) fail('Provisional collector maxBytes is invalid.');
    if (!Number.isInteger(maxFragments) || maxFragments < 1) fail('Provisional collector maxFragments is invalid.');
    if (!Number.isInteger(flushMs) || flushMs < 0) fail('Provisional collector flushMs is invalid.');
    this.emit = emit;
    this.maxBytes = maxBytes;
    this.maxFragments = maxFragments;
    this.flushMs = flushMs;
    this.pending = null;
    this.pendingBytes = 0;
    this.fragmentCount = 0;
    this.timer = null;
    this.failure = null;
  }

  get sizeBytes() { return this.pendingBytes; }
  get sizeFragments() { return this.fragmentCount; }

  schedule() {
    if (this.timer !== null || this.flushMs === 0) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      try { this.flush(); } catch (error) { this.failure = error; }
    }, this.flushMs);
  }

  collect(event) {
    if (this.failure) throw this.failure;
    const eventBytes = bytes(event);
    if (eventBytes > this.maxBytes) fail('One provisional fragment exceeds the collector bound.');
    const channel = channelOf(event);
    if (this.pending && this.pending.channel !== channel) this.flush();
    if (this.pending && (this.pendingBytes + eventBytes > this.maxBytes || this.fragmentCount >= this.maxFragments)) this.flush();
    if (!this.pending) this.pending = { channel, event: structuredClone(event) };
    else this.pending.event.payload = mergePayload(event.kind, this.pending.event.payload, event.payload);
    this.pendingBytes += eventBytes;
    this.fragmentCount += 1;
    if (this.pendingBytes >= this.maxBytes || this.fragmentCount >= this.maxFragments || this.flushMs === 0) this.flush();
    else this.schedule();
  }

  flush() {
    if (this.failure) throw this.failure;
    if (this.timer !== null) { clearTimeout(this.timer); this.timer = null; }
    if (!this.pending) return null;
    const event = this.pending.event;
    this.pending = null;
    this.pendingBytes = 0;
    this.fragmentCount = 0;
    return this.emit(event);
  }

  discard() {
    if (this.timer !== null) { clearTimeout(this.timer); this.timer = null; }
    this.pending = null;
    this.pendingBytes = 0;
    this.fragmentCount = 0;
    this.failure = null;
  }
}
