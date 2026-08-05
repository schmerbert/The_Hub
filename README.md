# The Hub — First Breath

This repository contains the smallest honest resident interaction: one local thread, one user message at a time, one completed or visibly failed wake. It uses Node.js built-ins, SQLite, a replaceable provider boundary, and the Corner-derived static mobile-first page. Wide browsers open as a compact chip that expands into the bench; narrow browsers open directly into the bench.

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

## Inspectable local API

- `GET /api/health`
- `GET /api/thread`
- `POST /api/wakes` with `{ "content": "..." }`
- `GET /api/wakes/:id`

Every wake inspection exposes the ordered charter/context manifest, provenance, authority, inclusion or omission reason, SHA-256 content hashes, provider receipt metadata, linked events, and typed failures.

## Verify

```powershell
npm test
```

The suite exercises the real HTTP and SQLite path in temporary databases, including empty and oversized input, missing live credentials, empty provider output, provider HTTP failure, fake-mode labeling, context ceilings, and visible nonterminal wakes.

This first breath deliberately does not implement rooms, tools, Forest retrieval, movement, chambers, companions, autonomy, streaming, authentication, or deployment.
