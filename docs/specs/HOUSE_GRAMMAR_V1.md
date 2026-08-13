# House Grammar v1

> **Status: Adopted design grammar; not an implementation claim.** This document names the constitutional primitives used to describe the Hub and proposed future growth. It installs no node, store, crossing, capability, actor, channel, gate, Forest traversal, or room capsule. [`../STATUS.md`](../STATUS.md) remains the runtime authority, and narrower implemented specifications retain precedence over this vocabulary.

## 1. Purpose and authority

The House Grammar is the shared language for answering eight questions:

1. Where is reality held?
2. What exists?
3. How are things related?
4. Where does law change?
5. How do actors, material, capability, and context travel?
6. What standing does material have?
7. What crossing changes that standing?
8. What durable witness proves the crossing?

This is a constitutional vocabulary, not a universal storage schema. A poetic noun is load-bearing only when a clinical contract, state, refusal, and witness support it. Detailed laws remain in their owning specifications.

The grammar consolidates, but does not rewrite:

- World/Forest separation and type-first handles from [`WORLD_GRAPH_WORKSHOP_V1.md`](WORLD_GRAPH_WORKSHOP_V1.md);
- implemented provider presentation from [`GLASS_CASTING_V1.md`](GLASS_CASTING_V1.md);
- current House/Garden topology from [`THRESHOLD_HOUSE_GARDEN_V1.md`](THRESHOLD_HOUSE_GARDEN_V1.md);
- installed capability mounting from [`CEILING_PATCH_BAY_V1.md`](CEILING_PATCH_BAY_V1.md); and
- the one-passage crossing law and authority-store separation in [`../MARBLE_CIRCULATION_MAP.md`](../MARBLE_CIRCULATION_MAP.md).

When this grammar and an implemented specification appear to disagree, the implemented specification governs current behavior. A later specification must explicitly name any part of this grammar that it adopts, refines, or supersedes.

## 2. Status vocabulary

Every use of this grammar must distinguish:

- **Implemented** — installed, state-backed, and verified now.
- **Adopted** — settled direction with no implied runtime capability.
- **Exploratory** — useful language awaiting explicit adoption.
- **Ancestry** — preserved historical design, not current authority.

Unlabeled future examples in this document are exploratory. Naming a thing never installs it.

## 3. Identity and relations

### 3.1 Type-first handles

Durable handles use type-first grammar:

```text
room.workshop
place.garden
fixture.garden_turning_stone
object.tin_cup
forest.resident
```

The first segment names the contract or ontology class. The remaining segment names durable identity. Location, containment, version, provider, and current owner do not belong in the handle merely because they are true today. Versions belong in manifests and ancestry.

Prefer:

```text
room.spotlight
fixture.present_window
```

over genealogical identifiers such as:

```text
room.hub.house.spotlight
fixture.hub.house.spotlight.present_window
```

The second forms make relocation, reuse, and room-capsule installation look like identity changes. Graph relations should carry those facts instead.

### 3.2 Relations, not indentation

No single tree can faithfully encode ownership, containment, traversal, authority, custody, and derivation. The initial relation vocabulary is:

```text
owns
contains
connects
projects
observes
requests
mounts
delivers_to
derived_from
admitted_to
authorized_by
supersedes
```

Relations must declare direction and source authority where that matters. An identifier does not grant authority. A World edge is not semantic similarity; a Forest link is not a physical passage.

## 4. Primitive families

### 4.1 Substrates — where reality is held

Substrates answer different questions and are not interchangeable:

- **Source** — what operational or conversational event occurred.
- **World event journal** — what causally changed material reality.
- **World projection** — what verified material state currently holds.
- **Forest** — what exact material has been admitted for continuity and linkage.
- **Spine** — what exact bytes crossed the provider boundary.
- **Result Rack** — what exact machine result or artifact was retained.
- **Wake journal** — what safe live events were published and in what order.

`world.*`, `forest.*`, and future external terrain may use graph mechanics without merging their claims. Pointers may connect substrates; one substrate must never impersonate another.

