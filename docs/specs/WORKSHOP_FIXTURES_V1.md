# Workshop Fixtures v1 — Shelves, Workbench, Kiln, Ledger, Clipboard

> **Status: Implemented.** Current for Workshop interior, fixture engagement, contents projection, and presence, subject to Heartbeat's house-bound lifetime rule.

## Status and scope

Adopted for the Workshop interior after the need-first tool ceiling ([WORKSHOP_TOOL_CEILING_V1.md](WORKSHOP_TOOL_CEILING_V1.md)). This slice replaces living Workshop stations with five plain-named engageable fixtures, strips tool-list scaffolding from room presence, and installs the kiln as the first living ambient face.

It does not add fixture→tool bundles, freeform shell, push/deploy, new rooms, or atmospheric LLM narration. Room prose is sparse, state-backed seed text: it may name installed rooms and fixtures but may not invent perception, windows, or actions.

## Relation to prior specs

- **HUB-016 ceiling stands:** full `workshop_*` catalog mounts whenever the resident is in `room.workshop`. Engagement never gates tools.
- **Stations superseded for Workshop interior:** Spec Table / Control Panel are retired. Engageable craft surfaces are `fixture` nodes with `engageable: true` in seed state. See mounting note on [WORKSHOP_STATIONS_V1.md](WORKSHOP_STATIONS_V1.md).

## Seeded fixtures

| ID | Contained by | Seed text (depth may grow in text, not the ID) |
| --- | --- | --- |
| `fixture.workshop_shelves` | `room.workshop` | Shelves. Look at the repository as it is. |
| `fixture.workshop_workbench` | `room.workshop` | Workbench. A heavy surface for cutting and changing work. Confirm-class cuts (delete, branch checkout) wait here for the Builder; ordinary writes apply under trust parity. |
| `fixture.workshop_kiln` | `room.workshop` | Kiln. Fire a named recipe and hear it run. |
| `fixture.workshop_ledger` | `room.workshop` | Ledger. History, staging, and landing. |
| `fixture.workshop_clipboard` | `room.workshop` | Clipboard. Name the job: objective, scope, acceptance. |

Machine seed state includes `{ engageable: true, fixture: '<short name>' }`. Center fixtures remain non-engageable.

Retired (preserved ancestry, not standing): `station.spec_table`, `station.control_panel`.

## Engagement

- Tools: `inspect_fixture({ fixture_id })`, `engage_fixture({ fixture_id })`, `disengage_fixture({})`.
- Inspect is read-only: it is lawful in `room.workshop` for any standing fixture contained there, returns the fixture text/state/projection, and does not change `engaged_fixture_id` or create an engagement event.
- Lawful only in `room.workshop` against a standing contained fixture with `engageable: true`.
- At most one engaged fixture per lifespan (`engaged_fixture_id`).
- Leaving the Workshop clears engagement.
- Engagement is orientation only; for looking, use inspect. It does not change the mounted tool list.

## Fixture contents

Inspect and engage returns carry a bounded `contents` projection appropriate to the fixture:

| Fixture | Contents |
| --- | --- |
| clipboard | current session brief |
| workbench | pending approval count and `{ approvalId, kind, status }` list (confirm-class only after HUB-025; auto cuts do not linger here) |
| kiln | runtime overlay, or honest idle state |
| ledger | bounded git branch/dirty digest, never a full status dump |
| shelves | repository-root listing digest, capped with truncation disclosure |

The workbench also projects `state.pendingApprovals`, equal to the room-level pending approval count.

## Presence packet

Quiet room presence names lived facts only:

- current room id and `resident_text`;
- standing contained fixtures (id, text, salient merged state);
- engaged fixture if any;
- exits;
- one line when pending approvals exist (“work waiting on the workbench”).

Engageable fixtures are named separately and plainly, for example `Engageable: shelves (fixture.workshop_shelves), …`; they are not hidden inside an opaque fixtures sentence.

It must **not** dump the native tool-name catalog. Schemas remain on the provider tools list when in Workshop.
In the Workshop, presence also states: “Workshop tools are mounted without engaging; engage is orientation only.” This is required even after engagement, so fixture metaphor never implies a hidden capability gate.

Presence crosses presentation Scrub every provider turn even when unchanged. Host tool results continue through host-return Scrub.

## Kiln runtime overlay

Standing `world_nodes` remain append-only for architecture text. Living kiln machine state uses a mutable fixture runtime overlay keyed by fixture id, merged into projection:

| status | Meaning |
| --- | --- |
| `idle` | quiet (default) |
| `running` | recipe in flight |
| `settled` | last run exited zero |
| `failed` | last run exited non-zero or errored |
| `cancelled` | killed by explicit cancel, timeout, or honest restart reconciliation |

Leave Workshop does **not** cancel an in-flight recipe (house-bound kiln; see [WORKSHOP_HEARTBEAT_V1.md](WORKSHOP_HEARTBEAT_V1.md)). Overlay may retain a short exact summary tail for presence; it is not a log dump into chat.

## Mount law (unchanged capability)

```text
room.workshop → entire workshop_* catalog + move_through_door + inspect_fixture + engage_fixture + disengage_fixture
room.center → move_through_door only
```

`inspect_fixture` mounts with the Workshop fixture tools. It is not mounted in Center.

The [Ceiling Patch Bay v1](CEILING_PATCH_BAY_V1.md) owns the profile routing: Workshop remains the fat profile and Center remains move-only. Fixture engagement is still orientation, never a mounting switch. Pending approvals stay anchored at `fixture.workshop_workbench` even if a later room gains a write-capable profile.

## Explicit non-goals

- Fixture→tool partitions
- Full ambient sound subsystem beyond kiln status in the presence packet
- Renaming Center fixtures
- Lengthening clinical bootstrap
