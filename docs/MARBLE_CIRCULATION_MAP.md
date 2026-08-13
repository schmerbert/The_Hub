# Marble Circulation Map

> **Status: Active architecture map.** This page is the compact clinical index of how material and authority move through the Hub. [`HOUSE_GRAMMAR_V1.md`](specs/HOUSE_GRAMMAR_V1.md) names the broader constitutional vocabulary and labels proposed primitives; [`SECURITY_PRIVACY_CUSTODY_V1.md`](specs/SECURITY_PRIVACY_CUSTODY_V1.md) names the adopted security gates for sensitive and remote crossings. This map remains the authority for installed pipes. Detailed laws remain in the linked specifications and executable modules. Any new source, sink, store, or crossing must update this map and add a bypass test.

The map exists so the system's shape does not depend on anyone holding every subsystem in working memory. It names the one crossing responsible for each kind of movement and the durable evidence that proves the crossing occurred.

## Trace epoch

The Marble now has a witnessed forward-only provenance boundary. [`TRACE_EPOCH_V1.md`](specs/TRACE_EPOCH_V1.md) records the **Two-Ended Closure Law**: paths traced forward from authority and backward from custody must meet at the same crossing. Pre-boundary Session Scroll history remains exact but may have partial ancestry; every new closure-era Scroll row is atomically paired with a source/gate/witness/destination/disposition manifest. No historical pointers are invented.

Glass has its own forward boundary under the same law. [`GLASS_TRACE_EPOCH_V1.md`](specs/GLASS_TRACE_EPOCH_V1.md) closes every new cast item from authority witness through its presented/omitted Scrub disposition to the exact Spine request. Historical casts remain exact and honestly partial.

Roots has a forward non-respiratory boundary. [`ROOTS_BOUNDARY_V1.md`](specs/ROOTS_BOUNDARY_V1.md) retains every new Hearth wake packet as causal evidence and links successful presentation to the exact response Glass cast. Historical packets remain exact without invented rooted custody.

## One-passage law

No material enters resident attention, becomes resident speech, changes World reality, or enters continuity custody through an unnamed path.

- **Scrub** is the language membrane. Provider-bound messages, selected provider returns, host returns, and Forest admissions cross an installed Scrub policy even when the policy changes nothing.
- **Ceiling / Patch Bay** is the capability membrane. It selects the exact tool-schema bundle mounted by the current room and policy.
- **Provider request construction** is the join where validated language and validated capability bundles meet.
- **Spine** is the exact-byte witness of that joined provider request and the admitted provider return.
- **Gateway** is the action membrane. Provider intent cannot change World or Workshop state directly.
- **World events** are causal state authority. Materialized World tables and resident perception are derived projections and must verify against the event journal.
- **Forest admission** determines what becomes continuity material. Presentation alone does not plant anything.
- **Corner** is a display projection. It does not create resident truth or authority.

## Circulation shape

Most paths below are implemented. The existing World physical and operational core now crosses the verified A1/A2 event-journal/projector segment. Future House, Garden, Backpack, Journal, and mutable fixtures must reuse it; the loose-wire register below remains the status authority for other gaps.

```text
Human HTTP input
      |
      v
Source Ledger ------------------------------------------------------+
      |                                                             |
      | active utterances / exact prior material                    |
      v                                                             |
Glass composer <---- verified World perception <---- World projector|
      ^                         ^                         ^           |
      |                         |                         |           |
      +---- Forest sources      |                  World event journal
      +---- session history     |                         ^
                                |                         |
Glass source messages           |                  Gateway actions
      |                         |                         ^
      v                         |                         |
provider-presentation Scrub     |                 scrubbed tool intent
      |                         |                         ^
      +---- validated language bundle                       |
                                                             |
Ceiling -> room Patch Bay -> fitted tool schemas             |
      +---- validated capability bundle                      |
                                                             |
             provider request construction <-----------------+
                           |
                           v
                    Spine exact request
                           |
                           v
                        Provider
                           |
                           v
              bounded raw intake collector
              (memory only; request/phase/channel separated)
                           |
                           v
                 provisional stream Scrub
                           |
              +------------+-------------+
              |                          |
              v                          v
      safe provisional filter       Spine admitted return
              |                          |
              v                          v
       wake event journal        provider-return Scrub
              |                          |
              v                    +-----+------+
            Corner                 |            |
                              tool intent   resident speech
                                   |            |
                                   v            v
                                Gateway    Source + Forest
                                   |
                  +----------------+----------------+
                  |                                 |
                  v                                 v
           World event/result                Result Rack custody
                  |                                 |
                  +------------+--------------------+
                               v
                       host-return Scrub
                               |
                               v
                       session continuation
```

