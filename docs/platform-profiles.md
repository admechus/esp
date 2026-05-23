# Platform Profiles

## Purpose

Different ESP boards should not be forced into the same trust and storage model.

This project should use `platform profiles` and `node roles` so the same protocol family can be built for:

- USB identity tokens
- gateway boards
- lightweight field nodes
- swarm relay nodes

## Profile Dimensions

Every supported board should be described by:

- `connectivity`: USB, UART, Wi-Fi, BLE, mesh-capable links
- `persistent storage`: none, flash only, encrypted NVS, SD card
- `trust level`: root identity holder, delegated node, ephemeral peer
- `interaction mode`: standalone, host-attached, gateway-attached

## Initial Profiles

### Profile A: Identity Token

Example:

- `LilyGO T-Dongle-S3`

Typical characteristics:

- USB-connected to a host
- persistent flash storage
- may have removable SD storage
- suitable for root identity or high-trust delegated identity

Primary responsibilities:

- generate identity
- store long-lived secrets
- sign and approve sensitive operations
- optionally export encrypted backups

### Profile B: Host-Attached Node

Examples:

- generic `ESP32-WROOM`
- generic `ESP32U`

Typical characteristics:

- may expose USB-UART rather than native USB
- usually has flash but may lack removable storage
- suitable for local transport, delegated node identity, or gateway experiments

Primary responsibilities:

- bridge local serial or radio traffic
- act as a lightweight peer
- hold delegated or replaceable node keys

### Profile C: Storage-Limited Node

Typical characteristics:

- no SD
- small flash budget
- limited room for logs, queues, or backup bundles

Primary responsibilities:

- ephemeral participation
- packet forwarding
- short-lived session activity

Storage policy:

- avoid storing root identity
- prefer short-lived delegated credentials
- keep queued payloads small and encrypted

### Profile D: Storage-Extended Node

Typical characteristics:

- SD card or larger persistent storage
- enough capacity for offline queueing or encrypted bundles

Primary responsibilities:

- cache encrypted payloads
- support delayed delivery
- keep encrypted backups or exported state blobs

Storage policy:

- keep only encrypted application payloads on removable media
- avoid storing plaintext root secret material on SD

## Capability Matrix

The firmware should eventually be selected by a mix of:

- `chip family`
- `board profile`
- `node role`

That is more useful than compiling one monolithic firmware for all boards.

## Node Roles

Roles are logical and may map to different profiles:

- `identity`
- `gateway`
- `peer`
- `relay`
- `worker`
- `observer`

One board may support more than one role in development, but production assumptions should stay narrow and explicit.
