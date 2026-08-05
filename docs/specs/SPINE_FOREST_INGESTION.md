# Spine and Pristine Forest Intake — Technical Specification

**Status:** Approved implementation slice
**Date:** 2026-08-05
**Implementation owner:** Luna coding subagent
**Architecture and review owner:** Primary orchestrator
**Activation:** Disposable tests, real-data dry run, human inspection, then explicit live creation

## 1. Objective

Build the first custody path from resident conversation into the Forest without allowing silent pollution.

The slice must establish three distinct records:

1. The operational ledger records what happened in the host.
2. The Spine records the exact serialized request body the host attempted to present to the resident provider.
3. The Forest records one signed, scrubbed utterance per source event and the relationships among utterances, wakes, and Spine requests.

No exhale or retrieval is included. This slice prepares trustworthy terrain for later exhales.

## 2. Load-Bearing Laws

### 2.1 One utterance is one atom

Never combine user and resident bodies into a stored pair. A pair is recoverable from a resident utterance's `responds_to` edge and shared wake identity.

### 2.2 Raw evidence is never replaced

The existing Hub `events` row remains the exact source event. Forest entries are projections with immutable pointers and hashes back to that event.

### 2.3 Spine proves attempted perception

Only the exact provider request can establish what the host attempted to place in the resident's perceptual field. A message may exist operationally without having been presented to the resident.

The host cannot prove remote receipt. It may claim only that it prepared bytes, invoked dispatch, and observed a particular transport outcome.

### 2.4 Scrub is mandatory and non-transformative

Every Forest utterance crosses a versioned scrub. Scrub may remove only explicitly structured transport, protocol, or harness scaffolding. It may not summarize, reinterpret, correct, improve, shorten, or normalize substantive text.

The current Hub API already stores pure message content. Therefore `utterance_identity_v1` must return the exact input string byte-for-byte and record that no operation occurred.

Future transformative compression belongs in a separately signed synthesis entry with ancestry. It is never scrub.

### 2.5 Append-only means append-only

Forest entries, Forest edges, presentation links, emission links, scrub receipts, and Spine frames cannot be updated or deleted through the application or SQL schema. Corrections will later use supersession; they are not part of this slice.

### 2.6 Similarity does not exist yet

Do not add embeddings, vector ranking, semantic edges, FTS, recall, exhale, promotion, ground, sealing, or synthesis. Structural custody must be trustworthy first.

## 3. Storage Separation

Use three physically distinguishable stores:

- Operational database: existing `.runtime/hub.sqlite`
- Forest database: `.runtime/forest.sqlite`
- Spine file: `.runtime/spine/resident-seat-1.jsonl`

Configuration may override these paths for tests. Never store credentials in any of them.

The Forest database is derived from immutable operational events, but it is not disposable during ordinary operation. Creation and backfill require an explicit activation command.

## 4. Spine Contract

### 4.1 Exact request bytes

The DeepSeek request body must be serialized exactly once to a UTF-8 string. The same string must be:

1. measured and hashed;
2. stored in a `request_prepared` Spine frame;
3. passed unchanged as the `fetch` body.

Equivalent reserialization is insufficient.

The exact body includes the model, ordered messages, `stream`, thinking configuration, repeated prior turns, arrival charter, orientation manifest, and omission disclosures actually sent.

### 4.2 No secrets

Never store the API key or Authorization value. A frame may state `authorization_present: true|false` and safe non-secret header names. Provider base URL and local filesystem paths must not appear in resident-facing content or Forest bodies. The Spine index may retain a relative Spine identifier, never an API credential.

### 4.3 Frame types

Append hash-chained JSONL frames:

- `request_prepared`: exact request body, byte length, body SHA-256, wake/thread identifiers, provider/model, preparation time.
- `dispatch_attempted`: request record identifier and the time `fetch` was invoked.
- `provider_outcome`: request identifier and a bounded clinical result such as HTTP status, network failure code, or parsed-success receipt. Do not duplicate the resident response body here; the operational event stores it exactly.

