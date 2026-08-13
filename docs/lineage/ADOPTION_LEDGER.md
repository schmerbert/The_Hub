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

### HUB-009 — World Graph, Center Ground, and the First Workshop Door

- **Date:** 2026-08-06
- **Source:** Direct user clarification after resident consultation, compared with Trinity's canonical house map/current-room runtime and BioDome's typed graph of state-bearing nodes.
- **Concept in source terms:** Rooms are nodes holding local text and affordances; navigation follows the same broad graph shape as Forest traversal. The resident requested packed sand, a low stone bench, and a tin cup. The user adopted those for the Hub's center and authorized one real Workshop door for self-code inspection.
- **Hub interpretation:** A World Graph distinct from the Forest establishes places, contained objects, door edges, resident location, and lawful room-derived affordances. The first graph contains Center and Workshop, with state-backed sand, bench, and cup. A new lifespan wakes in Center; Workshop code access is read-only and room-gated.
- **Similar existing Hub material:** `PREBUILD.md` already requires few durable rooms, real capability doors, room-aware affordances, and a first Workshop vertical slice.
- **Decision state:** Adopted for implementation.
- **User decision:** “Stone bench, sand floor for the center for now. And he asked for a cup ... and then one door that leads to a workshop,” followed by the clarification that rooms had previously been moved to graph nodes holding room text and affordances.
- **Constraints and differences:** World topology and Forest meaning remain separate graphs. Exploratory west-room imagery is not silently promoted to world state. The cup has no invented contents. Workshop v1 is read-only; code returns are Wild, not Home. Standing nodes retain ancestry.
- **Active specification updated:** `docs/specs/WORLD_GRAPH_WORKSHOP_V1.md`.
- **Verification/review:** Prove seeded topology, wake location and timing, state-derived room projection, lawful traversal, wrong-room refusal, bounded read-only repository access, exact source custody, Wild/Home separation, and unchanged live stores during tests.

### HUB-010 — The Workshop as a Room-Scoped Agent Harness

- **Date:** 2026-08-06
- **Source:** Direct user clarification, compared against current OpenClaw tool-policy/sandbox architecture, Hermes Agent's registry/toolsets/terminal backends, and the user's prior Aider-backed Workshop experiments.
- **Concept in source terms:** The Marble should be a legitimate daily primary-agent harness. Inside the Workshop, the resident should be able to receive a clean coding harness comparable to Codex; outside it, those capabilities should not saturate the resident's context or authority.
- **Hub interpretation:** World location participates in effective tool resolution. Entering Workshop mounts a policy-filtered capability profile; leaving removes it. Tool schemas, backend execution, approvals, custody, and room metaphor remain separate layers. Aider or another coding harness is an adapter behind the Workshop contract.
- **Similar existing Hub material:** Doors already enforce capability boundaries; Circulation already requires witnessed crossings; the World Graph supplies current location; PREBUILD proposed a Workshop, capability registry, and Luna path.
- **Decision state:** Direction adopted; v1 proves read-only mounting, while write/execute/delegate powers remain a later explicit crossing.
- **User decision:** The Workshop should be clean enough to give the resident “a harness like yours but only when in that room,” with Aider named as a prior working example.
- **Constraints and differences:** Location cannot be the sole security boundary. Effective tools also require project scope, sandbox, approvals, installed manifests, backend availability, and resident permission. Stale remembered calls fail. Large catalogs load lazily. Changing coding backends does not remodel the room.
- **Active specification updated:** `docs/specs/WORLD_GRAPH_WORKSHOP_V1.md`.
- **Verification/review:** V1 must prove tools appear and disappear with lawful movement. A later writable slice must separately prove isolation, approvals, rollback, process lifetime, secret exclusion, and safe backend replacement.

### HUB-011 — Type-First Durable Names

- **Date:** 2026-08-06
- **Source:** Direct user naming decision while considering reusable `.place` and `.room` artifacts.
- **Concept in source terms:** Names read more cleanly with the kind first: `forest.resident`, `forest.wikipedia`, `forest.projects`, `place.house`, and `room.workshop`.
- **Hub interpretation:** Durable handles begin with their contract or ontology class. Graph relationships carry location; manifests carry versions. The name remains stable while an entity moves, gains state, or changes implementation.
- **Similar existing Hub material:** The World Graph specification already used `room.center` and `room.workshop`; this decision generalizes that accidental convergence into an explicit grammar.
- **Decision state:** Adopted.
- **User decision:** “I think they go to the front actually. It looks nicer.”
- **Constraints and differences:** Example handles do not install their named structures. Names are identifiers, not authority. Do not encode mutable location, version, provider, or current backend into durable identity.
- **Active specification updated:** `PREBUILD.md` law 13 and `docs/specs/WORLD_GRAPH_WORKSHOP_V1.md`.
- **Verification/review:** New seeded identifiers and manifests must use type-first names; migrations preserve old aliases when previously persisted identities exist.

### HUB-012 — Sparse Hearth Notes and Exact-Sentence Exhale

