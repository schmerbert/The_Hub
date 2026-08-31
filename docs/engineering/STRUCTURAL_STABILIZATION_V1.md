# Structural Stabilization v1

> **Status: Active engineering work brief.** This brief governs the foundation pass that separates mature runtime responsibilities before further feature growth or incremental-verification optimization. It installs no Resident capability, authority, store format, migration, or checkpoint merely by naming the work.

## 1. Classification and pressure

The mechanical phases are **conforming structural refactors**. A later verification-checkpoint phase, if adopted after measurement and review, will be an **extending protocol change** with its own specification.

The Hub's architectural authorities remain clear, but several implementation owners now combine responsibilities that change for different reasons:

- `src/server/app.js` composes HTTP transport and owns progressive Forest lifecycle;
- `src/runtime/wake-service.js` owns the public wake protocol while directly implementing every causal phase;
- `src/world/graph.js` combines the active World facade with version recognition and migrations;
- `src/world/events.js` combines event definitions, replay, projection verification, and database inspection; and
- `public/app.js` combines transport, live state coordination, and multiple visual surfaces.

The pressure is maintainability and repeated verification cost, not evidence that the Marble's laws are defective.

## 2. Protected invariants

Structural work must preserve:

- exact Source, Scrub, Spine, Roots, Forest, Result Rack, and World custody;
- canonical serialization, hashes, event order, request phases, provider controls, and transaction boundaries;
- append-before-broadcast and append-only behavior;
- current tool authority, room fitting, and action refusal codes;
- World drift refusal before provider dispatch or mutation;
- first-wake Hearth chronology and settled reread behavior;
- progressive readiness states, stale-proof refusal, and shutdown cancellation;
- API, SSE, desktop-host, and direct-`createHub()` compatibility; and
- current migration refusal and backup-confirmation law.

No extraction may replace a full proof with cached success or move domain truth into runtime coordination.

## 3. Ownership target

### 3.1 Verification coordination

Each domain verifier remains the sole authority for its integrity claim. A process-local runtime coordinator may:

- name readiness gates;
- schedule domain verifier calls;
- retain a bounded process-local proof observation;
- reject stale observations;
- project bounded readiness and timing; and
- request background audit.

It may not reproduce domain verification, infer integrity from file metadata, repair ancestry, or grant capability from store presence.

### 3.2 Progressive lifecycle

Deferred Forest verification, activation, stale-input detection, cancellation, and close ordering move behind one runtime-owned lifecycle contract. `src/server/app.js` remains a thin composition/HTTP root.

### 3.3 World

`WorldGraphStore` remains the permanent public facade for active World operations. Historical-version recognition and explicit migrations move behind World-owned modules without changing commands, schemas, hashes, or refusal codes. Event schema, replay, and verification may separate internally while retaining the existing public exports until consumers move.

### 3.4 Wake

`WakeService` remains the public orchestrator. Phase modules receive explicit bounded dependencies and return typed results; they do not acquire cross-domain stores or provider authority implicitly.

### 3.5 Corner

Corner transport/live-state coordination separates from surface renderers. DOM text remains untrusted and rendered through safe text operations. Same-origin endpoints, EventSource recovery, scroll behavior, and desktop IPC remain unchanged.

## 4. Change sequence

1. Characterize current timing, verifier invocation counts, public results, failure codes, and close ordering.
2. Add a runtime verification coordinator as an observational/scheduling facade over existing domain owners.
3. Extract progressive Forest lifecycle behind that coordinator without semantic change.
4. Move World migration/version recognition out of the active facade mechanically.
5. Divide Wake Service by causal phase behind its unchanged public API.
6. Separate Corner transport/state from individual surfaces.
7. Remeasure.
8. Decide whether measured World pressure justifies a separately specified authenticated checkpoint protocol.

Each semantic-neutral extraction is a separate commit after focused and complete verification. Optimization must not be hidden inside an extraction diff.

## 5. Baseline evidence

The baseline records at least:

- production module line counts and architectural threshold crossings;
- startup composition, loopback binding, and deferred Forest timing;
- World verifier calls during startup, health, one ordinary wake, and one action wake;
- Glass Trace and Roots verifier calls per wake;
- provider preparation/dispatch/return time separately from local work;
- health and active-thread payload sizes; and
- cold and warm behavior against disposable stores only.

Configured live stores remain untouched by measurement unless the operator explicitly chooses a read-only audit.

### Initial disposable baseline — 2026-08-31

`npm run baseline:structure` on Node v22.22.3, using fresh disposable fake-mode stores and one compact ordinary wake, recorded:

| Observation | Initial value |
| --- | ---: |
| synchronous composition | 539.59 ms |
| loopback binding | 10.45 ms |
| first health request | 222.32 ms |
| one fake compact wake | 1303.88 ms |
| health payload | 3984 bytes |
| compact wake payload | 344 bytes |
| `world.verification()` calls through the instrumented facade | 4 |
| `world.assertVerified()` calls through the instrumented facade | 104 |
| Glass Trace verification calls | 1 |
| Roots verification calls | 1 |

Health alone accounted for two `verification()` and twenty `assertVerified()` facade calls. This is one diagnostic run, not a production latency claim. Its purpose is to preserve the pre-refactor call shape; later runs must compare the same disposable scenario and separately measure configured cold/warm behavior.

## 6. Structural acceptance

For every extraction:

1. Existing public imports and return shapes remain compatible or receive a registered facade.
2. Characterization tests prove exact success and refusal behavior before and after the move.
3. No domain store imports server, Corner, or runtime coordination.
4. No new generic `utils`, `helpers`, `common`, or miscellaneous module is introduced.
5. Focused success, drift, stale, duplicate, interruption, recovery, and shutdown cases pass where relevant.
6. The architecture-boundary test and complete suite pass.
7. `git diff --check` passes and the diff contains no mixed feature work.

## 7. Checkpoint adoption gate

Incremental verification is not part of the mechanical refactor. A later checkpoint specification must name exact persistent ownership, authentication, store identity, schema/verifier version, prefix head, suffix proof, projection digest, invalidation, crash consistency, background audit, revocation, in-flight action behavior, migration, and hostile tests. Until then, existing full verifiers remain authoritative.
