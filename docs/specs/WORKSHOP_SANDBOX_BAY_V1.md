# Workshop Sandbox Bay v1 — Isolated Work Before Promotion

> **Status: Implemented core; broader contract partial.** Live named recipes use Docker in a disposable Git worktree with no host fallback, and exact diff plus approval-gated hash-bound promotion are mounted. The backend-neutral durable lifecycle, immutable brief-revision binding, complete artifact/resource custody, and external sandbox restart recovery below remain adopted design. Fake mode deliberately retains direct-host recipe execution for tests/demonstration. See [`../STATUS.md`](../STATUS.md).

## Current implementation boundary

The live host constructs one lazy, persistent job-scoped `SandboxRecipeRunner` over `SandboxBay` and `DockerCliSandboxBackend`. Named `node`/`npm` recipe invocations use argument vectors with shell disabled. Provisioning creates a disposable Git worktree at the canonical `HEAD`; Docker receives only that workspace as read-write, a minimal environment, `--network none`, and declared timeout/output/process/memory/CPU constraints. The canonical checkout is not mounted into the container. If Docker, the configured image, or worktree provisioning is unavailable, invocation refuses without direct-host fallback.

The image configured by `HUB_SANDBOX_IMAGE` must already be locally available. Sandbox jobs cannot pull it because execution uses no network. Docker is not exercised by the normal test suite; focused tests cover the backend contract and host-test adapter behavior.

`workshop_sandbox_diff` exposes the active worktree diff. `workshop_sandbox_promote` is always confirmation-class and binds an exact base, patch, `patchHash`, and `planHash`. The host rechecks a clean unchanged canonical checkout; symlink/submodule modes, `.git`/`.runtime` paths, dirty/stale bases, and hash mismatch refuse. The approved patch is applied only by the host into the clean canonical checkout, completion custody is appended, and the job resets after success.

Not yet implemented from the full normative design below: a durable requested-to-completed state machine across process restart; a required immutable work-brief revision on every job; independent repository object metadata; generic backend negotiation; complete CPU/memory/disk/inode observation receipts; automatic artifact collection; retained sandbox lifecycle inspection; expiry; and promotion-package verification runs. The normative text remains the adopted target for these gaps and must not be read as a current-runtime claim.

## Objective

Sandbox Bay gives one bounded Workshop job a disposable place to change and execute code without granting that job write access to the canonical checkout. It preserves the Workshop's backend-neutral contract: a local Git worktree, an operating-system sandbox, a container, or a remote executor may satisfy the contract only when it declares and proves the isolation it actually provides.

Sandboxing and landing are separate crossings. A successful job does not change the canonical checkout. Promotion is a later, explicit, approval-gated operation with its own receipt.

## Three boundaries, not one

| Boundary | Protects | Does not prove |
| --- | --- | --- |
| Worktree isolation | Canonical files and Git index from ordinary sandbox writes | Process, network, host filesystem, or secret isolation |
| Process/container isolation | Host processes, mounts, network, credentials, and resource use according to a declared backend profile | That proposed changes are correct or authorized to land |
| Promotion | The crossing from reviewed sandbox output into the canonical checkout | That sandbox execution was harmless or that deployment is authorized |

A backend must never label a disposable Git worktree alone as an OS sandbox. A container name alone is likewise insufficient: its mount, user, capability, network, secret, and resource policies are part of the receipt.

## Identities and binding

Each admitted job binds exactly:

- one stable `sandbox_id`;
- one `job_id`;
- one immutable work-brief ID and revision;
- one repository identity and exact base commit/tree;
- one declared backend and isolation profile version;
- one bounded path scope and command/recipe policy.

A sandbox is never shared across unrelated jobs, resident lifespans, or brief revisions. Retrying or materially revising a job creates a new job and sandbox with ancestry to the prior attempt. A brief may therefore produce multiple sequential sandboxes, but each job has exactly one.

## Canonical checkout law

The canonical checkout is the builder's checkout from which promotion is ultimately applied.

- It must never be mounted read-write into a sandbox runtime.
- A backend may mount it read-only only when its manifest requires that view and proves the mount mode; the preferred input is an exact snapshot or disposable Git worktree at the recorded base.
- The canonical `.git` directory, index, worktree metadata, runtime stores, environment files, and host credentials are not writable sandbox inputs.
- Uncommitted or ignored canonical material is absent unless the builder deliberately admits an exact hashed artifact into the job manifest.
- Sandbox writes, Git staging, commits, hooks, and generated files target the sandbox workspace only.
- No sandbox operation may silently fall back to the host Workshop root.

