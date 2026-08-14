# Compatibility Register

> **Status: Active engineering register.** This register makes intentional compatibility visible. It is not exhaustive historical archaeology; add an entry when a compatibility surface is introduced, materially changed, or encountered during nearby work.

## Standing

- **Permanent facade** — stable public entry point whose internal owner may move.
- **Active transition** — callers are being migrated; removal has named conditions.
- **Migration-only** — retained solely to admit or inspect historical state.
- **Deprecated** — supported for named callers until a removal condition is met.

Unregistered new compatibility aliases are not permitted.

## Current register

| Surface | Standing | Consumers / purpose | Removal condition | Verification |
| --- | --- | --- | --- | --- |
| `src/world/results.js` | Permanent facade for now | Stable Result Rack and attention imports while implementation lives in `src/result-rack/` and `src/context/` | Reclassify only through an explicit import migration; no current removal planned | Result Rack and cleanup compatibility tests |
| `src/world/gateway.js` | Permanent facade for now | Stable World action crossing while handlers live under `src/world/gateway/` | No removal while it remains the public crossing owner | Gateway registry and Workshop crossing tests |
| Historical Workshop implementation paths | Deprecated / active transition | `src/world/{workshop,git,recipes,sandbox,sandbox-recipes,promotion}.js`, `src/workshop/path-law.js`, and `src/places/hub/workshop.js` preserve callers while `src/places/hub/workshop/` owns the room | All supported callers use the room package and stored source-pointer policy permits removal | Architecture barrier, Workshop compatibility, and full Workshop suite |
| `WorldGraphStore.engageStation()` / `disengageStation()` | Deprecated | Station-era callers mapped to fixture behavior | No active callers or persisted/API contract requires station naming | Workshop cleanup and fixture tests |
| `src/world/tools.js` deprecated schema export(s) | Deprecated | Older schema projection callers | All consumers use session/fixture-aware schema APIs | Tool Ceiling and cleanup compatibility tests |
| Provider `messages` compatibility bridge in `src/providers/dispatch.js` | Deprecated boundary adapter | Injected providers/tests receiving validated presentation messages | Provider interface adopts validated presentation directly and injected consumers migrate | Scrub/provider tests |
| Awaiting recipe compatibility method in `src/places/hub/workshop/recipes.js` | Deprecated | Callers needing terminal result rather than heartbeat start semantics | All consumers use explicit start plus settlement observation | Workshop heartbeat/recipe tests |
| Legacy Source context and custody-column migrations | Migration-only | Opens supported historical operational databases without losing records | Supported legacy floor is deliberately retired through an adopted migration policy | First Breath and Spine/Forest legacy tests |
| World A1/A2/B1 legacy admission and inspection paths | Migration-only | Explicit, backup-gated historical World migration and refusal | Supported legacy World generations are deliberately retired; never by incidental cleanup | World drift and migration tests |
| Spotlight `createSpotlightCapsule()` compatibility export | Experimental compatibility | Laboratory callers alongside standard `createRoomCapsule()` | Experiment is superseded or all lab callers use the standard interface | Spotlight standard-interface test |
| Injected Forest adapter surface accepted by `projectForestHealth()` | Permanent test/adapter contract for now | Runtime tests and future alternate Forest adapters may delegate historical operational methods plus an owned SQLite handle without health convenience methods | Reclassify only after a formal Forest adapter interface is adopted and all injected implementations migrate | Runtime Boundary Floor and Forest health tests |

## Entry template

```text
Surface:
Standing:
Owning module:
Named consumers:
Behavior guaranteed:
Removal condition:
Migration impact:
Verification:
Last reviewed:
```
