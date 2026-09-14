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
| Workshop v1 installed `resident_text` engagement wording | Migration-only presentation seam | Preserves exact topology hashes and replay while live Workshop presence/tool descriptions truthfully describe fixture schema fitting | A versioned World topology migration installs corrected text without rewriting prior events | World topology/hash, Workshop fixture, and Resident presentation tests |
| Experimental Spotlight capsule and `createSpotlightCapsule()` export | Sealed experimental compatibility | Laboratory callers and preserved recorded-replay ancestry after production Spotlight promotion | Remove only under an adopted experiment-retention decision; production code must not import it | Experimental Spotlight suite plus production architecture-boundary tests |
| Injected Forest adapter surface accepted by `projectForestHealth()` | Permanent test/adapter contract for now | Runtime tests and future alternate Forest adapters may delegate historical operational methods plus an owned SQLite handle without health convenience methods | Reclassify only after a formal Forest adapter interface is adopted and all injected implementations migrate | Runtime Boundary Floor and Forest health tests |
| Transitional Glass v2 fold hash | Migration-only ancestry admission | Verifies the bounded casts written with fold-aware bytes while still mislabeled code-owned Glass v2 before Glass v3 corrected the version boundary | Retire only if those exact historical cast/trace records are removed under an adopted custody-retention policy; never rewrite them | Glass trace epoch, Resident presentation, configured-runtime verification, and full suite |
| Forest traversal schema v1 | Migration-only ancestry | Empty stores evolve to v2; nonempty v1 journeys refuse automatic migration so their Garden-era dual-presence meaning is not rewritten | Retire only after an adopted ancestry-preserving journey migration | Empty evolution and migration-refusal tests |
| Forest traversal v2 flat junction geometry | Migration-only ancestry | The first live expedition and earlier tests retain their exact three-slot offers as `legacy_flat/v2`; v3 projection may read them but never recast them | Retire only under an adopted retention policy that explicitly disposes of those expedition records; never by schema cleanup | Explicit v3 migration, store verification, and Forest traversal tests |
| First autonomous-wake Glass ground witness | Migration-only ancestry admission | The first production bench wake retained an exact cast and trigger, but its crossing-ground receipt omitted the new `autonomous_wake_ground` message hash; verification recomputes that one message from the bound v2 trigger, timing, plan, and seat receipt | Retire only if that exact historical cast is disposed of under an adopted custody-retention policy; never rewrite its append-only receipts | Autonomous wake Glass verification and configured-runtime Glass trace verification |
| Blocking `POST /api/wakes` terminal response | Active transition | Direct callers and older HTTP clients may continue awaiting the completed wake projection while Corner uses `delivery=accepted` and durable stream reconciliation | All supported callers use admitted delivery or an explicitly named synchronous runtime API; removal requires an API version boundary | Wake Stream runtime, Corner API/live-event, disconnect, concurrency, shutdown, and full suites |

## Spotlight optional connection standing

Spotlight live-read v1 preserves the `1.2.0` portable manifest, installed schemas, room text, and room-installation witness exactly. Their optional-unwired socket rows and capped telescope wording describe installation ancestry. `SpotlightLiveService.status()` and the witnessed current tool ground report the process-local bindings that may now enable deliberate observation/list/read. Removal of this presentation seam requires a versioned room/topology migration; changing old bytes is forbidden. Tests: Spotlight live runtime, hands, installation witness, World verification and Glass trace tests. The default capped service remains a supported no-connection implementation, not an activation bypass.

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
