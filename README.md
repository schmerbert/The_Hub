# The Hub — First Breath

This repository contains one process-lived resident session. Each server start supersedes any prior open session and opens a new one; its first human message takes a native two-breath Hearth handshake, and later messages remain ordinary turns in the same complete active history. It uses Node.js built-ins, SQLite, a replaceable provider boundary, and the Corner-derived static mobile-first page.

## Run an explicit fake-mode demonstration

Fake mode is only a local demonstration and is labeled in the interface, API, and stored wake:

```powershell
$env:HUB_RESIDENT_MODE = "fake"
npm start
```

Open <http://localhost:3000>. The fake adapter does not claim to be DeepSeek or the resident provider.

## Run live DeepSeek mode

Live mode is the default. It fails honestly when the key is absent; it never falls back to fake output.

```powershell
$env:DEEPSEEK_API_KEY = "your-key-in-the-process-environment"
$env:DEEPSEEK_MODEL = "deepseek-v4-flash"
npm start
```

Optional settings include `DEEPSEEK_BASE_URL`, `DEEPSEEK_THINKING`, `HUB_PORT`, `HUB_DB_PATH`, `HUB_MESSAGE_CEILING`, `HUB_MAX_MESSAGE_LENGTH`, and `HUB_MAX_BODY_BYTES`. Keep credentials outside the repository. The API key and authorization header are never stored or returned.

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

## Inspectable local API

- `GET /api/health`
- `GET /api/thread` (includes active session and Session Zero ancestry)
- `GET /api/session`
- `POST /api/wakes` with `{ "content": "..." }`
- `GET /api/wakes/:id`

Every wake inspection exposes session identity, provider phases, exact structured messages, Hearth custody, provenance, SHA-256 content hashes, linked events, and typed failures. The tool call and tool-role return are not rendered as chat utterances.

## Verify

```powershell
npm test
```

The suite exercises the real HTTP and SQLite path in temporary databases, including empty and oversized input, missing live credentials, empty provider output, provider HTTP failure, fake-mode labeling, context ceilings, and visible nonterminal wakes.

This slice deliberately does not implement rooms, spatial state, reset UI, context-limit closure, summaries, embeddings, Forest retrieval or synthesis, movement machinery, autonomous work, streaming, authentication, or deployment. The only native tool is the forced first-turn `tend_hearth({})` action.