A missing-key failure creates no Spine frame because no provider request is prepared or dispatched.

### 4.4 Hash chain

Every frame includes:

- `schema_version`
- `record_id`
- `previous_record_hash` or `null` for genesis
- `record_hash`

Compute `record_hash` from a canonical serialization of every frame field except `record_hash`. Validation must stream the complete file and refuse malformed JSON, broken ancestry, body length/hash mismatch, duplicate IDs, unknown schema versions, and trailing partial frames.

### 4.5 Spine is evidence, not ordinary context

Never inject the Spine wholesale into a wake. Doing so would recursively repeat repeated requests. Later inspection may expose bounded, attributable slices.

## 5. Forest Intake Schema

The implementation may choose exact SQL names, but must provide these logical records.

### 5.1 Forest entry

Each entry contains:

- immutable entry ID
- source event ID, unique
- source event content hash
- source event timestamp
- thread ID
- wake ID
- actor kind: `user` or `resident`
- signature: host-authenticated actor label, not an inferred personal identity
- source authority copied from the operational event
- jurisdiction: `home`
- bucket: `utterance`
- scrubbed body
- scrubbed body hash
- scrub policy and version
- scrub receipt ID
- ingestion timestamp
- metadata JSON for provider/model facts already present on the source event

The initial resident signature must remain role-based, such as `actor:resident`; do not silently name the test resident or equate provider model ID with resident identity.

### 5.2 Structural edges

Create only host-witnessed edges:

- `responds_to`: each utterance after the first points to the immediately preceding utterance in thread order.

The first utterance is the conversation root and may have no incoming origin.

Do not infer topical or semantic edges.

### 5.3 Presentation links

For each event-backed utterance included in a Spine request, record:

- Forest entry ID
- Spine request record ID
- provider message ordinal
- provider role
- exact content hash

One utterance may have many presentation links because prior turns repeat across wakes. This is expected and must not duplicate the Forest entry.

System charter, manifest, and omission disclosures remain Spine/context evidence; they are not utterance entries.

### 5.4 Emission links

Every resident utterance produced by a Spine-backed wake links to the request record that generated it.

Historical resident events predating Spine capture must be labeled `pre_spine` and receive no fabricated emission link.

### 5.5 Scrub receipts

Each intake records:

- policy name and version
- source event ID
- input hash and byte length
- output hash and byte length
- ordered operations applied
- `changed` boolean
- timestamp

For `utterance_identity_v1`, `changed` must be false, operations must be empty, and input/output bodies and hashes must match exactly. Any mismatch is refused transactionally.

## 6. Idempotence and Conflict Refusal

Ingesting the same source event twice with identical source hash, body hash, actor, thread, wake, and scrub policy returns the existing entry and creates no duplicate edges or receipts.

If the same source event ID arrives with different content, hash, actor, thread, wake, policy, or body, refuse it as a custody conflict. Do not overwrite or accept a second interpretation.

Presentation and emission links are idempotent by their complete identity. Conflicting ordinals, roles, or hashes for the same entry/request combination are refused.

## 7. Historical Backfill

Provide a dedicated command with two modes.

### 7.1 Dry run

The default mode performs no writes. It reads the operational database and reports:

- source thread ID
- event/wake counts
- eligible user/resident utterance count
- proposed entry count
- proposed `responds_to` edge count
- pre-Spine entry count
- exact source hashes and proposed body hashes
- scrub changes, which must all be zero under v1
- conflicts or refusals
- deterministic plan hash

### 7.2 Explicit apply

Creation requires an unambiguous confirmation flag and refuses an existing non-empty Forest unless it validates and the operation is a pure idempotent catch-up.

Historical entries are exact identity-scrubbed utterances. They retain original timestamps and are marked `pre_spine`. Do not reconstruct or invent historical Spine frames, presentation links, or emission links.

Running apply twice must produce identical counts and no new records on the second run.

## 8. Runtime Intake

