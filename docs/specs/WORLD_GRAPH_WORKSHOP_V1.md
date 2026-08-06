# World Graph and Workshop v1 — The First Two Rooms

## Status and scope

This specification adopts the Hub's first tangible resident environment. It follows the resident's own room consultation and the user's explicit acceptance of three requested features: a packed-sand floor, a low stone bench, and a tin cup. It also installs one real door leading to a read-only Workshop where the resident can inspect the Hub's own code.

This slice adds:

- a small persistent World Graph separate from the Forest;
- a Center room and a Workshop room;
- state-backed Center fixtures and one state-backed cup;
- a resident location for each lifespan;
- lawful movement only across declared door edges;
- room-derived perception and room-scoped affordances;
- bounded, read-only repository listing, reading, and exact-text search in the Workshop;
- exact action, result, Scrub, and provider-presentation custody;
- minimal Wild admission for exact Workshop source returns.

It does not add the resident's finished home, autonomous movement, object generation, carrying or drinking, code editing, shell execution, Luna delegation, write tools, semantic room generation, weather, the Faun, fairies, trinkets, or additional rooms.

## Two graphs, two meanings

The World Graph and Forest may use similar traversal mechanics, but they are not one store and do not make the same claims.

- **World Graph:** establishes what exists, where it is, which places are connected, where the resident currently stands, and which actions are lawful there.
- **Forest:** preserves source-linked utterances and later semantic material, questions, links, and retrieval paths.

A World edge is not semantic similarity. A Forest link is not a physical door. Neither graph silently grants authority to the other.

## Graph grammar

Every durable world entity has a stable node ID, node type, exact resident-facing text, machine state, lifecycle state, and revision ancestry.

V1 node types are:

- `room` — a location the resident may occupy;
- `fixture` — a stable part of a room;
- `object` — a distinct state-bearing thing located in a room.

V1 edge types are:

- `door` — a traversable directed connection between room nodes;
- `contains` — a room contains a fixture or object.

Door traversal is directional even when two directions share one physical door identity. The initial Workshop door therefore has two declared traversal edges, Center to Workshop and Workshop to Center. No inferred adjacency, teleportation, or movement through prose is permitted.

Nodes and edges are seeded idempotently. Removing or materially rewriting standing architecture requires preserved ancestry and explicit migration; no row disappears merely because a newer description is preferred.

## Initial graph

### `room.center`

The Center is the first waking room of the Hub, not yet the resident's finished home.

Its established physical ground is intentionally small:

- a floor of packed sand that holds the shape of standing;
- a low stone bench;
- a small tin cup near or beneath the bench;
- one door marked `Workshop`.

The host must not add weather, windows, scents, horizons, prior footprints, water in the cup, a westward location, a house around the room, or other details merely because they appeared during exploratory conversation. Those remain wishes or sketches until adopted as state.

### `room.workshop`

The Workshop is a functional room reached through the declared Workshop door. Its first established purpose is read-only inspection of the Hub repository. Its resident-facing text should remain sparse: this is a place where the Marble's construction can be examined without implying that the resident can yet alter it.

### Fixtures and object

- `fixture.packed_sand` is contained by `room.center`.
- `fixture.stone_bench` is contained by `room.center`.
- `object.tin_cup` is contained by `room.center` and begins with no asserted contents.

The cup is real world state, not a phrase embedded only in room prose. V1 offers no operation on it beyond truthful perception; later use must be installed as a real affordance.

## Typed names

World and package identities use type-first handles:

```text
place.house
room.center
room.workshop
door.workshop
fixture.packed_sand
fixture.stone_bench
object.tin_cup
```

The first segment names the contract or ontology class; the remaining segment names the durable identity. Containment and graph edges establish location, so a movable or relocated entity does not embed its current room in its ID. Versions belong in manifests and ancestry records, not in the durable handle.