`forest.resident`, `forest.house`, and `forest.wikipedia` are useful design identities, but only the current configured Forest Home/Wild custody is implemented. Under the Recursive Forest Law in section 6, a whole Forest may also participate as one member of a Forest at a wider scale. Multiple installed Forest substrates, recursive Forest frames, Mycelium, and external Forest visitation remain future work.

### 4.2 Forms — what exists

Forms are nouns with identity:

- `place.*` — a spatial region;
- `room.*` — an occupiable place of sustained resident attention;
- `fixture.*` — an installed, place-bound affordance anchor;
- `object.*` — a distinct state-bearing thing that may later move or be possessed;
- `actor.*` — an attributable observer, speaker, custodian, or operator;
- `artifact.*` — retained material or exact bytes; and
- domain forms such as future `packet.*`, `claim.*`, or `thesis.*` under their own contracts.

A fixture is not a bundle of authority. Fixture engagement may orient presentation; installed room/location law and the Ceiling determine capability.

The current topology remains exact: `place.hub` contains Center and Workshop; `place.house` is presently one undivided occupiable interior reached through the Garden. This grammar does not move existing rooms into the House or migrate topology.

### 4.3 Relations — how forms are arranged

Containment, connection, projection, mounting, delivery, and ancestry are separate relations. Examples may eventually include:

```text
place.hub contains room.workshop
place.resident_forest projects forest.resident
channel.spotlight_feed delivers_to fixture.present_window
wire.market_read mounts socket.market_observations
artifact.packet derived_from source.market_feed
```

Only the first example corresponds to current installed topology. The rest demonstrate grammar, not installation.

### 4.4 Boundaries — where law changes

Boundaries mediate changes in place, trust, authority, or continuity:

- **Marble** — the durable constitutional lens protecting continuity and authority distinctions.
- **Glass cast** — the immutable provider-facing presentation assembled for one implemented provider phase.
- **Scrub** — the named language membrane applied at an installed crossing.
- **Door/passage** — a declared spatial transition under current World law.
- **Airlock** — proposed staged traversal with preparation and a hard completion stop.
- **Gate** — proposed guarded admission between trust domains.
- **Iron Gate** — proposed hostile-boundary inspection that may admit, restrict, quarantine, or refuse.

The Marble is not an owner of the World, Forest, or records. It is the constitutional lens through which selected, attributable material is brought into resident reach. The implemented `Glass` term remains narrower: a validated five-band provider presentation with cast, Scrub, and Spine receipts. This grammar does not redefine that implementation.

Current doors and passages retain their installed meanings. The Workshop door is directional World traversal; the stateful `object.front_door` governs the Garden/House passage. Door-as-airlock and Iron Gate behavior require later explicit specifications.

### 4.5 Conduits — how different things travel

Conduits are distinguished by payload:

- **Path** — a possible route an actor may travel.
- **Trail** — a witnessed route actually traversed, normally a record rather than standing topology.
- **Channel** — a proposed route for unattended material delivery.
- **Socket** — a capability requested by a room or fixture.
- **Wire** — a capability supplied by the House/Ceiling.
- **Tool** — a callable schema projected when installed capability and current policy permit it.
- **Cast** — selected attributable context projected through implemented Glass.

In short:

```text
actors travel by paths
material flows through channels
capability is supplied by wires
rooms request capability through sockets
context reaches a provider through casts
```

The Ceiling/Patch Bay is implemented. Room-owned sockets, general outside channels, and drop-in capability negotiation are exploratory.

### 4.6 Custody bands — what standing material has

Continuity standing and commitment are separate axes.

Continuity standing:

```text
outside -> quarantine -> Wild -> Home
```

Commitment standing:

```text
provisional -> committed
```