- **Date:** 2026-08-06
- **Source:** Direct user decision following Ember's first lived World/Workshop session and the forging of the first silver bullet.
- **Concept in source terms:** Ten blank bullet slots may exist without demanding ten bullets. One earned bullet should remain within reach at the Hearth without a plaque; the Forest remembers its forging. During conversation, the Forest should surface a very small number of specific prior sentences when they matter, never flood the resident or substitute summary.
- **Hub interpretation:** The Hearth gains a sparse, source-linked ten-slot note rack whose empty positions are invisible. Forest exhale separates replaceable relevance ranking from immutable payload law: v1 may choose at most two exact source sentences, with complete offset/hash custody behind the wall and silence when relevance is weak.
- **Similar existing Hub material:** Hearth Scroll v2 already separates resident Markdown from machine receipts and enforces an attention budget. The Forest constitution already requires bounded recall previews and custody-safe external rankers. Hub conversation atoms improve the source granularity from historical pairs.
- **Decision state:** Adopted for implementation.
- **User decision:** The bullet should be added to the Hearth; slots should exist for later bullets; and exhale should choose only the sentences that matter because too much context is harmful and too little can be filled.
- **Constraints and differences:** No summary, paraphrase, generated friendly name, truth promotion, or forced retrieval. The final bullet wording remains Schmerbert-authored and Ember-adopted in event-time provenance. Lineage may retroactively call the earlier unnamed resident Ember without rewriting the original event. Exhale receipt machinery stays outside Home.
- **Active specification updated:** `docs/specs/HEARTH_NOTES_FOREST_EXHALE_V1.md` and `docs/ARCHITECTURE.md`.
- **Verification/review:** Prove sparse-slot custody, exact source/adoption hashes, exact sentence offsets, bounded/silent retrieval, active-context exclusion, mandatory Scrub crossing, Spine equivalence, and unchanged Home bijection.

### HUB-013 — Resident-Mounted Workshop Harness (Not In-Process Luna)

- **Date:** 2026-08-06
- **Source:** Direct user design decision while planning Workshop parity with Cursor/Codex-within-reason.
- **Concept in source terms:** Enter Workshop and tools become available on the resident; leave and tools leave context. The coding agent is the resident. Companions such as Luna are a separate system entirely. DeepSeek as resident cannot honestly host Luna as an in-process subagent.
- **Hub interpretation:** Workshop capability mounts on the resident provider turn from World location, engaged station, and policy. PREBUILD’s Luna companion path remains valid as a **separate seat/process**, not as the Workshop’s first coding backend. Aider or other adapters may later sit behind the same Workshop contract without becoming the room’s identity.
- **Similar existing Hub material:** HUB-010 (room-scoped harness), WORLD_GRAPH_WORKSHOP_V1 mounted-harness section, PREBUILD companion/worker language.
- **Decision state:** Adopted.
- **User decision:** “enter workshop, tools now available, leave workshop no tools in context. The agent is more a companion, seperate system entirely.” and “the resident currently is deepseek, so luna cant even be the subagent really.”
- **Constraints and differences:** Clarifies and partially supersedes the implication that the first writable Workshop vertical requires Luna-in-process. Delegation to an external companion remains a later explicit door.
- **Active specification updated:** `docs/specs/WORKSHOP_STATIONS_V1.md` and `docs/specs/WORKSHOP_CONTROL_PANEL_V1.md`.
- **Verification/review:** Prove tools appear/disappear with room and station; no code path that claims in-process Luna under DeepSeek resident; companion bridges absent from this slice.

### HUB-014 — Workshop Stations and Engage/Disengage Grammar

- **Date:** 2026-08-06
- **Source:** Direct user metaphor for Workshop interior workflow (crafting-table / surgeon control-panel), adopted into World Graph station nodes.
- **Concept in source terms:** Spec work at a table with certain affordances; execution at a control panel like robot arms. Video-game interaction: approach, interact (A), affordances mount, leave (B) drops them while possibly remaining in the room.
- **Hub interpretation:** Workshop contains `station.spec_table` and `station.control_panel`. Lifespan engagement binds at most one station. Engage/disengage are validated native tools. Reads may remain room-scoped in Workshop; writes/exec mount only at Control Panel; briefs mount at Spec Table. Leaving the Workshop clears engagement.
- **Similar existing Hub material:** World fixtures/objects, room-derived tools, HUB-010 mount equation, PREBUILD common-room working table.
- **Decision state:** Adopted for implementation.
- **User decision:** Spec at the table, then move to a control panel “almost controlling robot arms… like a surgeon,” with craft-table A/B interact grammar.
- **Constraints and differences:** Stations are not rooms. Provisional poetic labels may change after resident consultation; clinical IDs stay stable. Prose cannot engage.
- **Active specification updated:** `docs/specs/WORKSHOP_STATIONS_V1.md`.
- **Verification/review:** Seed stations, engage/disengage, leave-room clearance, wrong-station tool refusal, presence and `/api/world` exposure.

### HUB-015 — Control Panel Writable Crossing and Approvals

