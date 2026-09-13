# Security, Privacy, and Sealed Custody v1

> **Bounded connector revision (2026-09-11):** [Spotlight live read v1](SPOTLIGHT_LIVE_READ_V1.md) adopts one opt-in standalone Robinhood read crossing and Windows DPAPI protection for its OAuth credential file. The human explicitly authorizes normalized financial observations in ordinary local custody and Resident provider attention. This narrow crossing supersedes this direction's blanket deferral of that connector only; it does not implement general sealed custody, encryption of observations/Source/Spine, a secret manager, user authentication or a security certification.

> **Status: Adopted security architecture and readiness gates; not implemented and not a certification claim.** The current runtime does not provide application-level encryption at rest, user authentication, remote-device admission, a secret manager, sealed Vault blobs, cryptographic erasure, or an independent security review. This specification records the minimum laws and gates required before the Hub may invite sensitive personal custody or outside-network access. [`../STATUS.md`](../STATUS.md) remains the runtime authority.

## 1. Purpose

The Hub is intended eventually to hold continuity, World state, exact provider crossings, documents, financial and household projections, private plans, and perhaps a Vault. Exact custody is valuable, but exact custody in ordinary plaintext creates a concentrated personal record.

Security must protect four properties together:

- **confidentiality** — material is disclosed only through an authorized crossing;
- **integrity** — retained bytes, ancestry, and projections cannot change silently;
- **availability and recovery** — lawful material and keys survive expected failure;
- **user agency** — the user can understand, restrict, export, revoke, and where lawful destroy custody.

Hash chains provide integrity evidence. They do not provide confidentiality. Encryption at rest protects some storage threats. It does not undo provider disclosure or protect an unlocked process that is already authorized to decrypt.

## 2. Current security truth

The following is current runtime truth, not a future promise:

- the Source Ledger retains unredacted operational events in ordinary SQLite;
- the Spine retains exact provider request bodies and admitted provider-return bodies in plaintext JSONL; base64 return encoding is not encryption;
- Forest, World, Result Rack, and wake journals use ordinary local files or SQLite stores without application-level encryption;
- credentials and Authorization values are intentionally excluded from Source/Spine/Forest content, protected Workshop paths are refused, and credential-shaped provisional stream fragments are suppressed;
- the desktop renderer has a narrow local boundary and no direct Source, Spine, Forest, World, Rack, filesystem, shell, or Electron authority;
- there is no general user authentication, remote network boundary, paired-device identity, mobile client, installer/updater trust chain, or Vault runtime;
- filesystem ownership, operating-system account controls, and any volume encryption configured by the user are the present at-rest boundary.

Therefore the current Hub must not describe itself as a secure store for account balances, identity documents, credentials, private keys, recovery codes, health records, or other high-impact secrets.

Existing credential refusal and tamper verification are valuable controls. They are not substitutes for encrypted custody and access control.

## 3. Security classification is separate from truth

Security standing does not establish factual authority. A sealed dream is still a dream. A sealed balance can still be stale. A public projection can still be false.

Future material must carry a declared security class before indexing or ambient projection. The initial conceptual classes are:

| Class | Meaning | Default attention |
| --- | --- | --- |
| `display` | Deliberately safe for its named surface | Only that surface and lawful descendants |
| `continuity_private` | Ordinary personal Home/Forest continuity | Resident attention under current continuity policy; not thereby public or ambient |
| `sealed` | Deliberately compartmented Vault or sensitive material | No ordinary search, Exhale, Faun, room orientation, or ambient surface |
| `operational_secret` | Credentials, private keys, recovery codes, signing material | Never model-readable; held only by a dedicated secret mechanism |
| `external_disclosed` | Exact material intentionally sent to a named outside provider or service | Retain the destination, purpose, and crossing receipt |

These classes are adopted vocabulary, not installed schema. Classification may narrow access; it must not silently promote truth or authority.

## 4. One-passage security law

No material becomes visible, decryptable, indexed, embedded, sent to a provider, included in a backup, exposed to a device, or destroyed through an unnamed path.

Every sensitive crossing must identify:

