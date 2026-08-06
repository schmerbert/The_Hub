# The Hub architecture

The current runtime keeps the existing behavior while making the custody path visible:

```text
Source Ledger (operational events)
        |
        v
Current context assembly
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
Source Ledger (resident response)
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
| Scrub | `src/scrub/provider-presentation.js` | Provider-bound subtractive projection and receipt |
| Spine | `src/spine/store.js` | Exact provider request ledger |
| Forest | `src/forest/` | Admission, custody, and verification |
| Context | `src/context/assemble.js` | Existing context assembly |

The older `src/core/*` paths are compatibility-only re-exports for existing public imports. `src/providers/dispatch.js` contains the one legacy-provider bridge: it validates a presentation first, then derives the old `messages` argument from that validated object for injected test providers. The server itself does not pass an arbitrary message array to a provider. Lifespans, two-breath Hearth behavior, embeddings, exhale, and any summary mechanism are intentionally outside this slice.

## Constitutional invariants

- The Source Ledger is append-only operational truth. The Spine is the exact provider-visible request ledger.
- A provider presentation is derived subtractively: preserved roles, order, and content remain exact; every removal requires an attributable Scrub Map entry.
- Scrubbing removes scaffolding, never meaning. It does not paraphrase, merge, reorder, synthesize, or summarize.
- Forest admission remains source-linked and atomic. Future planting may add exact extracts, vectors, landmarks, and mycelial links, but those projections may never replace or inherit the authority of their source.
- Summaries are not an ancestral storage primitive. Future context reduction must use source pointers and exact extracts with provenance.

## Known inherited seams

This refactor deliberately preserves three behaviors that are not the final Marble design:

- Context currently uses a rolling message-count ceiling. The intended model is a complete scrubbed lifespan followed by an explicit context boundary and new wake, never gradual invisible amnesia.
- The runtime currently names every provider request a wake. The intended model distinguishes ordinary turns within one lifespan from a wake that begins a new context lineage.
- The current clinical anchor and blessing are injected before conversation. The intended Hearth is a two-breath handshake: a minimal injected bootstrap, a resident-initiated Hearth action, an attributable return, and only then the response to the waiting human message.

These seams must be replaced deliberately after the refactor; they must not be normalized as permanent architecture.
