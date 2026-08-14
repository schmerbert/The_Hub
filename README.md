# The Hub — First Breath

The Hub is a local harness for a continuing Resident: a model-mediated collaborator who can remain oriented across conversation, tools, durable records, and a material World without being falsely presented as omniscient, continuously awake, or identical to one provider invocation. It separates what happened, what entered attention, what was retained, what was said, and what can cause action.

**Start with [`docs/ORIENTATION.md`](docs/ORIENTATION.md)** for the proposition, the reasons behind the harness, its spatial and clinical shape, and where the design is going. [`docs/GLOSSARY.md`](docs/GLOSSARY.md) maps the lived language to conventional machinery. [`docs/STATUS.md`](docs/STATUS.md) is the canonical implemented surface, and [`docs/README.md`](docs/README.md) provides the complete documentation index and authority order.

The runtime currently opens one process-lived Resident session per server start. Its first human message takes a native two-breath Hearth handshake; later messages remain ordinary turns in the same complete active history. The implementation uses Node.js, SQLite, a replaceable provider boundary, a browser Corner surface, and an Electron desktop shell.

## Run an explicit fake-mode demonstration

Fake mode is only a local demonstration and is labeled in the interface, API, and stored wake:

```powershell
$env:HUB_RESIDENT_MODE = "fake"
npm start
```

Open <http://localhost:3000>. The fake adapter does not claim to be DeepSeek or the resident provider.

## Run the desktop Corner

```powershell
npm run desktop
```

On Windows, double-click `start.bat` from the repository root. It delegates to the pinned `start-hub.bat` launcher; launching it again expands the existing single instance. Use `stop-hub.bat` for a graceful stop.

[`BUILDER_CHANNEL.md`](BUILDER_CHANNEL.md) is the shared Resident–Builder correspondence file. It is read and edited through ordinary Workshop affordances and does not automatically enter Glass or Forest continuity.

Electron 43.2.0 starts the same Hub on loopback, then loads it into a secure frameless Corner window. The desktop surface is 96x96 when compact and 980x680 when expanded, stays 24 pixels inside the active display, and offers tray controls to expand, collapse, or quit. Ordinary window close collapses and hides it; explicit quit awaits Hub custody shutdown. Set `HUB_CORNER_ALWAYS_ON_TOP=false` to disable its normal-level always-on-top behavior. The browser and desktop use the same renderer and API; a 96-pixel desktop window remains compact while a narrow browser opens expanded.

The shell is single-instance, opaque, and loopback-only. Its preload exposes only compact/expanded mode operations with sender validation; renderer Node integration, permissions, new windows, and external navigation are denied. There is not yet an installer or packaging pipeline, and a native GUI/tray smoke pass remains pending even though the desktop lifecycle, geometry, and security seams have automated coverage.

## Run live DeepSeek mode

Live mode is the default. It fails honestly when the key is absent; it never falls back to fake output.

Copy `.env.example` to the ignored local `.env` for a persistent local configuration, or set variables in the launching shell. `npm start` loads simple `KEY=VALUE` pairs from `.env` without overriding variables already present in the process environment.

```powershell
$env:DEEPSEEK_API_KEY = "your-key-in-the-process-environment"
$env:DEEPSEEK_MODEL = "deepseek-v4-flash"
npm start
```

Optional settings include the path and ceiling keys shown in `.env.example`, including Result Rack projection limits, provider attention thresholds, retained tool-pair count, the provider-return capture ceiling, and Sandbox Bay configuration. `HUB_PROVIDER_MAX_RETURN_BYTES` defaults to 8 MiB. When a database path is overridden without explicit Spine, World, or Result paths, the host derives sibling paths beside that database. Keep credentials only in the ignored `.env` or launching environment. The host does not store or return the API key or authorization header.

Live mode requires Docker sandbox execution. `HUB_SANDBOX_BACKEND` is mode-locked to `docker`, and `HUB_SANDBOX_IMAGE` (default `node:22-alpine`) must already be available locally. Each job starts from committed `HEAD` in a disposable Git worktree; uncommitted and ignored canonical files are absent unless a future admission crossing explicitly adds them. Container networking is disabled and the environment is minimal. Docker/image/provisioning failure refuses the recipe; it never falls back to executing that live recipe in the canonical checkout. Docker is not exercised by the normal test suite.