1. exact source material or sealed pointer;
2. source authority and current security class;
3. requesting actor, device, surface, and purpose;
4. the single policy gate that authorizes access;
5. the exact fields or bytes permitted to cross;
6. the destination and its security class;
7. durable success, refusal, and partial-failure receipts;
8. expiry, revocation, and residual-copy behavior; and
9. verification that detects bypass, stale authority, leakage, or replay.

Scrub is the language membrane used by a crossing. Scrub does not independently decide destination or grant decryption authority. Routing, authorization, decryption, projection, and destination admission remain distinct responsibilities.

## 5. Sealed pointer custody

Exact evidence need not be stored inline as plaintext. The adopted target is an immutable pointer manifest backed by immutable authenticated ciphertext:

```text
Source / Spine / Vault / Rack record
  -> non-secret manifest and sealed-content reference
  -> immutable authenticated ciphertext blob
  -> separately protected key custody
```

A future sealed manifest may retain only what its threat model permits, such as:

```text
record identity
schema and encryption-suite versions
security class
ciphertext reference, length, and integrity digest
wrapped data-key reference
source and causal pointers
creation and retention standing
authorized disclosure-policy identity
```

Titles, filenames, locations, plaintext hashes, sizes, timestamps, and relationship metadata can themselves disclose sensitive facts. They are not automatically safe manifest fields. Low-entropy plaintext must not be exposed through a guessable public digest merely to preserve current hash conventions.

Authorized verification may decrypt exact bytes in a bounded process, verify the manifest and causal receipt, and return a non-sensitive verification result. Verification must not print, log, or silently reclassify the body.

The ciphertext store is append-only for retained versions. Supersession creates a new sealed object and link. It does not rewrite an old ciphertext object.

## 6. Store-specific target boundaries

| Store | Current form | Adopted security direction |
| --- | --- | --- |
| Source Ledger | Inline unredacted SQLite event content | Non-secret event envelope plus class-aware sealed body where required |
| Spine | Inline exact request JSON and base64 raw return in JSONL | Exact encrypted body blobs with pointer frames; provider destination remains explicit |
| Forest | Inline Home/Wild bodies | Ordinary private continuity policy plus excluded/sealed entries and opaque Vault pointers; no sealed indexing |
| World | Plain event/projection fields | Keep ordinary material inspectable; isolate sensitive household fields behind declared sealed pointers |
| Result Rack | Plain exact result/artifact custody | Classify before capture; seal sensitive artifacts and projections independently |
| Vault | Not implemented | Sealed by default; bounded attention leases; field-selective projections; access and exit receipts |
| Wake stream | Plain safe projection journal | Continue refusing credentials; never publish decrypted sealed bodies or sensitive notification payloads |

The manifest and body may live in different stores. A pointer does not transfer the body’s authority or security class.

## 7. Direct Vault intake and ordinary speech

Ordinary conversation remains ordinary conversation. The House must not interrupt every intimate utterance with a classification ritual, but it must not pretend ordinary chat is a sealed deposit.

A genuine Vault deposit must select its destination before the sensitive body crosses ordinary utterance admission:

```text
open Vault deposit
  -> authenticate and select/create slot
  -> receive exact body through Vault intake Scrub
  -> encrypt and append sealed custody
  -> ordinary rail receives only a non-sensitive deposit receipt
```

Copying an ordinary Home utterance into the Vault later does not erase the Source or Forest copy. A future migration or destruction process must account for every retained copy and backup honestly.

Vault bodies are excluded by default from:

- semantic embeddings and full-text indexes;
- ordinary Forest Exhale;
- Faun lenses, trails, trinkets, and Mycelium;
- room orientation and general search;
- television, notification, and other ambient surfaces;
- provider requests; and
- diagnostics, logs, crash reports, fixtures, and test snapshots.

An opaque pointer may reveal only that an authorized sealed item exists. Even that fact may be hidden when its existence is sensitive.

## 8. Bounded sensitive attention

Opening sealed material creates a time- and purpose-bounded attention lease, not permanent ambient recall:

```text
authenticate
  -> select exact sealed sources
  -> decrypt into bounded working memory
  -> cast only authorized fields to an approved local or provider destination
  -> Keep / Write synthesis / Act / Leave
  -> revoke lease and clear ordinary projections
```

Resident-generated synthesis can still leak sensitive facts. Shorter text is not automatically safe text. A Vault exit policy must identify whether synthesis remains sealed, may enter Home, may cross to an external provider, requires human review, or must be discarded.

