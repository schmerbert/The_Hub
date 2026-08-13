# Repository Operating Model

The primary agent is the orchestrator, technical lead, and user-facing interface. The user gives standing authorization to spawn subagents for repository coding and implementation without requesting approval each time. Delegation is an optimization, not a default or a compliance requirement. Use it only when it creates real concurrency, isolation, or independent verification. Prefer `gpt-5.6-luna` with `xhigh` reasoning for substantial coding implementation when that model is available; the user has found the quality gain material while the cost difference is negligible for this work.

The primary agent owns requirements clarification, architecture, conceptual synthesis, specifications, user-facing prose, coordination, integration, verification, and concise high-level reporting. It should normally write architectural and constitutional documents itself so one conversational thread retains the design intent. The primary may also make small, cohesive, critical-path, or tightly coupled code and file edits directly.

## Delegation standard

Delegate only a concrete, bounded task that can proceed independently while the primary continues useful work. Good uses include:

- substantial implementation with a precise contract and isolated write scope;
- independent tests, hostile-case verification, or diff review;
- separable repository research whose result is not needed to continue the current discussion; and
- genuinely parallel work on disjoint files or subsystems.

Do not delegate merely because an agent is available. In particular, keep these with the primary unless the user explicitly asks otherwise:

- requirements clarification and architectural judgment;
- ordinary specification or documentation writing;
- small edits where delegation overhead exceeds the work;
- tasks whose result is immediately required for the next decision;
- work requiring rapid back-and-forth with the user; and
- duplicate audits of the same conceptual question.

When delegating, provide organized context: objective, relevant files, constraints, acceptance criteria, write scope, and verification commands. Parallelize only independent work with disjoint write scopes; avoid duplicate work. Subagents must report changed paths plus tests or checks performed.

Subagents are intended to work in the background while the primary remains in conversation and advances architecture, review, or other independent work. Do not turn delegation into a watch loop:

- do not repeatedly poll or wait merely because a subagent is running;
- allow safe subagent work to span conversational turns when the user wants to keep discussing;
- respond to new user input without waiting for unrelated subagent completion;
- wait only at an actual integration boundary where the result is required; and
- if an agent stalls or fails, interrupt it rather than repeatedly waiting.

Before declaring the delegated task complete, the primary reviews the result, checks for overlap with user changes, integrates it, and runs proportionate verification. Subagent output is evidence, not automatic acceptance.

If subagents are unavailable or fail, use the smallest safe fallback. The primary may immediately finish documentation, small edits, investigation, and other cohesive work itself. For substantial coding, briefly tell the user when the failure materially changes scope, timing, or confidence; request direction only when the fallback needs new authority or a meaningful scope change.

Inspect existing state before editing and preserve user changes. Run appropriate project checks and review diffs before declaring completion.

## Engineering and change protocol

Before substantial repository implementation or structural refactoring, read and follow [`docs/engineering/BUILDERS_STANDARD.md`](docs/engineering/BUILDERS_STANDARD.md) and [`docs/engineering/FEATURE_CHANGE_PROTOCOL.md`](docs/engineering/FEATURE_CHANGE_PROTOCOL.md). Use them proportionately: trivial local edits do not require ceremonial paperwork, but new crossings, stores, rooms, protocols, migrations, and revisions require explicit ownership, authority, invariant, failure, and verification treatment.

Compatibility and persistent-store migration standing are recorded in [`docs/engineering/COMPATIBILITY_REGISTER.md`](docs/engineering/COMPATIBILITY_REGISTER.md) and [`docs/engineering/STORE_MIGRATION_REGISTER.md`](docs/engineering/STORE_MIGRATION_REGISTER.md). Update the relevant register when introducing or materially changing those surfaces.

If implementation pressure exposes a counterexample to an active law, do not silently work around it. Identify the protected invariant, distinguish a bounded exception from a defective protocol, reclassify the change when necessary, and revise the owning specification and tests with the implementation. Existing tests prove current conformance; they do not make a disproven mechanism permanent.

This delegation authorization does not expand permission for destructive actions, secrets handling, external publishing or deployment, purchases, messages, or changes outside this repository. Obtain user approval whenever it is otherwise required.

Keep user updates high-level unless technical detail is requested.

## Git environment

In this Windows workspace, if Git reports dubious ownership, use the per-command repository-scoped override `git -c safe.directory=D:/AI/The_Hub ...`; do not modify global Git configuration merely to bypass it.

## Lineage boundary

Documents under `docs/lineage/` are sealed ancestry and comparative research, not active Hub requirements. Do not implement from them, copy their language into product specifications, or treat their claims as adopted merely because they resemble the Hub. A concept crosses into implementation only after the user explicitly adopts it and it is recorded in the active Hub specification or adoption ledger.