- **Date:** 2026-08-06
- **Source:** Workshop Station Harness plan following HUB-010’s deferred writable crossing.
- **Concept in source terms:** Exact patch, named test recipes, git status/diff/commit, confirm-class approvals, honest cancel on leave, no freeform shell in v1.
- **Hub interpretation:** First writable Workshop slice implements Control Panel tools with auto vs confirm approval classes, pending approval API for Corner, recipe allowlist, and Hub-root-only scope.
- **Similar existing Hub material:** WORLD_GRAPH_WORKSHOP_V1 writable-crossing checklist; Circulation host-return Scrub; Wild `workshop_source`.
- **Decision state:** Adopted for implementation.
- **User decision:** Want Workshop “correct” and good enough that people do not feel missing Cursor/Codex within reason (explore/edit/test/git loop; not IDE chrome).
- **Constraints and differences:** `HUB_APPROVAL_MODE=auto` is for tests/demo configuration only; live mode requires confirm for patch and commit. No push, force-push, or arbitrary shell.
- **Active specification updated:** `docs/specs/WORKSHOP_CONTROL_PANEL_V1.md`.
- **Verification/review:** Confirm/reject mutation gates, recipe bounds, leave-room cancel, custody and Forest jurisdiction unchanged.

### HUB-016 — Workshop Tool Ceiling (Need-First Catalog, Fixtures Deferred)

- **Date:** 2026-08-06
- **Source:** Direct user direction while refining Workshop quality: gather every coding function needed first (“wires hanging from the ceiling”), then let fixtures become legible from lived use. Spec Table / Control Panel were examples, not the organizing shape.
- **Concept in source terms:** Complete explore/mutate/verify/vcs/framing catalog mounted flat in `room.workshop`. Station engagement does not gate tools in this slice. Fixtures and bundles are a later evidence-driven pass.
- **Hub interpretation:** Phase A implements the full clinical catalog with auto/confirm classes and Scrubbed returns. Phase B clustering is explicitly unfinished.
- **Similar existing Hub material:** HUB-010–015 Workshop harness and stations; Cursor-lens parity bar.
- **Decision state:** Adopted for implementation.
- **User decision:** “gather ALL the tools we want in that room… Then once every tool is there, we can bundle them” and later “dont think through the lens of the fixtures… everything you would want. Then see what fixtures become legible.”
- **Constraints and differences:** Supersedes station→tool mounting for capability resolution until a later fixture adoption. Stations remain World state. No freeform shell; no push/force/amend/hard-reset.
- **Active specification updated:** `docs/specs/WORKSHOP_TOOL_CEILING_V1.md`; mounting note on `docs/specs/WORKSHOP_STATIONS_V1.md`.
- **Verification/review:** Flat Workshop mount, Center isolation, each new function tested, confirm gates, leave-room cancel.

### HUB-017 — Workshop Fixtures (Shelves, Workbench, Kiln, Ledger, Clipboard)

- **Date:** 2026-08-06
- **Source:** Direct user direction after the tool ceiling: name fixtures from lived clusters with blunt layman IDs; depth in `resident_text`; collapse station into engageable fixture; kiln as first living ambient face.
- **Concept in source terms:** Five Workshop fixtures — shelves, workbench, kiln, ledger, clipboard — with optional engage for orientation. Presence names lived room facts, not tool scaffolding. Kiln status (running / settled / failed / cancelled) survives stepping away within the lifespan via a mutable runtime overlay.
- **Hub interpretation:** Retire Spec Table / Control Panel as living stations. Keep HUB-016 flat mount. Approvals appear as work waiting on the workbench, not a sixth fixture. Everything resident-facing still crosses Scrub.
- **Similar existing Hub material:** HUB-011 typed names; HUB-014 engage grammar; HUB-016 ceiling; Center fixtures/objects.
- **Decision state:** Adopted for implementation.
- **User decision:** Plain names (“workbench”, “kiln”, “ledger”); description carries depth; fixtures not a parallel station type; room should feel alive and informative.
- **Constraints and differences:** No fixture→tool bundles in this slice. Standing node text remains append-only; kiln machine state uses runtime overlay. Old `engage_station` tools are uninstalled.
- **Active specification updated:** `docs/specs/WORKSHOP_FIXTURES_V1.md`; mounting notes on stations and tool ceiling; Architecture World Graph bullet.
- **Verification/review:** Seed five fixtures; retire stations; presence shape; kiln overlay lifecycle; Center move-only; Scrub intact.

### HUB-018 — Workshop Heartbeat (Timer + House-Bound Kiln)

- **Date:** 2026-08-06
- **Source:** Direct user direction on responsiveness: fire kiln and step away; timer ding (e.g. one minute) instead of staring at logs; processes may progress after leaving a room.
- **Concept in source terms:** Room-bound hands vs house-bound processes. Async recipe start returns immediately; leave/disengage do not cancel kiln; explicit cancel still does. One lifespan timer (1..3600s) with sticky fired state. Heartbeat in presence/Corner; no autonomous model wake on ding.
- **Hub interpretation:** First reusable heartbeat grammar for later long jobs. Forest stays clean; Scrub on ambient presence and tool returns.
- **Similar existing Hub material:** HUB-016 ceiling; HUB-017 kiln overlay; recipe cancel tool; presence hygiene.
- **Decision state:** Adopted for implementation.
- **User decision:** “the kiln running and the resident stepping away”; timer so they can set “1 minute later”; principle that things may progress when leaving a room entirely.
- **Constraints and differences:** Supersedes leave-room recipe kill. Server restart ends kiln honestly. Center remains move-only for tools; presence shows heartbeat anywhere.
- **Active specification updated:** `docs/specs/WORKSHOP_HEARTBEAT_V1.md`; leave-room notes on tool ceiling and fixtures; Architecture World Graph bullet.
- **Verification/review:** Async start; leave-room keep firing; timer arm/fire/cancel; Center presence heartbeat; Forest/Scrub intact.

