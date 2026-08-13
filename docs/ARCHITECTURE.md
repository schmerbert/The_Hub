# The Hub architecture

This document describes the implemented runtime and code ownership. New readers should begin with [`ORIENTATION.md`](ORIENTATION.md); [`GLOSSARY.md`](GLOSSARY.md) maps lived terms to clinical responsibilities. See [`STATUS.md`](STATUS.md) for specification precedence and the boundary between implemented cores and broader adopted designs. [`MARBLE_CIRCULATION_MAP.md`](MARBLE_CIRCULATION_MAP.md) is the compact crossing-and-authority index that must be updated whenever a new pipe is installed.

Source also owns the forward-only Session Scroll trace epoch. The append-only boundary records the exact inherited head without backfilling it. After that boundary, each Scroll row and its trace manifest are committed atomically; the manifest connects authoritative source, Scrub or intake gate, durable witness, exact Scroll coordinate, and retained disposition. See [`TRACE_EPOCH_V1.md`](specs/TRACE_EPOCH_V1.md).

Provider streaming has a bounded pre-Scrub pause. Raw fragments remain only in a memory collector, separated by provider request, phase, delta kind, and tool index. The collector coalesces consecutive same-channel fragments, flushes on channel changes and normal phase completion, and discards paused material on failure or cancellation. Only coalesced batches that pass wake-stream credential Scrub enter the hash-linked wake journal and SSE; Corner renders accumulated safe events at most once per animation frame.

New Glass casts are governed by a separate forward-only trace epoch. Five request-ground receipts bind crossing identity, verified World state, the exact Ceiling/Patch Bay schema mount, attention/omission state, and continuity state. A per-item manifest connects these receipts—or an exact Scroll row, Source event, or stable Glass hash—to the provider-presentation Scrub disposition and exact Spine request. The bundle commits atomically and verifies before the next wake.

```text
Source Ledger -> session/Hearth assembly -> provider-presentation Scrub
              -> Spine exact request -> provider SSE -> Spine exact admitted-body return
              -> provisional wake-stream events -> provider-return Scrub
              -> World Gateway -> Result Rack -> host-return fitted projection
              -> session continuation / resident response -> Forest admission

WakeService -> durable wake_stream_events -> bounded process bus -> SSE / Corner
```

Provider-bound Scrub is a projection, not a memory operation. It may remove only declared exact spans or declared complete messages, preserving the roles, order, and content that remain. Whole-message fitting currently removes only older completed assistant-tool/result exchanges; it retains the current and configured recent exchanges, records exact omitted source positions and hashes, and adds a deterministic disclosure while the Source Ledger retains the original history. Spine records the exact validated JSON sent to the provider.

Forest admission uses a separate `utterance_identity/v1` policy. It proves that an admitted utterance is unchanged; it is not provider-history fitting.

## Owned modules