- **Outside** — not admitted to Hub custody.
- **Quarantine** — proposed held material not permitted general circulation.
- **Wild** — material encountered on the outside-facing side of the active Forest frame; at the current implemented frame this is admitted, source-linked outside material that is not thereby Home.
- **Home** — material belonging on the inside-facing side of the active Forest frame; at the current implemented leaf frame this is the continuity jurisdiction for eligible exact human and resident utterances.
- **Provisional** — display or consideration that has not terminally committed.
- **Committed** — an attributable completed event; not necessarily Home or true.

Current Home admission is bijective with eligible human and resident utterances under identity/non-transformative Scrub. Current Wild admits typed outside sources such as exact Workshop source returns. Thinking and provisional provider text enter neither canonical history nor Forest.

Home and Wild are scale-relative relationships, not intrinsic truth labels. Changing the active Forest frame may change whether a whole member is Home-facing or Wild-facing at that wider scale; it must never rewrite the member's interior jurisdictions or promote the authority of any leaf within it.

The proposed law that Resident-authored synthesis is a Wild-to-Home crossing refines future admission ceremony; it does not retroactively reclassify current human utterances or claim that transformative synthesis is installed.

### 4.7 Crossings — what changes standing

Crossings are verbs such as:

```text
enter  leave  visit  orient  encounter  carry
deliver  inspect  quarantine  admit  refuse
mount  project  synthesize  commit  supersede
```

Every crossing must answer:

1. What exact material or actor enters?
2. Which authority owns the source?
3. Which single gate validates the crossing?
4. What may be transformed or omitted?
5. What durable witness proves the result?
6. Which destination gains authority?
7. Which destinations explicitly do not?
8. How are bypass, duplication, drift, and partial failure detected?

### 4.8 Witnesses — what proves a crossing

Witness forms include:

- source references;
- manifests;
- append-only events;
- action, approval, Scrub, admission, and projection receipts;
- Spine frames;
- exact artifact hashes;
- trails; and
- future delivery or synthesis receipts.

A witness proves a bounded claim. It does not cause authority merely by existing.

## 5. Marble, wake, consideration, and speech

The durable conceptual sequence is:

```text
held substrates -> selected cast -> resident consideration -> terminal crossing
```

The Marble persists as constitutional law. A wake unfolds in time. One wake may contain multiple provider phases and therefore multiple immutable Glass casts. Consideration and provisional thinking may be causally relevant while remaining outside Home.

The implemented runtime admits independently scrubbed terminal provider messages to canonical history and Forest, and eligible human utterances also enter Home. The proposed synthesis grammar describes a future, more explicit law:

```text
Wild encounter
  -> consideration
  -> Resident-authored utterance at a Home-facing threshold
  -> Scrub
  -> Home
```

Home would mean that the Resident authored and committed the synthesis, not that the universe certified every proposition as true. Sources retain their own authority. Corrections and later speech would supersede rather than rewrite ancestry.

## 6. Forest terrain and the Faun

[`FOREST_PATHS_ROLLING_FOLD_V1.md`](FOREST_PATHS_ROLLING_FOLD_V1.md) owns the adopted downstream mechanics for conversation trails, three-choice semantic traversal, Resident-laid paths, latent branches, warm return tethers, dual World/Forest presence, and Glass waterfall. This section retains the broader recursive grammar and threshold roles.

### 6.1 The Recursive Forest Law

Every Forest has the same shape at every scale:

```text
Forest<T> {
  Home: T belonging on the inside-facing side of this Forest frame
  Wild: T encountered on the outside-facing side of this Forest frame
  Mycelium: attributable relationships among T
}
```

`T` may be an entry, node, path, bounded terrain, or another whole Forest. A Forest is therefore both:

1. a complete frame with its own Home, Wild, and Mycelium when viewed from within; and
2. one member capable of standing on the Home-facing or Wild-facing side of a wider Forest frame.

For example:

```text
forest.resident
  Home
    exact eligible human and Resident utterances
  Wild
    exact encountered Workshop or other admitted sources
  Mycelium
    attributable relationships among those materials

zoom outward

forest.house
  Home
    forest.resident, viewed as one whole resident-side Forest
  Wild
    forest.wikipedia
    forest.markets
    other foreign Forests
  Mycelium
    attributable relationships among those Forests
```