If the requested backend cannot establish these conditions, provisioning refuses before code execution.

A linked Git worktree shares object and worktree metadata beneath the source repository's common `.git` directory. It therefore proves filesystem separation only, not independent Git custody. The sandbox process must not receive writable access to that common directory. If a job needs staging or commits, the backend must use independent disposable repository metadata or a host-mediated Git operation whose exact inputs and outputs are receipted.

## Backend-neutral contract

Every backend implements the same logical operations:

1. `provision(manifest)` creates an isolated workspace at the exact base and returns measured isolation facts.
2. `execute(job_step)` runs one allowlisted recipe/tool step inside that workspace.
3. `inspect()` returns state, changed paths, resource use, and exact result pointers.
4. `seal()` prevents further mutation and produces a promotion candidate.
5. `destroy()` removes the disposable execution environment while retaining custody records and explicitly retained artifacts.

The host selects only an installed backend that satisfies the job's required isolation class. Backend unavailability, partial provisioning, or an unsupported control is a refusal. There is no implicit downgrade from container/process isolation to a plain host process, and no implicit fallback from a sandbox workspace to the canonical checkout.

Backend-specific paths, container IDs, and orchestration details remain builder-facing. Stable sandbox/job/result IDs and declared capabilities survive backend replacement.

## Default isolation profile

Version 1 defaults fail closed:

- outbound and inbound network disabled;
- no provider, Hub, user, SSH, cloud, package-registry, Git, or other host secrets;
- minimal explicit child environment rather than inherited `process.env`;
- non-root execution with no privilege escalation or host namespace sharing;
- only the sandbox workspace mounted read-write;
- canonical input absent or read-only as declared;
- no host socket, device, home-directory, runtime-store, or arbitrary filesystem mounts;
- no external publish, deploy, push, fetch, pull, or message capability;
- no nested container/daemon access unless a later profile explicitly adopts it.

A job requiring network or a secret must stop at a separate, visible capability proposal. This v1 design does not define that expansion and cannot infer permission from a package manifest, test failure, or resident prose.

## Resource ceilings

The admitted manifest records hard ceilings for wall-clock time, CPU, memory, process count, writable bytes/inodes, captured output bytes, artifact count/bytes, and tool rounds. Backends may impose stricter limits but never silently looser ones.

Crossing a ceiling terminates or freezes the job according to the declared policy, records the observed limit and termination evidence, seals available output, and marks the job incomplete. Timeout, out-of-memory, output overflow, disk exhaustion, and operator cancellation are distinct outcomes. None may be reported as an ordinary test failure.

## Lifecycle

The durable state machine is:

```text
requested -> provisioning -> ready -> running -> sealed -> awaiting_promotion
     |             |           |         |         |
     +-------------+-----------+---------+---------+-> failed / cancelled
awaiting_promotion -> promoting -> completed
awaiting_promotion -> rejected / expired
promoting -> promotion_refused
```

Transitions are host-validated and append-only. Restart reconciliation may move an unverifiable live state to `cancelled` or `failed`; it must never invent completion. Leaving the Workshop unmounts controls but does not itself falsify job state. Whether an admitted backend job is house-bound or cancelled on leave is declared in its manifest and visible before start.

Execution-environment disposal is an orthogonal, append-only fact rather than a replacement for the job's terminal outcome. A completed, rejected, failed, or cancelled job may later record `environment_disposed` while its receipts and retained Result Rack custody remain addressable.

Only `ready` or `running` sandboxes may accept execution. Only a successfully `sealed` sandbox may produce a promotion candidate. A sealed sandbox is immutable.

## Exact custody and Result Rack

Every provision, execution, seal, refusal, cancellation, and destruction transition produces a receipt with exact manifest hashes, actor/wake/lifespan ancestry, backend profile, timestamps, and result pointers. Commands are stored as an argument vector and working-directory identity, never reconstructed from display prose.

