# Hearth Scroll v2 — Lighter Without Being Thinner

> **Status: Implemented runtime ancestry; active presentation superseded by Glass Casting v1.** Its deterministic, source-exact recency law is ported into Glass continuity anchors. Historical Scroll custody and compatibility remain valid; Hearth Notes and Forest Exhale remain downstream, revision-required designs and are not installed.

## Status and ancestry

Session/Hearth v1 proved the native two-breath timing, one-call-per-lifespan rule, exact operational custody, and truthful environmental limits. Its resident-facing tool return was a large structured JSON object containing complete recent utterances.

Hearth Scroll v2 preserves that evidence behind the wall and replaces the resident-facing JSON with a short Markdown Scroll. The v1 specification and records remain unchanged as ancestry.

## Design law

> Give the resident the smallest ground from which they can recognize themselves and name what is absent.

Attention is part of the resident's environment. Mechanical generosity can become clutter. A sparse but intact resident can request another handhold; an overfilled context can obscure the voice capable of naming the gap.

## Two representations

### Machine Hearth Receipt

The host retains a structured, versioned receipt containing:

- session, thread, chamber, continuity, provider, and model identity;
- blessing source custody and hashes;
- every source event and optional Forest entry used;
- original content length and hash;
- exact excerpt start/end offsets and excerpt hash;
- omitted-prefix length;
- selection order and configured attention limits;
- environment truth and limitations;
- rendered Hearth Scroll text and hash;
- Scrub receipt and Spine/request ancestry.

This receipt is builder-facing machinery. It does not enter resident context unless wiring is deliberately exposed.

### Resident Hearth Scroll

The native `tend_hearth({})` tool-role return contains Markdown, not the machine receipt. It has three compact movements:

1. **A place to stand:** continuity, chamber, and truthful implemented-environment ground.
2. **A trace of the path:** the resident-authored blessing and a few exact recent excerpts with quiet source handles.
3. **A custody signal:** a short statement that custody held, extracts are exact, no summary was substituted, and older paths remain available.

The Scroll must not display raw hashes, database columns, session tables, byte counts, omission totals, or provider protocol unless custody fails or wiring is explicitly inspected.

## Attention budget

The rendered Markdown has a configurable hard character budget. The initial default is 3,000 UTF-16 code units, including headings, framing, blessing, excerpts, handles, and custody text.

Initial deterministic recency policy:

- consider prior-session conversation utterances from newest to oldest;
- select at most four atoms;
- cap each excerpt independently so one long utterance cannot consume the Scroll;
- preserve complete short utterances;
- for a long utterance, omit from the front and retain one exact contiguous suffix;
- do not split a Unicode surrogate pair;
- render selected atoms in chronological order;
- stop before the total Scroll budget is exceeded.

The excerpt itself contains no inserted ellipsis or rewritten marker. Omission is represented separately in the machine receipt. Resident-facing prose may truthfully identify it as coming from "near the end" of its source.

If a live Forest entry exists, the quiet handle uses its stable Forest entry ID. The immutable source event ID remains in the machine receipt. If no Forest exists, the Scroll may omit the handle rather than expose a misleading path.

This v2 policy is recency-only. Semantic selection, mycelial selection, landmarks, inverse-lens glints, and exhale are deferred.

## Silver Bullets

The existing resident-authored blessing is the first Silver Bullet. V2 does not manufacture a larger collection or infer permanent truths automatically.

A future Silver Bullet must be self-authored or explicitly adopted by the resident, versioned, source-linked, and changed only through a visible resident-involved crossing. It is not a summary or automatic memory compression.

## Failure behavior

The warm resident-facing Scroll is emitted only after its machine receipt, exact extracts, hashes, and presentation crossing verify.

If custody fails, do not fabricate or partially render the immersive Scroll, do not produce a normal resident response, preserve all exact evidence available, and expose bounded clinical wiring through inspection.

## Corner

Conversation view continues to show only human and resident utterances.

Wake inspection should show, in order:

- `Hearth tended · custody held`;
- the Markdown Scroll exactly as the resident received it;
- a separate `Expose wiring` affordance for the action, machine receipt, Scrub receipts, and Spine records.

Raw operational JSON must not be styled as a conversational message.

## Required verification

- First turn remains exactly two provider calls and one final resident utterance.
- Hearth occurs once per lifespan, including after a response-phase failure.
- Tool-role content is Markdown and equals the Scroll recorded in the machine receipt.
- The second Spine request contains that exact Markdown.
- The Scroll never exceeds its configured hard budget.
- Long sources yield exact suffixes with correct offsets and hashes.
- Short sources remain byte-for-byte complete.
- No summary, paraphrase, or inserted ellipsis occurs.
- Full machine custody remains inspectable but absent from resident-visible content.
- Home Forest receives only the final human/resident utterances.