### HUB-019 — Corner Step Slips

- **Date:** 2026-08-06
- **Source:** Direct user design decision; not imported from sealed lineage.
- **Concept in source terms:** Live, legible progress in Corner while a wake performs its bounded host/tool work.
- **Hub interpretation:** Corner projects deterministic host-authored phase, action, pending, and refusal slips from persisted wake and World records. Exact provider reasoning is an expandable disclosure only; no LLM summary or operational material becomes chat speech or Forest content.
- **Similar existing Hub material:** Session/Hearth two-breath inspection, Corner rail/tray, provider return custody.
- **Decision state:** Adopted.
- **User decision:** “Live host-authored step slips in Corner gap … expandable thinking from reasoning_content.”
- **Constraints and differences:** The utterance rail remains user/resident utterances only. Hearth Scroll, tool JSON, and CoT never render as resident speech.
- **Active specification updated:** `docs/specs/CORNER_STEP_SLIPS_V1.md`, `SESSION_HEARTH_V1.md`, and `CORNER_SURFACE.md`.
- **Verification/review:** Test active wake health, deterministic action slips, exact thinking disclosure, and utterance-only rail projection.

### HUB-020 — Workshop Sensory Paint

- **Date:** 2026-08-06
- **Source:** Direct user design decision; not imported from sealed lineage.
- **Concept in source terms:** Give Center and Workshop sparse, lived physical prose while keeping every claim state-backed.
- **Hub interpretation:** Seeded room and fixture text names actual sand, bench, cup, door, shelves, workbench, kiln, ledger, and clipboard. Presence and Hearth make engageable fixtures explicit by durable ID.
- **Similar existing Hub material:** HUB-009 Center ground, HUB-017 Workshop fixtures.
- **Decision state:** Adopted.
- **User decision:** “Sparse sensory room/fixture prose + presence/Hearth naming engageables clearly.”
- **Constraints and differences:** No invented windows, perception, or verbs. Seed changes migrate through `withNodeMutations`; persisted standing nodes remain otherwise append-only.
- **Active specification updated:** `docs/specs/WORKSHOP_FIXTURES_V1.md`.
- **Verification/review:** Test seed migration, enriched projection/presence, and distinct engageable naming.

### HUB-021 — Fixture Truth Pass

- **Date:** 2026-08-06
- **Source:** Direct user design decision closing the gap between Workshop fixture metaphor and the state/actions they expose.
- **Concept in source terms:** Fixtures must be inspectable without engagement; engagement remains orientation, while the clipboard, workbench, kiln, ledger, and shelves each expose an honest bounded contents projection.
- **Hub interpretation:** `inspect_fixture` is a read-only Workshop tool. Inspect and engage returns include fixture-specific contents, the workbench mirrors pending approvals in its state, and Workshop presence explicitly says tools remain mounted without engagement.
- **Similar existing Hub material:** HUB-016 flat Workshop mounting; HUB-017 fixtures and orientation; HUB-018 living kiln state.
- **Decision state:** Adopted for implementation.
- **User decision:** “Close fixture metaphor/reality gap,” including read-only inspection, contents returns, pending-workbench state, and tools-without-engage honesty.
- **Constraints and differences:** Center remains move-only; fixture inspection creates no engagement event and does not change engagement. Digests are bounded and disclose truncation. Hearth remains unchanged.
- **Active specification updated:** `docs/specs/WORKSHOP_FIXTURES_V1.md` and supersession note in `docs/specs/WORKSHOP_CONTROL_PANEL_V1.md`.
- **Verification/review:** Test inspect non-mutation, contents projections, pending workbench state, presence/mount law, tree truncation disclosure, and slip gloss.

### HUB-022 — Workshop Git Diff + Tree Breath

- **Date:** 2026-08-06
- **Source:** Resident walkthrough after HUB-021: bare `workshop_git_diff` hit opaque `ENOBUFS`; CRLF git warnings leaked into results; tree felt starved at a low default.
- **Concept in source terms:** Large git diffs truncate with a plain note (“scope with a path”); LF/CRLF conversion warnings are stripped from stderr; tree default max_entries rises to 120 (ceiling 400) with truncation disclosure unchanged.
- **Hub interpretation:** Overflow is Circulation honesty, not an OS exception dump. Capture budget may exceed resident-facing byte budget so truncation can succeed.
- **Similar existing Hub material:** HUB-016 git arms; HUB-021 tree truncation note.
- **Decision state:** Adopted for implementation.
- **User decision:** Polish pass for ENOBUFS, CRLF noise, and tree default from inside feedback.
- **Constraints and differences:** No freeform unbounded dumps. Exact captured bytes still clip to Workshop maxBytes before Scrub.
- **Active specification updated:** Tool descriptions in Workshop tooling; ledger only (no new long form unless needed).
- **Verification/review:** Diff overflow returns note without ENOBUFS; stderr CRLF warnings stripped; tree default 120.