| Bay | Entry point | Current responsibility |
| --- | --- | --- |
| Ledger | `src/ledger/source.js` | Operational/source events and provider-phase attention records |
| Session | `src/session/lifespan.js` | Process-lived session identity, complete active history, and Session Zero ancestry |
| Hearth | `src/hearth/handshake.js`, `src/hearth/scroll.js` | Native first-call action validation, exact recency extracts, and resident Scroll |
| Provider Scrub | `src/scrub/provider-presentation.js`, `src/scrub/provider-return.js` | Subtractive provider projection and exact provider-return selection |
| Tool-history fitting | `src/context/tool-pairs.js` | Declared old completed tool-exchange omission and source-reference projection |
| Spine | `src/spine/store.js` | Exact provider request and bounded raw-return custody, including one admitted-body SSE frame appended at termination |
| Forest | `src/forest/` | Home/Wild admission, custody, backfill, and verification; no exhale selector yet |
| Forest health projection | `src/forest/health.js` | Domain-owned active/inactive, integrity, catch-up, Wild, and Intake health projection for transport surfaces |
| World state | `src/world/graph.js` | Room graph, location/fixture state, briefs, timers, action receipts, approvals, and append-only approval completion custody |
| World builder inspection | `src/world/inspection.js` | Bounded verified or drift-safe diagnostic projection; owns direct diagnostic access to World storage |
| Ceiling / Patch Bay | `src/world/ceiling.js`, `src/world/tools.js` | Complete World authority plus deterministic engaged-fixture schema fitting for provider attention |
| Workshop path law | `src/workshop/path-law.js` | Shared protected-path, traversal, containment, and symlink law used by Workshop and promotion |
| Workshop | `src/world/workshop.js`, `src/world/git.js`, `src/world/recipes.js` | Bounded repository operations, local Git, and fake/test host recipes |
| World Gateway | `src/world/gateway.js`, `src/world/gateway/` | Compatibility facade over the complete handler registry, approval crossings, Result Rack integration, and async result capture |
| Sandbox Bay | `src/world/sandbox.js`, `src/world/sandbox-recipes.js` | Disposable Git worktree jobs, Docker recipe execution in live mode, lifecycle/diff control, and no-fallback adapter |
| Promotion | `src/world/promotion.js` | Clean-base, plan/patch-hash-bound host application with protected-path checks |
| Result Rack | `src/result-rack/schema.js`, `src/result-rack/store.js`, `src/result-rack/projection.js` | Append-only exact result/output/artifact/projection custody, deterministic fitting, and exact pointers |
| Result/attention compatibility | `src/world/results.js`, `src/context/attention-meter.js` | Stable re-export facade plus provider-presentation byte attention measurement |
| Host-return Scrub | `src/scrub/host-return.js` | Validated identity or named `result_rack_projection_v1` host result projection |
| Corner slips | `src/corner/slips.js` | Deterministic active/completed progress from persisted phases, receipts, and approvals |
| Wake orchestration | `src/runtime/wake-service.js` | Wake lifecycle, provider phases, terminal history admission, tool rounds, and receipt-derived live events |
| Wake stream | `src/ledger/wake-stream.js`, `src/ledger/source.js`, `src/runtime/hub-event-bus.js` | Append-only hash-linked event journal, provisional credential boundary, and bounded in-process replay/broadcast |
| Provider streaming | `src/providers/sse.js`, `src/providers/deepseek.js`, `src/scrub/provider-return.js` | Strict OpenAI-compatible SSE parsing, safe provisional deltas, bounded admitted-body Spine custody, and independent exact terminal assembly |
| Corner desktop | `src/corner/electron-main.js`, `src/corner/desktop-host.js`, `src/corner/desktop-controller.js`, `src/corner/preload.cjs`, `src/corner/window-geometry.js` | Single-instance Electron lifecycle, loopback host ownership, secure narrow bridge, tray/window behavior, and display geometry |
| Context compatibility | `src/context/assemble.js` | Compatibility assembly for pre-session callers |

The older `src/core/*` paths are compatibility re-exports except `src/core/config.js`, which owns active configuration. `src/providers/dispatch.js` validates a presentation before deriving the legacy `messages` argument used by injected test providers.

`src/world/results.js` remains the Result Rack compatibility facade: consumers import the split store/projection surface and attention meter through it while the implementation lives in `src/result-rack/` and `src/context/attention-meter.js`. Likewise, `src/world/gateway.js` owns crossing state but delegates tool execution through a registry that is checked against the installed Ceiling names at module load.

## Wake streaming and Corner authority

`WakeService` is the single wake orchestrator. Each durable wake event is first appended to `wake_stream_events`, receiving a monotonic sequence, prior-event hash, and event hash, and only then broadcast on the process bus. The normal order is `wake.accepted`, one or more phase groups, then terminal `message.committed` and `wake.completed`; a failed path ends with `wake.failed`. A phase begins with `phase.started`, may emit provisional provider deltas, seals a scrubbed `provider.message.ready`, and may then emit `tool_call.ready`, `tool.started`, `tool.completed` or `tool.refused`, `approval.pending`, and receipt-derived `card.upsert` events as applicable. Tool and card events are not published before their host/Result Rack custody exists.

Provider thinking, content, and tool-call deltas carry `authority=provider_provisional` and `committed=false`. They are display evidence only. Provisional tool argument bytes are not published. Credential detection is stateful across up to 1 KiB of same-request, phase, and channel fragments; a match persists a safe suppression marker and suppresses later deltas on that channel without altering exact final provider custody. Host lifecycle, tool, approval, card, and terminal events carry host-receipt authority. Only the independently scrubbed terminal provider message may be committed to history, admitted to Forest, or used to drive tools and later provider rounds. Corner derives its live thinking, draft, and cards from safe event envelopes and host receipts/Result Rack projections; it does not promote provisional text into the utterance rail.

