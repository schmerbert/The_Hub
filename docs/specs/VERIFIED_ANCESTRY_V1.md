# Verified Ancestry v1

> **Status: Adopted for implementation, 2026-09-15.** This protocol installs one hash-bound checkpoint framework with domain-owned proofs. Its first operational pressure is configured Forest startup verification, measured at 110.56 seconds against approximately 442 MiB of Spine ledgers. It does not claim resistance to a fully privileged local actor capable of coherently rewriting every store and checkpoint.

## 1. Classification and protected invariant

This is an **extending** integrity protocol and a **revision** to the Forest startup-admission mechanism in [`PROGRESSIVE_READINESS_V1.md`](PROGRESSIVE_READINESS_V1.md).

The protected invariant remains: no request, projection, or action may use a subsystem whose required authority and ancestry have not been verified. A compatible checkpoint is retained evidence of a completed proof, not a cached success flag. A suffix proof may extend that evidence only when it begins at the exact retained frontier and every dependency still names compatible ancestry.

The pressure is concrete. The configured World contains 317 events and verifies in roughly 100 ms. The configured Forest contains about 1,607 admitted Home, Wild, and Journal entries, but its strict proof reparses roughly 442 MiB of exact Spine ledgers and completes in roughly 110.56 seconds. The progressive shell opens, yet the first wake remains correctly held until that proof settles.

## 2. Ownership

- `src/integrity/` owns the checkpoint envelope, append-only checkpoint store, compatibility selection, publication atomicity, and bounded status projection.
- Spine owns ledger parsing, hash-chain and lifecycle proof, per-ledger byte frontiers, and the compact verified index needed by Forest.
- World owns event replay, projection agreement, topology/schema requirements, and its checkpoint payload.
- Forest owns Home, Wild, Journal, Intake, presentation, emission, and cross-store agreement. It alone decides whether a Spine, Source, or World frontier is sufficient for Forest readiness.
- Runtime readiness coordinates results and revocation. It does not reproduce a domain proof or grant capability from checkpoint presence.
- Source, Spine, World, and Forest remain the authorities for their own stored facts. A checkpoint never becomes source material, Resident memory, or action authority.

The checkpoint store is a rebuildable integrity projection, not canonical custody. Its default path is `.runtime/verified-ancestry.sqlite`, configurable as `HUB_VERIFIED_ANCESTRY_PATH`.

## 3. Threat model and honest limit

V1 protects against accidental corruption, partial writes, truncation, stale or incompatible checkpoints, ordinary store replacement, broken ancestry, projection drift, dependency disagreement, and incomplete checkpoint publication.

V1 uses canonical SHA-256 hashes and existing append-only chain heads. It does **not** claim protection against an actor with sufficient local privilege to rewrite all canonical stores, recompute their complete histories, and replace the checkpoint coherently. Authentication, encryption, OS-protected keys, and hostile same-user resistance remain owned by the deferred security and Vault work.

## 4. Checkpoint envelope

Every checkpoint generation is immutable and contains:

- checkpoint format and domain;
- generation identity and predecessor checkpoint hash;
- domain verifier version plus relevant schema/projector/topology versions;
- canonical store identities and generations;
- a domain manifest containing exact verified frontiers;
- dependency domain, store identity, frontier, and checkpoint hash where applicable;
- canonical manifest SHA-256;
- completion timestamp; and
- a checkpoint hash over the complete canonical envelope.

Domain payload rows and indexes are written in the same SQLite transaction as the completed envelope. There is no mutable `verified=true` pointer. The newest compatible, internally complete generation is selected; partial generations are invisible or rejected.

Checkpoint tables are append-only under update/delete triggers. Corrupt or unknown checkpoint schema fails closed as a checkpoint miss and cannot alter canonical stores.

## 5. Spine proof and frontier

Each ledger has a stable logical identity derived from its configured role and session-scoped name, never from a transient absolute path. Its checkpoint binds:

- schema/verifier version;
- verified byte boundary ending exactly after a newline;
- frame count, first record hash, and terminal record hash;
- every prior record identity needed to detect duplicates across ledgers;
- request lifecycle state at the frontier; and
- a compact Forest-facing index of prepared requests, exact request bodies and hashes, phases, wake/thread/provider/model bindings, dispatch standing, terminal outcome, and raw-return standing.

Fast verification reads only bytes after the recorded boundary. The first suffix frame must point to the retained terminal hash. Every suffix frame receives the full ordinary schema, body, hash, uniqueness, and lifecycle checks. A shorter file, changed ledger set without a lawful new empty/suffix ledger, partial line, incompatible version, duplicate identity, broken link, or impossible lifecycle rejects the checkpoint and falls back to the complete verifier.

Exact raw-return bodies remain in Spine custody but are not duplicated into the compact index. Their hashes and lifecycle standing are retained. A complete full audit continues to decode and verify their exact bodies.

## 6. World proof and frontier

World checkpoints bind:

- exact World store identity and topology generation;
- verifier, event-schema, and projector versions;
- terminal event sequence, event identity, and event hash;
- the canonical replay state or its complete deterministic digest; and
- a digest of every materialized projection and custody collection covered by the verifier.

