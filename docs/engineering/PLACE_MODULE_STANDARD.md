# Place Module Standard

> **Status: Active implementation convention.** This standard organizes place-owned code. It does not make filesystem location a World authority and does not alter the installed topology.

## Fitting rule

The repository is a fitting board. New behavior should have one obvious owner. If a feature cannot be placed without importing several unrelated internals or inventing a miscellaneous folder, stop and name the missing architectural category before implementation.

The first question is not “which room mentions this?” It is “which authority owns this law?”

```text
Cross-room physics and custody -> context, scrub, ledger, spine, forest, runtime
Universal spatial causation    -> world
One place's declarations       -> places/<place>/
One room's fixtures/behavior   -> places/<place>/<room>/
Human projection               -> corner / public
External adapter               -> providers
```

Glass, Scrub, Scroll, Roots, Spine, Forest, Gateway authorization, provider transport, and generic World replay must not be placed inside a room merely because the Resident encounters them there.

## Place declaration contract

A place module is inert data created through `placeModule()`. It may declare:

- its stable World identity;
- nodes and contained edges it owns;
- local object-state seeds;
- local mounted tool names; and
- passages only when the place owns the complete crossing. Shared inter-place passages are composed by `world/`.

Declarations do not write storage, inspect process state, import runtime/server/provider code, or grant their own authority. The World composer preserves canonical ordering and exact historical hashes.

## Behavior placement

Place-specific behavior belongs beside its declaration when all of these are true:

1. only that place or one of its fixtures can invoke it;
2. its vocabulary and failure modes are local to that place;
3. removing the place removes the behavior; and
4. universal World replay can treat its consequence through a registered event contract.

Navigation, event append, replay, projection, drift verification, action authorization, and cross-place passage law remain universal World machinery.

## Expected shape

```text
src/places/
├── hub/
│   ├── center.js
│   └── workshop.js
├── garden/
├── house/
└── threshold/
```

A larger room may replace its single module with a directory containing `index.js`, `fixtures/`, `capabilities.js`, and local handlers. Do this when real behavior exists; do not pre-create empty scaffolding.

## Change checklist

Every new room or substantial fixture answers:

1. Which place owns its declaration and local behavior?
2. Which universal World event represents its material consequences?
3. Which Ceiling/Patch Bay profile exposes its capabilities?
4. Which Gateway handler admits intent?
5. Which Scrub and durable receipt close its language/result path?
6. Which stores explicitly do **not** receive its material?
7. Does its addition preserve canonical topology ordering and prior hashes?

If an answer has no existing socket, document the loose wire before creating a new subsystem.