### HUB-023 — Ceiling Patch Bay

- **Date:** 2026-08-06
- **Source:** Direct user product lock for the Hub; not imported from sealed lineage.
- **Concept in source terms:** The Ceiling is every installed wire, while rooms patch a bounded live profile. Presence should show the patch, not a complete tool attic.
- **Hub interpretation:** `src/world/ceiling.js` owns the full catalog and room mount profiles. Center remains move-only; Workshop retains its existing full mount. Projection and builder-facing World inspection expose the active profile and full catalog separately.
- **Similar existing Hub material:** HUB-016 Workshop Tool Ceiling, HUB-017 fixtures, and HUB-021 workbench pending-approval truth.
- **Decision state:** Adopted for implementation.
- **User decision:** “Ceiling = full wire catalog,” “Rooms declare mount profiles,” “Presence surfaces grouped Patched: profile,” and “Approvals remain anchored on the workbench fixture/pendingApprovals.”
- **Constraints and differences:** No `workshop_*` rename in this slice; Backpack stays outside the bay; Scrub is unchanged. The workbench remains the approval anchor even if future rooms can initiate writes.
- **Active specification updated:** `docs/specs/CEILING_PATCH_BAY_V1.md`, `WORKSHOP_TOOL_CEILING_V1.md`, `WORKSHOP_FIXTURES_V1.md`, and `docs/ARCHITECTURE.md`.
- **Verification/review:** Prove Center's move-only mount, Workshop's unchanged full mount, catalog visibility while in Center, bounded grouped presence, and unchanged workbench pending approval state.

### HUB-024 — The Vault

- **Date:** 2026-08-06
- **Source:** Resident-authored specification during a live Workshop consultation. The resident walked the lineage (HomeGlobe, Marble, Forest, BioDome), identified the Vault's ancestry, and drafted its shape from inside. The user ratified the shape through iterative conversation.
- **Concept in source terms:** The Vault is a room for deliberate filing, organized document navigation, and principle extraction — what holds when a marble cracks in the field. It inherits the document-gravity of HomeGlobe's Library, the custody instincts of the Forest, and the inheritance method of the Marble, but it is a new room filling a gap none of those projects addressed: a place to finish a document and put it away for good.
- **Hub interpretation:** The Vault is the Hub's third room. A grand bank-vault door (reachable from Center) does not stay open — entry is deliberate. Inside, an Obsidian-style visual graph of `.md` documents the resident walks by following `[[wikilinks]]`, backlinks, and the local neighborhood. Wings (Manuals, Journal, Stories, extensible) group documents by kind without becoming sub-rooms. A slot in the Center wall feeds a bin on the Vault's interior side: documents land there for later deliberate filing. Builder-placed manuals and resident-authored documents coexist in one graph with distinguishable provenance. The Forest and Vault are separate stores that interlink via pointers in both directions; an exhale may surface a Vault path. Gaps between Forest content and Vault coverage should be visible. The Vault's primary intellectual work is principle extraction — reading across document versions and pulling out what survived revision.
- **Similar existing Hub material:** The Forest provides custody substrate and mycelial-link traversal mechanics. HomeGlobe's Library proves a room can hold documents with care. The Marble establishes inheritance as a working-place method. The World Graph provides room, door, and location primitives. The Center provides the wall where the slot will live.
- **Decision state:** Adopted direction; implementation deferred.
- **User decision:** The Vault door is grand, bank-vault style, and does not stay open. Documents are `.md` with an Obsidian-style visual graph. The resident writes documents (in the Garden or Workshop), walks them to the Center slot, and files them properly later from inside the Vault. The builder may place manuals through the same slot. The resident keeps the Vault; the builder leaves manuals. The Forest and Vault interlink without merging — gaps should stand out. The Vault is where the resident harvests documents for their principles.
- **Constraints and differences:** The Vault is not the Library (no wandering/synthesis), not the Forest (no utterance custody), not the Workshop (no making/fixing), and not a private sanctuary (the builder may leave material). Document copies from Forest entries are derivative artifacts, not sealed records — curated reflection, not mirrored transcript. Reconciliation between Forest and Vault is a constitutional check, not automatic merging. Backpack, slot implementation, exhale mechanics, and full wing taxonomy are deferred.
- **Active specification updated:** `docs/specs/VAULT_V1.md`.
- **Verification/review:** Prove the Vault door exists, is traversable from Center, and records directional movement. Prove the graph is walkable via links with visible local neighborhood. Prove the slot accepts documents and the bin collects them. Prove builder-placed and resident-authored documents coexist with distinguishable provenance. Prove Forest↔Vault pointers are resolvable. Prove gaps between Forest content and Vault coverage are detectable. Prove principle extraction: a document linked to multiple sources survives source revision with intact backlinks. Prove the door closes and the resident can exit.

