# Store Migration Register

> **Status: Active engineering register.** This document records the operational posture of persistent Hub stores. Exact schema and migration law remains in code and owning specifications.

## Migration law

- Startup may create a fresh configured store and perform explicitly supported startup-safe schema evolution.
- Startup must not silently bless drift, fabricate ancestry, rewrite append-only history, or perform an operator-gated migration.
- Destructive, ancestry-changing, security-sensitive, or legacy-boundary migrations require an explicit command or adopted crossing, backup expectations, verification, and truthful refusal.
- Creating a new protected copy does not dispose of old plaintext or obsolete backups.

## Current stores

| Store | Current location / owner | Startup posture | Explicit operations | Verification | Important boundary |
| --- | --- | --- | --- | --- | --- |
| Operational Source / session database | `src/ledger/source.js` | Creates fresh schema; performs supported idempotent column/context migrations for admitted legacy forms | No separate general migration command | Full suite; Source/Spine/Forest tests | Must not lose operational events or silently reclassify provider/history material |
| Wake stream journal | `src/ledger/wake-stream.js`, stored with Source | Schema installed with operational database; append-only event custody | Durable recovery is runtime behavior, not a migration command | Wake-stream custody and runtime tests | Broadcast follows persistence; replay control envelopes are not journal rows |
| Spine | `src/spine/store.js`, JSONL | Opens/creates append-only ledger; verifies existing frames before trusted use | `npm run spine:verify` | Spine verifier and provider tests | Exact-byte formats and hash ancestry must remain stable or be explicitly versioned |
| Forest Home/Wild and Intake Ledger | `src/forest/` | Active mode requires an existing verified Forest; host does not silently create historical custody | `forest:plan/apply`, `forest:wild:plan/apply`, `forest:intake:plan/apply` | `npm run forest:verify` | Separate confirmation-gated catch-up paths; unresolved/held intake remains visible |
| World | `src/world/graph.js`, `src/world/events.js` | Fresh stores bootstrap exact topology; journal-bearing drift refuses; startup does not run A2/B1 upgrades | `world:migrate-a2`, `world:migrate-b1` with backup confirmation | `npm run world:verify` | Legacy boundaries and topology extensions are event- and hash-bound; no silent repair |
| Result Rack | `src/result-rack/` | Creates/opens append-only result schema | No operator migration command currently | Result Rack tests and Gateway integration tests | Exact retained results remain distinct from bounded projections; arbitrary sandbox files are not implied |

## Required entry for a new store or schema generation

```text
Store and owner:
Schema identity/version:
Fresh creation behavior:
Supported prior generations:
Startup-safe changes:
Operator-gated changes:
Backup and restore expectation:
Atomicity and interruption behavior:
Verification command:
Rollback/refusal posture:
Legacy copy disposition:
Security classification impact:
```

## Known floor work

- Establish uniform machine-readable schema identity where doing so does not rewrite existing custody.
- Separate migration code from live store behavior in the largest World and Source modules while preserving their public facades.
- Add a single inspection command that reports every configured store's schema and migration standing without modifying it.
- Review this register whenever sealed-pointer custody introduces new encrypted body stores or legacy plaintext disposition requirements.
