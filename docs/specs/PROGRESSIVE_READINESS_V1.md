# Progressive Readiness v1

> **Status: Adopted implementation contract.** This specification lets the Corner become available after the Hub's essential custody gates settle while optional subsystems verify behind explicit, feature-local readiness. It does not weaken any verifier, repair stored ancestry, or make a deferred capability available before its own gate passes.

## 1. Pressure and classification

This is an **extending** protocol change with a subsequent **revising** admission checkpoint. The synchronous composition root currently performs broad Forest verification before the desktop host can bind and before the Corner can render. That preserves integrity, but it makes an optional continuity subsystem indistinguishable from the minimum conditions required to show an honest shell. The first progressive mechanism allowed a wake to proceed without Forest while verification was pending; the observed stale-source race showed that this is not an honest continuing session contract.

The protected invariant is unchanged: no request, projection, or action may use a subsystem whose required authority and ancestry have not been verified. The revised mechanism separates **shell readiness**, **conversation readiness**, and **feature readiness** instead of treating all startup work as one implicit boolean.

## 2. Ownership and crossing

- **Owning subsystem:** runtime startup orchestration, projected through the server and Corner.
- **Crossing changed:** process startup into Resident-visible availability.
- **Source authority:** each existing subsystem verifier remains the sole authority for its integrity claim.
- **Persistent state owner:** none in v1. Readiness and timings are process-lived observations; existing stores remain unchanged.
- **Public contract:** a bounded readiness projection returned by `/api/health`.
- **Explicit non-owners:** the Corner does not infer readiness; HTTP does not verify domain stores; a background task does not grant capability merely by completing.
- **Failure witness:** the readiness projection records a bounded stage code and state. Existing domain failures retain their typed refusal behavior.
- **Migration and compatibility:** no store migration. Direct `createHub()` callers retain synchronous startup unless progressive startup is explicitly selected; the desktop and standalone browser hosts select it by default.

## 3. Readiness model

The process exposes three ordered claims:

1. `shell`: loopback HTTP and static Corner assets are available.
2. `conversation`: Source, active session, Spine, current World/Hearth, required topology, and wake orchestration are verified and able to fail closed.
3. feature-local readiness: optional Forest continuity, semantic Exhale, Forest walking, Workshop execution preparation, and later subsystems each declare their own state.

Each stage is one of `pending`, `ready`, `failed`, or `inactive`. A stage carries only a stable code, start/settlement timestamps, and elapsed milliseconds. It carries no exception body, path, credential, provider payload, or stored content.

Conversation admission requires `conversation=ready`. Forest actions, health claims, semantic selection, and traversal require `forest=ready`. `pending`, `failed`, and `inactive` are distinct and must not be collapsed into success.

## 4. Progressive Corner startup

The desktop and standalone browser hosts select progressive startup. Direct composition callers may retain synchronous startup compatibility. In progressive mode:

- essential stores and gates settle before conversation becomes ready;
- the HTTP shell binds without waiting for optional Forest full verification;
- Forest is opened only under its existing `requireExisting` law and remains unavailable to Wake Service, Gateway, health success, semantic services, and traversal until strict verification succeeds;
- verification runs away from the HTTP event loop so the shell can answer while it is pending;
- successful verification activates the already-open exact Forest and its dependent services as one process-local transition;
- failure leaves Forest unavailable, reports a bounded failed readiness state, and preserves conversation when the essential gates remain sound; and
- shutdown waits for or safely terminates pending startup work before closing stores.

There is no unverified grace period. A wake is not admitted while an active Forest is pending or failed. This hold is process-local and does not delay shell binding, health, static assets, room rendering, or other essential conversation inspection. The Corner disables its composer with `Forest waking…` while verification is pending and `Continuity unavailable` after bounded failure; it unlocks only after Forest readiness is settled to `ready`.

### 4.1 Startup admission hold revision

- **Old rule:** a wake accepted while Forest verification was pending could proceed without Forest continuity.
- **Pressure case:** the desktop returned as usable while the long Forest proof was still running; a wake then advanced Source before the proof completed. The lifecycle correctly refused stale activation, but the lifespan was left with an avoidable split between conversation and continuity.
- **Protected invariant retained:** no request, projection, or action may use Forest authority or ancestry before strict verification succeeds, and no stale proof may be admitted retroactively.
- **New rule:** in progressive startup, Wake Service refuses admission before any Source wake row is created whenever Forest readiness is `pending` or `failed`. The refusal uses the bounded readiness code, and direct orchestration callers receive the same gate as the HTTP crossing.
- **Scope and compatibility:** shell/health remain progressive and direct non-progressive `createHub()` startup remains synchronous. No store migration or retroactive admission is introduced. A failed stage still requires a new process startup in v1.
- **New witnesses:** pending and failed HTTP refusal tests assert no new Source event or wake; a direct-call bypass test asserts the same; the existing stale-snapshot test remains because a Source change from another authorized path must still revoke the proof.

## 5. Verification checkpoints

Incremental immutable-prefix verification is deferred until a separately reviewed checkpoint format can prove all of the following:

- checkpoint authenticity and exact store identity;
- the verified prefix boundary and terminal hash;
- code/schema/verifier-version compatibility;
- suffix continuity from the checkpoint boundary;
- projection agreement for the complete current state;
- invalidation after replacement, truncation, mutation, or verifier change; and
- a background full audit whose disagreement revokes feature readiness.

File timestamps, sizes, SQLite change counters, or a cached prior success are not sufficient authority. V1 records stage timings so a later checkpoint revision is driven by measured pressure rather than assumption.

## 6. Corner presentation

While optional verification is pending, the Corner remains usable and labels continuity as preparing. On bounded failure it labels the feature unavailable without showing raw failure material. It must not display `idle`, `ready`, or an enabled Forest affordance based solely on shell reachability.

## 7. Failure and recovery law

- Essential startup failure prevents conversation admission and retains the existing startup refusal.
- Optional verification failure cannot activate or partially mount the failed feature.
- Duplicate completion cannot activate a feature twice.
- Shutdown during verification cannot activate a closed store.
- A late verification result from an earlier startup generation is stale and ignored.
- Retrying a failed optional stage requires a new explicit process startup in v1.

## 8. Measurement

Startup records monotonic durations for essential composition, loopback binding, and each deferred stage. Tests use injected clocks or bounded artificial gates; production timing is observational and does not alter authority.

## 9. Acceptance

1. The desktop shell answers health and static requests while Forest verification is deliberately held pending.
2. Health distinguishes shell, conversation, and Forest readiness with bounded fields.
3. A wake submitted during pending or failed active Forest verification is refused before Source admission and cannot use Forest, Exhale, or traversal.
4. Successful strict verification activates Forest-dependent capability once.
5. Failed verification leaves Forest unavailable while core conversation remains honest.
6. Shutdown during pending verification closes cleanly and cannot activate afterward.
7. Ordinary direct Hub creation retains its current synchronous compatibility contract.
8. Startup timings are exposed without paths, content, credentials, or raw errors.
9. Focused hostile/recovery tests and the complete suite pass.
