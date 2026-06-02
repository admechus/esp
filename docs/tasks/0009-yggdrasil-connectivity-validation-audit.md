# Task 0009: Yggdrasil Connectivity Validation Audit

## Goal

Add diagnostics-only Yggdrasil connectivity validation without enabling active message delivery.

## Diagnostic Layers

This project now has three distinct Yggdrasil-oriented diagnostic layers:

1. readiness
   - validates remote URL and address shape
   - offline-only
   - no command execution required

2. environment
   - inspects host platform and command availability
   - local-only
   - no service control

3. connectivity
   - combines remote URL readiness with optional local self/address inspection
   - still diagnostics-only
   - no message delivery

## What This Step Checks

- whether a `remoteUrl` looks compatible with current Yggdrasil readiness rules
- whether `yggdrasilctl` appears available locally
- whether local self-inspection could be attempted safely
- whether local Yggdrasil-like IPv6 address candidates can be parsed from command output
- whether all checks remained diagnostics-only

## What This Step Does Not Check

- remote HTTP reachability
- `/health` over Yggdrasil
- `/transport/accept-bundle` over Yggdrasil
- peer connectivity
- mesh membership
- real delivery behavior
- service startup correctness

## Safety Boundary

This step must remain read-only.

It does not:

- start services
- stop services
- restart services
- write config files
- mutate runtime state
- send messages
- call active runtime delivery

## Platform Considerations

### Windows

- command lookup uses `where.exe`
- optional `yggdrasilctl` self-inspection remains local-only
- missing binaries are reported cleanly, not treated as fatal

### Linux / Unix

- command lookup uses `which`
- optional `yggdrasilctl` self-inspection remains local-only
- future service management expectations should stay outside runtime diagnostics

### Raspberry Pi

- connectivity diagnostics are suitable for preflight checks
- future deployment work still needs:
  - service startup notes
  - persistent state roots
  - field-node operational guidance

### VPS

- connectivity diagnostics are suitable for early host readiness checks
- real transport activation still requires:
  - daemon expectations
  - service ownership
  - host networking and exposure notes

## Future Work Before Real Delivery

- controlled `/health` probe over Yggdrasil
- authoritative local interface/address inspection
- real peer-to-peer reachability checks
- end-to-end delivery validation
- deployment notes for Linux, Raspberry Pi, VPS, and field nodes

## Current Boundary

`yggdrasil-direct` remains:

- experimental
- diagnostics/spike-only
- excluded from active runtime delivery

Connectivity validation improves observability, not activation.

The next tightly-bounded step may allow a controlled `GET /health` probe against a user-provided bracketed IPv6 URL, but it should still avoid `/transport/accept-bundle` and all message delivery behavior.
