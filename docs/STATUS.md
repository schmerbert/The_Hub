# The Hub — Current Status

This page is the canonical map of what the current runtime implements. Specifications under `docs/specs/` are cumulative design and implementation slices: an older slice's non-goals describe that slice, not necessarily the present runtime. When specifications conflict, the precedence table below controls.

## Implemented now

- One process-lived resident lifespan per server start, with Session Zero ancestry and a native two-breath `tend_hearth` handshake on the first human turn.
- Exact Source Ledger, provider-presentation and provider-return Scrub receipts, hash-linked Spine custody, and optional verified Forest Home/Wild intake.
- Hearth Scroll v2 with exact recency-selected source excerpts. Hearth Notes and Forest Exhale are not implemented.
- A persistent World Graph with `room.center` and `room.workshop`, one declared bidirectional Workshop door, per-lifespan location, Center fixtures, and an unspecified tin cup.
- Five engageable Workshop fixtures: shelves, workbench, kiln, ledger, and clipboard. Fixture engagement is orientation only and never gates tools.
- A complete Ceiling catalog and room Patch Bay: Center mounts movement only; Workshop mounts movement, fixture interaction, and the full `workshop_*` catalog.
- Bounded repository exploration, exact reads/searches, ordinary workspace writes, named recipes, local Git inspection/staging/commit, work briefs, and approvals. Delete and local branch checkout require confirmation; ordinary writes and local add/commit are automatic.
- A house-bound asynchronous kiln and one lifespan timer. Leaving Workshop drops its tools and clears fixture engagement, but does not stop the kiln or timer.
- Corner conversation, builder inspection, approvals, and deterministic Step Slips. The utterance rail contains user ground and final resident utterances only.

## Specification precedence

Later adopted slices supersede only the named parts of earlier slices; the remaining custody and constitutional laws stay in force.

| Current authority | Supersedes |
| --- | --- |
| `SESSION_HEARTH_V1.md` and `HEARTH_SCROLL_V2.md` | First Breath / Orientation Receipt / Wake Ritual presentation timing and the original large Hearth return |
| `WORLD_GRAPH_WORKSHOP_V1.md` | Earlier claims that no rooms or movement exist |
| `WORKSHOP_TOOL_CEILING_V1.md` | Station-to-tool mounting and the read-only Workshop capability ceiling |
| `WORKSHOP_FIXTURES_V1.md` | Living Spec Table and Control Panel stations; fixture engagement replaces station engagement |
| `WORKSHOP_HEARTBEAT_V1.md` | Leave-room recipe cancellation; kiln and timer are house-bound within the lifespan |
| `CEILING_PATCH_BAY_V1.md` | Ad hoc tool-list projection; the Ceiling catalog and room profiles own mounting |
| `CORNER_STEP_SLIPS_V1.md` | A single undifferentiated active-wake gap |

`WORKSHOP_CONTROL_PANEL_V1.md` and `WORKSHOP_STATIONS_V1.md` remain implementation ancestry. Use them only where a later Workshop specification has not superseded their claims.

## Adopted design, not implemented

- `HEARTH_NOTES_FOREST_EXHALE_V1.md`: ten-slot Hearth-note custody, Slot One, lexical Forest selection, exact sentence atoms, and exhale presentation.
- `VAULT_V1.md`: the Vault room, door, document graph, wings, bin/slot crossing, principle documents, and Forest↔Vault pointers.

These documents record adopted direction. They do not install rooms, tools, provider context, storage, or UI by themselves.

## Workshop trust and safety boundary

Workshop paths remain relative to the configured root and refuse traversal, symlinks, `.git`, `.runtime`, environment files, and credential-like paths. The resident cannot supply an arbitrary shell command. Git push, pull, fetch, force operations, amend, hard reset, clean, rebase, and merge are not installed.

Named recipes are allowlisted command shapes, not an operating-system sandbox. They execute trusted code already present in the configured workspace. The host supplies a scrubbed child environment that excludes Hub/provider credentials, but repository code can still read workspace files—including an ignored `.env`—and exercise the permissions of the Hub process. Prefer the launching environment for credentials when that boundary matters. Do not point `HUB_WORKSHOP_ROOT` at an untrusted repository or treat recipe allowlisting as process isolation.

`HUB_APPROVAL_MODE=auto` is a fake-mode test convenience. Live mode keeps delete and branch checkout confirmation-gated. Pending approvals belong to the lifespan that created them and are not confirmable after that lifespan closes. A kiln left `running` by process termination is reconciled as cancelled on restart rather than reported as still active.

For a confirm-class action, the initial World action receipt may record `committed` because the immediate result—the creation of a pending approval—was committed. The later mutation decision and outcome live on the approval record. A separate append-only confirmation action receipt would strengthen that ancestry and remains future hardening.

## Deferred

Vault runtime; Hearth Notes; Forest exhale/retrieval and synthesis; embeddings and semantic ranking; reset UI; context-limit lifespan closure; free-form shell; companion/delegation bridges; multi-root workspaces; browser/web tools; autonomous model wakes; streaming; authentication; external publishing, deployment, and network Git operations.
