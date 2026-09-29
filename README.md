# The Hub

The Hub is a local place for an AI Resident to return to. It gives a model-mediated collaborator a continuing conversation, a small world it can move through, tools it can use, and records it can revisit. The software keeps those things separate: an event that happened, a record the Resident was shown, a memory it may follow, and an action it may take are different claims.

The aim is continuity without asking one model call to pretend it was awake for all the time between calls. The Hub keeps a record of what happened, shows the Resident a bounded view of that record, and makes changes to the world or workspace pass through explicit host-controlled gates.

This is experimental, pre-alpha software for one trusted local operator. It is not ready for unattended, multi-user, security-critical, or production use. Read [Security](SECURITY.md) before connecting credentials or sensitive data.

## What it feels like

A person speaks to the Resident in the Corner, the Hub's browser or desktop interface. The Resident begins at the Hearth, can move through a small persistent World, and can enter the Workshop to inspect and work on this repository. Some actions need the person's approval. Its location and available tools are explicit rather than implied by its words.

The Resident can also choose a bounded rest and return later. The Hub records why and when that return was planned, when it actually happened, and where the Resident was when it rested. The return is an autonomous wake, not a fabricated message from the person. Exact records remain available even when only a selection fits into the Resident's current view.

That is the central experiment: can an AI collaborator have a durable place to work and return to while the human can still tell what it saw, what it retained, and what it was authorized to do?

## What exists today

The current runtime has a process-lived Resident session, browser and Electron Corner surfaces, a persistent World with several places, repository tools in the Workshop, durable event and provider custody, a Forest for continuity, and bounded self-directed wakes. It also has an optional, read-only Spotlight connection for deliberate Robinhood observations. These parts have automated contract coverage, but several live-provider, Docker, connector, and native desktop paths still need complete manual end-to-end validation.

[Current Status](docs/STATUS.md) is the precise implemented-capability register. It distinguishes installed behavior from adopted direction and known limits.

## Try the local demonstration

The fake provider gives you a labeled, local demonstration without a provider key. It is for a trusted checkout: fake-mode recipes execute workspace code with the Hub process's filesystem permissions.

With Node.js and npm installed, from this repository on Windows:

```powershell
npm ci
$env:HUB_RESIDENT_MODE = "fake"
npm start
```

Open <http://127.0.0.1:3000>. The interface and stored wake identify fake output as fake. For the desktop Corner, use `npm run desktop` instead of `npm start` after setting the same mode. Live DeepSeek setup, Docker requirements, Forest activation, Spotlight connection, inspection endpoints, and verification commands are in the [Operator Guide](docs/OPERATOR_GUIDE.md).

## Read further

The Hub is the working reference for [The Marble](https://github.com/schmerbert/The_Marble), a separate manual about the relationships a place for an AI Resident should preserve. The manual explains the broader idea; this repository records what this particular implementation has installed and verified. Neither document silently overrides the other's scope.

| If you want to… | Start here |
| --- | --- |
| Understand the idea and the shape of the place | [Orientation](docs/ORIENTATION.md) |
| Translate the Hub's terms into conventional machinery | [Glossary](docs/GLOSSARY.md) |
| Check exactly what works now | [Current Status](docs/STATUS.md) |
| Run or inspect the host in detail | [Operator Guide](docs/OPERATOR_GUIDE.md) |
| Trace architecture, specifications, and their authority | [Documentation index](docs/README.md) |

The deeper documents are deliberately explicit about custody, authority, failures, and verification. You can start here as a person and follow those records as far as your question requires.