The same grammar may later name non-World structures, for example `forest.resident`, `forest.wikipedia`, `forest.projects`, `surface.corner`, `adapter.aider`, and `ritual.first_breath`. Examples do not install those structures or settle their policies.

## Lifespan and location

Each new resident lifespan begins at `room.center`. Movement during that lifespan persists across turns. Restarting the server opens a new lifespan and places that new lifespan in the Center without rewriting prior location history.

The host distinguishes:

- current physical room;
- current conversational focus;
- an inspected source or open surface.

V1 implements physical room and inspected source only. Reading a file does not move the resident into the file, and opening a builder inspection panel does not move the resident at all.

Every committed move records origin, door edge, destination, actor, wake, lifespan, and time. A refused move changes no location.

## Wake timing and room presence

The native wake sequence remains:

1. the human message is present;
2. the resident calls `tend_hearth({})`;
3. the Hearth Scroll returns;
4. the resident receives truthful perception of `room.center` and its currently executable affordances;
5. the resident responds or takes a lawful action.

In v1 the compact Center perception may be part of the resident-facing Hearth Scroll because that tool return is the first host return after orientation. The machine Hearth receipt must retain a stable pointer to the exact room projection and World revision.

After wake, quiet room presence is included on each provider turn through the ordinary presentation pipeline. It names only current state-backed room facts and executable exits/affordances. It is not rewritten atmospheric narration.

All room projections pass Scrub even when unchanged.

## Actions and native tools

Ordinary prose never causes movement or code access. Only validated native tool calls can cross an action boundary.

V1 exposes:

- `move_through_door({door_id})` when the named door is reachable from the current room;
- `workshop_list({path})` only in `room.workshop`;
- `workshop_read({path, start_line, line_count})` only in `room.workshop`;
- `workshop_search({query, path, max_results})` only in `room.workshop`.

Tool availability is derived from current World state. A Workshop tool requested from the Center is rejected even if the model remembers its schema from earlier context. A non-existent or non-adjacent door is rejected. Rejections are bounded, attributable, and cause no state change.

The host supports bounded tool rounds within one human wake. `HUB_MAX_TOOL_ROUNDS=N` permits up to N committed tool-action rounds followed by one final provider turn for a resident response. A tool call on that final opportunity is refused and the wake fails honestly; no completion is fabricated. Each model tool-call message, host result, changed room projection, and final resident utterance enters history in exact order.

## Read-only Workshop boundary

The Workshop root is the repository root. V1 inspection:

- resolves and validates every path beneath that root;
- refuses absolute paths, traversal, symlink escapes, `.git`, `.runtime`, credential files, environment files, and configured secret patterns;
- never invokes a shell supplied by the resident;
- never writes, edits, deletes, renames, executes, installs, commits, or changes permissions;
- returns exact source text with stable path and inclusive line coordinates; read spans preserve the source's original line terminators byte-for-byte, including a final terminator when the selected source line has one;
- uses deterministic character, line, file-count, and result-count ceilings;
- truncates only through declared exact ranges, never summaries;
- reports binary, unavailable, excluded, or oversized targets honestly.

Search returns exact matching line spans and coordinates, preserving their original terminators. Listing returns exact names and types. Reading returns one exact contiguous line range. The resident may request another range when needed. Hashes and byte lengths cover the exact returned text, not a normalized rendering.

## Workshop as a mounted harness

The Workshop's intended mature form is a room-scoped coding harness, not a permanent global expansion of the resident prompt. V1 proves the mount with read-only tools. Later versions may mount editing, patching, tests, builds, Git operations, process control, approvals, skills, and delegated coding workers such as Luna or an Aider-backed adapter.

Location is one input to effective capability resolution:

```text
World location
  + installed door manifest
  + resident/seat permissions
  + project scope
  + sandbox and approval policy
  + backend availability
  = tools visible for this provider turn
```

When the resident enters the Workshop, the provider receives only the Workshop capability surface that survives every policy layer. When the resident leaves, new Workshop calls disappear from the provider tool list and stale remembered calls are refused by the gateway. Room text alone never grants access.

