# Marble Circulation Map

> **Status: Active architecture map.** This page is the compact clinical index of how material and authority move through the Hub. Detailed laws remain in the linked specifications and executable modules. Any new source, sink, store, or crossing must update this map and add a bypass test.

The map exists so the system's shape does not depend on anyone holding every subsystem in working memory. It names the one crossing responsible for each kind of movement and the durable evidence that proves the crossing occurred.

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

The provisional display branch is deliberately terminal: provisional thinking, content, and tool-name deltas may reach Corner after credential suppression, but never enter session history, Forest, tool execution, or a later provider request.

## Crossing register

| Movement | Sole gate | Durable proof | Destination |
| --- | --- | --- | --- |
| Human utterance enters host custody | HTTP wake validation + Source append | Source event | Active session assembly |
| Language enters a provider request | Glass validation + provider-presentation Scrub | Glass cast receipt, Scrub receipt, Spine request frame | Provider-visible messages |
| Capabilities enter a provider request | Ceiling catalog + room Patch Bay + attention fitting | Exact request body in Spine; mount/profile inspection | Provider-visible tool schemas |
| Provider bytes return | Capture ceiling + Spine admitted-body append | Spine raw-return frame and outcome | Provider-return Scrub |
| Provider return becomes tool intent or resident speech | Provider-return Scrub | Return Scrub receipt | Gateway or canonical history |
| Tool intent requests authority | World Gateway | Action receipt; approval receipt when applicable | World, Workshop, or refusal |
| World reality changes | Versioned World event reducer | Hash-linked World event and derived projection pointer | Verified materialized World |
| World becomes resident-visible ground | Drift verifier + actor-local perception + provider-presentation Scrub | World verification result, Glass source manifest, Scrub receipt, Spine | Glass living edge |
| Machine result continues the session | Result Rack when fitted + host-return Scrub | Exact result/artifact custody and host-return receipt | Tool-role history |
| Utterance enters continuity | Forest admission Scrub | Forest entry, admission receipt, Source link | Home jurisdiction |
| Outside source enters continuity | Typed Wild admission | Wild entry and action/source ancestry | Wild jurisdiction |
| Live activity reaches the interface | Append-before-broadcast wake journal | Hash-linked wake event | Corner display |

## Authority stores are not interchangeable

| Store | Answers one question |
| --- | --- |
| Source | What operational or conversational event occurred? |
| World event journal | What causally changed material reality? |
| World projection | What is the verified current material state? |
| Forest | What exact material has been planted for continuity and linkage? |
| Glass receipt | What source bands were composed for this provider phase? |
| Spine | What exact bytes crossed the provider boundary? |
| Result Rack | What exact machine result or artifact was retained? |
| Wake event journal | What safe live display events were published, and in what order? |

A pointer may connect stores. One store must never be treated as a substitute for another. A resident statement does not mutate World; a World projection does not become Forest merely because it was shown; a Corner card does not prove provider or action custody.

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

1. The exact tool bundle is visible in the Spine request, but a distinct persisted Ceiling/Patch Bay mount receipt is not yet stored beside each Glass cast.
2. Forest utterance admission uses its own identity Scrub implementation rather than one central Scrub policy registry.
3. Resident journal admission, the `home/journal` bucket, Backpack custody, and Silver Bullet forging are not implemented.
4. Automatic reconciliation of a durable `applying` approval after an uncertain external effect is not installed; the state remains visible and non-retryable for future Builder reconciliation.
5. World verification produces bounded diagnostics but still scans and replays the complete store; adversarially enormous stores do not yet have a CPU/time preflight ceiling.
6. Autonomous wakes, outside channels, browser/Web capability, MCP capability doors, and general connector ingress do not yet exist.

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

If any answer is absent, the pipe is not installed.