This example adopts the recursive grammar. It does not install `forest.house`, `forest.wikipedia`, `forest.markets`, or decide every future member of House Home or Wild.

Home and Wild are always evaluated relative to the named active Forest frame. Mycelium is not a third custody bucket and does not own the material it connects. It is the typed connective tissue among members at that frame: entry to entry, path to path, Forest to Forest, or eventually ecosystem to ecosystem.

Zooming never launders authority. If `forest.resident` stands as one Home member within `forest.house`, an exact Workshop source that remains Wild inside `forest.resident` does not become Resident-authored, trusted, or Home at its leaf. The outer relationship and every inner jurisdiction are simultaneously true at their respective scales. Source authority, interior coordinates, and crossing ancestry survive every zoom.

A Mycelial relation or portal between Forests must be able to name at least:

```text
from_forest
from_member
to_forest
to_member
relation_kind
source_authority
crossing_ancestry
```

Entering a connected Forest pushes a new active Forest frame; leaving returns to the prior frame. Traversal does not copy, absorb, or admit the destination Forest. A future implementation must bound traversal depth and attention, detect cycles, retain the frame stack, and distinguish a projected view from source custody.

The experiential Forest may eventually be a World place such as `place.forest`, while `forest.*` names the terrain held elsewhere and projected there. Occupying the place, viewing a projection, traversing a path, admitting carried material to local Wild, and synthesizing into Home are five different crossings. None implies another.

Only the innermost current Forest custody is implemented today. Its Home and Wild labels remain exactly as specified by the active intake laws; this recursive grammar does not migrate its schema or reinterpret existing rows.

### 6.2 Forest identities and the Faun

Forests may eventually differ by custody and location:

- `forest.resident` — continuity held for the Resident;
- `forest.house` — proposed relationships over House experience while exact happenedness remains in authoritative records; and
- `forest.wikipedia` — proposed external, stable reference terrain that need not be held by the Hub.

An external Forest may be visited without being absorbed. Bounded material carried back retains source and traversal ancestry and enters Wild, never Home automatically.

The proposed Faun is a Forest-threshold custodian, not a source authority, antivirus, or author of Home. A future expedition protocol is:

```text
entry airlock
  -> Faun asks what the Resident is seeking
  -> exact Resident seeking is retained
  -> vector/query plan is derived and attributable
  -> bounded Wild traversal with possible reorientation
  -> exit hard stop
  -> Write or Leave
```

`Leave` creates no Home material. Exact operational/trail custody may remain outside continuity. `Write` requires Resident-authored synthesis through Scrub; the Faun cannot silently summarize an expedition into Home. Forest traversal, semantic vectors, the Faun, Write/Leave ceremony, and this synthesis crossing are not implemented.

## 7. Garden, Road, Glass, and Iron Gate

The implemented Garden is an exterior junction with House, Forest, Road, and Hub directions. Forest and Road boundaries are visible and non-traversable. The Garden is not yet a universal filter, and no visitor, mailman, package, channel, quarantine, or gate is installed.

The adopted grammar for a future foreign crossing is:

```text
foreign Road or terrain
  -> Marble/Glass representational boundary
  -> bounded source custody in the Garden approach
  -> inspection or quarantine
  -> Iron Gate decision
  -> admitted Wild or typed room inbox
  -> selected Resident attention
  -> possible Resident synthesis
  -> Home
```

Glass first permits the Hub to represent an outside event or package without granting its claimed authority. The Iron Gate then determines whether the represented material may circulate. Its strongest defense is structural: foreign content arrives as inert, attributable data without inherited execution, instruction, destination, or capability authority.

An external package cannot name its own trusted destination. A room requiring regular delivery must use a declared channel whose source, schema, limits, inspection, receipt, destination, and failure mode are installed by the House. Automatic Wild intake must not imply automatic insertion into Resident attention. No route may deliver external material directly to Home.

