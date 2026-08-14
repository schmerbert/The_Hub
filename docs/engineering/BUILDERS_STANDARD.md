# Builder's Standard

> **Status: Active repository engineering standard.** This document governs how the Hub's code, specifications, and tests evolve. It does not supersede product specifications or install runtime behavior. When an existing law obstructs the invariant it was meant to protect, use the revision protocol below rather than silently coding around it.

## 1. Purpose

The Hub needs enough structure to remain comprehensible and safe without freezing its first understanding of every problem. This standard protects four qualities:

1. one identifiable owner for each piece of law;
2. explicit boundaries among authority, custody, orchestration, transport, and presentation;
3. changes that can be reviewed and verified in bounded pieces; and
4. lawful revision when concrete experience disproves an earlier mechanism.

The standard serves the Marble. The Marble does not serve the standard.

## 2. Strength of a rule

Every strong design statement belongs to one of four levels.

### 2.1 Constitutional invariant

A property the Hub intends to preserve across implementations. Examples include source authority surviving projection, provisional provider material not silently becoming Resident speech, and foreign content not granting itself action authority.

Changing an invariant changes what kind of Hub is being built. It requires explicit user adoption, an updated active specification and orientation where relevant, named consequences, and retained superseded ancestry.

### 2.2 Protocol law

The current adopted mechanism protecting one or more invariants: an event sequence, three-choice traversal, Write/Leave ceremony, one-passage crossing, or a projection contract.

Protocol laws are strong, testable, and revisable. Revision requires a concrete pressure case or counterexample, the protected invariant, compatibility and migration treatment, specification changes, and tests for the revised behavior.

### 2.3 Policy

A replaceable situational decision inside a protocol: thresholds, ranking, timeouts, retained counts, selection diversity, or confirmation posture. Policy must be named and witnessed where it affects standing. It must not masquerade as a constitutional truth.

### 2.4 Implementation convention

The current organization used to keep the code safe and comprehensible: files, classes, facades, naming, and dependency layout. Conventions may change when they stop serving cohesion, encapsulation, or reviewability. They do not gain constitutional standing from age.

When a rule is unlabeled, treat a product specification's normative behavior as protocol law and ordinary repository organization as implementation convention. Clarify the label when it affects a decision.

## 3. Protected-invariant annotation

Use absolute language sparingly. A consequential `must`, `must not`, `always`, or `never` should make its purpose inspectable:

```text
Rule:
Level:
Protected invariant:
Threat prevented:
Scope:
Permitted forms or known pressure cases:
Required witness:
Evidence that would justify revision:
```

The annotation may live beside the rule or in its owning design note. Existing specifications need not be mechanically rewritten. Add the annotation when a rule is challenged or materially extended.

A rule without an understood protected invariant must not be defended merely because it already exists.

## 4. Ownership and placement

Every behavior has one owning subsystem. Callers use the owner's public contract rather than duplicating its law or reaching into its storage.

Current broad ownership is:

| Concern | Owner |
| --- | --- |
| Operational happenedness and wake custody | `src/ledger/` |
| Provider presentation and attention fitting | `src/context/`, `src/scrub/` |
| Exact provider-bound and admitted return bytes | `src/spine/` |
| Material topology, state, movement, and World causation | `src/world/` |
| Place- and room-owned declarations and local behavior | `src/places/` |
| Continuity admission and terrain | `src/forest/` |
| Machine result and artifact custody | `src/result-rack/` |
| Wake protocol orchestration | `src/runtime/` |
| HTTP translation and process composition | `src/server/` |
| Human projection and desktop shell | `public/`, `src/corner/` |
| Unadopted propositions under test | `experiments/` |

[`PLACE_MODULE_STANDARD.md`](PLACE_MODULE_STANDARD.md) governs the seam between universal World machinery and code truly owned by a place or room.

`test/architecture-boundaries-v1.test.js` is the executable fitting barrier. It prevents place modules from reaching Marble machinery, prevents domain stores from importing presentation/composition roots, and requires every 500-line source module to carry an explicit cohesion standing. Crossing a threshold is therefore visible without making line count a substitute for architectural judgment.

An owner may be divided internally. Ownership does not require one large file.

Before a meaningful feature, record:

```text
Feature:
Change classification:
Owning subsystem:
Crossing added or changed:
Protected invariant:
Source authority:
Persistent state owner:
Public contract and callers:
Explicit non-owners:
Failure witness:
Migration and compatibility impact:
Expected files:
Verification:
```

This may be a specification section, work brief, issue, or implementation note. Do not create paperwork for a trivial local edit.

## 5. Module hygiene

### 5.1 Cohesion over line count

A module should contain behavior that changes for the same reason and shares one coherent contract. Separate it when at least two of these hold:

- it serves more than one architectural layer;
- it owns more than one authority or persistence boundary;
- its regions require substantially different verification;
- unrelated features repeatedly edit different regions of it;
- callers need internal fields rather than public methods;
- the main causal flow is obscured by unrelated machinery;
- migrations, compatibility, live operations, and verification have accumulated together;
- its name no longer describes most of its responsibility; or
- failure in one responsibility threatens another's transaction or cleanup behavior.

Line counts are review triggers, not automatic violations:

- around 300 lines: confirm that the file remains cohesive;
- around 500 lines: document why it remains one unit or identify a split;
- around 800 lines: require explicit architectural justification before adding another responsibility;
- around 1,000 lines: stop adding unrelated behavior until ownership is repaired.

Generated data, declarative schemas, and one exact reducer may remain large when splitting would hide the law rather than clarify it.

