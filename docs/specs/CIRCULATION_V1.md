# Circulation v1 — No Unwitnessed Crossing

## Status and scope

This specification is adopted for the next Hub slice. It extends, rather than rewrites, the completed Session/Hearth v1 implementation.

Circulation v1 adds:

- exact provider-return custody in the Spine;
- a mandatory Scrub crossing for every provider-visible input and every provider return selected for active history;
- stable pointers between raw returns, scrub receipts, cleaned session history, and later semantic admissions;
- Hearth Scroll v2 as the first resident-facing consumer of the circulation system.

It does not add rooms, Wild storage, a general bucket registry, exhale, context-limit closure, autonomous wakes, inverse-lens computation, the Faun, trinkets, or fairies.

## Constitutional law

> No-op is still witnessed.

No material may enter the resident's provider-visible context without passing through Scrub. A crossing that removes nothing still produces a deterministic identity receipt. No provider return may enter cleaned session history merely because an adapter parsed it successfully.

Scrub is a custody membrane, not a summarizer. It may:

- pass a value unchanged;
- select an exact structured subtree;
- omit declared exact message or content spans;
- extract a declared exact contiguous span;
- refuse the crossing.

It may not paraphrase, merge, reorder, improve, interpret, or summarize substantive material.

## Scroll and Spine

The Scroll and Spine are two views of one append-only evidentiary structure:

- **Scroll record:** the exact data-bearing record of what crossed, including serialized requests and raw provider returns.
- **Spine:** the hash-linked ordering, identity, lifecycle, and custody of those records.

Circulation v1 may continue using the existing append-only Spine JSONL as the physical store. A data-bearing frame is addressable by stable record ID and carries exact byte length and SHA-256. Line numbers may be displayed for people but are not authoritative pointers.

For each provider call, the Spine must distinguish:

1. exact request prepared;
2. dispatch attempted;
3. exact raw return observed, when any response body arrived;
4. typed provider outcome.

A network failure may have no return record. Invalid JSON, an invalid response shape, an empty response, or a failed Hearth action may still have an exact raw-return record if bytes arrived.

Secrets remain excluded. Authorization values and API keys must never enter Scroll or Spine records.

## Return crossing

The provider adapter must expose the exact raw response body to the Spine before JSON parsing or semantic validation can discard it.

The return-side Scrub then:

1. verifies the raw-body pointer, byte length, and hash;
2. parses without changing the recorded bytes;
3. selects the exact provider assistant-message subtree;
4. preserves every selected provider field required for correct continuation, including tool calls and provider-required reasoning fields;
5. produces a versioned receipt naming the structured selection and input/output hashes;
6. yields the only message object eligible to enter cleaned session history.

Transport envelope fields omitted by exact subtree selection remain available through the Scroll pointer. Selection does not grant authority or make the message a Forest utterance.

## Input crossing

Every request presentation is assembled from source-linked internal messages and passed through the provider-presentation Scrub. This includes minimal system ground, human and resident messages, assistant tool calls, host tool-role returns, and future Forest, room, or external material.

Only a validated `ScrubbedPresentation` may be serialized for dispatch. The Spine request body must match it exactly.

## History and pointers

Cleaned session-history rows retain internal custody metadata that is not automatically serialized to the provider:

- source event ID, when applicable;
- source Scroll/Spine record ID;
- Scrub receipt ID;
- exact cleaned message JSON and hash;
- classification (`user`, `resident`, `assistant_tool_call`, or `tool_result`).

Provider-visible serialization crosses Scrub again. Internal pointers do not leak into model context unless a deliberate resident-facing view includes them.

If a raw return later becomes unavailable, the system must not reconstruct it. Remaining pointers, hashes, cleaned projections, semantic extracts, and downstream edges describe the gap honestly.

## Forest boundary

Circulation does not imply Forest admission.

- Final human and resident conversation utterances remain eligible for the current Home Forest.
- Hearth actions, Hearth returns, reasoning fields, response envelopes, failures, Scrub receipts, and Spine frames remain machinery.
- Future substantive tool results may be admitted to a Wild bucket by a separate explicit policy.

The current Home Forest must remain bijective with eligible human/resident utterances throughout this slice.

## Required verification

- Every successful provider request has one exact prepared-request record.
- Every received HTTP body has one exact raw-return record, including invalid or refused returns.
- Network failures do not fabricate return bodies.
- Raw-return bytes, lengths, hashes, request ancestry, and lifecycle order verify.
- Only return-scrub outputs enter cleaned session history.
- Structured tool calls and required reasoning content survive exact selection.
- No provider-visible request bypasses the presentation Scrub.
- Existing pre-return-custody Spine frames remain valid ancestry.
- Live Home Forest counts and source bijection remain unchanged by migration and verification.

