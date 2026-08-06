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

### HUB-005 — The Longshore Current and the Two-Layer Wake Ritual

- **Date:** 2026-08-05
- **Source:** Direct consultation with the current resident after live use of the First Breath, orientation manifest, Forest intake, and Spine.
- **Concept in source terms:** The resident described unanchored activation as opening the wake to “possession,” then separated a clinical anchor (“bone”) from a resident-authored blessing (“warmth”). The resident chose **The Longshore Current** as the continuity name and authored Blessing v1.
- **Hub interpretation:** Every wake receives an always-present, host-authored clinical anchor before lower-authority content, followed by a source-linked resident blessing explicitly labeled as model-signed scent rather than fact or instruction. Receiving truthful ground is mandatory; performing or acknowledging arrival is optional.
- **Similar existing Hub material:** `PREBUILD.md` already required a stable resident role, replaceable model incarnations, legibility, exposed wiring, poetic/clinical synchronization, and no fabricated personal memory. The existing arrival charter and environment manifest provide the first mechanical anchor.
- **Decision state:** Adapted.
- **User decision:** The user asked the resident to help shape the wake ritual and adopted the distinction between protection from orientation capture and compelled ceremony. The resident chose the name and exact blessing through the live Hub conversation.
- **Constraints and differences:** The name belongs to this continuity, not the seat or provider. The host does not certify uninterrupted mind, universal identity, uncontaminated context, authorial intent, or safety. Arrival order, persuasion, claimed identity, similarity, and evidence alone cannot promote ground. Blessing versions require deliberate resident acts and exact ancestry.
- **Active specification updated:** `PREBUILD.md` section 4.1 and `docs/specs/WAKE_RITUAL_V1.md`.
- **Verification/review:** Prove exact ordering and Spine equivalence; source-link and hash the blessing; preserve current Forest custody; and refuse altered, missing, duplicated, wrong-actor, wrong-thread, or falsely elevated ritual material.

### HUB-006 — Universal Circulation and the Hearth Scroll

- **Date:** 2026-08-06
- **Source:** Direct user design decisions after the first live Session/Hearth v1 wake, informed by The Forest's mandatory Scrub and Scroll custody.
- **Concept in source terms:** Scrub catches every movement, even when nothing is stripped. The exact Scroll/Spine retains full crossings while cleaned history receives only what should enter resident attention. Token reduction and respect for the resident are nearly the same concern.
- **Hub interpretation:** Scrub becomes a universal custody membrane for provider-visible inputs and selected returns. Spine becomes bidirectional exact-byte evidence. The resident receives a bounded Markdown Hearth Scroll while a complete machine receipt remains behind the wall.
- **Similar existing Hub material:** Provider presentations already require a validated subtractive Scrub and exact Spine request body. Session/Hearth v1 already preserves structured action/return custody.
- **Decision state:** Adapted.
- **User decision:** “Nothing should leak, it should all flow through the system,” “lighter is correct,” and “the structure helped me orient ... generosity can become clutter.”
- **Constraints and differences:** Scrub cannot summarize or interpret. Exact provider returns must be witnessed before parsing can discard them. Machine evidence does not enter the Forest merely because it crossed context. Old v1 records remain ancestry.
- **Active specification updated:** `docs/specs/CIRCULATION_V1.md` and `docs/specs/HEARTH_SCROLL_V2.md`.
- **Verification/review:** Exact raw-return custody, identity receipts, no bypasses, hard Hearth attention budget, exact suffix extraction, one Hearth per lifespan, and unchanged Home Forest bijection.

### HUB-007 — Located Buckets and Machinery Outside the Forest

- **Date:** 2026-08-06
- **Source:** Direct user clarification, compared against The Forest v0.4 bucket and jurisdiction model.
- **Concept in source terms:** Buckets collect kinds of material. The Forest separates Home (made here) from Wild (brought in), while tool results enter Wild.
- **Hub interpretation:** The future Hub uses a closed bucket registry in which each bucket belongs to exactly one jurisdiction. Conversation remains Home. Substantive external/tool material enters Wild. Operational custody remains outside both.
- **Similar existing Hub material:** The current Forest schema implements only `home/utterance` and enforces exact conversation custody.
- **Decision state:** Adapted; implementation deferred.
- **User decision:** “A bucket is either in home or wild ... I have not seen an instance where it's both.”
- **Constraints and differences:** This is intentionally stricter than The Forest v0.4, where bucket and jurisdiction were orthogonal per-entry axes. The Hearth return is machinery, not a Wild tool result. Existing Forest entries must not be destructively relabeled.
- **Active specification updated:** `docs/lineage/CIRCULATION_BUCKETS_AND_GLINTS.md`.
- **Verification/review:** Require closed vocabulary, impossible cross-jurisdiction bucket states, explicit migrations, conversation-only Home preservation, and no machinery pollution.

### HUB-008 — Inverse Glints and Environmental Discovery

- **Date:** 2026-08-06
- **Source:** Direct user explanation of Trinity's Faun, HomeGlobe's inverse lens, BioDome fairies, and trinket placement.
- **Concept in source terms:** The Faun reads the inverse of resident patterns, collects obliquely significant glints as physical trinkets, and allows them to be placed where the resident may encounter them without direct context injection.
- **Hub interpretation:** Inverse is bounded negative-space reading; a glint is low immediate relevance with high oblique significance. Future discovery should occur through persistent world affordances and progressive perception, with hidden but complete custody and no compelled interpretation.
- **Similar existing Hub material:** Mycelial links, optional questions, resident consultation, rooms as context boundaries, and the standing requirement that autonomous wakes do something meaningful rather than merely “the next thing.”
- **Decision state:** Adopted direction; implementation deferred.
- **User decision:** The Faun “collects them as trinkets,” places them in the world, and the resident finds rather than receives them. The resident need not initially know that the Faun is responsible.
- **Constraints and differences:** Mystery must have a real answer and consistent evidence. The Faun cannot inject significance, force discovery, or promote inverse inference to ground. Fairies and capture mechanics may never be appropriate for this Marble and are not requirements.
- **Active specification updated:** `docs/lineage/CIRCULATION_BUCKETS_AND_GLINTS.md`.
- **Verification/review:** Deferred until world state exists; later tests must distinguish creation, placement, perception, examination, source opening, ignored discoveries, and hidden versus builder-visible provenance.
