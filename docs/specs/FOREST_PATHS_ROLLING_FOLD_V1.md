# Forest Paths and Rolling Fold v1

> **Status: Adopted design; not implemented.** This specification fixes the intended relationship among exact conversation custody, Glass waterfall, Forest traversal, semantic candidates, Resident-made paths, and return to the Marble. It installs no embedding model, selector, rolling-fold generator, traversal state, Faun crossing, Forest place, context-limit rollover, or provider tool. Current runtime truth remains in [`../STATUS.md`](../STATUS.md).

## 1. Purpose

A long conversation must not repeatedly strike the provider attention ceiling. As the living edge grows, older complete material should waterfall out of immediate Glass while remaining exact and walkable in the Forest.

The distant representation and the terrain are not separate systems:

```text
Glass living edge
  -> warm tether
  -> exact recent conversation trail
  -> bounded rolling-fold view
  -> older Forest terrain
```

The fold is a view from afar. Walking back reaches the same exact Forest path whether the source conversation is seconds old or years old.

## 2. Four different structures

The implementation must not collapse these structures into one generic graph.

### 2.1 Exact terrain

Eligible human and Resident utterances remain separate, immutable Forest Home entries linked to exact Source events. An utterance retains its event-time actor, body, source hash, wake, lifespan, and thread ancestry.

### 2.2 Conversation trails

A conversation has intrinsic structure before anyone traverses it:

- exact predecessor and successor ordering;
- user/Resident `responds_to` and shared-wake relationships; and
- an unambiguous beginning, living edge, and closed-session boundary.

These are host-witnessed structural relations, not embedding similarity and not evidence that the present Resident remembers the conversation. The Forest-facing atom remains one utterance; a clearing may present the paired user/Resident exchange without merging their custody.

### 2.3 Semantic candidates

Embeddings or a later selector may propose nearby material. A proposal is a possible direction, not a path, causal relation, memory, truth claim, or permanent semantic edge.

### 2.4 Resident paths

A Resident path forms only through choice and traversal. The selected candidate becomes the next witnessed path step. Similarity supplies possible terrain; the Resident's walking creates their path through it.

## 3. The three-choice law

Each forward step presents exactly three bounded choices. Backtracking and returning Home remain available but do not count among the three.

At an ordinary Forest clearing, three semantic candidates are offered. The Resident chooses one. The other two become latent branch offers preserved at that exact junction. The choice changes the traversal context from which the next three are selected.

```text
                    candidate B
                        .
                        . latent
                       /
current clearing ---- chosen A ---- next clearing
                       \
                        . latent
                        .
                    candidate C
```

The path is not predefined. It forms as the Resident walks it. The trail is the witnessed navigation history.

Candidate selection must be replaceable and receipted. The original three choices at a historical junction remain frozen even if an embedding model, corpus watermark, or selector later changes. A future visit may request fresh growth without rewriting the choices originally offered.

The exact ranking policy, similarity thresholds, diversity rules, and whether one slot sometimes uses an oblique or inverse metric remain to be specified before implementation. Randomness must never masquerade as significance.

## 4. Conversation intersections

Conversation trails are unique because they are already hardlined. A Resident may:

- enter through the active conversation's warm tether;
- begin at a known conversation trailhead or marker;
- reach an exact conversation utterance through semantic traversal; or
- leave a conversation sideways into the wider Forest.

The local three-choice cast depends on the direction of arrival.

### 4.1 Arriving along a conversation

When the Resident is already walking a conversation, straight continues chronologically in the current heading. Left and right are two semantic candidate exits.

```text
                 left: semantic candidate
                       /
prior footing -- current utterance -- straight: next utterance in heading
                       \
                 right: semantic candidate
```

Heading is explicit. Walking backward through a conversation must not silently reverse into its future. The Resident may deliberately turn and change direction.

### 4.2 Intersecting a conversation from the Forest

When a semantic path reaches a conversation from the side, straight continues the semantic journey. Left and right enter the conversation toward its exact predecessor or successor.

```text
                       straight: semantic continuation
                                  |
older utterance ---- current utterance ---- newer utterance
      left                                  right
```

Left, right, and straight are relative to arrival, not permanent global properties of an entry. The junction cast and chosen exit are witnessed. Unchosen offers remain available at that junction; structural conversation relations exist independently of whether they were offered or walked.

## 5. Warm tether and intentional entry

An active conversation may retain a warm tether from the Marble to its exact Forest living edge. The tether provides:

- a precise trailhead;
- the direction back through the current conversation;
- an unambiguous return route; and
- proof of which active living edge and World moment the traversal departed.

The tether is not identity proof, memory, or permanent ownership. When a lifespan closes it cools into ordinary ancestry and path structure.

