# Spotlight live read v1

> **Status: Adopted implementation contract, 2026-09-11.** The human requested a live Robinhood connection so the Resident can deliberately inspect actual data. This extends the Spotlight shell and revises its unconditional cap for observation/list/read only. Implementation and authentication status must be reported separately.

## Ownership and revision

- Classification: extending external read and observation custody; revising the unconditional capped-hand protocol.
- Owners: `src/connectors/robinhood/` owns standalone MCP transport, OAuth, upstream projection and account identifiers; `src/places/hub/spotlight/` owns observation validation, storage and deliberate read service. Server composition wires their lifecycles; World retains location and action authority.
- Crossing: deliberate World-mounted `spotlight_observe` -> six-operation Robinhood allowlist -> identifier-free admitted observation -> room-owned append-only store -> ordinary Gateway/Result Rack/host-return Scrub -> Resident provider attention.
- Protected invariant: observation cannot acquire financial execution, installation authority, or automatic Forest admission. Credentials and private account identifiers never enter observations or provider attention.
- Source authority: Robinhood owns reported values. Fetch time is sampling evidence, not proof of the market timestamp or real-time pricing. Missing fields stay missing; retained reads never refresh.
- Persistent state: a new versioned Spotlight SQLite store retains normalized observations and attempt/settlement witnesses. A separate Windows-current-user DPAPI file retains standalone OAuth credentials; this narrow connector credential facility does not implement or claim the general Vault.
- Non-owners: model text, Codex authentication, fixtures, account nicknames and a remembered tool cannot install a wire or authorize a trade.

The old shell permanently returned `withheld`, including when arbitrary ready flags were supplied. That mechanism cannot serve the adopted request. Keep the default shell service capped and introduce a concrete typed live read service; arbitrary flags still cannot enable it. Preserve the installed room schemas, manifest and historical installation witness byte-exact. Their optional socket standing is the installation baseline, not a claim about a later process-local connection. A separate live capability projection identifies the concrete source, custody, disclosure and activation standing.

## Connection and disclosure

The host uses Robinhood's documented `https://agent.robinhood.com/mcp/trading` endpoint through the MCP SDK. The standalone client performs its own OAuth with PKCE, random state, and a bounded loopback callback. It never imports Codex tokens. Authentication is an explicit operator command, never a Resident tool or startup browser popup. Tokens are encrypted with Windows DPAPI, atomically saved in the protected ignored runtime directory, and never printed. Unsupported platforms refuse persistent authentication rather than saving plaintext. Network responses, redirects, timeouts and errors are bounded; failures disclose stable codes rather than upstream secrets or bodies.