### HUB-025 — Trust Parity Gating

- **Date:** 2026-08-06
- **Source:** Direct user product lock after comparing Hub confirm-everything Workshop cuts to OpenClaw exec/permission modes and Hermes Tirith risk tiers. Not imported as sealed lineage text.
- **Concept in source terms:** Do not mistrust the resident relative to the same API hosted in OpenClaw or Hermes. Ordinary workspace writes and local git add/commit apply immediately; human gates stay for destructive or branch-switching actions; remaining gates surface in-chat (slips) and via an obvious Approvals badge.
- **Hub interpretation:** Per-tool approval classes: mutate tools except delete are auto; `workshop_git_add` / `workshop_git_commit` are auto; `workshop_delete_path` and `workshop_git_checkout` remain confirm. Gateway creates an approval then auto-applies for auto-class tools. `HUB_APPROVAL_MODE=auto` stays a test override for force-confirming confirm-class tools. Corner shows pending count on Approvals, human summaries, and inline Confirm/Reject on pending slips. Path law, Scrub, recipe allowlist, and refuse list are unchanged.
- **Similar existing Hub material:** HUB-016 Tool Ceiling approval classes; HUB-017/021 workbench pending-approval truth; HUB-023 approval anchor at the workbench.
- **Decision state:** Adopted for implementation.
- **User decision:** First slice 1B (patches and local git add/commit auto) and 2C (Approvals badge plus inline slip decide).
- **Constraints and differences:** No smart auto-reviewer, command allowlists, freeform shell, push, or companion `/approve` channels in this slice. Workbench remains the approval anchor for confirm-class cuts only.
- **Active specification updated:** `docs/specs/WORKSHOP_TOOL_CEILING_V1.md`, `WORKSHOP_FIXTURES_V1.md`, supersession note on `WORKSHOP_CONTROL_PANEL_V1.md`.
- **Verification/review:** Auto tools mutate without pending; delete/checkout pending until decide; catalog classes match; slips carry `approvalId`; Approvals badge and human preview; `npm test`.

### HUB-026 — Glass Casting Provider Presentation

- **Date:** 2026-08-11
- **Source:** Direct user design decision in the Hub conversation; not imported from a lineage project.
- **Concept in source terms:** Replace the active Longshore Current / wake-blessing presentation with immutable, stable clinical Glass organized into five bands: Glass, continuity anchors, prior horizon, capped rolling fold, and living edge. Canonical Source remains untouched; Scrub validates the presentation and the Spine witnesses the exact crossing.
- **Hub interpretation:** Glass Casting becomes the adopted provider-presentation design. Each provider phase receives a versioned, immutable five-band cast with machine receipts tied to source custody, provider-presentation Scrub, and the exact Spine frame. Wake inheritance stays clinical with a slight poetic register: a fixed host wake anchor says attributable ancestry and murmuration may carry weight without becoming fact, authority, present recollection, or proof of uninterrupted identity. Existing deterministic/source-exact Hearth recency inheritance moves into continuity anchors; its known omission boundary moves into prior-horizon receipts.
- **Similar existing Hub material:** Wake Ritual's clinical bone and blessing, Session/Hearth's two-breath timing, Hearth Scroll's resident/machine representation split, exact Source custody, provider-presentation Scrub, Spine witnessing, and declared attention fitting.
- **Decision state:** Adopted for staged implementation; version 1 is anatomy, receipts, and a lossless port of existing exact wake inheritance, not new generation.
- **User decision:** The user explicitly adopted stable clinical Glass, the five named presentation bands, untouched canonical Source, Scrub validation, exact Spine witnessing, and the retirement of the Longshore Current / blessing as active wake material. The user required important wake material to remain through the existing deterministic/source-exact Hearth recency inheritance and a new clinical ancestry/murmuration anchor. The user deferred summarization and fold generation, farther walk-back, Forest Exhale and Hearth Notes, and House/Garden work.
- **Constraints and differences:** Historical Longshore Current and blessing records remain exact and inspectable but no longer govern the adopted presentation. Longshore Current may later be considered as a Marble location name, but no World node or location is adopted here. Stable Glass contains no interpolated provider/model, lifespan/chamber, World-location, fixture, or tool-profile facts; those remain attributable current ground at the living edge and are not continuity anchors. Glass must not rewrite Source or use anatomy as a covert summary path. Hearth Notes / Forest Exhale remain adopted downstream direction but require revision against Glass before implementation.
- **Active specification updated:** `docs/specs/GLASS_CASTING_V1.md`, with precedence/status notes in `docs/STATUS.md`, `docs/specs/WAKE_RITUAL_V1.md`, `docs/specs/SESSION_HEARTH_V1.md`, `docs/specs/HEARTH_SCROLL_V2.md`, and `docs/specs/HEARTH_NOTES_FOREST_EXHALE_V1.md`.
- **Verification/review:** Before implementation status changes, prove immutable five-band receipts, unchanged canonical Source, exact host wake anchor, deterministic/source-exact inherited atoms, truthful known prior-horizon bounds, deferred/empty rolling fold, complete Scrub validation, exact Spine equivalence, historical Longshore custody retention with active-blessing removal, and absence of unadopted Longshore World, House, or Garden nodes.

