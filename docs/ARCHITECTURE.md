# The Hub architecture

This document describes the implemented runtime. See [`STATUS.md`](STATUS.md) for specification precedence and the boundary between implemented cores and broader adopted designs.

```text
Source Ledger -> session/Hearth assembly -> provider-presentation Scrub
              -> Spine exact request -> provider -> provider-return Scrub
              -> World Gateway -> Result Rack -> host-return fitted projection
              -> session continuation / resident response -> Forest admission
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
| Spine | `src/spine/store.js` | Exact provider request and raw-return custody |
| Forest | `src/forest/` | Home/Wild admission, custody, backfill, and verification; no exhale selector yet |
| World state | `src/world/graph.js` | Room graph, location/fixture state, briefs, timers, action receipts, approvals, and append-only approval completion custody |
| Ceiling / Patch Bay | `src/world/ceiling.js`, `src/world/tools.js` | Complete World authority plus deterministic engaged-fixture schema fitting for provider attention |
| Workshop | `src/world/workshop.js`, `src/world/git.js`, `src/world/recipes.js`, `src/world/gateway.js` | Bounded repository operations, local Git, fake/test host recipes, approvals, crossings, and async result capture |
| Sandbox Bay | `src/world/sandbox.js`, `src/world/sandbox-recipes.js` | Disposable Git worktree jobs, Docker recipe execution in live mode, lifecycle/diff control, and no-fallback adapter |
| Promotion | `src/world/promotion.js` | Clean-base, plan/patch-hash-bound host application with protected-path checks |
| Result Rack / attention | `src/world/results.js` | Append-only exact result/output/artifact/projection custody, deterministic fitting, exact pointers, and byte attention meter |
| Host-return Scrub | `src/scrub/host-return.js` | Validated identity or named `result_rack_projection_v1` host result projection |
| Corner slips | `src/corner/slips.js` | Deterministic active/completed progress from persisted phases, receipts, and approvals |
| Context compatibility | `src/context/assemble.js` | Compatibility assembly for pre-session callers |

The older `src/core/*` paths are compatibility re-exports except `src/core/config.js`, which owns active configuration. `src/providers/dispatch.js` validates a presentation before deriving the legacy `messages` argument used by injected test providers.

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
- Workshop file/output ceilings under `HUB_WORKSHOP_MAX_*`.

## Constitutional invariants

- The Source Ledger is append-only operational truth. The Spine is the exact provider-visible request ledger.
- Every received provider body is witnessed in the Spine before parsing; network failures create no raw-return frame.
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
- Hearth Notes, Forest Exhale, summaries, reset controls, context-limit closure, embeddings, and semantic retrieval are not implemented.
- Docker behavior has focused adapter/backend tests but is intentionally not exercised by the normal suite; operators must supply a working Docker CLI/daemon and a locally available image.
