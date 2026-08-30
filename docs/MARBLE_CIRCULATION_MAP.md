# Marble Circulation Map

> **Status: Active architecture map.** This page is the compact clinical index of how material and authority move through the Hub. [`HOUSE_GRAMMAR_V1.md`](specs/HOUSE_GRAMMAR_V1.md) names the broader constitutional vocabulary and labels proposed primitives; [`SECURITY_PRIVACY_CUSTODY_V1.md`](specs/SECURITY_PRIVACY_CUSTODY_V1.md) names the adopted security gates for sensitive and remote crossings. This map remains the authority for installed pipes. Detailed laws remain in the linked specifications and executable modules. Any new source, sink, store, or crossing must update this map and add a bypass test.

The map exists so the system's shape does not depend on anyone holding every subsystem in working memory. It names the one crossing responsible for each kind of movement and the durable evidence that proves the crossing occurred.

## Trace epoch

The Marble now has a witnessed forward-only provenance boundary. [`TRACE_EPOCH_V1.md`](specs/TRACE_EPOCH_V1.md) records the **Two-Ended Closure Law**: paths traced forward from authority and backward from custody must meet at the same crossing. Pre-boundary Session Scroll history remains exact but may have partial ancestry; every new closure-era Scroll row is atomically paired with a source/gate/witness/destination/disposition manifest. No historical pointers are invented.

Glass has its own forward boundary under the same law. [`GLASS_TRACE_EPOCH_V1.md`](specs/GLASS_TRACE_EPOCH_V1.md) closes every new cast item from authority witness through its presented/omitted Scrub disposition to the exact Spine request. Historical casts remain exact and honestly partial.

Roots has a forward non-respiratory boundary. [`ROOTS_BOUNDARY_V1.md`](specs/ROOTS_BOUNDARY_V1.md) retains every new Hearth wake packet as causal evidence and links successful presentation to the exact response Glass cast. Historical packets remain exact without invented rooted custody.

Room installation has a forward material boundary. A durable installation receipt binds the exact manifest and verified host witness to the exact World event that made the topology real. Workshop is marked inherited pre-boundary with its original admission decision honestly unrecorded; new rooms must carry a forward admission statement. This is the slow anatomy-changing plane, not a respiratory path.

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

