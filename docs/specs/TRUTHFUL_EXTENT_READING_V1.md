# Truthful Extent and Workshop Reading v1

> **Status: Adopted implementation contract, 2026-09-12.** A live Resident document review exposed that exact retained tool results can still become practically discontinuous when bounded projections, action rounds, and later attention omission require the Resident to remember coverage unaided. This revision makes bounded extent and continuation a shared result law and installs document reading as its first proving surface.

## Pressure, classification, and ownership

- Classification: **revising and extending** the Result Rack presentation and Workshop bounded-read protocols.
- Concrete counterexample: the Resident read lines 481–640 of an 816-line manual, later lost that fact from working attention, and reported the same range as unread. Exact custody survived, but navigable coverage did not.
- Protected invariant: bounds remain honest and exact without becoming blinders; source authority survives every projection; omission never masquerades as complete inspection.
- Universal contract: `src/core/truthful-extent.js` owns the authority-neutral truthful-extent value and deterministic validation; Result Rack owns its fitted custody projection. Domain owners supply typed extents and continuation coordinates.
- Proving owner: `src/places/hub/workshop/` owns document structure, exact source ranges, and readable derived projections. World/Gateway retain action and Wild-admission authority.
- Forest owner: `src/forest/` owns incremental jurisdiction and crossing verification. A health check proves provenance and eligibility, not truth, wisdom, or safety of source meaning.
- Explicit non-owners: provider recollection, generated summaries, repository prose, Result Rack pointers, and presentation markup cannot claim coverage, source identity, Forest admission, or truth.

## Universal truthful-extent envelope

Every newly adopted bounded inspection result carries a versioned `extent` object containing:

- the subject kind, stable locator, and exact revision/hash when available;
- requested, examined, and presented extents;
- explicit missing extent;
- `complete`, `partial`, `interrupted`, or `refused` standing;
- a deterministic continuation when further lawful inspection exists; and
- the named presentation transform, including whether it is exact or derived.

Domain coordinates remain typed: line ranges for files, paths for traversal, hunks for diffs, rows/pages for structured documents, time/instrument ranges for observations, and event intervals for logs. A tool without a meaningful bounded extent may declare `not_applicable`; it must not fabricate coordinates.

The envelope is machine metadata, not a summary. Result Rack exact custody and host-return Scrub remain authoritative for what crossed. When Result Rack must truncate the serialized machine result, its projection-level omission disclosure governs what was actually presented; an enclosed source extent cannot override that outer bound. Reopening a bounded projection does not claim access to source bytes omitted from that projection.

## Workshop Reading Desk

The Workshop installs bounded read-only document operations:

1. an outline operation returns exact Markdown heading text, levels, line coordinates, document size, revision hash, and complete/partial standing;
2. a document-read operation accepts a whole document, explicit line range, or exact heading coordinate;
3. a modest eligible UTF-8 text document may cross completely in one action round when it fits the separately declared document ceiling;
4. larger documents return deterministic heading-aware batches and an exact continuation;
5. every result reports authoritative covered and unread spans for that document revision; and
6. a changed file hash invalidates prior coverage instead of merging revisions.

Exact source is primary. An optional readable projection may normalize display-hostile markup or escaping only when it is labeled derived, deterministically reproducible, and linked to exact source ranges and hashes. It never replaces exact custody or becomes automatic Forest material.

Coverage is host-owned and derived from witnessed successful reads, not model-authored memory. It survives provider phases and wakes within the owning session. It grants no authority and makes no claim that the Resident understood the text.

## Forest crossing check

The existing full Forest verifier remains the forensic authority. A new quick check reports, without mutation:

- a deterministic current frontier hash and counts suitable for comparison between runs;
- Home, Wild, and Journal counts by admitted source kind and policy;
- held or unresolved intake offers;
- missing, duplicate, extra, or unknown admission routes;
- exclusion of provisional reasoning, Result Rack/Roots material, Spotlight observations, credentials, and generated reading projections from automatic Forest admission; and
- whether a full forensic verification is required.

The quick check may report `needs_full_verification`; it may never bless unknown ancestry. “Clean” means structurally eligible, attributable, and jurisdiction-correct—not factually true or semantically beneficial.

## Compatibility, persistence, and failure

Existing tool results and Result Rack projections remain valid ancestry and gain no fabricated extent metadata. Existing `workshop_read` remains supported. New coverage should be derived from existing append-only World/Result receipts where practical; any new persistent schema requires an explicit Store Migration Register entry and must not be silently backfilled.

Unknown extent versions, overlapping or impossible ranges, stale revisions, projection/coverage disagreement, and unrecognized Forest source kinds fail closed with bounded codes. No failure may cause automatic rereading, Forest admission, source mutation, or a larger provider crossing.

## Verification

Tests cover complete modest documents, heading outlines, section reads, deterministic large-document continuation, tamper-resistant extent receipts, separate projection ceilings, multi-wake coverage recovery, room boundaries, Result Rack custody, World event compatibility, and quick-check failure on unresolved intake. Existing repository suites continue to cover Workshop path law, Scrub/Spine custody, Wild eligibility, append-only stores, and unchanged legacy results. If a readable normalization transform is later installed, it requires its own provenance and hostile-markup tests. Completion also requires the focused suites, complete suite, `git diff --check`, active-documentation reconciliation, the live quick check, and the full Forest verifier.
