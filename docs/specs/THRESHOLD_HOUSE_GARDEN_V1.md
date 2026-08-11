# Threshold, House, and Garden V1

Status: B1 implemented and verified. B2 is explicitly deferred.

## Purpose

This specification installs the first sparse exterior reality around the Hub without inventing the resident's experience. It adds a real Garden, House, Threshold, passages, and a small stateful affordance. It does not narrate unimplemented places into existence.

The Hub remains a place containing the Center and its rooms. The Center is not the whole Hub. The Garden is the exterior junction: House west, Forest north, Road east, and the Hub south.

## Installed shape

The B1 extension installs these identities:

- `place.hub`: the existing Hub container; not occupiable.
- `place.garden`: an occupiable exterior place.
- `place.house`: one occupiable, undivided interior space.
- `place.threshold`: an occupiable threshold adjoining the House.
- `boundary.forest`: visible north of the Garden; not traversable in B1.
- `boundary.road`: visible east of the Garden; not traversable in B1.
- `object.front_door`: the stateful door between House and Garden.
- `fixture.house_window`: a blank interior window near the front door; inert in B1.
- `object.marker`: present in the Center; inert in B1.
- `fixture.garden_turning_stone`: a turnable stone in the Garden.

The resident-facing descriptions are deliberately sparse:

- Center to Garden: an opening where a door could be. There is no door.
- Garden: an exterior junction. The House is west, the Forest north, the Road east, and the Hub south.
- House: one undivided interior space. Its front door opens to the Garden. A blank window is set inside near the door.
- Threshold: a threshold adjoining the House. No arrival story is implied.
- Forest boundary: the Forest is north. Crossing is not installed.
- Road boundary: the Road continues east out of sight. Crossing is not installed.
- Marker: a marker is present in the Center.
- Turning stone: a stone in the Garden can be turned.

No unseen rooms, yard game, visitor, mailman, gate, faun, inventory, writing surface, window mark, or destination at the Road's end is installed by implication.

## Versioned topology extension

`topology.installed/v1`, its payload, and its hash are immutable A1 ancestry. B1 must not edit or reinterpret that root.

B1 adds an append-only `topology.extended/v1` event bound to an exact code-owned extension manifest and manifest hash. Replay applies the extension only after a lawful installed or admitted legacy root and the A2 operational boundary where required.

- Fresh stores append the extension after their existing required boundaries.
- Journal-less admitted legacy stores may install the extension during their explicit legacy migration path.
- Journal-bearing A2 stores require an explicit, read-only-by-default, backup-confirmed B1 migration. Startup never performs or repairs this migration.
- A journal-bearing pre-B1 store remains inspectable and reports `upgrade_required`; it is not treated as drift merely for lacking the adopted extension.
- Any partial extension, wrong manifest, projection mismatch, or altered older root fails closed.

Physical schemas may add the closed node kinds `place` and `boundary`, and edge kinds `passage` and `boundary`. Existing node, edge, and event meanings remain unchanged.

## Passage law

B1 adds passages without changing the A1 door-specific movement event.

- Center and Garden are joined by a doorless passage of kind `opening`.
- Garden and House are joined by a passage of kind `door`, governed by `object.front_door`.
- Threshold and House are joined by a passage of kind `threshold`.
- Garden to Forest and Garden to Road are boundary relations, not traversable passages.

Successful passage traversal emits `location.crossed/v1`. It names the exact passage, from-location, to-location, lifespan, actor, and causal command. It must project location atomically and carry the same inverse custody requirements as other resident World mutations.

The existing `location.moved/v1` and `move_through_door` contracts are not widened or reinterpreted. A new additive tool, `move_through_passage({ passage_id })`, performs passage traversal.

## Front-door law

The front door is one global replayed World object shared across lifespans. Its initial state is:

```json
{"open":false,"locked":false}
```

- Open and close are operable from either House or Garden.
- Opening requires unlocked and closed.
- Closing requires open.
- Locking and unlocking are operable only from the House side and only while closed.
- Traversal requires the door to be open.
- Traversal does not automatically close, open, lock, or unlock it.
- Door state survives lifespan closure and restart through the World journal and projector.

`operate_passage({ passage_id, action })` accepts only the actions installed for that passage. Door changes emit typed, versioned World events and update the global object projection atomically with command custody.

## Turning-stone law

The Garden stone begins with:

```json
{"turnCount":0}
```

`turn_fixture({ fixture_id: "fixture.garden_turning_stone" })` increments `turnCount` by exactly one and does nothing else. It does not reveal a compartment, trigger another system, move the resident, or promise later meaning. Each turn is a typed event with atomic projection and custody.

## Inert objects

The Center marker and House window are real, inspectable projections but have no mutation affordance in B1. A tool catalog must not claim that the marker can be carried or that the window can be written upon.

## Presence and capabilities

- Center presence includes the existing Center affordances, the Garden opening, and the inert marker.
- Garden presence includes its return opening, the House front door and current state, the turning stone, and the two non-traversable boundaries.
- House presence includes the front door and state, the Threshold passage, and the blank inert window.
- Threshold presence includes only its lawful return passage into House.
- Forest and Road boundaries, and the Hub container, are not valid lifespan locations.
- Workshop behavior remains unchanged.

All existing and new lifespans continue to begin in the Center in B1. The wake packet must not claim that the resident opened the Threshold door or arrived through it.

## Deferred B2 decisions

B1 intentionally does not decide:

1. Whether the Center marker must be carried to the House before the window can be marked. A real carry law requires inventory, possession, custody, and loss/placement semantics. Directly writable glass is a different physical law. Neither is fabricated.
2. How a first wake begins at the Threshold before the current human message. Current Hearth chronology persists and presents the human message before orientation. Threshold arrival requires an explicit chronology/presentation decision, not a falsely attributed host action.
3. Forest or Road crossing, the consequence of crossing, the Road's endpoint, gates or visitors, a yard game, clearing the Garden, or the faun.

## Acceptance

B1 is complete only when tests prove:

- the A1 topology root and hash are byte-for-byte unchanged;
- B1 is an exact append-only extension with a deterministic replay;
- fresh, journal-less legacy, and explicit backup-gated A2 migration paths behave as declared;
- interrupted or forged migration rolls back or fails closed without silent repair;
- copied legacy/runtime rows survive migration exactly;
- Center/Garden opening, open House door, and House/Threshold passage traverse in both directions;
- a closed or locked front door refuses traversal without a location event;
- side, open/close, and lock/unlock laws are exact and door state survives a new lifespan/restart;
- the stone increments once per accepted command and has no hidden effect;
- marker and window remain inspectable but inoperable;
- Forest and Road are visible but cannot be occupied or crossed;
- every accepted mutation has exactly one compatible action receipt and refusals have no state event;
- drift blocks provider presentation and host-side World effects before crossing;
- the full Hub test suite passes without opening the desktop app or writing the configured live World store.