`GET /api/events` is a same-origin SSE projection whose named event type is the envelope kind. A query `after` cursor takes precedence over `Last-Event-ID`. The bounded process buffer supports immediate replay; a cursor outside it produces a synthesized `resync_required` transport envelope with no event id or custody hashes. That control envelope is not appended to the journal. Corner keeps its last contiguous sequence, closes the stale EventSource, pages `GET /api/events/history` until it reaches the journal head, refuses incomplete recovery, and reconnects with `?after=<recovered sequence>`. The durable journal is the recovery authority. Closing a client connection only unsubscribes that client: it does not cancel or backpressure the provider request. Corner retains persisted-slip polling as a fallback when EventSource is absent, disconnected, or recovery fails.

DeepSeek requests enable SSE and include usage. Bytes are parsed incrementally to produce provisional deltas, but the Spine appends one exact raw-return frame containing the admitted body when the response terminates; it does not append one Spine record per network chunk. `HUB_PROVIDER_MAX_RETURN_BYTES` (8 MiB by default) is a hard response-capture ceiling: an oversized return is cancelled, its bounded admitted prefix is retained exactly, and the crossing fails before terminal Scrub or canonical use. Provider-return Scrub reparses complete exact bytes independently and validates a terminal stream before any message enters continuation history.

Renderer disconnect and process shutdown are separate boundaries. Disconnect only removes a subscriber. Shutdown stops intake, aborts the provider-only controller, and gives a compliant adapter up to 250 ms to finish partial raw-return and aborted-outcome custody. If an adapter ignores the signal, `WakeService` force-terminates its wait after that grace period, closes the callback gate, records the cancelled provider request/wake, and only then permits store closure; late provider callbacks cannot write into closed custody. Tool and World execution lies outside the provider-controller window and remains awaited and custodied.

## Desktop Corner boundary

Electron 43.2.0 runs one application instance and one owned Hub lifecycle. It binds the HTTP server to `127.0.0.1` before loading the renderer, uses the same Corner page/API as browsers, and awaits `hub.close()` on explicit quit. The opaque frameless window is 96x96 compact or 980x680 expanded, placed 24 pixels inside the active display. Ordinary close collapses and hides; tray actions expand, collapse, or quit. Normal-level always-on-top defaults on and is configurable with `HUB_CORNER_ALWAYS_ON_TOP`.

The renderer has `contextIsolation`, sandboxing, and web security enabled with Node integration disabled. Permissions, new windows, and navigation outside the owned loopback page are denied. The preload bridge allowlists only mode get/set/subscription and IPC validates the exact window sender and page origin. The desktop shell grants no provider, database, World, filesystem, or general artifact-opening authority.

## Workshop isolation and promotion

Live mode constructs `SandboxRecipeRunner` over `SandboxBay` and `DockerCliSandboxBackend`. A job lazily provisions one disposable Git worktree and retains it across named recipe calls until cancellation, promotion reset, close, or destruction. Container execution uses an argument vector with shell disabled, a minimal environment, `--network none`, a read-write sandbox workspace mount, no writable canonical mount, and declared timeout/output/process/memory/CPU controls. The image configured by `HUB_SANDBOX_IMAGE` must already exist locally. Docker is not exercised by the normal test suite; live invocation refuses when Docker, the image, or provisioning is unavailable and never falls back to host execution.

Fake mode keeps the legacy direct-host RecipeRunner for explicit tests/demonstration. It is not process isolation. Although fake configuration requires the `host-test` backend label, `createHub` does not instantiate `HostTestSandboxBackend`.

```text
canonical clean HEAD
        |
        v
disposable worktree -> Docker recipe step(s) -> exact diff/promotion plan
        |                                      |
        |                                      v
        |                           pending hash-bound approval
        |                                      |
        +------------------------------ host promoter
                                               |
                                               v
                                    clean canonical checkout
```

`workshop_sandbox_diff` projects the active candidate. `workshop_sandbox_promote` is always confirmation-class. The plan binds base, canonical state, patch, path manifest, `patchHash`, and `planHash`. Promotion rechecks a clean unchanged canonical checkout, refuses dirty/stale state, symlink/submodule modes, `.git`/`.runtime` control paths, and hash mismatch, then applies only the approved patch through the host. It does not merge, force, copy a tree wholesale, push, or deploy. Success records distinct completion custody and resets the sandbox job.

The implemented sandbox core does not yet provide the complete durable backend-neutral state machine, immutable brief-revision binding, external sandbox restart recovery, broad artifact collection, or all resource observations described by the adopted v1 specification.

## Result custody and fitted attention

