# Workshop Stations v1 — Engage, Disengage, Mount

## Status and scope

**Implemented ancestry; station nodes are retired and station-gated mounting is superseded.** This specification extended [WORLD_GRAPH_WORKSHOP_V1.md](WORLD_GRAPH_WORKSHOP_V1.md) without rewriting Center topology, Circulation, Spine, or Forest Home bijection. Current engagement uses fixtures and never gates tools.

It adds:

- `station` as a World Graph node type;
- two standing Workshop stations: Spec Table and Control Panel;
- lifespan engagement to at most one station;
- engage / disengage native tools with video-game interact grammar;
- tool resolution from room ∩ engaged station ∩ policy;
- automatic disengage when leaving the Workshop.

It does not add writable edits, shell, git mutation, Luna/companion mounting, arbitrary project roots, or additional rooms.

## Mounting note (HUB-016 / HUB-017)

Station engagement no longer gates tools ([WORKSHOP_TOOL_CEILING_V1.md](WORKSHOP_TOOL_CEILING_V1.md)). **HUB-017 retires living Workshop stations** in favor of plain engageable fixtures (`fixture.workshop_shelves`, `workbench`, `kiln`, `ledger`, `clipboard`). See [WORKSHOP_FIXTURES_V1.md](WORKSHOP_FIXTURES_V1.md). Spec Table / Control Panel nodes are retired ancestry; this stations document remains historical for the engage grammar that fixtures inherit.

## Locked agency

The resident currently inhabited by DeepSeek model sessions is the coding agent while tools are mounted. Companions (including Luna) are a separate system with their own seat and process boundary. Workshop must not pretend the resident provider can spawn an in-process coding subagent.

## Graph additions

### Node type

`station` — a engageable fixture inside a room. Stations are contained by rooms via `contains` edges. They are not rooms; the resident’s physical location remains a `room` node.

### Seeded stations

| ID | Contained by | Resident text (sparse) |
| --- | --- | --- |
| `station.spec_table` | `room.workshop` | Spec Table. Engage to shape a work brief before arms move. |
| `station.control_panel` | `room.workshop` | Control Panel. Engage for surgical repository execution. |

Provisional poetic names may change after resident consultation. Clinical IDs remain stable.

### Lifespan engagement

`world_locations` gains `engaged_station_id` (nullable FK to `world_nodes.id`).

Laws:

- Engagement is lawful only when `room_node_id === 'room.workshop'` and the station is contained by that room.
- At most one station may be engaged.
- Engaging a second station replaces the first after an attributable disengage event (or atomic swap with receipt naming both).
- `disengage_station` clears engagement; the resident remains in the Workshop.
- `move_through_door` that leaves `room.workshop` clears engagement automatically and records that clearance in the move ancestry attribution.
- Prose never engages or disengages.

## Native tools

### Always (by room)

| Room | Tools |
| --- | --- |
| `room.center` | `move_through_door` |
| `room.workshop` (any engagement, including none) | `move_through_door`, `workshop_list`, `workshop_read`, `workshop_search`, `engage_station`, `disengage_station` |

Reads remain available in the Workshop without ceremony so browsing is not blocked behind Spec Table engagement.

### Spec Table (engaged)

Additional tools (defined fully in Control Panel / brief specs as they land):

- `workshop_brief_upsert`
- `workshop_brief_get`
- `workshop_pending_diff` (read-only inspection of pending approvals)

No file mutation, shell, or git write at the Spec Table.

### Control Panel (engaged)

Additional tools (writable crossing):

- `workshop_apply_patch`
- `workshop_run_recipe`
- `workshop_git_status`
- `workshop_git_diff`
- `workshop_git_commit`
- `workshop_approval_status`

Control Panel tools requested while engaged at Spec Table, or with no engagement, are refused. Spec Table brief tools requested at Control Panel or with no engagement are refused. Stale remembered schemas fail at the gateway.

## Presence

Room presence text names:

- current room;
- contained fixtures/objects/stations;
- exits;
- engaged station or `none`;
- currently executable native tool names.

Station engagement changes affordances; narrated success without a receipt remains forbidden.

## Actions

### `engage_station({ station_id })`

- Requires Workshop location.
- `station_id` must be a standing `station` contained by `room.workshop`.
- Commits engagement; returns projection including `engagedStationId`.

### `disengage_station({})`

- Requires Workshop location and a current engagement (or identity no-op with explicit `already_clear` result if none—prefer refuse `world_not_engaged` for honesty).
- Clears engagement.

### Leave room

Moving from Workshop to Center clears `engaged_station_id` before or with the location update. Any in-flight Control Panel backend work is cancelled or orphaned per [WORKSHOP_CONTROL_PANEL_V1.md](WORKSHOP_CONTROL_PANEL_V1.md); stations v1 has no background work yet.

## Circulation

Engage/disengage and room presence continue through Circulation: action receipt, host-return Scrub, session history. Machinery does not enter Home or Wild. Workshop read/search Wild admission is unchanged.

## Capability equation

```text
World room
  + engaged station (or none)
  + station/door manifest
  + resident permissions
  + project scope (Hub root)
  + sandbox and approval policy
  + backend availability
  = tools for this provider turn
```

## Required verification

- Seed includes both stations and contains edges; idempotent; append-only standing rows preserved.
- New lifespans start in Center with `engaged_station_id` null.
- Workshop without engagement exposes move, reads, engage, disengage only.
- Engage Spec Table mounts brief tools; Control Panel tools refuse.
- Engage Control Panel mounts exec tools; brief tools refuse.
- Disengage drops station tools; room reads remain.
- Leave Workshop clears engagement; Center never exposes Workshop tools.
- Stale station tools from prior engagement fail closed with receipts.
- Presence and `/api/world` expose engaged station and effective tool names.

## Non-goals

Writable patch/git/recipe execution details beyond tool name reservation; companion bridges; autocomplete; cloud agents; additional rooms.
