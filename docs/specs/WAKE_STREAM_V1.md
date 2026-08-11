# Wake Stream v1

**Status:** Implemented

**Adopted:** 2026-08-10

**Extends:** [`CORNER_SURFACE.md`](CORNER_SURFACE.md) and [`CORNER_STEP_SLIPS_V1.md`](CORNER_STEP_SLIPS_V1.md)

## 1. Purpose and authority

Wake Stream provides live, recoverable evidence of a wake without turning partial provider output into resident speech. `WakeService` remains the single orchestrator. The Source Ledger/session history remains canonical for committed utterances; World receipts and Result Rack remain authoritative for actions and exact host results; the Spine remains authoritative for exact provider crossings.

Every durable wake envelope is appended to `wake_stream_events` before broadcast. Rows have a monotonic sequence, stable event id, schema version, kind, optional session/wake/phase ids, authority, committed flag, JSON payload/source, prior-event hash, event hash, and creation time. Update and delete are refused. Lossy/non-JSON event material is refused before append. Credential-shaped provisional fragments are detected within a fragment and across a bounded 1 KiB same-request, phase, and channel window; the affected channel receives a safe suppression marker and no further provisional text. Tool-call argument fragments are never published. Final Spine/provider-return custody remains exact and independent of these display restrictions.

## 2. Provider custody

DeepSeek requests use OpenAI-compatible data-only SSE with usage requested. The strict parser incrementally validates UTF-8, event framing, one indexed choice, stable response identity/model/fingerprint, reasoning/content fragments, indexed tool-call fragments, terminal finish reason, usage, and `[DONE]`.

Incremental parsing may emit display deltas, but the exact admitted response bytes are accumulated and appended to the Spine once the response terminates. Capture is bounded by `HUB_PROVIDER_MAX_RETURN_BYTES` (8 MiB by default); an over-limit response retains only the exact prefix admitted before the offending chunk, records an oversized outcome, and fails before terminal use. Provider-return Scrub then independently reparses complete retained bytes and proves the selected terminal assistant message. Only that scrubbed message may enter session history, Forest admission, tool execution, or a later provider round. A malformed, truncated, conflicting, empty, interrupted, oversized, or incomplete stream fails closed.

Current raw custody is one admitted-body frame at termination, not one Spine append per received byte chunk. Completed and interrupted responses retain every admitted byte. An oversized response explicitly records incomplete capture and retains only the exact prefix admitted before the chunk that crossed the ceiling. A network failure before any response produces no invented raw-return frame.

## 3. Event vocabulary and order

Implemented wake kinds are:

- lifecycle: `wake.accepted`, `phase.started`, `message.committed`, `wake.completed`, `wake.failed`;
- provider: `provider.thinking.delta`, `provider.content.delta`, `provider.tool_call.delta`, `provider.message.ready`;
- actions: `tool_call.ready`, `tool.started`, `tool.completed`, `tool.refused`, `approval.pending`;
- projections: `card.upsert`.

`resync_required` is a synthesized, non-durable process-buffer control envelope. It deliberately has no event id, prior hash, or event hash and is not a `wake_stream_events` row.

The order is receipt order, not animation timing. A wake starts with `wake.accepted`. Each phase starts with `phase.started`; any provider deltas precede `provider.message.ready`; tool/card events follow their underlying provider, World, host-event, approval, and Result Rack custody; a committed resident message publishes `message.committed` before `wake.completed`. Failure terminates with `wake.failed`. Multiple tool/provider rounds may repeat the phase-internal sequence.

Provider delta kinds carry `authority=provider_provisional` and `committed=false`. Safe fragments can drive only temporary thinking, draft, and tool-call name/index displays; arguments are withheld and credential-shaped channels are suppressed. Lifecycle, action, approval, card, and terminal events are host-receipt projections and do not turn their content into resident testimony. `provider.message.ready` represents a validated scrubbed message, but the utterance rail still waits for the committed Source Ledger event.

Cards are deterministic projections. Tool/action cards cite action and host-return receipts; result/diff cards cite Result Rack jobs, projections, source hashes, and exact pointers; approval cards cite approval custody. Card revisions are monotonic per card. Corner never asks a model to summarize them.

## 4. Delivery and recovery

- `GET /api/events` provides same-origin `text/event-stream`, emits each envelope under its named kind with the durable sequence as SSE id, disables caching, and sets `nosniff`. Corner registers every installed kind; `message` and `hub_event` listeners remain compatibility inputs.
- A non-negative `?after=` cursor takes precedence over `Last-Event-ID`. Duplicate or old sequences are ignored by the client reducer.
- The process bus keeps a bounded replay buffer. If the requested cursor is older than the buffer or ahead of its latest sequence, it emits the non-durable `resync_required` control rather than pretending replay was complete.
- `GET /api/events/history?after=<sequence>&limit=<1..1000>` reads the durable journal and is the recovery authority across buffer gaps and process restarts.
- Subscriber failures are isolated. Unsubscribe, renderer close, or network disconnect affects only that client and never cancels the wake.
- Corner uses one same-origin EventSource when available. Its reducer advances only across contiguous durable sequences. On a disclosed or observed gap, Corner closes that source, pages history from the last contiguous sequence until it reaches `latestSequence`, rejects incomplete/non-progressing recovery, and reconnects with the recovered `after` cursor. It retains persisted health/slip polling and timed retry as fallback and refreshes canonical thread state after terminal events.

The bounded process bus is delivery convenience, not custody. Clients must reconcile from the durable journal and ordinary committed APIs whenever a gap is disclosed.

## 5. UI law

Corner may display optimistic exact user text while submission is pending, safe provisional provider thinking/draft, tool-call name/index progress, and receipt-derived action/approval/result cards. Provisional tool arguments are withheld. All text is rendered inertly. Provisional draft clears on terminal commit/failure and never appears as canonical conversation. The utterance rail is refreshed from committed thread records.

The current surface does not promise general file/artifact opening, editor navigation, or source highlighting. Exact Result Rack pointers are custody references, not an installed opener.

## 6. Known limitations

- There is no user cancellation endpoint or Corner cancel control.
- Renderer/EventSource disconnect does not backpressure, pause, or cancel provider work. Process shutdown does abort the active provider crossing, gives a compliant adapter up to 250 ms to seal partial raw/outcome custody, then gates late callbacks before store closure. Tool and World execution outside that provider window remains awaited.
- Spine raw-return custody is appended at stream termination rather than per network chunk and is bounded by the configured capture ceiling.
- Process-buffer overflow requires journal resynchronization.
- Polling remains a deliberate fallback rather than being removed.

## 7. Hostile and regression matrix

The implemented tests require: Unicode-equivalent assembly across byte boundaries; deterministic fragmented tool calls; refusal of malformed/truncated/conflicting streams; exact admitted-body Spine custody before independent Scrub admission; bounded oversized custody; interrupted and shutdown-aborted partial custody; append-before-broadcast and append-only hash chaining; within- and cross-fragment credential suppression without changing final custody; omission of provisional tool arguments; bounded replay, named-event dispatch, dedupe, non-durable resync control, paged contiguous journal recovery, listener isolation, and restart history; SSE cursor validation and same-origin headers; renderer disconnect without cancellation; receipt-before-card ordering; provisional authority flags; terminal message ordering; late-callback gating; safe DOM rendering; and polling fallback.
