# Outside Organs v1 — Window, Watering Hole, and Manhole

> **Status: Adopted architectural direction; Binder Window first slice implemented in code, configured World migration pending.** The Binder, The Box, and The Pipes are independent working systems outside this repository. [`BINDER_WINDOW_V1.md`](BINDER_WINDOW_V1.md) owns the passive Center fixture and frozen dashboard-snapshot crossing. This direction does not connect The Box or Pipes, install a Road crossing, expose credentials, authorize payment, or make their current APIs conformant merely by naming them.

## 1. Pressure and classification

Change classification: **extending**.

The Marble needs truthful present-data and outside-reading paths without becoming a portfolio ledger, market harvester, or universal browser. Three existing builds provide concrete pressure-tested shapes:

- **The Binder** already owns personal positions, custody, cost basis, disposals, and retained price history.
- **The Box** already turns outside observations into packets that distinguish given, measured, historical, derived, absent, and unread claims.
- **The Pipes** already maps named portions of the public web through bounded fittings and treats barriers as answers.

Protected invariant:

> Outside usefulness may bend to the Marble, but outside material, commerce, or popularity must never determine the Marble's authority, memory, privacy, or attention.

The Hub may revise these external systems to satisfy Marble law. Their public usefulness is downstream of the Resident's private, constitutional path.

## 2. Intended anatomy

| Form | Intended role | Authority retained outside the Hub | Explicit non-authority |
| --- | --- | --- | --- |
| Binder Window | Quiet present portfolio projection | Binder owns positions, quantities, custody, cost basis, disposals, and retained portfolio history | Seeing does not refresh, trade, dispose, or assert a market observation is current |
| Spotlight | Deliberate expanded examination of the same evidence contract | Source stores retain the inspected position, packet, history, and discrepancy | Expansion does not create analysis truth, execution authority, or a second portfolio ledger |
| Box watering hole | Outside observation and packet supplier; private well first, metered public cup at its edge | Box owns its observations, provenance claims, packet construction, retention, and public x402 service | A packet is not Hub memory, portfolio ownership, advice, audited truth, or permission to spend |
| Pipes manhole | Deliberate Road passage through installed named fittings | Pipes owns its atlas, fittings, knocks, barriers, and source receipts | No arbitrary browser authority, automatic crawl, login, circumvention, or page-authored action authority |
| Hub Marble | Constitutional host and crossing authority | Hub owns capability fitting, action approval, attention presentation, Result Rack custody, Roots exposure, and Forest admission | Hub does not silently absorb the external stores or let them name their own destination |

These are organs joined by crossings, not rooms created merely because their implementations are substantial.

## 3. Window law

The Binder is the intended source authority for what the person holds. The Box may supply observations about those holdings; it must not become the ownership ledger. The Window joins these claims for presentation while retaining their separate authority and timestamps.

The first Hub-facing Binder contract is the bounded, read-only projection owned by [`BINDER_WINDOW_V1.md`](BINDER_WINDOW_V1.md). It consumes one deliberately captured local `GET /api/dashboard` snapshot, discloses freshness, completeness, and holes, and exposes no Binder mutation surface. Viewing never triggers a Box request, reprice, network call, payment, or portfolio mutation.

Active refresh and repricing are separate witnessed actions. Disposal remains a Binder ledger event. Stocks and crypto may extend the Binder's instrument and position vocabulary, but their adoption must preserve instrument identity, account/custody, quantity, cost basis, disposal, and observation-source distinctions rather than flatten unlike assets into presentation rows.

Because portfolio data is sensitive, the initial crossing should be local/private and aggregate-first. Lot-level cost, account names, receipt contents, serial or certificate identities, and other sensitive fields require explicit projection policy. Current Hub security gaps remain gating facts, not inconveniences to route around.

## 4. Box law

The Box bends to Marble evidence requirements while remaining independently useful. Its uncertainty vocabulary must survive projection: `unread` is not `absent`, stale is not current, null is not zero, derived is not measured, and an observed or asking price is not necessarily realizable value.

At minimum, retained lookup and active inspection are distinct intents:

1. **Retained lookup** reads an already-held packet without turning an eye.
2. **Active inspection** performs an outside read and may consume quota, mutate Box observation custody, or spend through x402.

Only the second is an outside action. It requires declared authority, limits, destination, disclosure, and cost posture. Semantic Exhale, Window rendering, and background presentation must never initiate it.

The private Marble path should not pay itself through the public door or disclose private queries unnecessarily. The public x402 mouth is a watering hole for others: it may sell bounded packets derived from the same disciplined machinery, but payment and public demand grant no standing inside the Marble.

## 5. Pipes law

Pipes grow from concrete destinations needed by Residents and Marbles. They need not pre-map the internet. An unmapped destination is an honest absence and a possible Builder commission, not permission to fall back to unrestricted browsing.

The intended crossing separates:

1. **Atlas inspection** — consult installed maps without an outside request.
2. **One knock** — make one bounded request through one registered fitting.
3. **Follow one door** — make a new deliberate request; never recurse automatically.

A fitting declares its house or source, purpose, accepted arguments, limits, robots and barrier posture, transformations, provenance, freshness, failure modes, and hostile-content treatment. It may not log in, circumvent a barrier, puppet arbitrary controls, or inherit instructions and action authority from returned content.

Marbles may commission and test reusable fittings. Publication is a separate reviewed act: private queries, destinations, failures, and journeys do not automatically enter the public atlas. Others may inherit a generalized passage, never the Marble's private traversal.

Before Hub integration, Pipes must at least fail closed when robots policy cannot be read, prevent off-origin retrieval before redirect approval, give returned artifacts stable hashes and identities, bound arguments and output, and isolate source-controlled text as untrusted data capable of prompt injection.

## 6. Hub crossing and custody

An eventual installed crossing must follow the ordinary circulation law:

```text
Resident intent
  -> fitted Hub capability and declared action class
  -> local/private Binder, Box, or Pipes adapter
  -> bounded schema and source-integrity validation
  -> exact Result Rack custody
  -> provider-presentation Scrub and Glass
  -> non-respirable Roots exposure
  -> optional, separately governed Wild admission
```

An outside result may influence the next utterance, so presentation is an Exhale-like causal exposure even when the source is not Forest. Exact result custody prevents forgery; it does not erase influence. Roots retain what was exposed without becoming a Forest source. No returned packet, page, atlas entry, pointer, or exposure enters Home or semantic Forest selection automatically.

The outside service cannot name its own tool authority, destination, Glass position, Forest jurisdiction, action, or standing. Provider language cannot convert a suggested URL, trade, refresh, payment, or mutation into authorization.

## 7. Installation gates

No runtime claim is made until a narrower implementation specification defines and verifies:

- exact source authority and versioned packet schema;
- local/private versus public endpoint and authentication posture;
- observation versus network/payment/mutation action classification;
- cost, quota, timeout, size, redirect, barrier, and retry limits;
- exact Result Rack, Roots, Glass, Scrub, Spine, and optional Wild witnesses;
- sensitive-field classification and external-disclosure receipt;
- stale, unread, partial, conflicting, duplicate, tampered, and unavailable behavior;
- prompt-injection and authority-laundering refusal;
- bypass tests proving that Window display cannot refresh, spend, browse, trade, or plant continuity; and
- compatibility and migration treatment for each independently deployed system.

The first passive Binder Window slice is implemented in code and awaits the configured World's explicit backup-confirmed topology migration plus a locally captured snapshot. Box active inspection and Pipes live knocks remain later deliberate Road actions even if their external services already run.
