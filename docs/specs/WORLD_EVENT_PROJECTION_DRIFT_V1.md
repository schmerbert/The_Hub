# World Event Projection and Drift v1

> **Status: Stretch A1 implemented and verified; Stretch A2 pending.** A1 installs the World event journal, projector, and verification for topology, lifespan state, movement, inspection, and fixture engagement. A2 moves fixture runtime, timers, briefs, and approvals onto the same pipe. House, Garden, Backpack, Journal, and new mutable fixtures wait until both stretches verify cleanly.

## Purpose

Resident-facing World prose must describe current causal state, not merely plausible state. Every mutable claim presented as current reality must be reconstructible from append-only events and must reconcile with its materialized projection before it enters Glass.

This specification makes three roles explicit:

- the **World event journal** is append-only causal authority;
- the **World projection** is a deterministic derived cache;
- **actor-local perception** is a bounded view over a verified projection.

No layer may silently repair another. Drift is exposed and the affected crossing fails closed.

## Staged scope

### Stretch A1 — physical core (implemented)

- installed topology manifest and its exact hash;
- honest legacy snapshot boundary for databases that predate this journal;
- lifespan initialization;
- current room and movement;
- inspected-source focus;
- fixture engagement and disengagement;
- leaving-Workshop clearing behavior;
- append-only hash-chain verification;
- deterministic empty replay and comparison with materialized state;
- fail-closed verification before World perception or room-derived tool authority.

### Stretch A2 — existing operational state

- fixture runtime, including kiln transitions and restart reconciliation;
- lifespan timers, including replacement and cancellation;
- complete work-brief revision history;
- approval opened, resolved, and cancelled transitions;
- action and approval receipts linked to the exact resulting World event;
- crash-safe atomic event plus projection mutation.

### Deferred to the following milestone

- Threshold, House, Garden, Road, Forest boundary, and Hub passage topology;
- actor inventory, Backpack, Journal, marker custody, and writing surfaces;
- door lock/open state, window marks, turnable stone, and journal pages;
- `home/journal` Forest admission and Silver Bullet forging.

The event vocabulary and reducer registry must be extensible to those later states without accepting arbitrary untyped mutations.

## Event envelope

Every World event contains:

```text
sequence                 monotonic integer journal position
event_id                 stable unique identity
event_schema_version     positive integer
event_kind               installed versioned event kind
aggregate_kind           declared subject class
aggregate_id             durable subject identity
aggregate_revision       contiguous revision for that subject
session_id               nullable only for topology/system events
wake_id                  nullable when no human wake caused the event
actor                     attributable initiator
command_id               optional idempotency identity
causation_json            exact action/request/Spine/approval pointers
payload_json              canonical typed payload
payload_sha256            hash of canonical payload
previous_event_hash       prior journal event hash or genesis marker
event_hash                hash of the complete canonical envelope
occurred_at               event time retained as data, never read by reducer
```

Update and delete triggers protect every event. Sequence must be contiguous. The hash chain covers order, kind, aggregate, revision, causation, payload, and time.

Initial installed event kinds are closed and versioned:

- `topology.installed/v1`;
- `legacy_snapshot.imported/v1`;
- `lifespan.started/v1`;
- `location.moved/v1`;
- `source.inspected/v1`;
- `fixture.engaged/v1`;
- `fixture.disengaged/v1`;
- `fixture_runtime.replaced/v1`;
- `timer.set/v1`;
- `timer.cleared/v1`;
- `brief.revised/v1`;
- `approval.opened/v1`;
- `approval.resolved/v1`;
- `approval.cancelled/v1`.

Unknown kinds or schema versions refuse. A later migration adds a new reducer; it does not reinterpret an existing version.

## Command and projection transaction

A state-changing command follows one transaction:

1. validate the command, current verified state, and expected aggregate revision;
2. begin one immediate SQLite transaction;
3. append the canonical event;
4. apply the pure installed reducer to projection tables;
5. store the last event sequence/hash on every affected projection row;
6. create or bind the action/approval custody that belongs to the same crossing;
7. commit.

