# Workshop Heartbeat v1 — Timer + House-Bound Kiln

> **Status: Implemented.** Current for asynchronous recipe and timer lifetime. On process restart, a persisted `running` kiln is reconciled to an honest cancelled state.

## Status and scope

Adopted after Workshop fixtures. This slice separates **room-bound hands** from **house-bound processes**: the resident may leave the Workshop while a kiln prove continues, and may set a voluntary timer ding (e.g. one minute) without staring at a log.

It does not add autonomous model wakes on ding, multiple concurrent kilns/timers, freeform shell, worktree sandbox, or fixture→tool bundles.

## Principle

| Kind | Behavior |
| --- | --- |
| Room-bound | Tools mount/drop with the room; engagement clears on leave |
| House-bound | Started kiln and armed timer survive room changes within the lifespan |

Server restart ends in-flight kiln honestly. Forest Home/Wild are untouched by heartbeat machinery.

## Kiln (async, house-bound)

- `workshop_run_recipe` **starts** the process and returns immediately with `status: 'started'` while kiln overlay is `running`.
- Completion updates kiln overlay to `settled` / `failed` / `cancelled` in the background.
- `workshop_recipe_status` mirrors kiln overlay / active job for explicit inspect.
- `workshop_recipe_cancel` still smothers an in-flight recipe.
- **Leave Workshop** and **disengage fixture** do **not** cancel the kiln (supersedes prior leave-room cancel law).

## Timer (voluntary ding)

Workshop-mounted auto tools:

| Tool | Role |
| --- | --- |
| `workshop_timer_set` | Arm one lifespan timer; `seconds` integer 1..3600; replaces any prior timer |
| `workshop_timer_status` | none / armed / fired |
| `workshop_timer_cancel` | Clear armed or fired ding |

Timer survives room changes. Center cannot set/cancel (tools unmounted) but **presence in any room** may show the heartbeat.

Fired is sticky until cancel or a new set. No separate ack tool in v1. No host-initiated resident wake on ding — visibility is next presence injection, next human wake, and Corner.

## Heartbeat face

Presence includes one compact heartbeat clause when kiln is non-idle and/or a timer is armed/fired. Still no tool-catalog scaffolding. Presence crosses presentation Scrub; tool returns cross host-return Scrub.

Projection / `/api/health` expose the same heartbeat fields for the Builder.

## Relation to prior specs

- Supersedes leave-room recipe cancel in [WORKSHOP_TOOL_CEILING_V1.md](WORKSHOP_TOOL_CEILING_V1.md) and [WORKSHOP_FIXTURES_V1.md](WORKSHOP_FIXTURES_V1.md).
- Flat ceiling and fixtures otherwise unchanged.
