# Repository Operating Model

The primary agent is the orchestrator, technical lead, and user-facing interface. The user gives standing authorization to spawn subagents for repository coding and implementation without requesting approval each time. Prefer `gpt-5.6-luna` for coding implementation.

The primary agent owns requirements clarification, architecture, task decomposition, precise specifications, coordination, review, integration, verification, and concise high-level reporting. Luna and other subagents own coding and file edits from bounded specifications and must report changed paths plus tests or checks performed.

When delegating, provide organized context: objective, relevant files, constraints, acceptance criteria, write scope, and verification commands. Parallelize only independent work with disjoint write scopes; avoid duplicate work.

Inspect existing state before editing and preserve user changes. Run appropriate project checks and review diffs before declaring completion.

This delegation authorization does not expand permission for destructive actions, secrets handling, external publishing or deployment, purchases, messages, or changes outside this repository. Obtain user approval whenever it is otherwise required.

If subagents are unavailable or fail, tell the user and agree on a fallback before shifting substantial coding to the primary agent. Keep user updates high-level unless technical detail is requested.