Every ordinary Gateway success, refusal, pending approval, and approval-completion crossing creates a terminal Result Rack job containing exact `machine-result.json` bytes, hashes, metadata, and a deterministic projection. Async recipe settlement is captured through the same custody path. Host-return Scrub places the projection in session history and retains an exact `result-rack://` pointer to the underlying output or artifact manifest.

The Rack schema and status/output/artifact/projection rows are append-only. Current artifact support stores artifacts explicitly admitted by code, especially machine-result JSON; it does not crawl or persist arbitrary sandbox-produced files. General artifact collection, retention/disposal receipts, parser-derived test observations, and user-facing Rack inspection tools remain future work.

Before each provider phase, the host fits schemas by the engaged Workshop fixture without changing World authority, plans eligible old completed tool-pair omissions, measures source and fitted bytes, records the meter with the provider request, and exposes the latest measure and resident tool profile through `/api/health`. Warning and refusal thresholds are configured separately; a crossing over the refusal ceiling does not dispatch.

## Configuration boundary

Relevant keys in `src/core/config.js` are:

- `HUB_RESIDENT_MODE` and mode-locked `HUB_SANDBOX_BACKEND` (`docker` live, `host-test` fake);
- `HUB_SANDBOX_IMAGE`, `HUB_SANDBOX_JOBS_ROOT`, and `HUB_RECIPE_TIMEOUT_MS`;
- `HUB_RESULT_PATH`, `HUB_RESULT_PROJECTION_MAX_BYTES`, and `HUB_RESULT_PROJECTION_MAX_LINES`;
- `HUB_ATTENTION_WARN_BYTES`, `HUB_ATTENTION_REFUSE_BYTES`, and `HUB_RETAINED_TOOL_PAIRS`;
- `HUB_PROVIDER_MAX_RETURN_BYTES` for the hard provider response-capture ceiling;
- Workshop file/output ceilings under `HUB_WORKSHOP_MAX_*`.

`HUB_CORNER_ALWAYS_ON_TOP` is a shell-only key read directly by `src/corner/electron-main.js` after `.env` loading; it is not part of `readConfig()` or the resident runtime configuration object.

`readConfig()` validates and freezes standalone configuration. The server uses `resolveHubConfig()` to derive sibling store paths and apply explicit construction overrides in one immutable step; the composition root does not mutate configuration after parsing. HTTP transport calls Forest- and World-owned health/inspection projectors and does not query their SQLite internals.

## Constitutional invariants

- The Source Ledger is append-only operational truth. The Spine is the exact provider-visible request ledger.
- Every completed or interrupted HTTP provider body admitted under the capture ceiling is witnessed exactly in the Spine before independent provider-return Scrub and terminal admission; incremental SSE parsing may precede that terminal append only to produce provisional events. Oversized custody is explicitly incomplete and retains only the bounded admitted prefix. A fetch failure with no response creates no raw-return frame.
- Wake-stream events persist before process broadcast; provisional provider deltas are never canonical resident speech.
- Only validated provider-return and host-return Scrub results enter continuation history.
- Scrubbing and fitting preserve remaining source exactly; they do not paraphrase, merge, reorder, synthesize, or summarize.
- Forest admission remains source-linked and atomic. Derived projections never replace source authority.
- World mounting owns capability authority; resident schema fitting changes attention only.
- Worktree isolation, process isolation, and promotion authority are separate claims.
- Live sandbox controls fail closed. An unavailable backend never causes direct-host execution.
- Canonical mutation through sandbox promotion requires a hash-bound approval and a distinct completion receipt.
- A pending action receipt commits only the immediate approval result; the later decision and mutation have linked append-only completion receipts.

## Known inherited seams

- A process start closes any open lifespan as `server_restart` and opens a new lifespan. The first turn has orientation and response phases; later turns have ordinary phases.
- Active session history remains authoritative even when provider presentation omits eligible older completed tool exchanges.
- Glass fold generation and farther walk-back, Hearth Notes, Forest Exhale, summaries, reset controls, context-limit closure, embeddings, and semantic retrieval are not implemented. Glass anatomy, receipts, exact inheritance, and causal promotion are installed.
- Docker behavior has focused adapter/backend tests but is intentionally not exercised by the normal suite; operators must supply a working Docker CLI/daemon and a locally available image.
- User cancellation is not installed. Renderer SSE clients neither backpressure nor cancel provider work. Hub shutdown does cancel the active provider crossing with a bounded custody grace period. Raw SSE custody is appended at termination rather than per received byte chunk.
- The process bus is bounded and may require resynchronization from the durable journal. Desktop installer/packaging and native GUI/tray smoke verification remain pending.