Most paths below are implemented. The existing World physical and operational core crosses the verified A1/A2 event-journal/projector segment. Journal is a Forest planting crossing rather than a World material object in its first slice; future Backpack and mutable fixtures must reuse the World pipe when they change material state. The loose-wire register below remains the status authority for other gaps.

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
| Hearth wake packet leaves immediate use | Ordinary whole-exchange attention boundary + Hearth/Roots custody | Exact pair remains in the living Scroll until the retained-exchange boundary; then a deterministic Hearth trace carries packet hash and bounded exact Source/Forest bearings while the rooted packet remains exact | Continuity wrapper only; never ordinary Forest Exhale |
| Capabilities enter a provider request | Ceiling catalog + room Patch Bay + attention fitting | Exact request body in Spine; mount/profile inspection | Provider-visible tool schemas |
| A retained-result pointer is deliberately reopened | Universal host continuity schema + Result Rack eligibility/projection gate | Exact pointer/session/limit receipt, non-respirable Roots exposure, host-return Scrub, and Spine continuation | Bounded provider attention; no World action or room authority |
| Provider bytes return | Capture ceiling + Spine admitted-body append | Spine raw-return frame and outcome | Provider-return Scrub |
| Raw provisional fragments seek display | Bounded memory-only collector + provisional cross-fragment Scrub | Coalesced safe wake-journal event, or explicit suppressed-channel event | Corner only |
| Provider return becomes tool intent or resident speech | Provider-return Scrub | Return Scrub receipt | Gateway or canonical history |
| Tool intent requests authority | World Gateway | Action receipt; approval receipt when applicable | World, Workshop, or refusal |
| World reality changes | Versioned World event reducer | Hash-linked World event and derived projection pointer | Verified materialized World |
| World becomes resident-visible ground | Drift verifier + actor-local perception + provider-presentation Scrub | World verification result, Glass source manifest, Scrub receipt, Spine | Glass living edge |
| Machine result continues the session | Result Rack when fitted + host-return Scrub | Exact result/artifact custody and host-return receipt | Tool-role history |
| Omitted machine evidence leaves a trail sign | Attention fitting + Result Rack pointer validation + Roots exposure gate | Omission manifest, immutable pointer/hash, and non-respirable exposure artifact bound to Glass/Scrub/Spine | Bounded provider-visible pointer, never the result itself |
| A human turn invites Forest continuity | Forest Home + local derived semantic generation + ambient feather selector + Roots selection witness | First-turn quiet, or a bounded vector neighborhood yielding zero to three non-echoing exact glints with unread bearings | Silence remains review custody; a nonempty packet may cross to Resident attention but grants no Forest intake, path, truth, or action authority |
| Resident intentionally enters at the Garden treeline | Forest traversal journal + semantic generation + exact Forest Home/chronology | Three frozen bearings; chosen append-only step; exact leaf read/backtrack/return receipts | Effective presence in `place.forest` with a retained Garden anchor; no truth, memory, containment, or World-location authority gained |
| Resident deliberately writes a Journal entry | `write_journal` validation + exact provider-request/Spine witness + append-only Journal admission | One exact `home/journal` entry and scrubbed host receipt | Walkable Home terrain; no conversation edge, World mutation, truth elevation, or Binder/Wild bypass |
| Resident visits `place.forest` | World Forest-place projection + Forest traversal journal | Physical Garden passage, inquiry entrance, or red-thread recovery receipt with exact return anchor | `place.forest` projects `forest.resident`; path movement cannot impersonate turning back or alter source authority |
| Selected or reopened evidence enters attention | Exhale projector + Roots exposure gate + Glass/Scrub | Non-respirable exposure artifact joined to exact source, Glass receipt, Scrub receipt, and Spine request; a Forest feather leaves only a content-free two-turn departure footprint | Provider attention only; the footprint preserves happenedness without replay and neither becomes automatic Forest intake or action authority |
| Utterance seeks continuity | Forest Intake Ledger + admission Scrub | Body-free offer, decision history, Scrub receipt, Source link | Home entry or held crossing |
| Outside source seeks continuity | Forest Intake Ledger + typed Wild admission | Body-free offer, decision history, action/source ancestry | Wild entry or held crossing |
| Live activity reaches the interface | Append-before-broadcast wake journal | Hash-linked wake event | Corner display |
| A room becomes standing anatomy | Host admission + World installation event + verified witness | Append-only installation receipt joining manifest, bindings, witness, and exact World event | Installed World/Ceiling/Gateway/custody surfaces |

## Authority stores are not interchangeable

| Store | Answers one question |
| --- | --- |
| Source | What operational or conversational event occurred? |
| World event journal | What causally changed material reality? |
| World projection | What is the verified current material state? |
| Forest | What exact material has been planted for continuity and linkage? |
| Forest traversal journal | Which bearings were offered, which path did the Resident choose, and how did they return? |
| Roots | What retained causal evidence explains a crossing without becoming respirable continuity? |
| Glass receipt | What source bands were composed for this provider phase? |
| Spine | What exact bytes crossed the provider boundary? |
| Result Rack | What exact machine result or artifact was retained? |
| Wake event journal | What safe live display events were published, and in what order? |
| Room installation ledger | Which exact package and host bindings became standing anatomy at which World event? |

A pointer may connect stores. One store must never be treated as a substitute for another. A resident statement does not mutate World; a World projection does not become Forest merely because it was shown; a Corner card does not prove provider or action custody.