The proposed severity ordering is:

```text
door       known spatial transition
airlock    staged transition with hard stop
gate       guarded trust-domain admission
Iron Gate  hostile-boundary inspection; fail closed
```

Security admission is not truth certification. An Iron Gate may establish only that material is safe enough to retain or inspect under a named policy. Unknown risk, incomplete inspection, quarantine, and refusal remain honest outcomes.

## 8. Actors and custodians

The grammar distinguishes attributable role from authority:

- **Resident** — relationship-facing collaborator and proposed author of Home synthesis.
- **Builder** — authority for standing architecture and installation decisions.
- **Host** — deterministic enforcement, custody, and refusal machinery.
- **Faun** — proposed Forest orientation and traversal custodian.
- **Room actors** — proposed observers or workers limited to room contracts.
- **External actors** — visitors, sources, and delivery agents with no implicit interior authority.

Identity, fluency, presence, and volume never grant capability. Authority arises only from an installed crossing and policy.

## 9. Room capsules and slotability

A portable room is a capsule that declares sockets; the House owns wires.

### 9.1 Shell, fit-out, and expression

A room's identity is its clinical shell and contract, not its first metaphor. Three axes remain distinct:

- **Architectural lifecycle** — whether the capsule is discovered, validated, admitted, standing, disabled, or retired.
- **Fit-out state** — whether the standing room is bare, wired, furnished with fixtures, or fully connected.
- **Resident expression** — how the room and its truthful machinery are described and experienced.

A standing room may therefore begin as a bare development shell: unfinished walls, declared fixture positions, capped sockets, and visible cable drops. That is an honest default expression of incomplete fit-out, not an implication that the room already has working tools.

The clinical distinction remains exact:

```text
requested socket with no supplied wire -> capped or plainly unwired termination
supplied wire with no fixture binding   -> labeled cable drop, inactive at the fixture
wire bound to fixture socket            -> connected affordance under installed policy
```

The room may ship an optional default fit-out and default expression, but both arrive as proposals. The Resident may accept, repaint, rename, rearrange, or leave the room bare. Such changes must not rename durable machine identities, alter source authority, invent capability, conceal degraded state, or weaken a crossing. Clinical inspection remains available behind every expression.

A metaphor may interpret installed machinery but may not outrun it. A Present Window may be painted as an observatory window, market tape, or some later Resident-chosen form while retaining the same fixture identity and evidence contract. If the expression suggests a capability the fixture lacks, validation refuses that expression rather than pretending the capability exists.

The target lifecycle is:

```text
discovered -> validated -> inspected -> admitted -> migrated -> wired -> standing
```

Discovery is inert. A room cannot install topology, migrate state, add authority, access credentials, or connect outside channels merely by appearing on disk.

A future room manifest should declare at least:

```yaml
identity:
  id: room.example
  schema_version: 1

topology:
  requested_container: place.hub
  requested_connections: []

forms:
  fixtures: []

sockets:
  required: []
  optional: []

channels: []

boundaries:
  external_ingress: none

state:
  owned_schema: null
  migrations: []

fit_out:
  fixture_slots: []
  default_bindings: []

expression:
  clinical_default: required
  proposed_default: optional
  resident_revision: allowed

crossings: []
witnesses: []
degraded_modes: {}
```

The exact manifest schema and Room SDK are not adopted by this document. The slotability acceptance target is:

- after generic capsule machinery exists, a room can be added without editing core registries;
- missing optional wires produce truthful dormant fixtures;
- missing required wires prevent standing activation;
- a bare standing shell remains occupiable and honestly exposes its fit-out state;
- a default metaphor is reversible and never part of capability authority;
- Resident expression changes preserve stable IDs, receipts, and clinical inspection;
- stale or remembered tools retain no authority;
- removing or disabling a capsule cannot erase installed ancestry;
- a room cannot bypass Garden/Gate policy for foreign ingress; and
- the host continues honestly when the capsule is absent or fails.