Suffix verification begins from the retained replay state, validates every later event and aggregate revision, and compares the complete resulting projection with current materialized state. Schema and trigger definitions are checked on every startup. An old prefix edit may be discovered by background full audit; suffix discontinuity or current projection drift refuses immediately.

## 7. Forest proof and dependencies

Forest readiness remains one domain claim even though its evidence crosses stores. A Forest checkpoint binds:

- Forest schema/verifier version and store identity;
- deterministic digests/counts/frontiers for Home entries, edges, scrub receipts, Wild entries, Journal entries/custody, Intake offers/decisions, presentation links, and emission links;
- the exact eligible Source frontier and relevant-row digest;
- the exact Spine ledger checkpoint set and compact-index hash;
- the exact World checkpoint/frontier used for Wild action custody; and
- unresolved/held intake standing.

V1 must not pretend unordered Forest tables support suffix proof. Before suffix-only Forest validation, every Forest mutation that affects the strict proof must receive one append-only, monotonically ordered mutation witness in the same transaction. Establishing the first frontier requires one complete verification and a snapshot-boundary witness; it does not fabricate historical row order.

Source material used by Forest requires an equivalent bounded eligible-event frontier or a deterministic complete relevant-row digest. Ordinary startup session bookkeeping must not invalidate Forest when eligible utterance ancestry is unchanged.

## 8. Startup and audit

Startup proceeds as follows:

1. Inspect checkpoint schema and select compatible domain generations.
2. Verify cheap current schema, trigger, identity, dependency, and frontier conditions.
3. Verify the implemented Spine suffix from its retained frontier, then run the ordinary strict Forest proof over the compact verified Spine view and the current Source, World, and Forest stores. World and Forest native suffix adapters remain gated on their domain mutation-witness work; checkpoint presence does not stand in for those proofs.
4. If every required proof succeeds, activate Forest and label readiness `forest_checkpoint_verified`.
5. Begin a complete background audit using the existing authoritative verifiers.
6. On successful audit, atomically publish a new generation only when its frontier differs from the latest generation.
7. On disagreement, close Forest-dependent services, revoke Forest readiness with bounded code `forest_background_audit_failed`, and retain diagnostic detail outside Resident attention.

If no compatible checkpoint exists, startup performs the current complete proof before activation and publishes the first checkpoint only after success. Checkpoint failure never repairs, migrates, or rewrites a canonical store.

Only one audit generation may publish. Shutdown cancels background work without converting cancellation into success. A later result from an earlier process generation is ignored.

## 9. Compatibility and migration

- Existing Source, Spine, World, and Forest bytes remain unchanged unless a separately specified additive mutation-witness schema is installed.
- The checkpoint store is additive and rebuildable. Deleting it causes a slow full verification, not canonical data loss.
- Existing Spine JSONL formats and public readers remain compatible.
- Existing direct `createHub()` synchronous behavior remains until callers explicitly select checkpoint-assisted progressive startup.
- Checkpoint format or verifier incompatibility causes full verification and a new generation; it never silently blesses an old proof.

## 10. Bounded observation

Health may expose domain, mode (`full`, `checkpoint_suffix`, `background_full`), compatible/miss/refused standing, verified item counts and byte counts, elapsed milliseconds, and bounded failure codes. It exposes no paths, record identities, bodies, credentials, or checkpoint payloads.

## 11. Required hostile and recovery tests

Tests must cover:

- first full proof and atomic checkpoint publication;
- fast unchanged restart and lawful suffix growth;
- prefix truncation, suffix partial line, broken terminal link, and duplicate record identity;
- ledger addition/removal/replacement and cross-ledger duplicates;
- unknown schema/verifier/projector/checkpoint versions;
- trigger removal and projection drift;
- stale Source, Spine, World, or Forest dependency frontier;
- incomplete checkpoint transaction and corrupt checkpoint rows;
- concurrent mutation during proof or publication;
- shutdown and stale audit completion;
- background disagreement revoking Forest readiness;
- safe checkpoint deletion and full-proof recovery; and
- equivalence of checkpoint-assisted and complete verifier results.

## 12. Acceptance

1. The configured unchanged Hub reaches Forest readiness without reparsing verified raw-return prefixes.
2. A normal new wake verifies only lawful suffixes on the next startup.
3. Current schema, trigger, projection, dependency, and suffix drift still fail before Forest capability activation.
4. A full audit remains available, runs in the background after fast activation, and can revoke readiness.
5. World and Forest share one checkpoint format and coordinator without sharing or weakening domain proof law.
6. The configured 110.56-second baseline is recorded alongside post-install cold, warm, suffix, and fallback measurements.
7. No checkpoint grants Resident attention, memory, movement, tools, or other authority.

## 13. Installed measurements

Measured on the configured stores on 2026-09-15:

- pre-install complete Forest verification: 110.56 seconds;
- initial checkpoint establishment after implementation: 103.85 seconds;
- unchanged checkpoint-assisted verification: 7.26 seconds wall time;
- strict Forest proof within that warm run: 1.77 seconds;
- retained checkpoint store after establishment: 63,905,792 bytes.

The warm path still hashes the retained Spine prefix and fully proves current Forest, Source, and World-facing custody. It avoids reparsing and decoding the verified raw-return prefix. A complete Spine audit remains the slower background path after readiness.