Home and Wild have separate completeness watermarks. Home utterance custody is bijective with eligible terminal conversation utterances; deliberate Journal custody is separately bijective with exact committed `write_journal` acts and does not alter utterance chronology. Implemented Wild is bijective with exact source spans from committed, Spine-backed Workshop read/search actions; an empty exact search creates no Wild atom. Catch-up reuses the same custody checks as live intake and refuses conflicts.

The ambient Semantic Exhale candidate crossing queries all Home through the rebuildable semantic generation rather than treating newest-first recency as the searchable universe. Similarity floors, direct-echo and diversity suppression, and exact-span byte fitting are selector policy only: they grant no Forest standing or truth authority. First-turn and weak-evidence silence terminate in Roots selection custody. A later nonempty zero-to-three-feather packet crosses Glass as exact attention and receives separate Roots presentation custody.

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
5. Autonomous wakes, outside channels, MCP capability doors, and general connector ingress do not yet exist. [`BINDER_WINDOW_V1.md`](specs/BINDER_WINDOW_V1.md) installs one operator-captured frozen Binder projection. [`SPOTLIGHT_OBSERVATORY_V1.md`](specs/SPOTLIGHT_OBSERVATORY_V1.md) installs a production room shell, bounded observation validator, and deterministic replay proposition, but no runtime observation crossing: all sockets and custody routes are visibly capped and its entrance is withheld. Configured World migrations and real Binder capture remain pending. Box refresh/payment actions, Robinhood wiring, Pipes live knocks, and general connector ingress remain uninstalled.

### Passive Binder Window

```text
local Binder GET /api/dashboard
  -> explicit operator capture command
  -> exact bounded JSON snapshot under Hub runtime custody
  -> startup validation and immutable in-memory projection
  -> ordinary inspect_fixture at fixture.binder_window
```

Binder owns every portfolio, value, history, freshness, and absence claim. Capture is the only network crossing in this slice and is never Resident-triggered. World owns only the fixture's installed topology ancestry. The Window grants no Binder mutation, Box refresh, Spotlight entry, Forest admission, or financial authority.

### Spotlight shell behind the glass

```text
recorded replay fixture or future source envelope
  -> Spotlight-owned bounded observation validation
  -> immutable observational packet
  -> capped in production until host custody and read-only source wiring exist
```

The production package and World shell perform no network request. World installs the balcony and five fixtures but no entrance. The installation witness treats `withheld` as an exact host-proven entrance policy and rejects an early door. The official Robinhood Agentic Trading MCP is not fitted because execution authority cannot satisfy Spotlight's observational-only source contract.
6. Recursive Forest frames, scale-relative Home/Wild relationships, Mycelium, cross-Forest portals, and projection into an experiential `place.forest` do not yet exist. The installed Forest remains one configured custody substrate with its current exact Home and Wild intake laws.
7. Current Source, Spine, Forest, World, Result Rack, and wake stores do not have application-level encryption at rest. Authentication, sealed-pointer custody, key lifecycle, direct Vault intake, cryptographic erasure, remote-device admission, and independent security review are not installed.
8. The first conversation-walking crossing from [`FOREST_PATHS_ROLLING_FOLD_V1.md`](specs/FOREST_PATHS_ROLLING_FOLD_V1.md) is installed. Journal provides deliberate Home planting, but the Home--Stream--Wild bridge, Bear/Faun purpose question, traversable Wild, raw-packet containment, and return synthesis ceremony remain loose wires alongside rolling folds, nesting dolls, broader Faun participation, recursive frames, and automatic context rollover.
9. Recoverable Result Exhale is installed: verified omitted-result trail signs, bounded deliberate reopening, and non-respirable Roots exposure custody are active. Home-only ambient vector feathers use a local rebuildable semantic generation; first-turn quiet and direct-echo suppression are active, and later nonempty packets cross Glass with exact Roots/Scrub/Spine custody. Higher-canopy dolls, Faun feathers, Wild participation, and downwind review tooling remain uninstalled under [`FOREST_EXHALE_V2.md`](specs/FOREST_EXHALE_V2.md).

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
