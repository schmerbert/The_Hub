# Binder Window v1

> **Status: Adopted implementation contract.** This specification installs a passive portfolio Window in the Center beside Spotlight's future threshold. It does not install `room.spotlight`, offer a door, refresh Binder, connect Robinhood, or grant financial action authority.

## 1. Adopted shape

The Binder Window is a standing Center fixture and a bounded projection crossing, not a room, iframe, database mirror, or generic Binder client.

```text
The Binder authority
  -> one exact dashboard snapshot
  -> Hub-owned validation and bounded projection
  -> fixture.binder_window in room.center
  -> Resident inspection

through the same glass, when Spotlight later exists
  -> retained past observations
  -> retained present observations
  -> no entry until a separate door installation
```

The Window stands next to the place where a future Spotlight door may be installed. Its existence does not reserve, imply, or make traversable that door. Until Spotlight is separately adopted and installed, looking through the Window truthfully reports that the room beyond is not yet available.

## 2. Change classification and ownership

```text
Feature: Passive Binder Window
Change classification: Extending
Owning subsystems: Binder owns portfolio/dashboard claims; Center owns the fixture; World owns topology; the Hub Binder Window adapter owns validation and Resident projection
Crossing: Exact frozen Binder dashboard snapshot into a bounded Center fixture projection
Protected invariant: Source authority and uncertainty survive presentation; observation grants no refresh or financial authority
Source authority: The Binder dashboard read
Persistent state owner: Binder remains the portfolio/history owner; World retains only fixture installation ancestry
Public contract and callers: binder-window.v1 snapshot -> Hub adapter -> inspect_fixture projection
Explicit non-owners: Corner, World topology, Spotlight experiment, Robinhood, Forest, and provider text do not become portfolio authorities
Failure witness: Dormant/missing, malformed, oversized, stale, incomplete, or source-mismatched projection with no invented values
Migration impact: One backup-confirmed append-only World topology extension; no existing location changes
```

## 3. Source contract

Binder already computes the website dashboard in one server-side read. That dashboard payload is the starting source contract because the web canvas performs no portfolio arithmetic. The Hub must not reconstruct totals from Binder rows, query Binder's database, scrape rendered HTML, or import Binder implementation modules.

The admitted snapshot is an inert JSON document derived from Binder's dashboard read. It carries the dashboard's belts, bodies, totals, historical curve, and declared absences together so the Hub cannot combine observations from different moments. The projection records an exact or canonical source hash, format identity, load time, and the source's available observation times.

Unknown or future fields do not silently acquire meaning. A format revision requires an explicit adapter change. Credentials, account numbers, raw authentication headers, and mutation routes are outside this contract.

## 4. Passive-view law

Inspecting or perceiving the Window must not:

- make a network request;
- ask Binder or The Box to refresh, reprice, or inspect;
- mutate Binder, Spotlight, World portfolio state, or a brokerage;
- turn an absent value into zero;
- recompute Binder totals in the Hub;
- claim that a retained observation is current merely because it is being viewed; or
- admit the projection to Forest Home.

Snapshot production or replacement is a separate operator- or supplier-owned action outside Resident inspection. The Hub may read a configured local snapshot when it composes the adapter; thereafter inspection projects only the admitted frozen value. Missing configuration or a missing file produces an honest dormant Window.

## 5. Near pane and through-glass view

The v1 near pane may show only bounded Binder claims:

- total cost basis, priced market value, priced basis, and unvalued basis;
- counts of objects, lots, belts, and bodies;
- Binder's confidence/completeness claim and observation time;
- bounded position and belt summaries without account identifiers;
- the retained historical curve with measured/carried distinctions; and
- computed absences and holes exactly as Binder declares them.

The Hub renders but does not recalculate these claims. It must preserve `null` as unknown/unpriced rather than translating it to zero.

The through-glass portion is initially explicit absence: Spotlight is not installed and no live observation exists. Later Spotlight work may add a separately sourced far pane containing retained past and present observations. Binder and Spotlight claims must retain separate source marks and timestamps even when visually composed in one Window.

## 6. Privacy and bounds

The Window is personal financial material. The snapshot path and any future remote credentials remain configuration, never topology or committed source. The Resident projection omits account identifiers and is bounded by item count and byte size. Hostile strings remain inert data and cannot become instructions, capability names, destinations, HTML, or tool authority.

The first slice does not claim sealed Vault custody or suitability for remote provider disclosure. Deployment must therefore make the Window's provider visibility explicit. A later security review may require a local-only or sealed-attention presentation policy before real personal data is included in provider requests.

## 7. World installation

`fixture.binder_window` is installed by a forward World topology-extension event after the current Forest-place generation. Existing World stores require a read-only inspection followed by an explicit backup-confirmed migration. Startup never performs the migration silently.

The extension:

- adds the Window fixture and its Center containment edge;
- adds no Spotlight room, door, passage, socket, tool, channel, or brokerage authority;
- leaves every existing lifespan location unchanged;
- remains inspectable with the already installed `inspect_fixture` action; and
- is verified through event replay and projection drift checks.

## 8. Acceptance

The first slice is complete when:

1. a fresh World installs the Window through an exact code-owned extension event;
2. an existing exact Forest World reports a backup-confirmed migration requirement and can be migrated without rewriting ancestry;
3. the Center presence names the Window but offers no Spotlight exit;
4. missing snapshot configuration is honestly dormant;
5. a valid frozen Binder dashboard snapshot produces a deterministic bounded projection;
6. malformed, oversized, hostile, stale, and incomplete material remains bounded or refuses without invented claims;
7. repeated Window inspection performs no network or mutation action;
8. the Resident can inspect the Window through the ordinary fixture boundary;
9. no Binder credentials or private account identifiers enter topology, logs, tests, or committed fixtures; and
10. Status, the Marble Circulation Map, migration register, and Resident presentation inventory describe the installed boundary exactly.

## 9. Deferred

- automatic Binder snapshot delivery or scheduling;
- authenticated remote Binder reads;
- sealed personal-finance custody and provider-disclosure controls;
- Spotlight room installation, furnishings, replay, and door;
- Robinhood observation and brokerage MCP wiring;
- the far-pane composition of retained past and present Spotlight material; and
- any financial mutation, proposal, approval, order, or autonomous wake.
