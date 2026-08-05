# First Breath — Technical Specification

**Status:** Approved implementation starting point  
**Scope:** One resident, one thread, one honest wake  
**Implementation owner:** Luna coding subagent  
**Architecture and review owner:** Primary orchestrator  

## 1. Objective

Prove the smallest end-to-end resident interaction that obeys the Hub's existing laws:

1. The user submits one message from a mobile-usable local web page.
2. The host commits that message as user-authored ground.
3. The host constructs an attributable context packet.
4. DeepSeek receives exactly that packet and returns a resident response.
5. The host commits the response as model-signed testimony.
6. The interface displays the conversation and a clinical inspection view of what shaped the wake.
7. Provider, validation, or storage failures remain visible and never become narrated success.

This is a **first breath**, not the full first vertical slice.

## 2. Explicit Non-Goals

Do not implement:

- Forest retrieval, embeddings, or cross-project connection.
- Rooms, spatial movement, the House/Hub/Globe map, or chamber rotation.
- Tools, function calling, companions, Luna delegation from inside, or autonomous wakes.
- Builder correspondence.
- Authentication, remote deployment, app-store packaging, or multi-user support.
- Summarization, inferred memory, or silent context compression.
- A fixed resident name or personality beyond the minimal arrival charter.

These remain visible horizon, not hidden partial features.

## 3. Runtime and Fittings

Use the repository's existing Node.js 22 runtime.

Prefer a dependency-minimal JavaScript ESM implementation:

- Node built-in HTTP server.
- Node built-in `fetch` for the provider request.
- Node built-in `node:sqlite` for the local database.
- Node built-in `node:test` for verification.
- Static HTML, CSS, and browser JavaScript for the first mobile web surface.

Do not introduce a framework or build system unless a concrete blocker is found and reported before installation.

## 4. Provider Boundary

Implement a replaceable resident provider interface. The production adapter targets DeepSeek's OpenAI-compatible `POST /chat/completions` endpoint.

Configuration:

- `DEEPSEEK_API_KEY` — required for live resident wakes; never stored or logged.
- `DEEPSEEK_BASE_URL` — defaults to `https://api.deepseek.com`.
- `DEEPSEEK_MODEL` — defaults to `deepseek-v4-flash`.
- `DEEPSEEK_THINKING` — defaults to `disabled` for the first breath.
- `HUB_RESIDENT_MODE` — `live` or explicit `fake`; defaults to `live`.
- `HUB_DB_PATH` — optional local database path; defaults beneath ignored runtime data.
- `HUB_PORT` — optional local port.

The fake adapter exists only for tests and explicit local demonstration. The UI and stored wake must label it `fake`; it must never present itself as the resident or as DeepSeek.

If live mode lacks an API key, the host returns a typed `provider_unavailable` failure. It must not silently fall back to fake output.

Capture provider response identifiers, resolved model name, finish reason, system fingerprint when present, and token/cache usage when returned. Do not request or expose hidden chain-of-thought.

## 5. Resident Arrival Charter

Keep the initial resident charter in one plain, inspectable source file. It should establish only:

- This is the first experimental residence in an unfinished Marble.
- The resident may speak naturally and form opinions about orientation, comfort, and friction.
- The resident must distinguish current context from inference and unknowns.
- The resident must not claim memories, rooms, tools, actions, or continuous experience not supported by returned context and receipts.
- Missing or contradictory machinery should be named plainly as exposed wiring.

Do not prescribe a clinical personality, a successor identity, Trinity's identity, or an elaborate fictional biography.

The exact charter text must appear as an inspectable context item on every wake.

## 6. Minimum Data Model

Use SQLite migrations or idempotent schema initialization. Preserve user and resident utterances separately.

Minimum entities:

### `threads`

- stable ID;
- created timestamp;
- optional human label.

### `events`

- stable ID;
- thread ID;
- wake ID when applicable;
- actor kind: `user`, `resident`, or `host`;
- event kind: `utterance`, `failure`, or `state`;
- exact content;
- authority: `ground`, `model_signed`, or `host_receipt`;
- provider/model identity when applicable;
- created timestamp.

### `wakes`

- stable ID and thread ID;
- status: `assembling`, `calling_provider`, `committed`, or `failed`;
- provider and requested/resolved model;
- provider response ID, finish reason, and fingerprint when present;
- token/cache usage as nullable fields or attributable JSON;
- typed failure code and safe failure message;
- started/completed timestamps.