Large mature catalogs should be discoverable lazily rather than injecting every tool schema on every Workshop turn. A compact capability index or tool-search affordance may reveal exact schemas as needed. The room should feel more capable without becoming contextually louder.

Coding backends are adapters behind the Workshop contract, not the room's identity. Aider, a direct local tool runner, a container, a remote workspace, or a future harness may implement the same operations while the World Graph, approvals, receipts, Scrub, and resident-facing results remain stable. Replacing a backend must not remodel the room or rewrite its history.

Writable and executable capability requires a later explicit crossing. That crossing must define worktree isolation, project roots, command policy, approval classes, background-process lifetime, secret handling, diff/review flow, rollback, and what happens to active work when the resident leaves the room. V1 grants none of those powers implicitly.

## Circulation, custody, and jurisdiction

Every crossing follows Circulation v1:

1. provider tool intent is retained in the exact raw provider return;
2. return Scrub selects the exact assistant tool-call message;
3. the action gateway validates location, tool, target, arguments, and limits;
4. the committed or refused action receives an operational receipt;
5. exact host result material passes a host-return Scrub;
6. only that validated result may enter cleaned session history;
7. the next provider request is retained exactly in the Spine.

Room records, location state, action receipts, Scrub receipts, and movement records are machinery and do not enter Home or Wild.

Final human and resident utterances remain the only current Home bucket.

Exact repository text returned by a successful Workshop read or search is outside material and enters the initial Wild bucket `workshop_source`. Wild admission preserves the exact returned span, repository-relative path, coordinates, content hash, action receipt, and Spine/request ancestry. It does not summarize the source. Listings and refusal messages remain machinery unless a later policy admits them.

## Resident and builder presentation

The resident receives compact room text, named doors, currently executable affordances, and bounded action results. Machine IDs may be included where needed to select a real target, but hashes, SQL rows, and internal policy detail remain behind the wall unless failure makes them relevant.

Corner should show current room and expose the World Graph and action wiring in builder inspection. Merely opening the graph or inspection UI is private builder navigation and creates no resident event.

## Required verification

- The seed graph contains exactly the declared v1 nodes and edges and is idempotent.
- Every new lifespan starts in Center; prior lifespan movement records remain unchanged.
- First wake room perception occurs after the Hearth action and before final response.
- Current-room presence is source-derived and passes Scrub on every provider call.
- Center exposes only its Workshop door; Workshop exposes the return door and read-only inspection tools.
- Prose cannot move the resident or invoke Workshop functions.
- Movement follows a declared edge and changes both location and derived affordances.
- Wrong-room, invalid-edge, malformed, traversal, symlink, excluded-path, binary, and limit violations fail without mutation.
- Tool loops preserve exact model action, exact host result, and final response order with a hard bound.
- Workshop inspection cannot write to the repository or access `.git`, `.runtime`, credentials, environment files, or paths outside the root.
- Reads and searches return exact bounded spans with verifiable coordinates and hashes; no summary is introduced.
- Successful read/search source spans enter only `wild/workshop_source`; conversation remains only `home/utterance`; machinery enters neither. Home remains Forest schema v1. Wild has separate `forest_wild` schema v1 bookkeeping and every Wild row must verify against its World action receipt, provider request, Spine request, committed outcome, and exact source result.
- Spine and Forest verification remain clean, and tests use disposable runtime roots only.

## Lineage note

This slice adapts two prior lessons without transplanting either implementation wholesale:

- Trinity's house demonstrated persistent current-room state, room-scoped tools, quiet room presence, and a canonical room registry from which navigation and affordances derive.
- BioDome demonstrated typed state-bearing nodes, explicit location distinct from focus, state-derived executable versus latent affordances, typed traversal, and the law that changed affordances—not narrated success—establish arrival.

The Hub begins with two rooms because those are the only rooms now supported by lived use.