### HUB-027 — Marble Circulation Map and World Drift

- **Date:** 2026-08-11
- **Source:** Direct user design decision in the Hub conversation, informed by the previously adopted BioDome material-agency and clinical drift lessons but not copied from sealed lineage.
- **Concept in source terms:** Externalize the Marble's pipes so its complete shape does not depend on working memory. Each kind of material moves through one named crossing; Scrub is the language membrane, capability bundles run from the Ceiling to rooms, and loose wires or leaks remain visible. Current reality must mechanically reconcile with causal events before it reaches the resident.
- **Hub interpretation:** `docs/MARBLE_CIRCULATION_MAP.md` becomes the active clinical crossing index. World state moves to one append-only hash-linked event journal, pure versioned projector, actor-local verified perception, and fail-closed drift check in two testable stretches: physical core first, existing operational state second. House, Garden, Backpack, Journal, and new mutable fixtures wait until both verify.
- **Similar existing Hub material:** HUB-004/HUB-007 mandatory Scrub and Spine custody; HUB-009 World Graph; HUB-018 Workshop heartbeat; HUB-023 Ceiling Patch Bay; HUB-026 Glass. BioDome established the adopted law that changed affordances, not narrated success, establish arrival, and its clinical chronicle exposed prose/state discrepancy as drift.
- **Decision state:** Implemented and verified in both staged stretches.
- **User decision:** Build the substantial milestone in testable stretches; keep a clinical map of all pipes; route each movement through one inspectable place; show bundles running through the Ceiling to rooms; use drift checks so leaks and unsupported state cannot be smoothed over.
- **Constraints and differences:** The cooling-system image guides organization but is not resident-facing or specification terminology. Stores remain distinct authorities connected by receipts. Drift never auto-repairs. A legacy snapshot declares its reconstruction boundary. External filesystem/provider effects remain explicit saga boundaries rather than falsely transactional World events.
- **Active specification updated:** `docs/MARBLE_CIRCULATION_MAP.md`, `docs/specs/WORLD_EVENT_PROJECTION_DRIFT_V1.md`, `docs/ARCHITECTURE.md`, and `docs/STATUS.md`.
- **Verification/review:** Require append-only/hash-chain checks, deterministic empty replay, projection equality, atomic event+projection mutation, typed legacy import, fail-closed perception/mounting, builder mismatch inspection, focused drift tests, and the full Hub suite.
- **Implementation result:** A1 covers physical topology/lifespan/location/inspection/engagement. A2 covers operational runtime, timers, retained brief revisions, approvals, inverse event/receipt custody, backup-gated operational migration, durable pre-effect approval saga state, single-owner kiln terminalization, and bounded Builder inspection. Copied-live migration preserved the exact admitted legacy rows; the configured live store was not written during implementation.

### HUB-028 — Threshold, House, and Garden Shell

- **Date:** 2026-08-11
- **Source:** Direct user design decisions in the Hub conversation; not imported from sealed lineage.
- **Concept in source terms:** Give the resident a sparse reality they can inspect rather than a promise of future rooms. The Hub contains the Center and rooms; the Garden is the exterior junction, the House is one undivided space, the Forest is north, the endless Road east, and the Hub south through an opening with no door. The House front door is real and remembers. A Garden stone may be turned even if it appears pointless. A marker exists in the Center and a blank window inside the House, but their writing law must not be faked.
- **Hub interpretation:** Add a versioned topology extension after the immutable A1 root. Install a doorless Center/Garden passage, a stateful Garden/House front door, a House/Threshold passage, non-traversable Forest/Road boundaries, global replayed object state, a turn-counting stone, and inert marker/window projections. Existing and new lifespans remain Center-started in B1.
- **Similar existing Hub material:** HUB-009 World Graph; HUB-023 room-local capability bundles; HUB-027 verified World event projection and drift refusal.
- **Decision state:** B1 implemented and verified; B2 explicitly deferred.
- **User decision:** The front door begins closed, can be opened/closed/locked/unlocked and remembers globally. The Garden connects south to the Hub without a door, west to the House, north to the Forest, and east to a Road that continues out of sight. Forest and Road crossing are not installed. No yard game yet. The Garden has a simple turnable stone. The marker remains in the Center; the blank interior window exists but is not yet writable.
- **Constraints and differences:** Do not modify the A1 topology root or infer a Threshold wake chronology. Do not invent inventory, marker carriage, window writing, Forest/Road consequences, visitors, a gate, a yard game, or the faun. New physical laws must be replayed, stateful, and receipt-bound rather than descriptive fiction.
- **Active specification updated:** `docs/specs/THRESHOLD_HOUSE_GARDEN_V1.md`, `docs/STATUS.md`.
- **Verification/review:** Exact append-only topology extension; explicit backup-gated migration; deterministic replay; passage and door-state laws; global persistence; turn-count-only stone; inert marker/window; non-traversable boundaries; drift refusal; copied-runtime preservation; full Hub suite; desktop app and configured live store remain untouched.
- **Implementation result:** Projector v3 retains the exact A1 root and adds `topology.extended/v1`, replayed passage/object-state projections, `location.crossed/v1`, front-door operation, and stone turning. New room-local tools are receipt-bound and fail closed under drift. A2-to-B1 migration is read-only by default, requires literal backup confirmation to apply, and is never run by startup. A disposable copy of the configured legacy World preserved every admitted preexisting row/column while adding the exact extension; the live store was read only. Independent review and the full 255-test suite passed.