The provisional display branch is deliberately terminal. Raw provider fragments pause outside the Marble in a bounded memory-only collector. Consecutive fragments are coalesced only within one request, phase, kind, and tool index; channel changes flush in arrival order. Normal phase completion flushes, while failure or cancellation discards anything still paused. Only after the coalesced batch crosses provisional stream Scrub may safe thinking, content, and tool-name deltas enter the append-only wake journal and reach Corner. Raw fragments never enter SQLite, logs, Corner, session history, Forest, tool execution, or a later provider request. Corner folds arriving safe events into at most one render per animation frame.

## Crossing register

| Movement | Sole gate | Durable proof | Destination |
| --- | --- | --- | --- |
| Human utterance enters host custody | HTTP wake validation + Source append | Source event | Active session assembly |
| Closure-era utterance enters Session Scroll | Scroll trace boundary + atomic manifest insert | Append-only Scroll trace manifest linked to Source/Scrub/Spine witness | Exact chronological session custody |
| Language enters a provider request | Glass validation + provider-presentation Scrub | Glass cast receipt, Scrub receipt, Spine request frame | Provider-visible messages |
| Request-time ground enters Glass | Glass ground receipt + trace manifest | Crossing, World-head/projection, attention, continuity, and Patch Bay/schema receipts | Exact Glass source ordinal |
| Hearth wake packet leaves immediate use | Roots boundary + atomic Hearth custody | Root artifact, typed wake-packet coordinate, and optional response-Glass edge | Roots only; never ordinary Forest Exhale |
| Capabilities enter a provider request | Ceiling catalog + room Patch Bay + attention fitting | Exact request body in Spine; mount/profile inspection | Provider-visible tool schemas |
| Provider bytes return | Capture ceiling + Spine admitted-body append | Spine raw-return frame and outcome | Provider-return Scrub |
| Raw provisional fragments seek display | Bounded memory-only collector + provisional cross-fragment Scrub | Coalesced safe wake-journal event, or explicit suppressed-channel event | Corner only |
| Provider return becomes tool intent or resident speech | Provider-return Scrub | Return Scrub receipt | Gateway or canonical history |
| Tool intent requests authority | World Gateway | Action receipt; approval receipt when applicable | World, Workshop, or refusal |
| World reality changes | Versioned World event reducer | Hash-linked World event and derived projection pointer | Verified materialized World |
| World becomes resident-visible ground | Drift verifier + actor-local perception + provider-presentation Scrub | World verification result, Glass source manifest, Scrub receipt, Spine | Glass living edge |
| Machine result continues the session | Result Rack when fitted + host-return Scrub | Exact result/artifact custody and host-return receipt | Tool-role history |
| Utterance seeks continuity | Forest Intake Ledger + admission Scrub | Body-free offer, decision history, Scrub receipt, Source link | Home entry or held crossing |
| Outside source seeks continuity | Forest Intake Ledger + typed Wild admission | Body-free offer, decision history, action/source ancestry | Wild entry or held crossing |
| Live activity reaches the interface | Append-before-broadcast wake journal | Hash-linked wake event | Corner display |

## Authority stores are not interchangeable

