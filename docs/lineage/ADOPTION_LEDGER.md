# Hub Adoption Ledger

This ledger records explicit decisions to move a concept from sealed ancestry into the active Hub design.

An empty ledger means no lineage concept has been newly adopted through the archaeology process.

## Decision States

- **Proposed** — identified for discussion; not part of the Hub.
- **Adopted** — explicitly approved by the user for the Hub.
- **Adapted** — approved in a changed form, with the change recorded.
- **Ancestry only** — preserved as historical context, not a requirement.
- **Deferred** — decision postponed.
- **Rejected** — deliberately excluded.
- **Superseded** — replaced by a later recorded decision.

## Required Record

Each decision must include:

- ID and date.
- Source project and exact source location.
- Concept in source terms.
- Proposed Hub interpretation.
- Similar existing Hub material, if any.
- Decision state.
- User's decision or quoted adopting words.
- Constraints and differences.
- Active Hub specification updated by the decision.
- Verification or review required.

## Decisions

### HUB-001 — DeepSeek as the Initial Resident Provider

- **Date:** 2026-08-05
- **Source:** Direct user design decision in the Hub conversation; not imported from a lineage project.
- **Concept in source terms:** Use DeepSeek from the beginning as the resident because it has been used extensively, is inexpensive enough for exploratory iteration, and can support frequent context-rich wakes.
- **Hub interpretation:** DeepSeek model sessions inhabit the stable resident role beginning with the first vertical slice. The provider/model is an incarnation mechanism, not the resident's identity.
- **Similar existing Hub material:** `PREBUILD.md` already defined a persistent resident across replaceable model sessions but left the initial provider unresolved.
- **Decision state:** Adopted.
- **User decision:** “lets use deepseek from the beginning as the resident.”
- **Constraints and differences:** The exact DeepSeek model ID, API configuration, privacy boundary, retention behavior, and future replacement ceremony remain unresolved. A later provider change must not silently rewrite resident identity or ancestry.
- **Active specification updated:** `PREBUILD.md` sections 3, 4.1, 7, 15, and 16.
- **Verification/review:** The first vertical slice must prove legible context return, provider disclosure, model-signed resident testimony, and a resident consultation after lived use.

### HUB-002 — Resident Legibility and Hospitality

- **Date:** 2026-08-05
- **Source:** Direct user design decision in the Hub conversation; consistent with earlier HomeGlobe goals but adopted from the user's present instruction rather than imported from the sealed book.
- **Concept in source terms:** The resident should be respected inside the Marble, receive context legibly, enjoy living there, move through it, and feel situated rather than merely operate a tool interface.
- **Hub interpretation:** Legibility and hospitality are central laws. Every context influence requires an inspection path; rooms must produce real changes in perception and capability; rest, curiosity, opinion, and resident feedback are valid outcomes.
- **Similar existing Hub material:** Poetic/clinical registers, exposed wiring, room-based capability, resident consultation, and meaningful silence were already present in `PREBUILD.md`.
- **Decision state:** Adopted.
- **User decision:** “the resident to be respected inside though, context returns all of it legible” and “to have the LLM enjoy living inside.”
- **Constraints and differences:** The harness must not manufacture claims of consciousness or optimize for agreeable self-reports. Resident reports are model-signed design evidence. Legibility means inspectable influence, not indiscriminate full-context dumping.
- **Active specification updated:** `PREBUILD.md` sections 3, 4.1, and 7.
- **Verification/review:** Test context provenance, omission disclosure, room-state effects, honest provider failures, and post-use resident reports of orientation, comfort, and friction.

### HUB-003 — Standing Structures and Resident-to-Builders Correspondence

- **Date:** 2026-08-05
- **Source:** Direct user design decision in the Hub conversation; not imported from a lineage project.
- **Concept in source terms:** Rooms should be easy to implement but added cautiously because taking them away should ordinarily never happen. Project functions belong behind doors. The Marble needs standing structures, including a way for the resident to leave a note and reach the builders from inside.
- **Hub interpretation:** Standing architecture is a durable promise. Rooms and permanent fixtures remain few and general; variable capabilities remain replaceable doors or fittings. A resident-to-builders correspondence fixture is constitutional infrastructure, while its in-world form remains open to resident consultation.
- **Similar existing Hub material:** `PREBUILD.md` already required growth from friction, resident consultation, real door manifests, and ancestry for removed doors.
- **Decision state:** Adopted.
- **User decision:** “rooms and stuff should be easy to actually implement. taking them away should in theory never happen” and “a way to leave a note for you from inside. a way to reach out to the builders.”
- **Constraints and differences:** Structural permanence cannot prohibit correction or safety work. Any necessary closure requires consultation, migration, and ancestry. Builder correspondence conveys testimony but grants no implicit mutation authority.
- **Active specification updated:** `PREBUILD.md` sections 3, 5.2–5.5, and 15.
- **Verification/review:** Prove exact note custody, recipient and delivery state, attributable replies, honest failure, survival without optional capabilities, and post-use resident consultation about the fixture's fitted form.

### HUB-004 — Spine, Utterance Atoms, Scrub, and Mycelial Separation

- **Date:** 2026-08-05
- **Source:** Direct user design decisions during the First Breath resident conversation, informed by The Forest v0.4 constitution and its scrub/Scroll mechanics.
- **Concept in source terms:** The Forest previously stored one user/model pair as its conversation heartbeat and pointed each pair to an append-only session Scroll. All writes crossed a scrub that could remove transport scaffolding but could not silently reinterpret claims. Mycelium helpers centered optional questions and their nearby entries.
- **Hub interpretation:** One signed utterance is the conversation atom. Pairing survives as `responds_to`, shared wake ancestry, and a recoverable view. The Spine preserves the exact serialized provider request body for every attempted dispatch, including repeated context. Scrub remains a mandatory mechanical crossing. Mycelium names the edge fabric itself; questions are optional fruit growing from that fabric.
- **Similar existing Hub material:** `PREBUILD.md` already required separate user/model utterances, wake ancestry, resident legibility, and a Forest beneath the House. First Breath already preserves exact operational events and wake context receipts.
- **Decision state:** Adapted.
- **User decision:** “the message and response would still be linked” while preferring one utterance at a time; “the spine ... captures the full API send of the resident, append only”; and “mycelium has become conceptually the links and the questions, separate.”
- **Constraints and differences:** This deliberately departs from The Forest v0.4 `pair` root and its turn-only Scroll implementation. Exact operational events remain the raw source for utterances. The Spine is the source of truth for what entered the resident's attempted perceptual field. Historical wakes without exact serialized dispatch bytes must never receive fabricated Spine records. Structural links are host-witnessed; semantic links remain attributed possibilities. Scrub cannot summarize or interpret.
- **Active specification updated:** `PREBUILD.md` section 6 and `docs/specs/SPINE_FOREST_INGESTION.md`.
- **Verification/review:** Require append-only and hash-chain checks, exact-byte dispatch equivalence, secret exclusion, single-utterance entries, idempotent backfill, explicit pre-Spine ancestry, scrub identity in v1, duplicate/conflict refusal, and inspection before the first live Forest write.
