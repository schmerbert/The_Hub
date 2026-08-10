# The Hub — First Breath

This repository contains one process-lived resident session. Each server start supersedes any prior open session and opens a new one; its first human message takes a native two-breath Hearth handshake, and later messages remain ordinary turns in the same complete active history. It uses Node.js built-ins, SQLite, a replaceable provider boundary, and the Corner-derived static mobile-first page.

See [`docs/STATUS.md`](docs/STATUS.md) for the canonical implemented surface, specification precedence, and adopted designs that are not yet runtime features.

## Run an explicit fake-mode demonstration

Fake mode is only a local demonstration and is labeled in the interface, API, and stored wake:

```powershell
$env:HUB_RESIDENT_MODE = "fake"
npm start
```

Open <http://localhost:3000>. The fake adapter does not claim to be DeepSeek or the resident provider.

## Run live DeepSeek mode

Live mode is the default. It fails honestly when the key is absent; it never falls back to fake output.

Copy `.env.example` to the ignored local `.env` for a persistent local configuration, or set variables in the launching shell. `npm start` loads simple `KEY=VALUE` pairs from `.env` without overriding variables already present in the process environment.

```powershell
$env:DEEPSEEK_API_KEY = "your-key-in-the-process-environment"
$env:DEEPSEEK_MODEL = "deepseek-v4-flash"
npm start
```

Optional settings include `DEEPSEEK_BASE_URL`, `DEEPSEEK_THINKING`, `HUB_PORT`, `HUB_RUNTIME_ROOT`, `HUB_DB_PATH`, `HUB_FOREST_PATH`, `HUB_SPINE_PATH`, `HUB_WORLD_PATH`, `HUB_WORKSHOP_ROOT`, `HUB_MESSAGE_CEILING`, `HUB_HEARTH_SCROLL_BUDGET`, `HUB_HEARTH_EXCERPT_LIMIT`, `HUB_MAX_MESSAGE_LENGTH`, `HUB_MAX_BODY_BYTES`, `HUB_MAX_TOOL_ROUNDS`, `HUB_WORKSHOP_MAX_FILES`, `HUB_WORKSHOP_MAX_BYTES`, `HUB_WORKSHOP_MAX_LINES`, `HUB_WORKSHOP_MAX_RESULTS`, and `HUB_RECIPE_TIMEOUT_MS`. When a database path is overridden without explicit Spine or World paths, the host derives sibling paths beside that database. Keep credentials only in the ignored `.env` or launching environment. The host does not store or return the API key or authorization header, and named recipe children receive a credential-scrubbed environment. Recipe code still has the Hub process's filesystem permissions and can read local workspace files, including an ignored `.env`; prefer the launching environment when that trust boundary matters.

Fake-mode orientation variants for failure testing are selected with `HUB_FAKE_ORIENTATION_VARIANT` (`valid`, `prose`, `malformed`, `duplicate`, `wrong_tool`, or `nonempty_args`).

## Activate Forest custody and the Spine

The historical Forest is built separately and verified before the resident host may write to it:

```powershell
npm run forest:plan
npm run forest:apply -- --confirm-create
npm run forest:verify
```

After verification, restart the live DeepSeek host with custody enabled:

```powershell
$env:HUB_FOREST_ACTIVE = "true"
npm start
```

Activation refuses a missing Forest, an invalid Forest, or fake-provider mode. Historical entries are marked `pre_spine`; the append-only Spine begins with the first newly dispatched live request. Verify it with `npm run spine:verify` after that request. `HUB_FOREST_PATH` and `HUB_SPINE_PATH` may override their default locations.

Workshop fixtures stand inside `room.workshop`: shelves, workbench, kiln, ledger, and clipboard. Engagement is optional orientation and does not gate tools; the full Workshop catalog mounts in the room. It includes bounded exploration, exact patch/write/create/rename/delete operations, named recipes, local Git inspection/staging/commit/checkout, work briefs, timers, and catalog inspection. Ordinary workspace writes and local Git add/commit are automatic. Delete and local branch checkout wait for Corner Approvals (`GET /api/approvals`, `POST /api/approvals/:id/decide`). `HUB_APPROVAL_MODE=auto` is limited to fake-mode tests.

Named recipes are allowlisted command shapes, not an OS sandbox: they execute trusted code already present in `HUB_WORKSHOP_ROOT` with the Hub process's filesystem permissions. Do not mount an untrusted repository. Free-form shell and network/destructive Git operations are not installed.

## Inspectable local API

- `GET /api/health`
- `GET /api/thread` (includes active session and Session Zero ancestry)
- `GET /api/session`
- `GET /api/world` (builder inspection of the separate graph, current location, engaged fixture, Ceiling catalog, effective room tools, and approvals)
- `GET /api/approvals`
- `POST /api/approvals/:id/decide` with `{ "decision": "confirm" | "reject" }`
- `POST /api/wakes` with `{ "content": "..." }`
- `GET /api/wakes/:id`
- `GET /api/wakes/:id/slips`

Every wake inspection exposes session identity, provider phases, exact structured messages, Hearth custody, provenance, SHA-256 content hashes, linked events, and typed failures. The tool call and tool-role return are not rendered as chat utterances.

## Verify

```powershell
npm test
```

The suite exercises the real HTTP and SQLite path in temporary databases, including empty and oversized input, missing live credentials, empty provider output, provider HTTP failure, fake-mode labeling, context ceilings, and visible nonterminal wakes.

The current World Graph implements Center and Workshop only: packed sand, a stone bench, an unspecified tin cup, one bidirectional Workshop door, per-lifespan location, and the five Workshop fixtures. Center mounts movement only; Workshop mounts its complete coding catalog. Fixture engagement is orientation, not a capability gate. The kiln runs named recipes asynchronously and survives room changes within the lifespan; the timer likewise remains visible through room presence. Corner projects deterministic phase, thinking, action, pending-approval, and refusal slips without placing host machinery in the utterance rail.

The adopted Vault and Hearth Notes/Forest Exhale designs are not implemented. Other deferred work includes free-form shell, companion/delegation bridges, reset UI, context-limit lifespan closure, summaries, embeddings and semantic retrieval, autonomous model wakes, streaming, authentication, external publishing, deployment, and network Git operations.
