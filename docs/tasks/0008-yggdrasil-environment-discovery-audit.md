# Task 0008: Yggdrasil Environment Discovery Audit

## Goal

Add diagnostics-only Yggdrasil host environment discovery without enabling active runtime delivery.

## What This Step Checks

- local host platform:
  - `process.platform`
  - `process.arch`
  - `process.version`
- whether command lookup was attempted locally
- whether `yggdrasil` appears available on the current PATH
- whether `yggdrasilctl` appears available on the current PATH
- whether diagnostics remained:
  - readiness-only
  - connectivity-free
  - service-control-free

## What This Step Intentionally Does Not Check

- whether a Yggdrasil service is running
- whether a local node has joined an overlay
- whether any peer is reachable
- whether a configured remote URL is actually contactable
- whether the local machine has a valid Yggdrasil IPv6 address
- whether transport delivery can succeed

This step is strictly local environment discovery.

## Safety Boundary

Diagnostics are read-only only.

This step does not:

- start services
- stop services
- restart services
- write config files
- modify host networking
- call network endpoints
- call transport delivery paths

## Windows Expectations

- `where.exe` is used for local command lookup
- Yggdrasil may or may not be installed yet
- missing command availability is reported, not treated as fatal
- later real testing will still require explicit service and deployment instructions outside the runtime

## Linux / Unix Expectations

- `which` is used for local command lookup
- local diagnostics are portable
- missing command availability is reported cleanly
- later real testing will still require explicit daemon and service expectations

## Raspberry Pi Expectations

- local diagnostics remain safe and lightweight
- command availability is useful for pre-deployment checks
- future real work will still need:
  - daemon startup expectations
  - persistent state roots
  - operator notes for field-node operation

## VPS Expectations

- local diagnostics can confirm whether binaries are likely present
- service state and connectivity are intentionally out of scope
- later real deployment work will need:
  - service ownership expectations
  - persistent runtime state roots
  - interface exposure and transport policy documentation

## What Will Be Needed Before Real Yggdrasil Delivery

- authoritative host/node validation
- explicit service and daemon expectations
- real interface/address discovery
- real `/health` reachability over Yggdrasil IPv6
- real `/transport/accept-bundle` delivery validation
- restart/recovery validation under overlay interruptions
- Linux / Raspberry Pi / VPS deployment notes

## Current Boundary

`yggdrasil-direct` remains:

- experimental
- diagnostics/spike-only
- excluded from active runtime delivery

Environment discovery improves observability, not activation.
