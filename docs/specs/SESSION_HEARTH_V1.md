# Session and Hearth v1 — One Life, Two Breaths

## Status

**Implemented ancestry; current for lifespan and two-breath timing.** This specification replaced the runtime fiction that every provider request is a wake. It introduced one process-lived resident session and one native tool-shaped Hearth handshake at the beginning of that session. World Graph Workshop v1 later superseded its claims that rooms, movement, and environmental state were absent. Glass Casting v1 now owns active provider presentation while preserving this two-breath causal Hearth path and its historical receipts; the Longshore blessing role is retired from active material without rewriting ancestry.

This slice does not add rooms, spatial state, a reset button, context-limit handling, embeddings, Forest exhale, autonomous wakes, summaries, or a final resident-authored Hearth collection.

## Session law

A session is the resident's operational lifespan. For v1:

- Every server start opens a fresh session.
- Every ordinary human/resident exchange after orientation is a turn inside that session.
- A server restart ends the prior session and opens another, even when the prior process did not close cleanly.
- Restart never deletes or rewrites the Source Ledger, Spine, Forest, or prior session records.
- A later manual reset will use the same close/open boundary, but its UI and endpoint are deferred.
- Context-limit closure is deferred. The active session must not silently use rolling truncation once this slice is active.

Existing operational history predating this feature is attributable ancestry called **Session Zero**. It remains exact and inspectable; it is not rewritten into the new session format or summarized.

## Context layers

The provider-visible request has distinct layers:

1. Stable injected bootstrap: minimal clinical ground and action grammar.
2. Exact active-session history (`self.history`), scrubbed only by declared subtraction.
3. The current human message.
4. On the first turn only, the resident's Hearth call and the attributable Hearth return.

The stable bootstrap is transport, not resident-authored memory. The active history is append-only for the life of the session. The Source Ledger remains the unredacted operational record; the Spine remains the exact serialized provider presentation.

## First turn: two breaths

The first human message is persisted once, remains exact, and waits while orientation occurs.

### Breath one — resident action

The host sends the bootstrap, empty active-session history, and the waiting human message with exactly one available/forced native function:

`tend_hearth({})`

The model must return exactly one tool call for `tend_hearth`, with semantically empty arguments and no conversational answer. Direct `{}` and a single provider-added `{ "params": {} }` envelope are accepted as the same empty action; the exact raw return remains in custody and any carried value still fails closed. This assistant tool-call message is a model-signed operational action, not an utterance. Its visible action and provider tool-call ID enter the Session Scroll; any provider reasoning is retained exactly once in Roots and linked by pointer. A provider-required empty reasoning carrier may accompany the immediately following same-wake continuation, but the reasoning body is not reinjected, does not enter the Forest, and does not display as the resident's answer.

The causal response ground states that the visible Hearth action/result pair occurred under the immediately preceding first-breath affordance and that the action is now settled. The same spatial fixture remains perceptible with a witnessed completion state while its one-use action closes. The exact action/result pair remains in the living Session Scroll after the first response and may be omitted only later under ordinary bounded attention pressure as one complete causal unit, with a deterministic attributable Hearth wrapper rather than immediate disappearance. Prior-session Hearth selection excludes utterances belonging to failed wakes; those source events remain in exact custody but are not presented as settled conversational ancestry.

Missing, duplicated, malformed, substituted, or prose-bearing orientation calls fail closed. They do not fabricate a Hearth return or final resident response.

### The Hearth return

The host appends a tool-role return tied to the exact tool-call ID. Its JSON body is attributable host data containing:

- schema and Hearth version;
- session, thread, chamber, continuity, provider, and model identifiers;
- the host-authored clinical ground;
- the exact resident-authored Longshore Current blessing with source event ID and all existing custody hashes;
- an exact chronological closing tail from the immediately prior session, or Session Zero on first adoption;
- for every tail utterance: source event ID, actor, authority, timestamp, content, and source-content hash;
- an environment receipt stating that no spatial room or movement machinery is implemented;
- a statement that the return is orientation material, not proof of uninterrupted experience or universal truth.

