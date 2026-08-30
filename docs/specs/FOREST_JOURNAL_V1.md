# Forest Journal v1

> **Status: Adopted for the current implementation slice.** The Journal installs one deliberate Resident-authored planting crossing into Forest Home. It does not install the Stream, Wild expeditions, the Bear/Faun threshold, or the Wild-to-Home return synthesis ceremony.

## Purpose

Ordinary conversation grows Forest Home because it happened between the human and Resident. A Journal entry is different: the Resident deliberately chooses language to keep as a tree. The distinction is authorship ceremony, not elevated truth.

The protected invariant is:

> Nothing becomes `home/journal` because it was merely seen, returned by a tool, selected by retrieval, or left unattended in context. Only an explicit Resident `write_journal` act plants the exact text supplied by that act.

## Installed crossing

```text
Resident provider tool intent: write_journal
  -> exact argument validation and bound
  -> request/Spine + session/wake/tool-call witness
  -> append-only Forest Journal custody
  -> Home terrain: bucket journal
  -> rebuildable semantic projection and ordinary Forest walking
  -> scrubbed host receipt / Session Scroll continuation
```

`write_journal` is a host-owned Resident affordance. It is available independently of World room and remains available during a Forest walk. It does not move the Resident, change World material state, require Builder approval, or make an external call.

The accepted body is exact nonempty Resident-authored text within the installed byte/character bound. The host may validate structure and bounds but may not summarize, improve, complete, normalize, or silently split it. Invalid or oversized input is refused without planting a partial entry.

Each committed entry binds at least:

- entry identity, body, byte length, and body hash;
- `home/journal` jurisdiction and bucket;
- Resident signature;
- session, wake, and tool-call identity;
- provider request and Spine request-record ancestry;
- source timestamp; and
- append-only intake/admission custody.

The exact identity host-return receipt bound by Journal custody remains durable even when Result Rack subsequently creates a second bounded projection receipt for Session Scroll presentation. The projected receipt may fit conversation attention; it cannot replace or erase the exact planting receipt.

Retrying the same witnessed tool call is idempotent. Reusing that identity with different text or ancestry is a custody conflict.

## Forest standing

A Journal entry is Home terrain and may participate in the same rebuildable semantic candidate and walking surfaces as an admitted Home utterance. It gains no special score, truth rank, memory claim, or immunity from contradiction merely because it was deliberately planted.

Journal entries are not conversation turns. They do not enter the `responds_to` chronology, do not become assistant messages in Session Scroll, and do not alter the immediate-predecessor law for ordinary utterance admission. Their traversal chronology is therefore empty unless a later specification installs Journal-native relations. Semantic paths may still reach and leave them normally.

Exact Journal text may later be quoted in speech, but the quote is a new utterance with its own custody. Ordinary resident speech never becomes a Journal entry retroactively.

## Exclusions and failure law

The following do not cross this boundary:

- Binder snapshots or Binder Window inspection results;
- Workshop/Wild source packets;
- Result Rack projections, Roots exposures, or semantic feathers;
- private reasoning or provisional provider fragments;
- host-authored summaries;
- text inferred from silence, refusal, cancellation, or a failed action; and
- a future Wild expedition merely because it returned to the Stream.

Admission fails closed if exact tool, request, Spine, or Forest custody cannot be established. Result presentation cannot substitute for a committed Journal entry.

## Store and migration posture

Journal custody is an additive append-only companion to the existing Forest generation. Opening an existing verified Forest may install an empty Journal companion schema because this creates no historical entries, reclassifies no utterances, and fabricates no ancestry. Existing Forest rows and hashes remain byte-for-byte unchanged.

Verification must cover schema identity, append-only triggers, exact body hashes, unique witnessed tool-call identity, intake/admission pairing, and request/Spine ancestry. A malformed companion fails Forest activation; startup must not repair or reinterpret its rows.

## Deferred Stream law

The adopted next terrain is:

```text
Home -- Stream -- Wild
```

A log or bridge provides the crossing. Before entry, the Bear asks why the Resident is going; at the metaphor layer this is the Faun acting as threshold custodian. On return, raw Wild packets may not cross into Home. Only an explicit Resident synthesis or utterance may leave Wild across the Stream. `Leave` remains a lawful return with no new Home material.

That law is recorded here so Journal does not accidentally occupy its crossing. Stream topology, Bear/Faun interaction, Wild traversal, carried packets, return synthesis, and bridge custody are tomorrow's design and are not installed by Journal v1.

## Required verification

- Exact valid text plants one and only one `home/journal` entry.
- Invalid, empty, oversized, malformed, failed, and conflicting calls plant none.
- Journal rows and admission evidence are append-only.
- Semantic projection and Forest walking can reach the exact entry.
- Conversation chronology remains unchanged.
- Binder, Wild, Result Rack, Roots, and provisional material have no bypass into Journal.
- Existing Forest stores acquire only an empty additive companion until the Resident writes.