### `wake_context_items`

- wake ID and stable ordinal;
- item kind: `charter`, `utterance`, or `disclosure`;
- actor/role sent to provider;
- exact content sent;
- source event ID when applicable;
- source description;
- authority;
- included/omitted state and omission reason;
- content hash.

Do not store the API key, HTTP authorization header, or secrets in any table or log.

## 7. Context Assembly

For each wake:

1. Include the resident arrival charter first.
2. Include committed utterances from the one thread in chronological order.
3. Include the newly committed user utterance exactly once.
4. Enforce a clear configurable message-count ceiling, default 20 utterances.
5. When older utterances are omitted, create an inspectable disclosure item containing the omitted count and reason. Do not summarize omitted content.
6. Persist the complete ordered context manifest before the provider call.
7. Hash each exact context item so inspection can verify what was sent.

There is no semantic retrieval or hidden weighting in this slice.

## 8. Wake Transaction

The host owns the sequence:

1. Validate a non-empty bounded user message.
2. Begin the wake and commit the user event.
3. Assemble and commit the context manifest.
4. Mark the wake `calling_provider`.
5. Call the configured adapter.
6. Validate a non-empty resident response.
7. Commit the resident event and provider receipt, then mark `committed`.
8. On failure, commit a host failure event and mark `failed` without creating a resident utterance.

The first implementation may use a SQLite transaction around local mutations but cannot make the remote request atomic. State transitions must make interrupted provider calls legible on restart.

## 9. Local API

Provide the smallest routes needed by the surface:

- `GET /api/health` — runtime status, schema readiness, resident mode, configured model, and whether live credentials are available; never expose the key.
- `GET /api/thread` — the single thread's committed events and wake summaries.
- `POST /api/wakes` — accepts `{ "content": "..." }`; returns the committed or failed wake.
- `GET /api/wakes/:id` — full clinical inspection including ordered context manifest, provider receipt metadata, failure, and linked events.

Use typed JSON errors and appropriate HTTP status codes. Bound request body size and message length.

Streaming is explicitly deferred. An honest completed response is more important than simulated immediacy.

## 10. First Surface

Build a quiet mobile-first local page with:

- A transcript distinguishing user ground, resident model-signed testimony, and host failures.
- A text composer and send button.
- Visible sending/failed state that prevents duplicate submission.
- A clearly visible resident mode/model indicator.
- An inspection control on each wake.
- A clinical drawer or panel showing context order, provenance, authority, hashes, omissions, provider metadata, and failure state.
- No visual suggestion of rooms, tools, movement, or capabilities not implemented.

Use accessible semantic HTML, keyboard operation, readable focus states, and a narrow-phone layout.

## 11. Verification

Use tests that exercise the real host/database path with a temporary SQLite database.

Required positive tests:

- Schema initializes idempotently.
- A valid fake-adapter wake commits user event, exact context items, resident event, and provider receipt.
- Context ordering and hashes match the actual adapter input.
- The default ceiling creates an omission disclosure without a summary.
- API thread and wake inspection return attributable records.

Required hostile/failure tests:

- Empty and oversized input refuse before a provider call.
- Live mode without an API key fails honestly and creates no resident utterance.
- Empty provider content fails honestly.
- Provider HTTP failure is typed and preserved without leaking secrets or raw authorization data.
- Explicit fake mode is labeled in storage and API responses.
- Interrupted/nonterminal wakes are visible rather than reported as committed.

Provide one command that runs the entire suite.

## 12. Expected Repository Shape

Luna may adjust names minimally if Node conventions require it, but should keep the write scope within:

```text
package.json
.gitignore
src/
  server/
  core/
  providers/
  resident/
public/
test/
README.md
```

Do not modify `PREBUILD.md`, `AGENTS.md`, or `docs/lineage/` during implementation.

## 13. Acceptance

The mission is complete when:

1. `npm test` passes from a clean checkout without a DeepSeek key.
2. An explicit fake-mode local run demonstrates the UI and labels itself fake.
3. Live mode has a documented launch path using environment variables and never requires committing a secret.
4. Every response shown as resident speech corresponds to a committed resident event.
5. Every wake can reveal the exact context and provenance that shaped it.
6. No unimplemented Globe feature is implied by prose or UI.
7. Luna reports changed paths, commands run, results, and any deviations from this specification.
