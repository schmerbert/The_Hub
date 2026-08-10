# Ceiling Patch Bay v1 — Catalog, Mount Profiles, and Approval Anchor

> **Status: Implemented.** This specification is current for tool catalog, room profile, presence grouping, and approval-anchor behavior.

## Status and scope

Adopted for the World harness. The Ceiling is the full installed wire catalog: every current native and `workshop_*` tool schema exists there even when a room does not mount it. The Patch Bay selects a room's live profile; it does not rename wires, change schemas, or alter Scrub.

This slice does not put Backpack in the bay. Backpack remains outside this model. Renaming `workshop_*` tools is explicitly deferred.

## Catalog versus mount

- `CEILING_WIRES` is the complete current catalog, with one stable group per tool.
- `ROOM_PROFILES` declares mounts by room. A tool may be cataloged and unmounted.
- `room.center` mounts only `move_through_door`.
- `room.workshop` mounts move, fixtures, and the entire current `workshop_*` catalog (the fat profile).
- Gateway enforcement resolves the current room through the Patch Bay. Stale calls to unmounted wires refuse.

The catalog is available to builder-facing inspection. Resident presence does not dump it.

## Presence

Presence includes one bounded `Patched:` line after room facts. It names mounted groups and short aliases only, stripping the `workshop_` prefix and abbreviating long groups. It is not a flat catalog and does not expose an attic of unmounted wires.

For example:

```text
Patched: move (through_door).
Patched: move (through_door); fixtures (inspect, engage, disengage); explore (list, read, search, …); …
```

## Approval-anchor law

`fixture.workshop_workbench` is the sole approval anchor. Pending approvals remain in the workbench fixture state and contents projection regardless of which future room may initiate a write. Mount routing never relocates approval custody, approval APIs, or the workbench's pending count.

## Non-goals

- Backpack mounting or inventory routing
- Fixture-specific tool gating
- Tool schema or `workshop_*` rename
- Any change to provider or host-return Scrub