### 5.2 Encapsulation

Transport, UI, and orchestration code must not query another subsystem's SQLite connection or depend on private tables. Provide a domain method or a dedicated read projector. Direct storage access is limited to the store owner, its verifier, its explicit migrations, and narrowly named diagnostic modules.

### 5.3 Dependency direction

Normal dependencies flow inward:

```text
Corner / HTTP
    -> runtime orchestration
    -> domain crossings and services
    -> stores and external adapters
    -> SQLite / filesystem / network
```

Stores do not import server or UI code. Domain law does not depend on HTTP. Experiments do not become runtime dependencies until an adoption and installation crossing explicitly moves or replaces them.

### 5.4 Thin composition roots

A composition root may select concrete implementations and connect their lifecycles. It should not also own domain health semantics, SQL projections, route behavior, or protocol parsing.

### 5.5 No miscellaneous dumping ground

Do not create generic `utils`, `helpers`, `common`, or `misc` modules for unrelated behavior. Name a module after the law or operation it owns. Test helpers may contain repeatable setup mechanics but must not hide the domain condition a test asserts.

## 6. Safe separation

Structural refactoring and semantic change should normally be separate checkpoints.

1. Characterize current behavior and failure cases.
2. Extract or move code without changing public contracts.
3. Preserve hashes, canonical serialization, error codes, event ordering, transaction boundaries, cleanup, and migration refusal behavior.
4. Run focused and complete verification.
5. Review the diff for accidental semantic change.
6. Only then add the new behavior.

Use branch by abstraction when callers cannot move atomically: keep the existing public module as a delegating facade, migrate consumers, and remove it only when its standing in the compatibility register permits removal.

Do not split a file merely to reduce its line count. A poor extraction that scatters one law across vague helpers is a regression.

## 7. Pressure, exceptions, and counterexamples

### 7.1 Pressure case

A concrete need that tests whether a rule's mechanism still protects its invariant. Investigate pressure before weakening the rule or forcing the feature around it.

### 7.2 Exception instance

A rare, anticipated deviation already permitted by the owning law. It must name the displaced ordinary rule, authorization, exact scope, retained invariant, and witness. An exception must not be a hidden conditional.

### 7.3 Counterexample

Evidence that the law is incomplete or incorrectly stated. Repeated exceptions, routine pressure, contradictory workarounds, or tests that require false behavior are counterexamples. Revise the protocol; do not accumulate exceptions.

### 7.4 Revision question

When law meets reality, ask:

> Is the pressure challenging the protected value, or only the first mechanism chosen to protect it?

Usually the mechanism should move while the invariant remains.

Passing tests prove conformance to current adopted behavior. They do not prove the behavior should never change. Tests that freeze a disproven mechanism must change with the owning specification.

## 8. Change classifications

Every nontrivial change is one of:

- **Conforming** — implements or repairs existing law.
- **Clarifying** — removes ambiguity without changing runtime behavior.
- **Extending** — covers a deferred case while preserving the existing law.
- **Revising** — changes protocol because pressure exposed an incomplete or incorrect mechanism.
- **Constitutional** — changes a foundational invariant or the kind of relationship the Hub embodies.
- **Experimental** — tests a proposition without installing or adopting it.

If a change begins conforming and discovers a counterexample, stop treating it as an ordinary implementation. Reclassify it before continuing.

## 9. Lawful revision

Protocol revision follows this loop:

```text
standing law
  -> concrete pressure or counterexample
  -> protected invariant identified
  -> alternative mechanisms compared
  -> smallest coherent revision adopted
  -> specification, tests, status, and code updated together
  -> superseded ancestry retained
```

A revision record must state:

- the old rule and owning authority;
- the concrete case it could not represent truthfully;
- the invariant retained, changed, or rejected;
- the new rule and its scope;
- compatibility, migration, and stored-ancestry consequences;
- new failure and bypass cases; and
- which documents and tests changed.

Do not silently edit sealed lineage. Do not describe a new protocol as if it had always existed.

## 10. Compatibility and migrations

Compatibility code must be registered as permanent facade, active transition, migration-only, or deprecated. Each entry names consumers, removal conditions, and tests. Unregistered compatibility must not be added.

Every persistent store must state its schema standing, startup behavior, explicit migration commands, backup expectations, verification path, and refusal posture in the migration register. Startup must not perform a destructive or ancestry-changing migration merely because the new code can.

## 11. Verification floor

Proportionate verification includes:

- focused tests for the changed law;
- positive, refusal, hostile, bypass, stale, duplicate, partial-failure, recovery, and drift cases where applicable;
- the complete suite before a substantial checkpoint;
- documentation and status alignment;
- `git diff --check` and review of the actual diff;
- confirmation that unrelated user changes remain intact; and
- explicit reporting of checks not run or boundaries not exercised.

Static checks and architectural boundary tests should be added where they encode real correctness rather than style preference. Passing a formatter is not evidence that a crossing is sound.

## 12. Escape clause

These rules exist to preserve comprehensibility, honest authority, exact custody, and safe change. When a convention or protocol obstructs those purposes, do not evade it silently and do not obey it performatively.

Record the conflict, identify the protected invariant, classify the change, and revise the smallest owning law before or with the implementation. Emergency containment may precede full revision only when delay would risk custody, security, or destructive action; it must be bounded, witnessed, and followed by an explicit reconciliation.

The standard is successful when it helps the Marble settle into a truer shape. It has failed if it forces the code to lie so the document can remain unchanged.