Fake mode is an explicit test/demo boundary. It uses the legacy direct-host RecipeRunner and therefore executes trusted workspace code with the Hub process's filesystem permissions. It is not an OS sandbox, even though fake configuration uses the `host-test` backend label. Do not point fake mode at an untrusted repository.

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

Workshop fixtures stand inside `room.workshop`: shelves, workbench, kiln, ledger, and clipboard. Engagement is optional orientation and does not gate World authority; it fits the provider-facing schema set for resident attention. The full catalog remains mounted and inspectable. The Workshop includes bounded exploration, exact patch/write/create/rename/delete operations, named recipes, sandbox diff/promotion, local Git inspection/staging/commit/checkout, work briefs, timers, and catalog inspection. Ordinary workspace writes and local Git add/commit are automatic. Delete and local branch checkout wait for Corner Approvals (`GET /api/approvals`, `POST /api/approvals/:id/decide`). Sandbox promotion always requires confirmation. `HUB_APPROVAL_MODE=auto` is limited to fake-mode tests.

Named recipes remain allowlisted command shapes. In live mode their execution crossing is the Docker Sandbox Bay; in fake mode they run directly on the host for trusted tests/demonstration. Free-form shell and network/destructive Git operations are not installed.

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
- `GET /api/events` (same-origin Server-Sent Events; `?after=<sequence>` or `Last-Event-ID` resumes within the process buffer)
- `GET /api/events/history?after=<sequence>&limit=<1..1000>` (durable recovery journal)

Every wake inspection exposes session identity, provider phases, exact structured messages, Hearth custody, provenance, SHA-256 content hashes, linked events, and typed failures. The tool call and tool-role return are not rendered as chat utterances.

DeepSeek live responses use SSE. Response bytes admitted under the configured return ceiling are retained exactly in one terminal Spine frame and independently assembled by provider-return Scrub. An oversized response retains the exact admitted prefix, records incomplete capture, and fails before canonical use. Safe thinking, draft, tool-call-name, and card updates are persisted as append-only wake-stream events before delivery to Corner; provisional tool arguments are withheld and a credential-shaped delta suppresses its channel. Provider deltas are provisional: only the terminal scrubbed assistant message enters session history, Forest admission, or later tool rounds. A disconnected Corner does not cancel the wake. It reconnects from its last contiguous event cursor, pages the durable journal when the process buffer discloses a gap, and retains persisted-slip polling as a fallback.

Closing the Hub is different from disconnecting a renderer. Shutdown stops intake and aborts the active provider crossing. A compliant provider has up to 250 ms to seal any admitted partial raw bytes and an aborted outcome; an adapter that ignores cancellation is detached after that grace period, and late callbacks are gated before custody stores close. Tool and World execution already in progress remains awaited and custodied.

## Verify

```powershell
npm test
```

The suite exercises the real HTTP and SQLite path in temporary databases, including empty and oversized input, missing live credentials, empty provider output, provider HTTP failure, fake-mode labeling, context ceilings, and visible nonterminal wakes.

The current World Graph implements the Hub container, Center, Workshop, Garden, House, and Threshold; a stateful House front door; a Center/Garden opening and House/Threshold passage; visible non-traversable Forest/Road boundaries; per-lifespan location; and the installed fixtures and objects described in Status. Center mounts movement only; Workshop mounts its complete coding catalog. The kiln runs named recipes asynchronously and survives room changes within the lifespan; the timer likewise remains visible through room presence. Result Rack captures ordinary tool/refusal/approval crossings and async recipe completion, while deterministic projections keep exact large results behind fitted pointers. Corner projects deterministic chronological phase, thinking, action, pending-approval, completion, and refusal slips without placing host machinery in the utterance rail.

The adopted Vault and Hearth Notes/Forest Exhale designs are not implemented. Other deferred work includes free-form shell, companion/delegation bridges, reset UI, context-limit lifespan closure, summaries, embeddings and semantic retrieval, autonomous model wakes, user cancellation, authentication, desktop installers/packaging, general file or artifact opening/highlighting, external publishing, deployment, and network Git operations.
