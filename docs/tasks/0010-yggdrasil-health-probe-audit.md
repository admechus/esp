# Task 0010: Yggdrasil Health Probe Audit

## Goal

Add the first controlled diagnostics-only network probe for future Yggdrasil transport work.

## Scope of This Step

Only one network action is allowed:

- `GET <remoteUrl>/health`

This step does not allow:

- `/transport/accept-bundle`
- bundle delivery
- routing
- peer discovery
- fallback
- service mutation

## What This Step Checks

- whether a user-provided bracketed IPv6 HTTP/HTTPS `remoteUrl` is probe-eligible
- what `/health` endpoint will be used
- whether a controlled `GET /health` succeeds
- whether failures are returned in a structured diagnostics shape
- whether all behavior stays delivery-free

## What This Step Does Not Check

- bundle delivery
- end-to-end message transport
- `/transport/accept-bundle`
- peer exchange
- routing policy
- mesh membership
- session encryption

## Safety Boundary

This step remains diagnostics-only.

It does not:

- start services
- stop services
- restart services
- edit configuration files
- deliver messages
- mutate runtime state

## Expected Receiver Setup

For future controlled live testing, the receiver should expose an HTTP health endpoint over an IPv6-reachable host.

Example:

```powershell
node src/cli.js serve --host :: --listen 8788 --state-dir <explicit-state> --agent-name receiver
```

The diagnostics step itself does not require that a live receiver already exists.

## Platform Considerations

### Windows

- explicit state roots remain recommended
- Yggdrasil installation and service ownership remain outside runtime diagnostics
- a reachable IPv6 host binding must be supplied by the operator

### Linux / Unix

- controlled `/health` probing fits service-style deployment well
- explicit daemon and interface assumptions still need documentation outside runtime

### Raspberry Pi

- useful for gateway/node preflight checks once a service is listening
- future field-node notes should describe bind addresses, state roots, and boot behavior

### VPS

- useful for early overlay reachability validation
- service ownership, persistence, and exposure still require deployment notes

## How to Use Local Yggdrasil Address Data

If `yggdrasilctl getSelf` is available and readable, it can help the operator identify likely local addresses.

That data may be used to:

- understand local address candidates
- choose which bound receiver address to test
- prepare future controlled live probes

This task still does not activate transport delivery.

## Future Work

- controlled `/health` probe against real Yggdrasil-connected peers
- authoritative interface/address discovery
- `/transport/accept-bundle` validation only after health probing is mature
- deployment notes for Linux, Raspberry Pi, VPS, and field nodes

## Current Boundary

`yggdrasil-direct` remains:

- experimental
- diagnostics/spike-only
- not active runtime delivery

Controlled `/health` probing improves observability without activating transport delivery.

The next diagnostics layer may collect structured local node information from `yggdrasilctl`, but it should remain local, read-only, and delivery-free.
