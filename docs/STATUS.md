# The Hub - Current Status

This page is the canonical map of the current runtime. Specifications under `docs/specs/` are cumulative slices: an older slice's non-goals describe that slice, not necessarily the present runtime. When specifications conflict, the precedence table below controls.

## Implemented now

- One process-lived resident lifespan per server start, with Session Zero ancestry and a native two-breath `tend_hearth` handshake on the first human turn.
- Exact Source Ledger, provider-presentation and provider-return Scrub receipts, hash-linked Spine custody, and optional verified Forest Home/Wild intake.
- Hearth Scroll v2 with exact recency-selected source excerpts. Hearth Notes and Forest Exhale are not implemented.
- A persistent World Graph with Center and Workshop, per-lifespan location, five engageable Workshop fixtures, a complete Ceiling catalog, and room-based Patch Bay mounting. Fixture engagement is orientation, not authority.
- Bounded repository exploration and mutation, local Git operations, work briefs, timers, approvals, and deterministic Corner Step Slips.
- Result Rack custody for ordinary Gateway success, refusal, pending approval, and approval-completion crossings. Exact machine-result bytes/manifests are retained in SQLite and resident tool returns use deterministic `result_rack_projection_v1` host-return Scrub projections. Asynchronous recipe completion is also captured.
- Provider attention fitting: a persisted per-phase attention meter, health projection, fitted resident tool schemas keyed by the engaged fixture, and declared whole-message omission of older completed tool-call/result exchanges. Current and configured recent exchanges remain; every omission is recorded by provider-presentation Scrub with a disclosure while the exact original history remains in host custody. World tool authority remains unchanged.
- Append-only approval custody. A pending confirm-class call records a pending approval receipt linked to its original action receipt; confirmed, rejected, and restart-cancelled decisions create distinct completion action and approval receipts. Promotion confirmation is therefore separate from the initial pending result.
- Live-mode named recipes run in one persistent job-scoped Docker Sandbox Bay backed by a disposable Git worktree. The canonical checkout is not mounted read-write, container networking is `none`, the child environment is minimal, resource caps are declared, and backend failure refuses without host fallback.
- `workshop_sandbox_diff` and always-confirm `workshop_sandbox_promote`. Promotion is plan- and patch-hash bound, requires a clean and unchanged canonical checkout, refuses symlink/submodule and Hub control paths, applies only through the host-owned crossing, records completion custody, and resets the sandbox job after success.

## Specification precedence

Later adopted slices supersede only the named parts of earlier slices; remaining custody and constitutional laws stay in force.

| Current authority | Supersedes |
| --- | --- |
| `SESSION_HEARTH_V1.md` and `HEARTH_SCROLL_V2.md` | First Breath / Orientation Receipt / Wake Ritual presentation timing and the original large Hearth return |
| `WORLD_GRAPH_WORKSHOP_V1.md` | Earlier claims that no rooms or movement exist |
| `WORKSHOP_TOOL_CEILING_V1.md` | Station-to-tool mounting and the read-only Workshop capability ceiling |
| `WORKSHOP_FIXTURES_V1.md` | Living Spec Table and Control Panel stations; fixture engagement replaces station engagement |
| `WORKSHOP_HEARTBEAT_V1.md` | Leave-room recipe cancellation; kiln and timer are house-bound within the lifespan |
| `CEILING_PATCH_BAY_V1.md` | Ad hoc tool-list projection; the Ceiling catalog and room profiles own mounting |
| `CORNER_STEP_SLIPS_V1.md` | A single undifferentiated active-wake gap |
| `WORKSHOP_SANDBOX_BAY_V1.md` | Direct-host recipe execution in live mode and promotion without an isolation boundary |
| `WORKSHOP_RESULT_RACK_V1.md` | Unfitted ordinary host returns and unreceipted removal of old completed tool exchanges |

`WORKSHOP_CONTROL_PANEL_V1.md` and `WORKSHOP_STATIONS_V1.md` remain implementation ancestry. Use them only where a later Workshop specification has not superseded their claims.

## Implemented core, broader design still partial

- [`WORKSHOP_SANDBOX_BAY_V1.md`](specs/WORKSHOP_SANDBOX_BAY_V1.md): live Docker execution, disposable worktree custody, no host fallback, diff inspection, and hash-bound approval-gated promotion are implemented. Durable backend-neutral lifecycle events, immutable brief-revision binding, restart recovery of an external sandbox, independent repository metadata, and broad artifact/resource telemetry remain design work.
- [`WORKSHOP_RESULT_RACK_V1.md`](specs/WORKSHOP_RESULT_RACK_V1.md): append-only jobs/status/output/artifact/projection rows, exact pointers, deterministic bounded projections, ordinary Gateway integration, async recipe completion, provider attention measurement, and declared old-tool-exchange omissions are implemented. General sandbox file-artifact collection, Rack list/read tools, retention/disposal policy, parser-derived observations, and complete promotion-package artifact custody are not.

Result Rack currently retains exact machine-result JSON and output chunks plus their manifests. It must not be read as a claim that arbitrary files produced inside a sandbox are collected or durably retained.

## Workshop trust and safety boundary

Workshop paths remain relative to the configured root and refuse traversal, symlinks, `.git`, `.runtime`, environment files, and credential-like paths. The resident cannot supply an arbitrary shell command. Network Git and destructive/rewriting Git operations are not installed.

Live mode requires `HUB_SANDBOX_BACKEND=docker`. The configured `HUB_SANDBOX_IMAGE` must already be present locally: jobs run with network disabled and the Hub does not pull an image as an execution fallback. If Docker, the image, worktree provisioning, or a required control is unavailable, recipe invocation refuses; it never runs that live recipe in `HUB_WORKSHOP_ROOT`.

Fake mode is different by design: it retains the legacy direct-host RecipeRunner for tests and demonstration. That runner executes trusted workspace code with the Hub process's filesystem permissions and is not an OS sandbox. `HUB_SANDBOX_BACKEND=host-test` is accepted only with fake configuration, but `createHub` does not instantiate the HostTestSandboxBackend. Do not use fake recipe execution for untrusted repositories.

`HUB_APPROVAL_MODE=auto` is a fake-mode test convenience. Live mode keeps confirmation-class actions gated, and sandbox promotion remains confirmation-gated even in auto approval mode. Pending approvals belong to the lifespan that created them and are cancelled rather than confirmable after restart. A kiln left `running` by process termination is reconciled as cancelled.

For a confirm-class call, the initial action receipt may be `committed` because creation of the pending approval was the immediate committed result. The later decision and mutation have their own append-only action and approval receipts linked to the pending phase.

## Adopted design, not implemented

- `HEARTH_NOTES_FOREST_EXHALE_V1.md`: ten-slot Hearth-note custody, Slot One, lexical Forest selection, exact sentence atoms, and exhale presentation.
- `VAULT_V1.md`: the Vault room, door, document graph, wings, bin/slot crossing, principle documents, and Forest-to-Vault pointers.

## Deferred

The partial Sandbox Bay and Result Rack items named above; Vault runtime; Hearth Notes; Forest exhale/retrieval and synthesis; embeddings and semantic ranking; reset UI; context-limit lifespan closure; free-form shell; companion/delegation bridges; multi-root workspaces; browser/web tools; autonomous model wakes; streaming; authentication; external publishing, deployment, and network Git operations.