External protocol references: [Robinhood Agentic Trading overview](https://robinhood.com/us/en/support/articles/agentic-trading-overview/) documents the endpoint and third-party MCP support; the [official TypeScript SDK OAuth example](https://github.com/modelcontextprotocol/typescript-sdk/blob/v1.x/src/examples/client/simpleOAuthClient.ts) defines the SDK client/provider flow. These describe external contracts, not successful authentication of this configured Hub.

Enabling this connection explicitly permits the six normalized reads to be retained locally and shown to the configured Resident provider through ordinary tool custody. This includes holdings and balances under opaque account aliases. It does not authorize trading or broader raw financial disclosure. Local observation, Result Rack, Source and Spine custody are not application-encrypted by this revision; the connector token file is a separate encrypted store. No raw MCP instructions, account numbers, UUIDs, order identifiers, OAuth material, or provider tool catalog enter Resident context.

## Deliberate instrument grammar

The existing `spotlight_observe` schema remains exact. Its `instrument_id` selects:

- `accounts`
- `portfolio:<opaque-alias>`
- `equity-positions:<opaque-alias>` or `crypto-positions:<opaque-alias>`
- `equity:<SYMBOL>` or `crypto:<SYMBOL>`; a bare uppercase symbol means an equity quote.

Optional `observation_ref` may identify a retained observation of the same instrument as prior evidence; it never selects an endpoint or authority. Unknown grammar, unknown aliases, malformed arguments, mismatched returns and unbounded responses refuse. Capability status explains the grammar without contacting Robinhood. Account reads discover stable opaque aliases; subsequent account-specific reads require an explicit alias. No implicit primary/trading account selection is installed.

The six fixed upstream names are `get_accounts`, `get_portfolio`, `get_equity_positions`, `get_crypto_positions`, `get_equity_quotes`, and `get_crypto_quotes`. Portfolio/equity positions use the selected account number; crypto positions use its separately discovered RHS number. Crypto quotes use USD pairs (`BTC` becomes `BTC-USD`). A nonempty positions pagination pointer causes refusal in this version; it is never fetched as an arbitrary URL or silently dropped. Equity trade prices keep their corresponding venue timestamp, selecting the newer available regular/extended-hours trade. Crypto mark prices use their reported update time. Missing source time means unknown freshness.

Only capability status, observation list, observation read and observe become usable. Packet building, replay, proposals, ring changes and execution keep their existing caps. Entering the room, inspecting fixtures, listing history and startup perform no live request. Observations are fetched on demand, not streamed or polled automatically.

The prior injectable adapter assumed nonnegative position quantities and portfolio money. Robinhood's actual equity contract permits signed short quantities and account deficits. Preserve finite signed equity quantities/market values and portfolio money instead of rejecting or taking their absolute value. Crypto quantities and quote prices remain nonnegative. This bounded normalization revision preserves reported source meaning; it grants no short-selling or other execution capability.

## Custody and failure

The observation store creates only a fresh generation-1 schema, verifies retained hashes/links, refuses unknown generations and drift, and never repairs old content. Each deliberate read first appends a bounded attempt keyed by session/wake/tool-call identity, then appends one success or failure settlement. Success commits the exact validated normalized observation with its receipt before returning it. Duplicate settled calls replay the same settlement without networking; unresolved attempts after interruption refuse automatic retry and require a new deliberate call. No partial response is admitted as complete. A successful observation whose later World receipt fails remains attributable retained evidence, not proof of a completed World action.

List and read validate retained evidence and label it retained, with observed/received times. Status distinguishes installed functionality from authentication and source availability. Disconnection and auth expiry do not silently substitute fixtures or old observations for a live request. Shutdown aborts/closes the connector and awaits bounded observation work before store closure. A missing/invalid optional connector must leave the rest of the Hub usable with truthful Spotlight unavailability.

## Verification and migration

Verify successful on-demand reads, account alias isolation, unknown operations, hostile/malformed/oversized responses, source timestamps and missing fields, credential/error redaction, OAuth state/PKCE and storage, no startup network, no trading passthrough, location mounting, durable duplicate/interruption/restart handling, drift, and shutdown. Use simulated transport for automated tests and separately report actual OAuth and live read evidence. A successful Codex call is never standalone proof.

No World or existing store migration is required: optional socket activation does not change topology, tool-schema hashes or installed room ancestry. The new observation and encrypted credential stores receive explicit register entries and verification commands. Deactivation closes the connection and retains prior evidence; disconnect removes only this client's encrypted credential file on explicit operator command.

Implementation verification on 2026-09-11 covered the six exact upstream request shapes, source projection, hostile inputs, network ceilings, SDK authorization classification, native Windows DPAPI round-trip, and deliberate Resident reads through Result Rack/provider attention with verified Glass. The full suite run reported 515 passed, one skipped, and one existing Workshop recipe timeout; that file subsequently passed all nine checks in isolation. The two additional transport regression checks also passed. Real OAuth reached the Robinhood authorization page; successful user authorization and an actual standalone observation remain separate operational checks.

DPAPI credentials belong to the Windows user that runs the connection command. Run the Hub and connection commands under that same user; another user or a restricted execution identity cannot decrypt them. After connecting or disconnecting, restart the Hub so its in-memory credential/session state is replaced.