| Store | Answers one question |
| --- | --- |
| Source | What operational or conversational event occurred? |
| World event journal | What causally changed material reality? |
| World projection | What is the verified current material state? |
| Forest | What exact material has been planted for continuity and linkage? |
| Roots | What retained causal evidence explains a crossing without becoming respirable continuity? |
| Glass receipt | What source bands were composed for this provider phase? |
| Spine | What exact bytes crossed the provider boundary? |
| Result Rack | What exact machine result or artifact was retained? |
| Wake event journal | What safe live display events were published, and in what order? |

A pointer may connect stores. One store must never be treated as a substitute for another. A resident statement does not mutate World; a World projection does not become Forest merely because it was shown; a Corner card does not prove provider or action custody.

Home and Wild have separate completeness watermarks. Home is bijective with eligible terminal conversation utterances. Implemented Wild is bijective with exact source spans from committed, Spine-backed Workshop read/search actions; an empty exact search creates no Wild atom. Catch-up reuses the same custody checks as live intake and refuses conflicts.

The Intake Ledger is not terrain. A held offer reserves its source identity and attempted chronological position at the crossing while adding no placeholder entry to Home or Wild. Repair retries the same immutable source; successful retry appends an admitted decision pointing at the real entry. Terminal resolution cannot be silently reopened.

## Visible bundles through the Ceiling

Room capability is a separate pipe from room description:

```text
complete installed Ceiling
        |
        v
room mount profile
        |
        v
policy/backend/attention fitting
        |
        v
exact tool bundle joined into the provider request
```

Leaving a room removes its bundle on the next provider phase. Remembered schemas do not retain authority; stale calls refuse at Gateway. Future capability doors must reuse this route rather than append ad hoc tools directly to provider requests.

## Current loose wires

These are tracked architecture gaps, not implied capabilities:

1. Forest utterance admission uses its own identity Scrub implementation rather than one central Scrub policy registry.
2. Resident journal admission, the `home/journal` bucket, Backpack custody, and Silver Bullet forging are not implemented.
3. Automatic reconciliation of a durable `applying` approval after an uncertain external effect is not installed; the state remains visible and non-retryable for future Builder reconciliation.
4. World verification produces bounded diagnostics but still scans and replays the complete store; adversarially enormous stores do not yet have a CPU/time preflight ceiling.
5. Autonomous wakes, outside channels, browser/Web capability, MCP capability doors, and general connector ingress do not yet exist.
6. Recursive Forest frames, scale-relative Home/Wild relationships, Mycelium, cross-Forest portals, and projection into an experiential `place.forest` do not yet exist. The installed Forest remains one configured custody substrate with its current exact Home and Wild intake laws.
7. Current Source, Spine, Forest, World, Result Rack, and wake stores do not have application-level encryption at rest. Authentication, sealed-pointer custody, key lifecycle, direct Vault intake, cryptographic erasure, remote-device admission, and independent security review are not installed.
8. The adopted [`FOREST_PATHS_ROLLING_FOLD_V1.md`](specs/FOREST_PATHS_ROLLING_FOLD_V1.md) waterfall and traversal crossings are not installed. Current attention fitting can omit declared older tool exchanges but cannot generate a rolling fold, lay Resident-chosen paths, preserve latent branch offers, enter Forest attention, or walk exact prior conversation terrain through a warm return tether.
9. Forest Exhale is absent. The provisional collector is installed and safe batches have hash-linked wake-journal custody, but they do not yet carry trace-epoch manifests joining their collector/Scrub disposition to the broader closure calendar.

Loose wires remain visible until a tested crossing removes them. Documentation must not smooth over them.

## Change rule

Every new pipe must answer all of these before implementation:

1. What exact material enters?
2. Which authority owns the source?
3. Which single gate validates the crossing?
4. What may be transformed or omitted?
5. What durable receipt proves the movement?
6. Which destination gains authority, and which destinations explicitly do not?
7. How does verification detect a bypass, leak, duplicate, stale projection, or broken link?
8. If Forest scale changes, which frame is active, which interior jurisdictions remain unchanged, and how is authority laundering prevented?
9. What security class applies, where is plaintext permitted, which key or device boundary protects it, and what residual copies remain after expiry or destruction?

If any answer is absent, the pipe is not installed.