Machine receipts may retain sealed derivation pointers while ordinary presentation omits their bodies and sensitive metadata.

## 9. Credentials and signing material

Passwords, provider keys, recovery codes, private signing keys, brokerage credentials, and equivalent operational secrets do not belong in model-readable Vault documents, Forest, Source bodies, Spine bodies, prompts, logs, environment snapshots, or room projections.

A dedicated secret mechanism may expose only bounded operations or health facts:

```text
credential exists
credential is currently usable
operation was authorized through this gate
operation produced this external receipt
```

The Resident and provider receive neither the raw credential nor a general secret-reading capability. A room, capsule, pointer, identifier, or prior use never confers secret authority.

## 10. Key-management law

Encryption is acceptable only with an explicit key lifecycle. Before sealed custody is implemented, the design must settle:

- approved authenticated-encryption and version-agility policy;
- independent data-encryption and key-encryption keys where appropriate;
- operating-system or hardware-backed root-key custody where available;
- separation of keys from encrypted data and backups;
- key generation, activation, rotation, compromise, revocation, destruction, and audit;
- device loss and paired-device revocation;
- secure key backup or a deliberate no-recovery promise;
- recovery testing that does not expose production bodies; and
- behavior when keys are unavailable, corrupted, or only partly rotated.

Keys must not be hard-coded, committed, printed, stored beside ciphertext as plaintext, or injected into model-visible context. Losing a required key can permanently destroy access; backup and recovery law is part of security, not an operational afterthought.

## 11. Deletion and cryptographic erasure

Append-only ancestry must not become an excuse for involuntary eternal plaintext retention.

A future destruction crossing may preserve a non-sensitive append-only receipt while disposing of ciphertext and destroying the only remaining data key:

```text
sealed record existed
authorized destruction was requested
named ciphertext copies were disposed
named keys were destroyed or revoked
known backups have this remaining standing
body is no longer recoverable through the Hub
```

The Hub must not claim erasure while readable copies remain in Source, Spine, Forest, Rack, temporary files, logs, provider custody, device caches, or backups. Storage media and third-party retention may limit what can honestly be promised.

## 12. Provider and connector disclosure

Anything sent to an outside model, market feed, broker, cloud API, mail service, or other connector has crossed beyond local encrypted custody. Transport encryption protects the route, not the recipient’s later use or retention.

Every external disclosure must retain:

- exact destination and provider identity;
- declared purpose and authorized fields;
- local or external processing class;
- exact Spine or connector request receipt;
- response and failure custody; and
- any known retention or deletion limitation.

Some security classes may require local-only processing or prohibit model access entirely. No provider is permitted merely because it is configured.

## 13. Remote and mobile boundary

Before a phone, tablet, television, browser, or outside service can cross into the House, the Hub requires:

- encrypted transport and explicit server identity;
- deliberate device pairing and per-device identity;
- narrow surface/capability profiles;
- secure device-key storage where available;
- replay-resistant, idempotent commands;
- revocation, expiry, lost-device response, and audit;
- minimal notification payloads with no sealed bodies;
- cursor-based recovery from durable non-sensitive projections;
- refusal of unsupported protocol and security versions; and
- no direct database, filesystem, key-store, or provider credential exposure.

A paired surface is not the Resident, operator, or universal administrator. Physical room awareness does not itself grant Vault or action authority.

## 14. Capsules, tools, and untrusted material

Room, Forest, Faun, adapter, and surface capsules receive declared sockets rather than ambient process authority. Discovery remains inert. Activation does not grant filesystem, network, key, decryption, provider, or execution authority.

Untrusted repository text, documents, web pages, filings, card metadata, social content, model output, and connector responses remain inert data until a named crossing validates their use. Prompt injection is an authority-confusion attempt, not merely undesirable prose.

Sensitive capability tests must include malicious manifests, stale bindings, path escape, dependency compromise, oversized inputs, parser differentials, instruction-bearing data, and attempts to route sealed content into ordinary attention.

## 15. Updates, migrations, and legacy plaintext

Security migrations are versioned crossings. Startup must never silently rewrite plaintext custody, rotate keys, or bless an incomplete migration.

