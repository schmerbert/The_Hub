# Autonomous Wakes v1 — Rest, Return, and a Smaller Pair of Hands

> **Status: Adopted first implementation slice, 2026-09-12.** This revision installs self-directed rest and same-seat autonomous return. An outside Hearth-origin heartbeat remains a distinct deferred crossing; it must not be simulated by teleporting the Resident home or launching a second context path.

## Pressure, classification, and ownership

- Classification: **extending** wake orchestration and **revising** the earlier assumption that every admitted wake begins with a human utterance.
- Pressure case: an earlier autonomous experiment felt like a shadow or second model because it did not inherit the ordinary lived continuity path. The desired experience is the same Resident waking and walking, with fewer consequential hands but meaningful freedom.
- Protected invariant: wake origin may fit authority, but must not fork Resident identity, session continuity, location, Forest footing, provider-presentation law, or canonical speech custody.
- Wake protocol owner: `src/runtime/`.
- Happenedness and schedule custody owner: `src/ledger/autonomous-wakes.js` beside Source.
- Location and footing authorities: World and Forest traversal, unchanged.
- Single authority gate: Wake Service intersects currently mounted tools with the autonomous allowlist before presentation and checks the same allowlist again before dispatch.
- Explicit non-owners: prompts, provider recollection, schedules, room prose, and the initiating clock cannot grant tools or relocate the Resident.

## Two wake origins

### Self-directed return — installed

The Resident may call `rest_for` with a bounded delay and optional loose intention. The host records the exact current World seat and, when present, Forest journey/junction/footing. When due, the same open lifespan resumes through the ordinary Wake Service, Session Scroll, Glass, Spine, World, and Forest machinery.

The wake begins at the current verified seat. It does not reconstruct or restore an older copied projection: if lawful movement occurred after scheduling, stale seat disagreement refuses rather than teleporting or silently substituting a location.

In this slice, one open process-lived session is one Resident life and carries `life_id = session_id`, with context generation `1`. Provider phases and later wakes do not themselves create new lives. A future explicit context-reset crossing must increment or replace that generation and turn an outstanding bench rest into an attributable successor handoff rather than claiming same-life continuation.

The bench promise retains `rested_at`, exact requested duration in milliseconds, computed `due_at`, actual `woke_at`, derived elapsed milliseconds, and nonnegative dispatch lateness. The wake ground tells the Resident each value precisely. Requested duration, due time, actual dispatch, and elapsed time are never substituted for one another; process suspension or competing work may therefore appear as honest lateness.

One pending rest is permitted per lifespan. Replacing or cancelling it is append-only. A crash leaves the plan pending; startup may claim an overdue plan once. Claim identity makes duplicate timer delivery inert.

### Hearth-origin heartbeat — deferred

An outside heartbeat is not a self-directed return. Its future law must decide whether and how the Hearth participates without rewriting World location or pretending the Resident sat there. This slice records that distinction and does not install an hourly schedule, external channel, automatic relocation, or fake human utterance.

## Freedom and authority

Autonomous wakes receive a default horizon of 24 action rounds plus one reserved final response. The horizon is a resource policy, not a productivity quota. Wandering, finding nothing, changing direction, remaining in the Forest, or scheduling another rest are valid outcomes.

Initially permitted autonomous actions are reversible or read-only experience:

- World movement, reversible passage operation, inspection, and fixture focus;
- installed Forest traversal and exact leaf reading;
- Workshop repository/document exploration and read-only Git inspection;
- retained Spotlight status/list/read, but not a new live observation;
- exact Result Rack reopening; and
- `rest_for`.

Mutation, recipes, Git writes, approvals, durable object-state turning, Journal planting, live outside observation, financial action, publishing, installation, and authority changes remain unavailable. A remembered or fabricated call to a withheld tool is refused with `autonomous_tool_denied` and receives ordinary refusal custody.

## Trigger and continuity

An autonomous trigger is a host-receipted state event, never a fabricated user utterance and never automatic Forest terrain. It names origin, plan, due time, loose intention, and witnessed seat. Provider attention receives that trigger as labeled current ground while the same Session Scroll, stable Glass, holster, World presence, active Forest walk, and previous Resident speech remain in their ordinary positions. Its exact rendered message hash is included in the crossing-ground receipt. The first production wake predates that inclusion; its immutable trace remains admissible only by recomputing the exact message from its bound trigger, timing, plan, and seat receipt.

The resulting terminal response is ordinary Resident-authored canonical speech and may enter Forest under existing laws. Its chronological predecessor is the latest eligible utterance, not the host clock event.

## Failure and recovery

Missing Hearth settlement, a closed or reset life/context generation, stale seat, concurrent wake, unavailable Forest readiness, invalid delay/intention, duplicate claim, shutdown, provider failure, or custody drift fails boundedly. The plan receives an append-only terminal event where appropriate. Failure cannot create a user utterance, move the Resident, widen authority, or retry a claimed provider crossing invisibly.

## First proving surface

- `rest_for` accepts 60 seconds through 24 hours.
- `POST /api/autonomous-wakes/run` creates an operator-requested immediate self-directed proving wake.
- `GET /api/autonomous-wakes` reports bounded current standing and recent plans without exposing provider credentials or private reasoning.
- startup arms the next pending plan and shutdown cancels only process timers, not durable plans.

Tests cover same-session/no-fake-user continuity, exact-seat preservation, authority fitting and stale-call refusal, generous action horizon, duplicate claim, overdue recovery, failure settlement, and unchanged human wakes. No production provider wake is automatically exercised during repository verification.
