# Glass Trace Epoch v1

> **Status: Adopted and implemented for new Glass casts.** Historical casts remain exact and may have partial ancestry. This boundary adds no invented witnesses to them.

## Promise

After `glass_trace_boundary/v1`, every source message considered by Glass has a resolvable authority witness and an explicit terminal disposition: presented to the provider at an exact ordinal, or omitted by Scrub for an exact reason.

The resulting path is inspectable in both directions:

```text
authority -> ground/Scroll/Source witness -> Glass source ordinal
          -> Scrub disposition -> provider message ordinal -> Spine request
```

The trace is clinical custody. It does not claim that a sentence is true merely because its path is complete.

## Forward boundary

The append-only singleton boundary records the number and exact last hash of pre-boundary Glass casts. Those casts are not backfilled. Fresh Source stores establish an empty-history boundary. Existing stores cross through `npm run glass-trace:establish` after a recoverable backup.

## Ground receipts

Each closure-era provider request retains five append-only ground receipts:

| Receipt | Exact witness |
| --- | --- |
| Crossing | Session, wake, phase, provider, requested model, thinking mode, and lifespan |
| World | Verified journal head, projector version, projection hash, and exact presence-message hash |
| Tool mount | Room, World mount profile, fitted resident profile, schema count, and ordered schema hashes |
| Attention | Persisted attention receipt ID/hash, status, and exact omission plan |
| Continuity | Active continuity mode and inheritance receipt hash when present |

Stable Glass is code-owned and resolves through its version and exact content hash rather than a ground receipt.

## Per-item closure

Every manifest item records:

- source index and Glass kind;
- authority label and exact provider-message hash;
- one resolvable source:
  - code-owned stable Glass version/hash;
  - ground receipt ID/hash;
  - exact Session Scroll row ID, session, and ordinal; or
  - Source event ID and content hash;
- `presented` with exact provider ordinal, or `omitted` with the Scrub reason.

The manifest binds the Glass cast receipt and exact provider request body hash. Ground receipts, cast receipt, and trace manifest commit atomically. A partial closure-era Glass bundle cannot be admitted.

## Verification and inspection

Before every wake, verification checks boundary hashes, append-only triggers, one manifest per closure-era cast, manifest hashes and cast bindings, and resolution of every ground, Scroll, and Source pointer. Drift refuses the wake.

Wake inspection exposes `glassTrace` and `glassGroundReceipts` for every provider phase. This is the durable substrate for a later sentence-level “follow this packet” interface; that interface is not part of this slice.