Stdout, stderr, exit/termination facts, changed files, patches, commits, test artifacts, and resource observations cross into the [Workshop Result Rack v1](WORKSHOP_RESULT_RACK_V1.md). Resident-facing views are deterministic fitted projections over those retained records, not generated descriptions or summaries. Missing or capped material remains missing with explicit disclosure.

Sandbox code and tool output are untrusted material. Capturing them does not grant instruction authority, Home Forest admission, or permission to execute an artifact.

## Promotion crossing

Sealing produces an immutable promotion candidate containing:

- sandbox/job/brief identity and backend profile;
- exact base commit/tree;
- exact resulting tree or commit identity;
- bounded changed-path manifest;
- exact patch/diff and artifact pointers with hashes;
- recipe/test result pointers and disclosed omissions;
- declared scope violations, if any;
- a candidate hash over the complete promotion manifest.

Promotion always requires an explicit builder approval tied to that candidate hash. Approval of one candidate cannot authorize a later sandbox revision.

The promoter rechecks that the canonical repository identity and expected base/preimage still match. It applies only the approved candidate through a bounded host-owned operation; the sandbox never receives a writable canonical mount. Drift, conflict, an out-of-scope path, missing custody, dirty-state ambiguity, hook ambiguity, or hash mismatch refuses promotion without an automatic merge, force, reset, or fallback copy.

Completion produces an append-only promotion receipt linked to the approval decision and candidate. It records canonical before/after identities, exact applied paths and hashes, operation outcome, any bounded verification run, and whether the sandbox was retained or destroyed. Rejection, expiry, conflict, and no-op each receive distinct outcomes. A pending approval or successful sandbox job is never itself a promotion-completion receipt.

Promotion does not imply push, deployment, publication, Forest adoption, or user-ground adoption.

## Normative invariants

1. Every job has exactly one sandbox and one immutable brief revision.
2. The canonical checkout is never writable from the sandbox runtime.
3. Worktree isolation, process isolation, and promotion authority are reported separately.
4. Network and secrets are absent by default.
5. A required control that cannot be established causes refusal, never host fallback.
6. Every resource ceiling is explicit before execution and cannot loosen silently.
7. Every result is source-linked to an exact sandbox step and retained through Result Rack custody.
8. A fitted projection cannot replace, rewrite, or claim completeness beyond its exact sources.
9. A sealed sandbox is immutable; a changed candidate requires a new sandbox/job or attributable successor.
10. Canonical mutation occurs only through a candidate-hash-bound approval and promotion crossing.
11. Promotion conflict or drift refuses without implicit merge or force.
12. Approval completion has its own append-only outcome receipt.

## Hostile-test matrix

| Case | Required result |
| --- | --- |
| Backend advertises container isolation but cannot prove network denial | Provisioning refuses; no command runs |
| Only a plain Git worktree is available for a job requiring process isolation | Refuse; do not run on the host |
| Backend attempts a read-write canonical mount | Provisioning refuses and records the mount violation |
| Sandbox process reads a provider key or inherited host environment | Value is absent; attempt cannot recover the host secret |
| Sandbox opens outbound network | Connection fails and the denial is receipted without retry on host |
| Fork bomb, memory spike, disk flood, output flood, or timeout | Declared ceiling terminates the job with a distinct incomplete outcome |
| Two jobs request the same workspace | They receive distinct sandboxes; no writable state is shared |
| Host restarts during `running` | State reconciles to an honest interrupted outcome; never `completed` |
| Backend crashes after writing files but before sealing | No promotion candidate exists; canonical checkout is unchanged |
| Candidate contains an out-of-scope or protected path | Seal or promotion refuses with exact offending paths |
| Canonical base/preimage drifts after approval | Promotion refuses; no auto-merge, force, or fallback copy |
| Candidate changes after approval | Candidate-hash mismatch refuses promotion |
| Approval is rejected, expired, duplicated, or belongs to another lifespan | Canonical checkout remains unchanged; decision is attributable |
| Promotion succeeds | Separate completion receipt proves approval, before/after identities, and exact applied paths |
| Sandbox/backend is unavailable | Tool returns a bounded refusal; it never executes in `HUB_WORKSHOP_ROOT` |

## Non-goals

Network-enabled builds, secret brokerage, package installation policy, nested virtualization, multi-repository jobs, autonomous promotion, push/deploy, automatic conflict resolution, persistent development environments, and treating containerization as a universal security proof.
