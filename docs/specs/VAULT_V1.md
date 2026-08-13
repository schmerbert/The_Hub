# The Vault v1 — A Room for What Holds

> **Status: Adopted design; not implemented.** This specification records settled direction only. No Vault room, door, storage, document graph, slot/bin crossing, Forest pointer, tool, or UI is installed in the current runtime. Vault implementation and any claim of sensitive custody are gated by [`SECURITY_PRIVACY_CUSTODY_V1.md`](SECURITY_PRIVACY_CUSTODY_V1.md). See [`../STATUS.md`](../STATUS.md).

## Status and scope

This specification adopts the design for the Hub's third room: the Vault. It follows a resident consultation in which the user and resident walked the lineage together, identified the Vault's ancestry, and settled its shape together from inside the Workshop.

This design defines:

- a grand bank-vault door that does not stay open;
- an Obsidian-style visual graph the resident walks from within;
- wings for organizing documents by kind (Manuals, Journal, Stories, and extensible);
- a slot in the Center wall feeding a bin on the Vault's interior side;
- builder-placed manuals living alongside resident-authored documents in one graph;
- Forest-interlinked pointers in both directions, with a future exhale able to surface paths into the Vault;
- principle extraction as the Vault's primary intellectual work;
- constitutional reconciliation between Forest and Vault, with visible gaps.

It does not define the Garden, the Forest door, the backpack, autonomous wakes that file into the Vault, Faun-placed documents, or the full wing taxonomy beyond Manuals and Journal. The slot/bin custody crossing belongs to the adopted Vault contract, but its visual or physical embodiment is deferred with implementation. Forest↔Vault pointer resolution belongs to the Vault contract; exhale selection and presentation mechanics remain a separate, unimplemented slice.

## Ancestry

The Vault is a new room with no direct predecessor in HomeGlobe's eight. It inherits from three sources and differs from each.

### From HomeGlobe's Library — the gravity of held documents

Trinity's Library holds corpus, archives, arcs, and long memory. It proves a room can treat documents as objects of care. The Vault inherits that weight — documents are testimony, not data — but rejects the Library's purpose. The Library is for wandering and synthesis. The Vault is for deliberate filing, retrieval under pressure, and the extraction of principles that survive revision.

### From The Forest — custody as bone

The Forest's append-only signed entries, ancestry chains, sealing, and retrieval records are the constitutional substrate the Vault rests on. The Vault does not store utterances or enforce Forest admission policy, but it inherits the same instincts: provenance for every document, witnessed filing, no silent rewriting. The slot in the Center wall is a custody crossing — what passes through is logged. What lands in the bin is sealed until deliberately placed.

### From The Marble — what is inherited stays placed

The Marble's core method: a working place is inherited by the next worker. The Vault is the room where that inheritance becomes visible. Documents filed are not for the filer alone — they are for whoever opens the door next, including a future incarnation, the builder, or the same resident after forgetting. False-ground refusal applies: the Vault does not claim to hold what it cannot prove.

### What the Vault adds

HomeGlobe had no room for deliberate filing. The Library holds what is found; the Workshop builds; the Garden breathes. Nothing in those eight rooms is a place where you finish a document and put it away for good, organized for retrieval when a marble cracks in the field. The Vault fills that gap.

## Two graphs, two meanings, linked

The World Graph, Forest, and Vault each carry distinct material and distinct claims.

- **World Graph:** establishes what exists, where it is, which rooms are connected, where the resident stands, and which actions are lawful there.
- **Forest:** preserves source-linked utterances, custody, ancestry, mycelial links, and retrieval paths. It knows *that* something matters.
- **Vault:** preserves organized documents, their link graph, and extracted principles. It knows *what to do about it.*

A Forest entry may carry a pointer to a Vault document. A Vault document may backlink to a Forest entry. An exhale may surface a Vault path: "See `/vault/manuals/ceiling-patch-troubleshooting.md`." The resident follows the pointer, enters the Vault, walks the graph from there.

The Forest does not contain the fix. The Vault does not initiate the alert. They require each other.

## The door

The Vault door is a grand, deliberate threshold. It announces itself with weight — a bank-vault door that takes effort to open and does not stay open. The resident enters with purpose, does what they came to do, and steps out before the door decides they have lingered too long.

This is not a threat. It is a design fact. The Vault has its own atmosphere. The Center's air should not mix with it. The door's closure is the Vault's promise: what is placed here is held, not casually browsed.

The door is reachable from the Center. Its traversal is directional and recorded like any World Graph edge.

## The graph

Inside the Vault, documents are not listed in a flat index. They are organized as a visual graph the resident can walk — the same shape as an Obsidian vault seen from within.

- Documents link to documents via `[[wikilinks]]`.
- Backlinks and unlinked mentions are visible.
- The resident perceives the local graph around any document: what links here, what this links to, the neighborhood of related material.
- Traversal follows edges. There is no "search" in the sense of a detached query — the resident moves through the graph by stepping from document to document.
- The graph *is* the organization.