Injected failure at any point before commit leaves neither event nor projection mutation. A refused command may create a refusal/action receipt but appends no state-change event.

External filesystem, Git, Docker, provider, and network effects cannot share the SQLite transaction. They remain explicit saga boundaries with preimages, idempotency identities, and fail-closed reconciliation. A World event must never claim an outside mutation succeeded merely because it was requested.

## Pure projector

The reducer:

- reads only prior reducer state and the event envelope;
- performs no wall-clock, filesystem, provider, random, or network reads;
- validates every transition and aggregate revision;
- refuses impossible topology, custody, or lifecycle changes;
- produces canonical rows in stable order;
- derives current state without generating resident prose.

Time-dependent observation such as an armed timer becoming fired uses an injected observation time over persisted `due_at`; it does not rewrite history merely because time passed.

Replaying the journal into an empty projection must reproduce every canonical projection column byte-for-byte. Unknown extra rows are drift, not harmless decoration.

## Legacy boundary

A database with material state but no World journal receives one explicit `legacy_snapshot.imported/v1` event containing or hashing the exact admitted starting projection. This establishes a truthful reconstruction boundary:

- state before the boundary is imported, not reconstructed;
- future events are replayable from that boundary;
- existing location/action/approval ancestry remains inspectable;
- migration never fabricates missing historical events.

Fresh databases begin from `topology.installed/v1` and ordinary typed initialization events rather than a legacy snapshot.

## Drift verifier

Verification must:

1. require append-only journal triggers;
2. require contiguous sequence and intact previous-event hashes;
3. recompute canonical payload and event hashes;
4. validate event schemas, kinds, causation, and aggregate revision continuity;
5. replay into an isolated empty projection;
6. compare every canonical projection column and reject missing or extra rows;
7. verify every projection row's last-event pointer;
8. verify state-changing action and approval receipts cite compatible events;
9. return a bounded, inspectable mismatch manifest without rewriting either side.

Drift examples include:

- an actor or object in two locations;
- a materialized room different from replayed movement;
- engagement retained after leaving its room;
- an inspected source without its event;
- a fixture runtime value unsupported by its latest event;
- a timer, brief, approval, door, mark, or object state that differs from replay;
- a resident-facing claim that cannot be derived from the verified actor-local projection.

## Runtime refusal

World verification runs before:

- `projection()` and actor-local perception;
- `presenceMessage()` and any World ground enters Glass;
- room-derived capability mounting;
- a World mutation command selects its prior state.

On failure:

- no affected World prose enters resident attention;
- no room-derived tool bundle is mounted from unverified state;
- no automatic repair, reseed, or projection overwrite occurs;
- the wake fails with a typed bounded World-drift code before provider dispatch when possible;
- builder inspection exposes the mismatch without treating it as resident knowledge.

An explicit future rebuild command may be designed separately. It is not installed by this specification.

## Inspection and verification command

`GET /api/world` must expose a builder-only verification projection containing journal head, event count, projector version, verified status, and bounded mismatches. It does not move the resident or create a Source event.

`npm run world:verify` verifies an existing configured World database without starting a provider or modifying state. Exit is nonzero on schema, journal, replay, projection, or custody mismatch.

## Acceptance

### A1

- Fresh topology and lifespan state replay exactly.
- Legacy import has one honest snapshot boundary.
- Move, inspect, engage, re-engage, disengage, and leave-room clearing replay exactly.
- Event update/delete, sequence gaps, payload tampering, broken hashes, unknown versions, aggregate revision gaps, projection tampering, and extra rows fail.
- Failure injected between event append and projection commit leaves neither side changed.
- Copying the journal into a clean projection reproduces the canonical physical core.
- Drift refuses World perception, room capability mounting, and provider dispatch.

### A2

- Kiln, timer, brief, and approval histories replay exactly.
- Async kiln and restart transitions have causal events.
- Brief updates retain prior revisions rather than overwrite their only row.
- Pending through confirmed/rejected/cancelled approvals reconstruct exact current counts.
- State-changing action/approval receipts link to exactly one compatible World event.
- Refused commands have receipts and no state event.
- The complete focused suite and full Hub suite pass without touching configured live ledgers.