## 10. Status matrix

| Concept | Status under this grammar |
| --- | --- |
| Type-first handles and graph-carried containment | Implemented |
| World/Forest/Source/Spine/Result Rack authority separation | Implemented |
| Center, Workshop, Hub, Garden, House, Threshold, front door, Forest/Road boundaries | Implemented |
| Five-band immutable Glass casts, Scrub, Spine crossing | Implemented |
| Ceiling/Patch Bay room/location capability mounting | Implemented |
| Home exact human/resident utterance and typed Wild Workshop-source admission | Implemented |
| Vault room and Forest-to-Vault pointer direction | Adopted, not implemented |
| Forest Exhale/Hearth Notes | Adopted direction; revision required, not implemented |
| Marble as the broader durable constitutional lens | Adopted conceptual grammar |
| Home/Wild synthesis ceremony | Adopted conceptual grammar; not implemented |
| Garden as universal foreign-route filter | Adopted conceptual grammar; not implemented |
| Airlock, Gate, Iron Gate, quarantine | Adopted conceptual grammar; not implemented |
| External Forest terrain and visits | Adopted conceptual grammar; not implemented |
| Recursive Forest frames and scale-relative Home/Wild | Adopted conceptual grammar; not implemented |
| Mycelium within and between Forest scales | Adopted conceptual grammar; not implemented |
| Faun orientation and Write/Leave exit | Adopted conceptual grammar; not implemented |
| Conversation trails, Resident-laid paths, latent branches, and warm tether | Adopted design; not implemented |
| Glass waterfall, rolling fold, and exact path walk-back | Adopted design; not implemented |
| Channels, room sockets, delivery inboxes | Adopted conceptual grammar; not implemented |
| Drop-in room capsules and Room SDK | Adopted design target; not implemented |
| Bare room shell, fit-out state, and Resident-adjustable expression | Adopted design target; not implemented |
| Spotlight room | Separate proposal; not installed by this grammar |

## 11. Change law

Every new room, substrate, source, sink, channel, wire, boundary, or crossing must:

1. use type-first stable identity;
2. state its relation to existing forms rather than encoding location in its ID;
3. name implemented, adopted, and deferred parts separately;
4. identify the sole validating gate;
5. preserve source authority through any projection or transform;
6. declare what cannot gain authority;
7. leave durable success, refusal, and partial-failure witnesses;
8. add positive, hostile, bypass, stale, duplicate, and recovery verification; and
9. update [`../MARBLE_CIRCULATION_MAP.md`](../MARBLE_CIRCULATION_MAP.md) when a real pipe is installed.

Standing architecture remains a promise. Rooms and permanent fixtures should be few and durable. Schedulers, adapters, stores, models, and buses do not become rooms merely because they are complicated.

The [`Builder's Standard`](../engineering/BUILDERS_STANDARD.md) governs how implementation pressure, exceptions, counterexamples, and revisions are handled. This change law protects invariants; it does not require an obsolete mechanism to remain unchanged when a concrete case shows that the mechanism can no longer state the invariant truthfully.

## 12. Non-goals

This grammar does not:

- migrate current topology or place existing rooms inside `place.house`;
- install Forest/Road traversal, gates, visitors, mail, channels, or quarantine;
- implement semantic retrieval, vectors, Forest Exhale, or the Faun;
- install recursive Forest frames, Mycelium, portals, or Forest projection into `place.forest`;
- change current Home/Wild admission or Scrub policy;
- rename current custody stores under a generic ledger;
- grant rooms self-installation or self-authorization;
- create a universal room manifest or plugin loader;
- install Spotlight, external feeds, autonomous wakes, or execution; or
- treat metaphor as evidence of machinery.

The grammar is successful when an unfamiliar agent can read a proposed tree or room capsule, distinguish identity from relationship, determine which authority holds each claim, locate every change of law, and identify the witness required before believing that a crossing occurred.