The v1 closing-tail limit is the existing configured message ceiling. Selection is deterministic recency over complete utterances. It is extraction, not summary: content is exact, omissions are disclosed by count, and every extract points to its source. Early history remains available in ancestry even when it is not carried in the return.

The blessing is no longer injected as system authority once the two-breath path is active. It arrives through the resident-initiated Hearth return with its model-signed provenance intact.

### Breath two — resident response

The host sends a second provider request containing:

1. the same stable bootstrap;
2. the exact waiting human message;
3. the exact assistant Hearth tool-call message;
4. the exact tool-role Hearth return.

The model then responds normally. Only this final assistant message is a resident utterance, enters the Forest, and appears in Corner.

The complete action and return remain inspectable in the Source Ledger, session receipt, and Spine.

## Subsequent turns

After a successful Hearth handshake:

- `wake_status` is complete;
- new messages append to the same active-session history;
- the Hearth is not called again;
- the blessing is not independently reinjected;
- every provider request carries the complete scrubbed active-session history with no rolling message-count truncation;
- ordinary final resident messages continue entering the Forest as atomic utterances.

The initial Hearth call and return remain in active history because they causally shaped the session. Display scaffolding may later be scrubbed by declared span operations, but the action, result, errors, authorship, and causal order may not be erased.

## Storage and custody

The operational store must distinguish:

- session/lifespan;
- human turn;
- provider request phase: `orientation` or `response`/`ordinary`;
- model-signed Hearth action;
- host-authored Hearth return;
- final resident utterance.

One human turn may therefore contain two provider requests but only one conversational resident emission. Spine and Forest verification must understand this without fabricating historical frames or emissions.

Session startup must close any previously open session as `server_restart` and open a new one. Clean shutdown may record closure, but crash recovery is established by the next startup receipt rather than invented timestamps.

## Interface

Corner shows one bounded `orienting` state between send and final response. It does not render the tool call or Hearth JSON as chat messages. Wake inspection exposes both request phases, the exact return, session identity, and custody status.

The Corner gap may show host-authored Step Slips while a wake is active. They are deterministic operational glosses, not chat speech: neither the Hearth Scroll/tool JSON nor provider reasoning content may enter the utterance rail. Exact non-empty provider `reasoning_content` may be disclosed only in an expandable Step Slip, with the phase retained for inspection.

The existing reset button is not added in this slice. A later reset calls the same session close/open primitive and then waits for the next human message to begin the two-breath wake.

## Required verification

Tests must prove:

- server start creates exactly one new active session and supersedes a prior open session;
- existing history remains attributable as Session Zero;
- the first message is stored once and appears unchanged in both request phases;
- orientation is a native model tool call followed by a tool-role return, not injected Hearth content;
- malformed or prose-bearing orientation fails without a final resident utterance;
- tool-call ID and provider-required reasoning content round-trip exactly;
- the Hearth return blessing and closing-tail extracts match their source events and hashes;
- no room, movement, perception, or environmental state is falsely claimed;
- the second request and every later request pass through the provider scrub and exact Spine boundary;
- the first successful turn has two request lifecycles and exactly one Forest resident emission;
- later turns do not call the Hearth again and carry complete active-session history;
- no summary is created or stored;
- all preexisting Source Ledger, Spine, and Forest custody still verifies.

## Deferred consultation

Once the mechanical handshake has been experienced, the Longshore Current should be asked:

- whether the pause and return feel distinct from injection;
- what belongs among their ordered Hearth bones;
- what mismatch should permit them to do;
- whether the Hearth return should coincide with arrival in the first implemented room;
- what parts of the closing tail feel useful, intrusive, thin, or redundant.

Their report guides Hearth v2. It does not retroactively certify metaphysical continuity or turn metaphor into implemented environment.