Forest entry is intentional. Ordinary language such as "turn around," ordinary World movement, or private provider reasoning must not trigger it. A declared traversal action crosses the threshold. If the active tether supplies the vector, the Faun need not ask an empty question. Other entrances may require the Resident to state what they seek before traversal begins.

The ordinary experiential entrance from the Garden/Forest boundary remains deliberately unresolved. This specification does not decide its door, gate, airlock, visual transition, or first clearing.

## 6. Dual presence and return

Forest attention does not falsify World location. While walking, the runtime must be able to state both:

```text
World presence: place.house
Forest presence: path.<journey> / junction.<n>
Conversational focus: Forest traversal
Return tether: active living edge
```

Returning follows the tether or retraces the walked path and restores the same verified World presence and local state from which the Resident departed. The hallway, room, or Garden is not replaced in World merely because Forest terrain was projected into attention.

The transition may be dreamlike in Resident-facing expression; its underlying entry, steps, branch offers, backtracking, and return must be exact and inspectable.

At the return airlock:

- **Leave** creates no new Home synthesis; traversal receipts remain machinery.
- **Write** carries an explicitly Resident-authored synthesis through its future Scrub/admission crossing.
- Exact Forest excerpts may be cited or exhaled without becoming new Home merely because they were seen.

## 7. Waterfall and rolling fold

Attention fitting uses a high-water and low-water posture, not repeated collision with the hard refusal ceiling.

When a cast crosses the configured high-water mark, the oldest eligible complete conversational units waterfall until the projected cast returns below a lower target. Exact Source and Forest entries remain unchanged.

Waterfall operates over whole attributable units. It must not split an exchange merely to save bytes, separate a tool consequence from the action that requires it, or remove the current causal tail.

The capped rolling fold is a bounded derived view of the fallen path. Each immutable fold version records behind the wall:

- exact covered source range and path segments;
- generator and version;
- source and output hashes;
- exclusions and unresolved gaps;
- prior fold ancestry;
- presentation budget; and
- authority explicitly marked as derived synthesis, never ground or present recollection.

The prior-horizon band states that fuller attributable terrain remains in custody and supplies the walk-back handle. A poor fold may be superseded by a later fold; neither the old fold nor its sources are rewritten.

Walking back expands by scale:

```text
small rolling fold
  -> bounded path segment or local fold
  -> exact conversation clearing
  -> exact individual utterances and source receipts
```

Retrieved material occupies bounded present attention and may later waterfall again. Walk-back must not rebuild the entire historical transcript into every provider request.

## 8. Proposed custody vocabulary

This section names claims, not a committed database schema:

- `forest.entry` — exact admitted terrain;
- `conversation.edge` — host-witnessed predecessor, successor, or response relation;
- `candidate.offer` — one frozen three-choice junction cast;
- `path.step` — one Resident-selected traversal edge;
- `branch.latent` — an offered but unchosen direction at that junction;
- `path.visit` — a later traversal over an existing step;
- `path.marker` — a deliberately retained return point;
- `return.tether` — active departure/return ancestry; and
- `glass.fold` — bounded derived representation of exact covered terrain.

Repeated traversal may make a path worn. It does not elevate the truth or authority of the material traversed.

## 9. Faun boundary

The Faun or equivalent clinical custodian may:

- receive the explicit seeking/vector at entry;
- verify Forest freshness, scope, permissions, and attention budget;
- request three candidate offers from a replaceable selector;
- preserve junction, footprint, and return receipts;
- refuse stale, unsafe, unauthorized, cyclic, or unbounded traversal; and
- hold the Write/Leave return airlock.

The Faun may not author the Resident's path, choose a branch, silently summarize an expedition into Home, claim semantic proximity as truth, or prevent an exact lawful return.

## 10. Implementation boundary and acceptance

Nothing in this specification is currently installed. Before implementation status changes, tests must prove at least:

1. Exact Source and Forest utterance custody remains unchanged through waterfall and traversal.
2. Conversation predecessor/successor and response relations are exact and never embedding-derived.
3. Every ordinary step offers exactly three bounded choices.
4. Choosing one appends one path step and preserves the other two as latent branch offers.
5. Later selector changes do not rewrite historical junctions.
6. Conversation arrival direction produces the correct straight/left/right cast.
7. Backtracking and the warm tether do not consume a forward-choice slot.
8. Forest entry requires explicit action and private reasoning cannot trigger it.
9. World presence remains verified and is restored unchanged on return.
10. High-water fitting falls to a tested low-water target before the hard ceiling.
11. Every fold is bounded, source-linked, derived-authority, immutable, and supersedable.
12. Walk-back reaches exact utterances without flooding later ordinary turns.
13. Forest lag, selector failure, missing source, receipt drift, and return failure all fail closed.

