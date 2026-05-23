# Agent

This is the first PC-side scaffold for the ESP messenger.

## What It Does

- lists ESP-related COM ports on Windows
- models platform profiles and node roles
- defines the first USB JSON command set
- supports a `mock` dongle mode
- includes a Windows serial JSON transport for live firmware testing
- can generate a device identity, fetch a public key, derive a stable `keyId`, and verify a live signature
- stores known peers in a local peer store
- can build the first signed text envelope using the dongle
- stores saved outgoing envelopes in a local outbox log
- can accept verified envelopes into a local inbox history
- exposes a local HTTP API for UI or automation layers
- serves a local browser UI from the same agent process
- can export pending outbox messages into transport bundles and import them back
- can run multiple local agents with separate state directories
- can deliver transport bundles directly to another local agent over HTTP
- can route transport bundles through a dedicated local relay or gateway process
- can persist delivery receipts on both sender and receiver sides
- can track conversation-focused UI state per peer
- can generate and accept `read_remote` receipts in addition to delivery acceptance receipts
- can queue undeliverable relay bundles and recover them later with a manual `pull`
- can expose a first `unified client shell` that aggregates sender, receiver, and relay into one UI
- can focus the unified shell on a selected cross-role conversation and manage relay queue entries from that same surface
- can cache `GET_PLATFORM_IO` firmware responses and surface declared or probed outputs in the unified shell role map
- can trigger live `TEST_OUTPUT` checks from the unified shell role map for supported displays and LEDs
- can persist a shell-local hardware activity log for output tests and discovery refreshes
- can compare saved role bindings against the live discovery snapshot and current role transports, surfacing match or mismatch states inside the unified shell
- can reconcile saved role bindings with the live lab state, including adopting current sender or receiver transports and clearing stale or conflicting bindings

## Commands

Run from [agent/package.json](C:/Users/Keal/Documents/Codex/2026-05-14/esp/agent/package.json):

```bash
npm run list-ports
npm run list-profiles
npm run ping:mock
npm run info:mock
npm run serve:mock
```

Direct CLI examples:

```bash
node src/cli.js serve --port COM9 --listen 8787 --agent-name sender --remote-url http://127.0.0.1:8788
node src/cli.js serve --listen 8788 --state-dir .\agent\state-receiver --agent-name receiver
node src/cli.js serve-relay --listen 8790 --state-dir .\agent\state-relay --relay-name gateway-alpha --route receiver=http://127.0.0.1:8788
node src/cli.js pull-relay --remote-url http://127.0.0.1:8790 --state-dir .\agent\state-receiver --agent-name receiver
node src/cli.js serve-unified --listen 8795 --sender-url http://127.0.0.1:8787 --receiver-url http://127.0.0.1:8788 --relay-url http://127.0.0.1:8790
node src/cli.js serve-unified --listen 8795 --sender-port COM9 --receiver-port COM8
node src/cli.js gen-identity --port COM9
node src/cli.js get-public-id --port COM9
node src/cli.js identity-summary --port COM9
node src/cli.js remember-self --port COM9
node src/cli.js list-peers
node src/cli.js list-messages
node src/cli.js make-envelope --port COM9 "hello"
node src/cli.js save-envelope --port COM9 --file .\agent\state\outbox\hello.json "hello"
node src/cli.js verify-envelope .\agent\state\outbox\hello.json
node src/cli.js import-envelope .\agent\state\outbox\hello.json
node src/cli.js receive-envelope .\agent\state\outbox\hello.json
node src/cli.js sign-text --port COM9 "hello"
node src/cli.js verify-text --port COM9 "hello"
node src/cli.js send --mock SIGN_BYTES "{\"payloadBase64\":\"aGVsbG8=\"}"
node src/cli.js send --port COM9 PING
```

The `--port` mode expects the firmware to speak line-delimited JSON over serial.

## Local API

Start the API:

```bash
node src/cli.js serve --port COM9 --listen 8787 --agent-name sender --remote-url http://127.0.0.1:8788
```

Then open:

```text
http://127.0.0.1:8787/
```

Useful endpoints:

- `GET /`
- `GET /app/state`
- `GET /health`
- `GET /ports`
- `GET /profiles`
- `GET /identity/summary`
- `POST /identity/remember-self`
- `GET /peers`
- `GET /messages`
- `GET /outbox`
- `GET /receipts`
- `POST /envelopes/text`
- `POST /envelopes/verify`
- `POST /envelopes/import`
- `POST /envelopes/receive`
- `POST /outbox/receive`
- `POST /transport/export`
- `POST /transport/import`
- `POST /transport/accept-bundle`
- `POST /transport/deliver`
- `POST /transport/pull`
- `POST /device/test-output`

Relay endpoints:

- `GET /health`
- `GET /app/state`
- `GET /relay/routes`
- `GET /relay/transfers`
- `GET /relay/queue`
- `POST /relay/deliver`
- `POST /relay/pull`

The API is meant to stay local on `127.0.0.1` and act as the backend seam for a later UI.

Useful local two-agent setup:

```bash
node src/cli.js serve --port COM9 --listen 8787 --agent-name sender --remote-url http://127.0.0.1:8788
node src/cli.js serve --listen 8788 --state-dir .\agent\state-receiver --agent-name receiver
```

Relay-backed three-process setup:

```bash
node src/cli.js serve --port COM9 --listen 8787 --state-dir .\agent\state --agent-name sender --remote-url http://127.0.0.1:8790 --target-agent receiver
node src/cli.js serve --port COM8 --listen 8788 --state-dir .\agent\state-receiver --agent-name receiver --remote-url http://127.0.0.1:8790 --target-agent sender
node src/cli.js serve-relay --listen 8790 --state-dir .\agent\state-relay --relay-name gateway-alpha --route receiver=http://127.0.0.1:8788 --route sender=http://127.0.0.1:8787
```

Unified client shell over an already running lab stack:

```bash
node src/cli.js serve-unified --listen 8795 --sender-url http://127.0.0.1:8787 --receiver-url http://127.0.0.1:8788 --relay-url http://127.0.0.1:8790
```

Embedded unified shell that launches sender, receiver, and relay itself:

```bash
node src/cli.js serve-unified --listen 8795 --sender-port COM9 --receiver-port COM8 --sender-listen 8787 --receiver-listen 8788 --relay-listen 8790
```

The unified shell then serves:

```text
http://127.0.0.1:8795/
```

The built-in UI currently provides:

- visible sender/receiver agent identity with `stateDir` and transport metadata
- identity overview
- peer list
- outbox list with local delivery status
- inbox message history
- compose form for new signed envelopes
- one-click local round-trip from outbox into inbox
- bundle export/import controls for relay-style transport handoff
- direct bundle delivery to another local agent URL
- relay-aware delivery with explicit `target agent`
- relay queue recovery with a manual `pull` button for deferred deliveries
- receipts list for accepted remote deliveries
- read actions on inbound messages that can forward a receipt back through relay
- file-based receive flow for accepting saved envelopes
- live two-sided hardware flow where `sender` uses `COM9` and `receiver` uses `COM8`
- a first unified shell view
- unified shell shows sender, receiver, and relay health summaries
- unified shell links to role-specific consoles
- unified shell supports quick-send actions from sender to receiver and back
- unified shell aggregates recent outbox, inbox, and receipt activity
- unified shell can focus the merged timeline on one active dialog
- unified shell can delete relay queue entries after inspection or recovery
- unified shell now exposes one shared conversation workspace with a single composer and role toggle
- unified shell now separates `Chats`, `Identities`, `Relay`, `Activity`, and `Diagnostics` into sidebar navigation sections
- unified shell `Chats` view now behaves like a two-column messenger workspace with dialog list on the left and active conversation on the right
- unified shell dialog rows now show last-message preview plus the latest route state directly in the conversation list
- unified shell `Diagnostics` now exposes a role map and route-level pull controls, starting the move toward explicit role/lifecycle management
- unified shell now keeps discovery snapshots and shows local discovery candidates, which is the first foundation for later dynamic network device detection
- unified shell `Diagnostics` now keeps recent discovery history, shows role-binding hints for unassigned candidates, and supports optional auto-refresh for repeated local discovery polling
- unified shell can now persist shell-local candidate bindings, so a discovered COM port or remote peer can be assigned to a planned role directly from `Diagnostics`
- unified shell can now apply those saved bindings into a persistent lifecycle plan, giving the client an explicit current role configuration even while attached mode still leaves live processes under external control
- unified shell `Role Map` now includes live device metadata and GPIO platform summaries for sender and receiver, while clearly marking that external GPIO attachment probing is not yet implemented in firmware
- unified shell `Role Map` can now launch live output tests against supported board outputs such as the T-Dongle display/RGB LED and the receiver OLED
- unified shell `Activity` now includes a persistent hardware activity log, so board output tests and discovery refreshes remain visible after reload or restart
- unified shell now records lifecycle actions such as binding, unbinding, and applied-plan changes in the same shell activity stream
- unified shell `Diagnostics` now surfaces binding resolution state, so planned roles can be checked against live ports and current sender or receiver transports
- unified shell `Diagnostics` now includes reconciliation controls, so live sender or receiver transports can be adopted into planned bindings and conflicting saved bindings can be cleared with explicit result details
- unified shell `Lifecycle Plan` entries now include per-binding repair actions, so one mismatched planned role can be rebound to the current live transport or removed directly from the plan view
- unified shell `Diagnostics` now also exposes a one-click `Reconcile To Live` flow, so live sender and receiver transports can be adopted and immediately re-applied into a fresh lifecycle plan in attached mode
- unified shell binding diagnostics now include explicit next-action guidance, so stale, missing, mismatched, or policy-only bindings explain what the operator should do next

Current identity responses expose:

- `algorithm`: `ES256`
- `curve`: `P-256`
- `publicKeyBase64`: raw uncompressed public key
- `fingerprintHex`: `sha256(publicKey)`
- `keyId`: short stable identifier derived from the fingerprint

Current envelope flow:

- canonicalize unsigned envelope JSON on the host
- hash it with `SHA-256`
- ask the dongle to `SIGN_HASH`
- attach `signatureBase64` and verify locally before returning the envelope
- if `--to <keyId>` is used, require that recipient to exist in the local peer store
- allow the saved envelope to be verified and imported later as an incoming artifact
- store accepted incoming envelopes in `agent/state/inbox.json`
- allow a sender outbox to move into `delivered_remote` after receiver acceptance
- import sender identity into the receiver peer store on first remote delivery
- store accepted remote delivery receipts in `receipts.json`
- return relay and delivery receipt ids for relay-backed transport
- if relay cannot reach the target agent, leave the message in `queued_relay` until a later pull drains the relay queue