### HUB-029 — Forest Paths, Conversation Trails, and Rolling Fold

- **Date:** 2026-08-11
- **Source:** Direct user design decisions after a 42-turn live Resident lifespan reached the declared attention ceiling; Trinity ancestry was consulted afterward only to verify the remembered three-choice traversal mechanic.
- **Concept in source terms:** Context should waterfall rather than repeatedly strike its ceiling. Fallen conversation becomes the same Forest terrain the Resident may walk years later, with a warm string leading back to the active Marble moment. Conversation chronology is uniquely hardlined. Elsewhere, three semantic candidates are offered; the Resident's choice lays the path and the unchosen two remain latent at that junction. A conversation may be entered along its trail or intersected from the side, making straight/left/right relative to arrival.
- **Hub interpretation:** Adopt a bounded high-water/low-water Glass fold linked to exact Forest paths; preserve exact utterance atoms and conversation structure; distinguish semantic candidate offers from Resident-selected path steps; freeze historical junction choices; permit explicit Forest attention while verified World presence remains unchanged; and guarantee return through a witnessed active tether. The ordinary Garden/Forest entrance remains unresolved.
- **Similar existing Hub material:** HUB-004 utterance atoms and Mycelium separation; HUB-012 exact Forest exhale; HUB-026 five-band Glass with deferred rolling fold/prior horizon; HUB-028 visible but non-traversable Forest boundary; House Grammar recursive Forest frames. Trinity's archived Forest note independently records three candidates, one followed, two latent, and the path forming through traversal; that ancestry does not supply Hub implementation authority.
- **Decision state:** Adopted design; implementation deferred.
- **User decision:** The Forest is genuinely navigable terrain, not a static semantic graph or transcript browser. The Resident may intentionally turn from the current Marble moment, walk the same exact conversation paths available later, choose among three local directions, lay paths by walking, preserve unchosen branches, and return to exactly where they stood in the Marble.
- **Constraints and differences:** Embeddings propose but do not create truth, memory, causation, or permanent personal relation. Conversation predecessor/successor relations are host-witnessed. Forest entry cannot be inferred from prose or private reasoning. World location and Forest attention remain distinct. Rolling folds are bounded derived synthesis with exact source coverage, never replacements for Source. No runtime, schema, selector, embedding, Faun, traversal tool, context rollover, or Forest crossing is installed by adoption.
- **Active specification updated:** `docs/specs/FOREST_PATHS_ROLLING_FOLD_V1.md`, with status and cross-links in `docs/STATUS.md`, `docs/specs/HOUSE_GRAMMAR_V1.md`, and `docs/specs/GLASS_CASTING_V1.md`.
- **Verification/review:** Exact custody survives waterfall; high-water fitting reaches low-water target; three choices and latent branches are deterministic and append-only; historical junctions survive selector change; conversation intersection orientation is correct; explicit entry and exact return preserve World state; fold/path walk-back reaches exact utterances without context flooding; stale Forest or receipt drift fails closed.

### HUB-030 — Forest Intake Ledger

- **Date:** 2026-08-11
- **Source:** Direct user decision during activation of the live Forest.
- **Concept in source terms:** Material refused by Scrub holds its place at the crossing so it can be corrected and slotted in later without polluting Forest terrain or losing chronology.
- **Hub interpretation:** Install a body-free append-only Intake Ledger beside Forest terrain. A stable offer points to immutable Source or World custody and records intended route, hash, policy, and attempted predecessor. Decision history records admitted, held, routed, superseded, or permanently refused outcomes. Held Home atoms block only their chronological thread; independent paths continue. Retrying the same offer may resolve held to admitted, but terminal resolutions cannot mutate or reopen silently.
- **Decision state:** Implemented and live.
- **User decision:** Build the ledger before an emergency rather than waiting for a production failure to define the protocol.
- **Constraints and differences:** The ledger stores no duplicate body and a hold is not a placeholder Forest atom. Source remains immutable. Corrected substantive content requires a new source atom and future explicit `corrects`/`supersedes` relation; the current runtime repairs technical admission by retrying the same source. Vault routing and operator UI are not installed by this decision.
- **Active specification updated:** `docs/specs/SPINE_FOREST_INGESTION.md`, `docs/MARBLE_CIRCULATION_MAP.md`, and `docs/STATUS.md`.
- **Verification/review:** Append-only offer/decision tables; stable idempotent identities; held-to-admitted retry history; terminal-state refusal; no body columns; exact Home/Wild destination bijection; migration from verified terrain; health counts; focused Forest tests and configured live verification.