Moving from inline plaintext to sealed pointers requires:

1. read-only inventory of every body and copy;
2. backup and recovery plan;
3. explicit migration authorization;
4. authenticated encryption into new immutable custody;
5. byte-for-byte authorized verification;
6. atomic pointer/projection activation;
7. explicit legacy-store disposition; and
8. post-migration leak scans and restore tests.

Encrypting a new copy does not erase old files, snapshots, SSD remnants, logs, or backups. Legacy plaintext ancestry must remain honestly labeled until its disposition is verified.

Future application updates require signed release artifacts, version-pinned wakes/jobs, migration compatibility, rollback rules that do not restore vulnerable plaintext, and an update supervisor separated from Resident identity and continuity.

## 16. Security readiness gates

### Gate A — architecture readiness

Required before implementing any feature that intentionally collects high-impact sensitive material:

- current data-flow and threat-model inventory;
- classification and direct-Vault-intake contract;
- pointer-capable storage boundaries;
- key-management and recovery decision;
- explicit provider/local-processing policy; and
- security tests included in acceptance criteria.

### Gate B — local sensitive custody

Required before describing the local Hub or Vault as suitable for sensitive personal material:

- application-level sealed custody implemented and verified;
- authentication/unlock and least-disclosure policies;
- key rotation, loss, backup, restore, and destruction drills;
- no-plaintext scans across stores, logs, temporary files, crash artifacts, tests, and backups;
- sealed-content exclusion from ordinary indexing and attention; and
- documented residual threats and recovery limitations.

### Gate C — remote and mobile access

Required before any non-loopback or paired-device channel:

- remote threat model and authenticated encrypted transport;
- pairing, per-device authorization, revocation, and replay resistance;
- secure notification and cache policy;
- protocol/version negotiation and downgrade refusal;
- hostile-network and compromised-device tests; and
- incident response and audit inspection.

### Gate D — peer release

Required before claiming mature security to users or peers:

- independent architecture and code review;
- adversarial testing of storage, keys, providers, capsules, updates, backups, mobile surfaces, and recovery;
- dependency and release-chain review;
- documented vulnerability reporting and patch process;
- remediation or explicit blocking of unresolved high-severity findings; and
- a public, accurate statement of what the Hub protects and what it does not.

A final security pass verifies these gates. It cannot substitute for Gates A through C.

## 17. Required verification

Future implementations must test at least:

- plaintext absence from each forbidden store and projection;
- exact decrypt-and-verify behavior without body logging;
- wrong, missing, rotated, revoked, and corrupted keys;
- copied ciphertext without keys and copied keys without ciphertext;
- manifest, ciphertext, ancestry, and security-class tampering;
- bypass from sealed custody into Forest Exhale, Faun, search, embeddings, Glass, notifications, or logs;
- field-selective projection and metadata minimization;
- provider-bound disclosure receipts and local-only refusal;
- interrupted encryption, migration, rotation, destruction, backup, and restore;
- device loss, revocation, replay, downgrade, and stale authorization;
- malicious capsule and prompt-injection attempts;
- secure shutdown and residual temporary-memory/file handling; and
- legacy plaintext inventory and disposition verification.

Tests use disposable roots and synthetic secrets. They never open, migrate, print, or scan the user’s live custody unless the user initiates a dedicated audited security operation.

## 18. References and review baseline

Implementation and review should use current primary guidance rather than inventing cryptography locally, including:

- [OWASP Cryptographic Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html);
- [OWASP Key Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Key_Management_Cheat_Sheet.html);
- [OWASP Secrets Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html);
- [OWASP Mobile Application Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Mobile_Application_Security_Cheat_Sheet.html); and
- [NIST Key Management Guidelines](https://csrc.nist.gov/projects/key-management/key-management-guidelines).

Standards and libraries change. The security review must record the exact versions and guidance used at implementation time.

## 19. Non-goals

This specification does not:

- encrypt or migrate any current store;
- implement the Vault, authentication, mobile access, secret management, deletion, or updates;
- select a cryptographic library, vendor, provider, or compliance regime;
- certify the current Hub for sensitive data;
- promise protection against a fully compromised authorized host while material is decrypted;
- claim that encryption prevents provider disclosure; or
- authorize collection of financial, identity, health, credential, or similarly sensitive material.
