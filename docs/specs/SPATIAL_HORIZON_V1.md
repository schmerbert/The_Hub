# Spatial Horizon v1

> **Status: Adopted and installed.** This specification owns the bounded structural horizon rendered inside verified World current ground.

## Purpose

Actor-local perception correctly states the Resident's current place and immediate exits, but locality alone can make an established nonlocal room epistemically unavailable. The Spatial Horizon gives the Resident compact, attributable orientation to the larger installed structure without presenting a universal map, inventing memory, or granting movement authority.

## Authority and crossing

The verified World event projection is the sole source authority. `src/world/spatial-horizon.js` renders standing nodes, direct Hub containment, and installed directed door/passage edges after the ordinary World drift gate. `WorldGraphStore.presenceMessage()` carries the rendering as `world_current_ground`; Glass, Scrub, and Spine witness its presentation through their existing crossings.

No new store, event, topology revision, tool, fixture, or migration is installed.

## Claims

- Direct `place.hub` containment may establish that a standing room exists within the Hub.
- A directed chain of installed door or passage edges may establish only a known route, not that every stateful passage is presently open.
- Containment without a route is stated as existence with access withheld or unavailable.
- Current location, existence, reachability, and action authority remain distinct claims.
- The Garden horizon names the already-established directional relation: south is the Hub.

The House is not falsely described as contained by `place.hub`; it is oriented through the exterior Garden junction. The Spotlight Observatory may be named as a verified contained room while its absent entrance remains explicit.

## Bounded presentation

The horizon contains at most the current place's relation to the Hub, the verified direct Hub room inventory, one shortest known Workshop route, and Spotlight entrance standing. It includes no fixture catalog, hidden provider state, speculative geography, or inferred future route.

## Failure law

World drift refuses before the horizon enters Resident attention. Missing Hub structure produces no horizon. Rendering is read-only and cannot repair, migrate, or mutate World state.

## Acceptance

- Garden ground states that the Hub is south and contains the Workshop.
- House ground distinguishes exterior relation from containment and shows the multi-step Workshop route.
- Center ground states direct Hub membership and the direct Workshop route.
- Spotlight existence is distinguishable from deliberately withheld access.
- Existing World drift, fixture, and Ceiling tests continue to pass.
