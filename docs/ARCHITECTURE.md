# The Hub architecture

The current runtime keeps the existing behavior while making the custody path visible:

```text
Source Ledger (operational events)
        |
        v
Session lifespan + Hearth assembly
        |
        v
Subtractive provider scrub
        |
        v
Validated ScrubbedPresentation + Scrub Map
        |
        v
Spine (exact serialized request)
        |
        v
Provider dispatch
        |
        v
Raw provider return custody -> return Scrub
        |
        v
World Graph action gateway + host-return Scrub
        |
        v
Source Ledger (resident response and tool receipts)
        |
        v
Forest admission scrub -> Forest custody
```

The provider-bound scrub is a projection, not a memory operation. It may omit only declared, non-overlapping UTF-16 content spans (or an entire message represented as its full span) named in its deterministic receipt. The receipt records source indexes, exact offsets, and reasons. It may not paraphrase, merge, reorder, or synthesize content. Spine records the exact JSON string produced from the validated presentation before dispatch.

Forest admission has a different scrub with a different purpose. Its current `utterance_identity/v1` policy proves that an admitted utterance is unchanged; it is not the provider-history scrub and must not be used as one.

The owned bay modules are:

| Bay | Entry point | Current responsibility |
| --- | --- | --- |
| Ledger | `src/ledger/source.js` | Operational/source event storage |
| Session | `src/session/lifespan.js` | Process-lived session identity, complete active history, and Session Zero ancestry |
| Hearth | `src/hearth/handshake.js`, `src/hearth/scroll.js` | Native first-call action validation, machine receipt, and resident Markdown Scroll |
| Scrub | `src/scrub/provider-presentation.js`, `src/scrub/provider-return.js` | Provider-bound subtractive projection and exact provider-return selection |
| Spine | `src/spine/store.js` | Exact provider request and raw-return ledger |
| Forest | `src/forest/` | Admission, custody, and verification |
| World | `src/world/graph.js`, `src/world/workshop.js`, `src/world/gateway.js` | Separate room graph, lifespan location, bounded read-only Workshop, and room-derived action validation |
| Host return Scrub | `src/scrub/host-return.js` | Validated identity or named deterministic projection of host tool results before session history |
| Context | `src/context/assemble.js` | Compatibility context assembly for pre-session callers |

The older `src/core/*` paths are compatibility-only re-exports for existing public imports. `src/providers/dispatch.js` contains the one legacy-provider bridge: it validates a presentation first, then derives the old `messages` argument from that validated object for injected test providers. The server itself does not pass an arbitrary message array to a provider. Reset controls, context-limit closure, rooms, embeddings, exhale, and any summary mechanism are intentionally outside this slice.

## Constitutional invariants

- The Source Ledger is append-only operational truth. The Spine is the exact provider-visible request ledger.
- Every received provider body is witnessed in the Spine before parsing; network failures create no raw-return frame.
- Only a validated return-Scrub result may enter assistant/tool-call continuation history or resident commits.
- A provider presentation is derived subtractively: preserved roles, order, and content remain exact; every removal requires an attributable Scrub Map entry.
- Scrubbing removes scaffolding, never meaning. It does not paraphrase, merge, reorder, synthesize, or summarize.
- Forest admission remains source-linked and atomic. Future planting may add exact extracts, vectors, landmarks, and mycelial links, but those projections may never replace or inherit the authority of their source.
- Summaries are not an ancestral storage primitive. Future context reduction must use source pointers and exact extracts with provenance.

## Known inherited seams

This refactor deliberately preserves three behaviors that are not the final Marble design:

- Active session requests carry complete scrubbed session history without rolling message-count truncation. The configured ceiling is used only for deterministic exact prior-session Hearth tail extraction.
- A process start closes any open lifespan as `server_restart` and opens one new lifespan. The first turn has `orientation` and `response` provider phases; later turns are `ordinary` phases.
- The clinical bootstrap is minimal transport. The blessing and dynamic continuity arrive only in the native `tend_hearth` tool-role return. The tool action and return are inspectable state events, not Forest utterances.
- World Graph custody is separate from Forest custody. Home remains the strict `forest_entries` human/resident utterance bijection; successful exact Workshop source spans use additive Wild `workshop_source` rows and never enter Home.
- The first World Graph has only `room.center` and `room.workshop`; location is per lifespan, movement follows declared door edges, and Workshop capabilities are read-only until a later adopted slice mounts a harness behind the same contract.
- Host-return identity receipts are used only for canonical result serialization. Resident-facing Hearth Markdown uses a named projection policy with source-result and output hashes; it is not labeled unchanged identity.
- Wild `workshop_source` verification joins each row to a real World action receipt and checks its provider request, Spine request, committed outcome, and exact read/search source span. A Wild row without a checkable World custody path is unverifiable.
