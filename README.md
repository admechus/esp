# ESP Messenger Prototype

This repository is the starting point for an experimental messenger built around ESP-based hardware identities, gateway nodes, and future swarm-capable peer structures.

## Goal

Build a system where:

- a `LilyGO T-Dongle-S3` acts as the holder of user identity and signing authority
- other ESP boards can act as simplified peers, sensors, relays, or local nodes depending on their capabilities
- a PC-side agent handles networking, storage, and UI integration
- remote peers communicate through an encrypted overlay between gateway nodes
- local ESP nodes can later attach as a lower-layer mesh or local transport
- the long-term network can evolve into a swarm-style topology with distinct logical roles

## V1 Scope

The first version is intentionally narrow:

- one hardware key: `T-Dongle-S3`
- one local PC agent
- USB communication between the agent and the dongle
- identity generation and protected storage on the dongle
- signing and session-setup operations performed by the dongle
- a simple local UI on the PC
- platform-aware code structure so other ESP boards can be added without redesigning the protocol

Not in `v1`:

- global decentralized node discovery
- a custom worldwide routing layer
- a full ESP-to-ESP internet overlay
- production-grade anonymity guarantees

## Core Design

Split the system into three trust zones:

1. `Dongle`
   Holds the root identity secret and performs sensitive crypto operations.
2. `PC agent`
   Talks to the dongle over USB, stores messages, manages peers, and handles transport.
3. `UI`
   Talks only to the PC agent. It must never own root secret material.

High-level flow:

```text
UI <-> PC Agent <-> USB protocol <-> T-Dongle-S3
                      |
                      v
            encrypted remote transport
```

## Supported Platform Direction

The design should support multiple hardware profiles instead of assuming one universal firmware:

- `identity token`: USB-capable board with stronger local trust and persistent storage
- `gateway node`: board or host-connected ESP that bridges local radio/serial traffic into the encrypted overlay
- `light node`: constrained ESP peer with minimal local state
- `relay or swarm node`: non-identity node that forwards or buffers encrypted packets according to policy

Storage-aware behavior matters:

- devices with protected persistent storage can hold long-lived identity or delegated node keys
- devices with plain flash only should hold only low-value or replaceable secrets where possible
- devices with removable storage can keep encrypted backups, bundles, or queued payloads
- devices with no practical persistent storage should use ephemeral session identities or host-provided configuration

## Current Hardware Roles

- `COM9` / `LilyGO T-Dongle-S3`: primary identity token and first firmware target
- `COM8` / classic `ESP32` over `CP210x`: second hardware-backed identity endpoint for receiver-side tests
- `COM7` if present later: secondary ESP target for reduced-role node and gateway experiments

## Security Direction

The design should prefer:

- root secret stored in the dongle, not on the PC
- `Secure Boot` and `Flash Encryption` on the `ESP32-S3` once development flow is stable
- modular crypto implementation in code, but one fixed protocol suite per firmware build
- encrypted backup/export instead of plaintext key export
- role-specific secret handling depending on whether the board has trusted persistent storage

## Current Milestone Crypto Shape

Milestone 1 currently uses:

- identity key: `ES256` on `P-256`
- persistent identity storage in `NVS`
- public identity responses that include `publicKeyBase64`, `fingerprintHex`, and `keyId`
- on-device signing with host-side verification

The wider messenger protocol is still intentionally unfrozen. Session transport and agreement can evolve later without changing the basic `dongle as trust anchor` model.

## End Goal

The final intended shape is not just a dongle-backed messenger, but a logical swarm:

```text
User token <-> Agent <-> Gateway <-> Encrypted overlay <-> Gateway <-> Agent <-> User token
                         |                                      |
                         v                                      v
                   local node cluster                     local node cluster
```

In that swarm, nodes can have different responsibilities:

- `identity nodes`: own user identity and approve sensitive actions
- `gateway nodes`: bridge local radio or serial domains to remote encrypted transport
- `worker nodes`: send, receive, cache, or forward encrypted envelopes
- `relay nodes`: improve reachability and delayed delivery
- `observer or sensor nodes`: optional low-trust participants that inject events but do not hold root identity

The protocol and codebase should therefore be modular by `role`, not only by `chip`.

## First Milestone

The first implementation milestone is:

`Make the T-Dongle-S3 behave like a USB identity token for a local messenger agent.`

That means:

- initialize firmware
- generate a device identity
- persist it safely on the dongle
- expose a minimal command protocol over USB
- build a PC-side tool that can ask the dongle for public identity and signatures

That milestone is now extended with:

- stable `keyId` and `fingerprintHex` derivation
- local peer persistence in the agent
- a first signed text envelope format built on top of `SIGN_HASH`
- envelope verification and peer import from saved JSON artifacts
- local outbox persistence and status tracking
- local inbox persistence for accepted envelopes
- transport bundle export/import as a gateway-facing seam
- a local HTTP API layer for UI and host integration
- a local browser UI served by the agent itself
- multi-agent local mode with separate sender and receiver state roots
- direct sender-to-receiver bundle delivery over local HTTP
- a dedicated local relay or gateway process with route-based forwarding
- delivery receipts that flow back to sender and receiver stores
- a second hardware identity on a classic `ESP32`, enabling live two-sided `COM9 <-> relay <-> COM8` message flow
- conversation-oriented UI filtering by peer, with message and outbox views scoped to a selected contact
- `read receipt` plumbing that can flow back through relay to upgrade sender-side status beyond delivery acceptance
- relay-side queueing plus manual `pull` recovery, so temporarily offline agents can receive deferred bundles after reconnecting
- a first `unified client shell` that can attach to an existing lab stack or launch sender, receiver, and relay as one client surface
- conversation focus inside the unified shell, so cross-role history can be scoped to one active dialog
- relay queue inspection and entry deletion from the unified shell for diagnostics and cleanup
- discovery snapshot and cache foundation inside the unified shell, so local ports, live roles, relay routes, and future network candidates can be tracked in one place
- discovery history, role-binding hints, and optional auto-refresh controls in the unified shell, so diagnostics can evolve toward dynamic device and route discovery
- shell-local candidate role bindings, so discovered ports and peers can be assigned into planned roles before full dynamic lifecycle automation exists
- applied lifecycle plans inside the unified shell, so planned bindings can be promoted into a current shell configuration even before managed live restarts are implemented
- hardware-aware role map entries, so live device info plus GPIO platform summaries can be surfaced for sender and receiver roles even in attached mode
- a persistent hardware activity log in the unified shell, so output tests and discovery refresh events survive reloads and remain available for later diagnostics
- lifecycle-aware binding diagnostics in the unified shell, so planned roles can be compared against live transports and missing or mismatched candidates can be surfaced explicitly
- reconciliation actions in the unified shell, so current live sender or receiver transports can be adopted into saved bindings and stale or conflicting planned bindings can be cleared quickly
- per-binding reconciliation actions in the unified shell lifecycle plan, so a single mismatched planned role can be rebound to the live sender or receiver transport without resetting the whole plan
- a one-click `reconcile to live` workflow in the unified shell, so attached-mode diagnostics can adopt current live transports and immediately rebuild the lifecycle plan around the running lab state
- action guidance on binding resolution, so `Lifecycle Plan` and discovery diagnostics can explain the next operational step for each mismatch or stale-binding scenario

## Repository Layout

```text
docs/
  architecture-v1.md
  identity-and-storage.md
  milestone-01.md
  platform-profiles.md
firmware/
  dongle/
agent/
tools/
```

## Next Concrete Step

Build on the finished identity-token base before any mesh work:

- expand receipt states beyond delivery acceptance into richer session semantics
- extend the unified client beyond summary and quick-send into full role-aware conversation control
- begin separating `gateway` and `identity` roles more explicitly inside the unified shell lifecycle
- evolve relay queue recovery from manual `pull` into background sync and retry policy
- move from passive discovery snapshots toward active heartbeat, candidate binding, and later network-wide dynamic discovery
- continue evolving reconciliation from diagnostics into managed lifecycle control, so live transports, saved plans, and future embedded role restarts stay aligned

## Environment

Project-local ESP environment helpers live in [tools/README.md](C:/Users/Keal/Documents/Codex/2026-05-14/esp/tools/README.md).

For day-to-day lab work, the full local stack can now be managed through [tools/lab-stack.ps1](C:/Users/Keal/Documents/Codex/2026-05-14/esp/tools/lab-stack.ps1), including `sender`, `receiver`, `relay`, and the unified shell.


## Architecture docs

- [docs/index.md](./docs/index.md)
- [docs/adr/](./docs/adr)
- [docs/protocol/](./docs/protocol)
- [docs/tasks/](./docs/tasks)


## Platform support

Current runtime and transport maturity work is split between cross-platform host logic and
Windows-first hardware workflows.

Cross-platform today:

- runtime profiles and manual profile validation
- local HTTP agent and relay transports
- file-bundle transport
- transport metadata, diagnostics, manual targeting, and explicit health checks
- transport smoke validation

Windows-first today:

- `COM` port discovery
- Windows serial JSON transport
- ESP hardware serial workflows and examples that use `COMx`

Planned later:

- Linux and Unix serial discovery
- Linux serial JSON transport
- Raspberry Pi deployment notes
- old laptop field-node notes

## Yggdrasil Validation Status

Stage 5 has now validated a real two-host Windows Yggdrasil path for diagnostics-only HTTP health checks.

Validated today:

- independent Windows Yggdrasil nodes
- static IPv4 peering
- peer and session establishment
- route propagation and path visibility
- IPv6 reachability over Yggdrasil
- receiver agent HTTP /health access over Yggdrasil
- diagnostics-only remote yggdrasil-health probing

Important Windows deployment findings:

- yggdrasil.conf must be saved as UTF-8 without BOM
- IPv6 must remain enabled on the underlay adapter
- the validated listener shape is tls://0.0.0.0:12345
- Windows Firewall may create both Allow and Block rules for node.exe
- because the Yggdrasil interface commonly uses the Public profile, the Block rules can silently break inbound HTTP until removed or overridden

Bundle delivery remains intentionally out of scope until Stage 6.



## License

This project is licensed under the MIT License. See [LICENSE](./LICENSE).

Third-party dependency and attribution tracking lives in
[docs/legal/third-party-notices.md](./docs/legal/third-party-notices.md).

