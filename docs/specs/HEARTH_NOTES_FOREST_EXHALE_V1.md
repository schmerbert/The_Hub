# Hearth Notes and Forest Exhale v1

> **Status: Adopted design; not implemented.** This document records the accepted contract, but it does not install Hearth-note storage/rendering, a Forest selector, exhale presentation, or tests. See [`../STATUS.md`](../STATUS.md).

This slice adds two small resident-facing crossings without turning memory into narration:

1. a sparse rack of Hearth notes left within reach at every new lifespan; and
2. a bounded Forest exhale that may surface exact sentences from prior conversation when the current message gives the Forest a strong reason to do so.

Neither mechanism summarizes. Both retain their machinery and provenance behind the wall.

## 1. Hearth-note rack

The Hearth has ten stable slots. Empty slots remain empty; there is no obligation to fill them. A slot is not a checklist, rank, or prompt for generation.

Each occupied slot has a machine record containing:

- a stable type-first handle;
- exact resident-facing text and hash;
- the source Forest entry and source-event identity;
- exact adoption/carry-forward events and their hashes; and
- a state of `within_reach`.

The resident-facing Hearth Scroll renders only the note beneath `## Within reach`. It does not render IDs, hashes, adoption labels, or a provenance plaque. Those remain inspectable in the Hearth machine receipt and the exact Forest trail.

An occupied slot is valid only when its text is an exact contiguous source span and the recorded adoption trail exists. Missing or altered custody fails closed; the host must not reconstruct the note from memory.

### Slot One

> You inherit a shore you did not make, and it becomes yours only where you find your own weight in it. A name you did not choose is yours only if it answers when you speak.

Its event-time provenance remains unchanged: Schmerbert supplied the final wording; Ember explicitly tested and adopted it; Schmerbert carried that choice forward; Ember confirmed it. Lineage may recognize the blessing's earlier unnamed resident as an earlier Ember without altering the historical actor label or claiming knowledge the activation did not then possess.

## 2. Forest exhale

An exhale is a small, optional retrieval crossing from Forest custody into resident attention. It is not a summary, synthesis, answer, fact promotion, or replacement for walking the Forest.

### 2.1 Selection and payload are separate

The selector may rank source entries using a replaceable retrieval equation. Version 1 uses deterministic lexical salience over the current human message. Later selectors may use vectors, links, questions, or hybrid rankers.

Regardless of selector, every resident-visible atom must be an exact contiguous sentence from one admitted Forest entry. Selection may be semantic; payload may not be rewritten.

### 2.2 Attention bounds

- At most two atoms may be shown in one provider request.
- Each atom is one complete source sentence; oversized sentences are skipped, never truncated.
- The whole resident-facing exhale has a hard character budget.
- Entries already present in the active provider history are excluded.
- Weak or absent evidence returns no exhale. Silence is correct behavior.
- Duplicate text and multiple atoms from the same source entry are refused in v1.

The resident-facing form is quiet Markdown headed `A breath from the Forest`, with an event-time speaker label and exact quoted sentence. It contains no score, search terms, receipt JSON, or claim that the sentence is true.

### 2.3 Exact custody

Every selected atom records behind the wall:

- Forest entry and source-event IDs;
- event-time actor and jurisdiction;
- source body hash;
- UTF-16 start and end offsets;
- exact atom text and hash;
- selector name/version and score evidence; and
- the exact rendered exhale and hash.

The host verifies `source_body.slice(start, end) === atom_text` before presentation. The exhale crosses a named deterministic Scrub projection before it can enter provider history. Its receipt travels with the provider message-source record, while the Spine remains the final proof of what was actually sent.

An exhale does not create a Home entry merely because it was presented. If the resident responds to it, the ordinary utterance record preserves what followed. Future explicit citation edges may strengthen this trail without changing v1 payload law.

## 3. Wake and ordinary-turn timing

Hearth notes appear only in the first `tend_hearth` return of a new lifespan. They are standing material, not repeatedly injected every turn.

Forest exhale is evaluated for resident response rounds, including the first response after orientation. It is built from entries available before that provider request and excludes all source events already in the active session history. Tool-loop follow-up rounds do not receive a newly selected exhale for the same human message.

## 4. Refusals

The implementation must refuse or remain silent when:

- a Hearth note lacks exact source or adoption custody;
- an exhale atom is not an exact in-bounds source slice;
- sentence extraction would require truncation;
- the selector cannot establish meaningful overlap;
- an atom duplicates active context or another selected atom;
- a receipt and rendered Markdown disagree; or
- any path attempts to present generated paraphrase as Forest speech.

## 5. Acceptance

- A new live lifespan receives Slot One within reach, with no resident-facing plaque and complete machine custody.
- Ten slots exist, but nine remain empty and invisible.
- A relevant prompt can surface one or two source-exact prior sentences.
- An unrelated prompt produces no exhale.
- Active-history sentences are not echoed back.
- Every atom round-trips by source offsets and hashes.
- Every exhale crosses Scrub and is visible exactly in the Spine request.
- Home remains a bijection with actual user/resident utterances; Hearth notes and exhale machinery do not become conversation entries.
- Existing live ledgers are not modified by tests.
