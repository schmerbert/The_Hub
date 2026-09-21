# Security Policy

## Project standing

The Hub is experimental, pre-alpha software intended for one trusted local operator. It is not a hardened multi-user service and has not received an independent security audit.

The server binds to loopback, and live provider credentials are expected only in the ignored local `.env` file or the launching process environment. Runtime stores, logs, provider returns, conversation material, repository projections, and optional Spotlight observations may contain sensitive information. They are excluded from Git by the repository defaults, but most ordinary Hub custody is not application-encrypted at rest.

Do not expose the Hub server to an untrusted network, use fake-mode host recipe execution with an untrusted repository, commit a populated `.env`, or commit files from `.runtime`.

The adopted security direction and currently unimplemented controls are documented in [`docs/specs/SECURITY_PRIVACY_CUSTODY_V1.md`](docs/specs/SECURITY_PRIVACY_CUSTODY_V1.md) and [`docs/STATUS.md`](docs/STATUS.md).

## Supported versions

There is no supported stable release yet. Security fixes are made on the current default branch only.

## Reporting a vulnerability

Please do not place credentials, private conversation data, financial data, or exploit details in a public issue. Use GitHub's private vulnerability reporting for this repository when it is available. Non-sensitive hardening suggestions may be filed as ordinary issues.

If no private reporting channel is available, disclose only that you found a potential vulnerability and ask the maintainer to establish a private channel before sharing details.
