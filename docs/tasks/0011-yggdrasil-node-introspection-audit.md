# Task 0011: Yggdrasil Node Introspection Audit

## Goal

Add structured diagnostics-only local Yggdrasil node introspection using `yggdrasilctl` output.

## What Is Collected

Local node identity:

- build name
- build version
- IPv6 address
- IPv6 subnet
- routing table size
- public key

Peer information:

- peer count
- peer summaries
- empty peer table support

Session information:

- session count
- session summaries
- empty session table support

TUN information:

- interface name
- interface MTU
- local TUN summary

Command availability:

- supported `yggdrasilctl` commands from `yggdrasilctl list`

## What Is Not Collected

- remote peer diagnostics
- routing control
- peer modification
- bundle delivery
- remote command execution
- network probe data

## Observations From Real Host Testing

Windows host:

- service name:
  - `Yggdrasil`
- binary path:
  - `C:\Program Files\Yggdrasil\yggdrasil.exe`
- command path:
  - `C:\Program Files\Yggdrasil\yggdrasilctl.exe`
- config path:
  - `C:\ProgramData\Yggdrasil\yggdrasil.conf`
- log path:
  - `C:\ProgramData\Yggdrasil\yggdrasil.log`

Observed available commands:

- `getself`
- `getpeers`
- `getsessions`
- `gettun`
- `list`

Observed behavior:

- `getself` returns structured local identity information
- `getpeers` may return an empty table and must still parse cleanly
- `getsessions` may return an empty table and must still parse cleanly
- `gettun` returns local interface state
- `list` provides supported command inventory

## Current Boundary

This step remains:

- diagnostics-only
- local-only
- read-only

It does not:

- send bundles
- call `/transport/accept-bundle`
- manage peers
- modify routes
- edit configuration
- restart services

## Future Use

The node introspection module should become the single source of truth for local Yggdrasil node diagnostics and later support:

- health diagnostics
- deployment validation
- future transport registration
- future peer discovery planning

without directly activating transport delivery.