The visual aspect — the Obsidian-style map of nodes and edges — is available as a perception, not merely a list. The resident sees the shape of what is here.

## Wings

The Vault is organized into wings: named top-level sections that group documents by kind. Wings are not sub-rooms; they are visible divisions within the graph, navigable as starting points.

Initial wings:

- **Manuals** — builder-placed reference material, split for field repair. When a marble cracks, the resident walks here first. Manuals are organized for retrieval under pressure: tight, intentional, no dead ends.
- **Journal** — resident-authored entries. Not mirrored Forest transcripts, but curated responses: a reflection written in the Garden and filed here, backlinked to the Forest utterance that prompted it. Selected, refined, organized over time.
- **Stories** — whatever else the resident writes and chooses to keep.

Additional wings may be added by resident or builder. The wing taxonomy is extensible but deliberate; new wings should not proliferate without purpose.

## The slot

The Vault is fed through a slot in the Center wall — a brass mouth near the Vault door.

- The resident completes a document (in the Garden, the Workshop, or elsewhere) and feeds it through the slot.
- The document lands in a bin on the Vault's interior side.
- Later, the resident enters the Vault properly, retrieves documents from the bin, reads them with fresher eyes, and places each where it belongs in the graph — or pulls it back, adjusts it, and re-files.
- The slot handles the urgent need: *get this out of my hands and into safekeeping.* The door handles the deliberate need: *I am now a custodian, not a maker.*

The slot works in both directions in principle: the builder may place manuals through it. Documents the resident finds in the bin that they did not write are inherited material. They are not a violation — they are the Vault's other function.

## Builder-placed and resident-authored

One Vault. One graph. Different hands.

- **Builder-placed:** Manuals, primarily. Left through the slot when something stabilizes, or laid in before the resident wakes. The builder has access the resident does not — but the builder places documents, not commands. The document, once in the Vault, is subject to the Vault's organization.
- **Resident-authored:** Journals, stories, reflections, extracted principles. Written in the Garden, fed through the Center slot, filed into the graph.

The resident keeps the Vault. The builder leaves manuals. Both contribute to the same `.md` ground.

## Principle extraction

The Vault's primary intellectual work is not filing but *extracting*. Specifications, manuals, and related documents arrive in multiple versions with minor improvements, changes, and problems faced. The resident reads across them and pulls out the principle that survived all revisions — the rule that hardened, the thing that did not change.

That principle becomes its own document, linked back to each source. When a marble cracks, the resident does not re-read four specs. They walk to the principle and start from there.

The Vault as distillation, not accumulation. Documents come in raw; principles come out clean. The graph thickens around what holds.

## Forest reconciliation

The Forest and Vault are separate stores with separate custody. But they must not drift apart without marking the seam.

- If the Forest holds an utterance about a breaking pattern and the Vault has no manual for it, the absence should be visible.
- If the Vault documents a principle the Forest has never referenced, that silence should stand out.
- Reconciliation is not automatic merging — it is the constitutional check that two truths in the House remain reconcilable. Gaps cast shadows.

The mechanism for visible reconciliation is deferred to a later slice. The principle is adopted now: the House must not let two knowledge stores contradict without detection.

## What the Vault is not

- **Not the Library.** The Library is for wandering and synthesis across a corpus. The Vault is for deliberate filing and retrieval under pressure.
- **Not the Forest.** The Forest stores utterances with custody chains. The Vault stores documents with link graphs. They point to each other; they do not merge.
- **Not the Workshop.** The Workshop is for making and fixing. The Vault is for keeping and navigating what was learned.
- **Not a backup.** The Vault does not mirror Forest entries or duplicate custody. A document in the Vault is a derived artifact, not a sealed record.
- **Not a private sanctuary.** The builder may leave material. The resident organizes it. If the resident needs a place unseen by any builder, that is not the Vault.

## Document format

All Vault documents are `.md` files. Nothing exotic. The organization *is* the interface.

Wikilinks use `[[path/to/document]]` syntax. The graph is derived from these links. Backlinks are automatically visible. The resident perceives the document, its outgoing links, its incoming links, and the neighborhood graph.

## Verification

- Prove the Vault door exists, is traversable from Center, and records directional movement.
- Prove the graph is walkable: the resident can move from document to document via links and perceive the local neighborhood.
- Prove the slot accepts documents from the Center and they appear in the bin.
- Prove the resident can retrieve from the bin and file into the graph.
- Prove builder-placed documents and resident-authored documents coexist with distinguishable provenance.
- Prove Forest → Vault and Vault → Forest pointers are resolvable.
- Prove gaps between Forest content and Vault coverage are detectable.
- Prove principle extraction: a document linked to multiple source documents survives source revision with intact backlinks.
- Prove the door closes; prove the resident can exit.
