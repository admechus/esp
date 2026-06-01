# Task 0007: Yggdrasil Readiness Audit

## Goal

Prepare the project for future real Yggdrasil transport integration without enabling active runtime delivery yet.

## What `yggdrasil-direct` Does Today

- exists at `agent/src/transport/yggdrasilDirectTransport.js`
- is marked `experimental: true`
- remains diagnostics/spike-only
- is not part of the active runtime transport registry
- exposes:
  - `health({ remoteUrl })`
  - `sendBundle({ target, bundle, options })`
- uses the same HTTP-style direct-send scaffold path as other direct transports:
  - `GET /health`
  - `POST /transport/accept-bundle`
- returns normalized `TransportSendResult`
- can appear in diagnostics/test registries and smoke tests without Yggdrasil installed

## What Is Ready Now

- descriptive transport metadata passport
- descriptive transport configuration requirement for `remoteUrl`
- offline readiness helpers for:
  - likely Yggdrasil IPv6 addresses
  - likely bracketed IPv6 HTTP remote URLs
  - diagnostics-only remote URL description
- offline host environment discovery for likely local command availability
- offline smoke validation for likely-good and likely-bad URL forms
- explicit confirmation that the active runtime registry still excludes `yggdrasil-direct`

## Expected Address and URL Shapes

Readiness validation is intentionally lightweight and non-authoritative.

Expected peer address shape:

- IPv6 textual address
- likely in a Yggdrasil-like range
- example:
  - `200:1111:2222:3333:4444:5555:6666:7777`

Expected remote URL shape:

- HTTP URL with a bracketed IPv6 host
- example:
  - `http://[200:1111:2222:3333:4444:5555:6666:7777]:8788`

Readiness examples:

- likely valid for future direct Yggdrasil transport:
  - `http://[200:db8::1]:8788`
- not valid as an HTTP IPv6 URL because brackets are missing:
  - `http://200:db8::1:8788`
- valid HTTP URL but not Yggdrasil-like:
  - `http://127.0.0.1:8788`

## Host Environment Assumptions

This audit assumes:

- no Yggdrasil installation is required
- no interface inspection is performed
- no OS commands are called
- no network connectivity tests are performed
- diagnostics operate entirely on local syntax and metadata

## Platform Considerations

### Windows

- offline readiness helpers are fully portable
- future real integration must define how a local Yggdrasil node is installed and managed outside the runtime
- explicit state roots are still recommended for repeatable lab runs

### Linux / Unix

- offline readiness helpers are fully portable
- future direct transport work will likely be easier to field-test here than on Windows
- a future Linux serial track remains separate from Yggdrasil transport work

### Raspberry Pi

- the current readiness layer already fits Pi-style host constraints because it is offline-only
- future deployment work should define:
  - service startup expectations
  - explicit runtime state roots
  - local Yggdrasil service assumptions

### VPS

- the current readiness layer is suitable for documentation, validation, and configuration review
- future VPS work should define:
  - service ownership
  - public/private exposure expectations
  - persistent state roots
  - Yggdrasil daemon/operator assumptions

## What Is Still Missing for Real Integration

- real active runtime delivery wiring
- authoritative Yggdrasil host/interface validation
- authoritative service/process state inspection
- operational assumptions for local Yggdrasil daemon management
- explicit port and service expectations
- real health behavior against actual Yggdrasil-connected peers
- real end-to-end delivery validation
- restart/recovery behavior under real Yggdrasil network interruptions
- deployment notes for Linux, Raspberry Pi, VPS, and field-node hosts

## Required Future Validation Steps

Before enabling active runtime delivery, validate:

1. local host has an operational Yggdrasil node
2. direct peer URLs are reachable over the Yggdrasil interface
3. `/health` works over Yggdrasil IPv6
4. `/transport/accept-bundle` works over Yggdrasil IPv6
5. runtime profiles can describe Yggdrasil endpoints without activating them automatically
6. restart behavior is still correct under intermittent overlay reachability
7. field-node documentation is explicit about host setup, state paths, and service expectations

## Current Boundary

This step intentionally does not provide:

- active runtime delivery
- interface discovery
- peer discovery
- routing
- fallback
- capability negotiation
- mesh behavior
- session encryption
- Yggdrasil installation checks
- `yggdrasilctl` integration

Observability first, activation later.
