# Feature Change Protocol

> **Status: Active implementation SOP.** Use this protocol proportionately for repository changes. The [`Builder's Standard`](BUILDERS_STANDARD.md) owns the principles and revision law behind it.

## 1. Intake

Before substantial coding:

1. Read [`../ORIENTATION.md`](../ORIENTATION.md), [`../STATUS.md`](../STATUS.md), and the relevant portion of [`../MARBLE_CIRCULATION_MAP.md`](../MARBLE_CIRCULATION_MAP.md).
2. Read the owning active specification. Do not implement directly from `docs/lineage/` or from an experiment.
3. Classify the change: conforming, clarifying, extending, revising, constitutional, or experimental.
4. Name the owner, crossing, protected invariant, source authority, persistent state owner, and explicit non-owners.
5. Inspect the current implementation and user changes before editing.
6. Decide whether the owning module needs mechanical separation before accepting more responsibility.
7. Identify compatibility, stored-data, migration, security, and external-disclosure consequences.

For a small local repair, these answers may remain in the working notes. For a new crossing, room, store, protocol, or revision, record them in an active specification or work brief.

## 2. Design gate

Do not begin implementation until these questions have bounded answers:

```text
What exact claim becomes newly true?
Which authority owns it?
Which single gate validates it?
What may be transformed or omitted?
What cannot gain authority?
What durable witness proves success, refusal, and partial failure?
How is retry, duplication, stale state, and recovery handled?
Does the current law represent the need truthfully?
```

If the last answer is no, stop and use the revision protocol. Do not hide a counterexample inside implementation detail.

## 3. Separation gate

Separate first when the proposed work would:

- add a new responsibility to an already mixed module;
- require transport or UI code to reach into storage internals;
- make one change span unrelated authority stores;
- add room-specific branches to a generic core surface;
- combine schema migration with new behavior; or
- make the main causal path harder to audit.

An extraction checkpoint preserves behavior. A feature checkpoint changes behavior. Keep them distinct unless atomicity is genuinely required and documented.

## 4. Implementation

During coding:

1. Preserve public contracts or register the compatibility transition.
2. Keep domain law out of HTTP, UI, adapters, and generic helpers.
3. Use typed, bounded failures at crossings.
4. Preserve canonical serialization, hashes, event order, transaction boundaries, and append-only behavior.
5. Add no silent fallback across custody, provider, security, or execution boundaries.
6. Keep experimental discovery inert and installation explicit.
7. Keep presentation separate from custody and authority.
8. Write focused tests with the implementation rather than after it.
9. Update the Marble Map when a real source, sink, store, or crossing is installed.
10. Update Status when runtime truth changes; label adopted and experimental work honestly.

## 5. Required pressure handling

If implementation reveals that an existing rule blocks a legitimate case:

1. stop adding conditionals;
2. write the concrete counterexample;
3. name the original rule and its protected invariant;
4. determine whether this is a permitted exception or a protocol defect;
5. compare the smallest truthful mechanisms;
6. reclassify the change if necessary;
7. revise specification and tests with the code; and
8. retain superseded ancestry.

The phrase “special case” is not sufficient design justification.

## 6. Verification

Before completion:

1. Run focused tests for the changed subsystem.
2. Exercise success and relevant refusal, hostile, bypass, stale, duplicate, interrupted, recovery, and drift paths.
3. Run the complete suite for a substantial change.
4. Run available static, documentation, and architectural checks.
5. Run `git diff --check`.
6. Review the final diff for mixed responsibilities, accidental behavior changes, leaked sensitive material, and unrelated edits.
7. Verify runtime claims against Status and owning specifications.
8. Record any accepted debt in the appropriate register rather than only in conversation.

## 7. Completion report

Report:

- the outcome and change classification;
- changed paths and their ownership;
- specifications, Status, Marble Map, registers, or orientation updated;
- tests and checks performed;
- migrations, compatibility standing, or residual limitations; and
- anything intentionally not exercised.

Do not describe an experiment as installed, a policy as an invariant, a passing unit test as complete end-to-end proof, or an unverified migration as safe.

## 8. Compact checklist

```text
[ ] Active authority found; lineage not treated as requirements
[ ] Change classified
[ ] Owner, crossing, invariant, source, witness, non-owners named
[ ] Existing module can accept the responsibility coherently
[ ] Compatibility and migration standing named
[ ] Success and failure laws implemented without internal boundary leaks
[ ] Counterexamples revised rather than hidden
[ ] Focused and complete verification run proportionately
[ ] Status / Marble Map / specification updated where required
[ ] Final diff reviewed and residual debt registered
```