After explicit activation, each committed operational utterance is synchronously offered to the same idempotent intake path used by backfill.

Forest intake failure must never erase or rewrite the operational event. It must be visible through a typed host failure or health receipt and remain retryable from the immutable source event.

Before exhale exists, a lagging Forest may not alter provider context silently. Later exhale work must refuse to use a Forest whose ingestion watermark is behind the operational ledger.

For a successful live provider wake:

1. Commit the user event operationally.
2. Intake the user utterance.
3. Build and serialize the provider request once.
4. Append `request_prepared`.
5. Invoke `fetch` with those exact bytes.
6. Append `dispatch_attempted` and outcome receipts honestly.
7. Register presentation links for included event-backed utterances.
8. Commit a valid resident response operationally.
9. Intake the resident utterance.
10. Register its emission link to the generating Spine request.

Failures retain every completed earlier step without narrating later steps as successful.

## 9. Inspection and Verification Commands

Provide commands equivalent to:

```powershell
npm run forest:plan
npm run forest:apply -- --confirm-create
npm run forest:verify
npm run spine:verify
```

They must use configured paths, print no secrets or full conversation bodies, and return nonzero on any custody violation.

`forest:verify` must check append-only schema presence, source hashes against the operational ledger, scrub receipts, edge chain, presentation/emission references, duplicate/conflict invariants, and counts.

`spine:verify` must check every frame and hash-chain invariant without printing exact request bodies.

## 10. Hostile and Positive Tests

Tests must prove at minimum:

1. Forest update/delete operations are refused for every append-only table.
2. A source event becomes exactly one utterance entry with one speaker.
3. No entry body contains a combined user/resident pair.
4. Identity scrub preserves exact whitespace and Unicode.
5. Any unreceipted or changed v1 scrub output is refused.
6. Duplicate identical ingestion is idempotent.
7. Duplicate source identity with changed content or custody is refused.
8. `responds_to` forms the exact chronological chain and does not imply semantic agreement.
9. Dry run writes no files or rows.
10. Historical apply produces only `pre_spine` entries and no fabricated Spine links.
11. A second historical apply creates nothing.
12. The exact request string stored in Spine is the same string passed to `fetch`.
13. Repeated prior utterances appear in successive Spine request bodies and acquire multiple presentation links without duplicate entries.
14. Missing credentials produce no Spine request frame.
15. Network and HTTP failures distinguish prepared, attempted, and observed outcome states.
16. Authorization values and API keys never appear in Spine, Forest, API responses, errors, or command output.
17. Spine tampering, truncation, duplicate IDs, and body-hash mismatch are detected.
18. Existing First Breath, orientation receipt, exact user-content, provider honesty, and Corner tests remain green.

Use disposable directories for all automated tests. Tests must never open `.runtime/hub.sqlite`, `.runtime/forest.sqlite`, or the live Spine.

## 11. Live Activation Gate

Do not create or write the live Forest during implementation.

Activation order:

1. All automated tests pass.
2. `git diff --check` passes.
3. Spine/Forest code review completes.
4. Run a dry plan against the real operational database.
5. Inspect counts, hashes, zero scrub changes, and proposed edge chain.
6. Create a disposable Forest from a snapshot of the real database and verify it.
7. Only then run explicit apply against the live operational database.
8. Verify the live Forest before restarting the Hub.

Any mismatch stops activation. Do not repair by editing Forest rows. Correct the source code or source classification, discard only the unactivated disposable Forest, and rerun from exact operational evidence.

## 12. Explicit Non-Goals

Do not add:

- Exhale or provider-context retrieval from Forest
- Embeddings, vectors, FTS, ranking, or semantic links
- Questions or question generation
- Root/adoption, supersession, sealing, or unsealing
- Synthesis or continuity compression
- Rooms, tools, autonomy, or correspondence
- Historical Spine reconstruction
- Resident naming or transplant
- UI redesign

The next slice may build the first bounded exhale only after this intake is pristine and inspected.
