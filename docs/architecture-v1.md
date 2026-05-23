# Architecture V1

## System Boundary

The messenger is split into:

- `dongle firmware`
- `other ESP node firmware`
- `PC agent`
- `UI layer`
- `remote transport`

## Component Responsibilities

### Dongle firmware

Owns:

- device boot and unlock state
- root seed or root private key material
- signing operations
- session key agreement helper operations
- protected local configuration

Does not own:

- message database
- chat history synchronization logic
- internet routing logic
- rich UI

### Other ESP node firmware

Owns, depending on role:

- local transport bridging
- delegated peer identity
- local packet queueing
- sensor or event production
- relay or forwarding behavior

Should avoid owning:

- the user's root identity secret unless the board is explicitly running an identity profile

### PC agent

Owns:

- USB session with the dongle
- peer directory and public keys
- message queue and local message store
- network transport to remote gateways or relays
- local HTTP or IPC API for the UI

Does not own:

- the root identity secret

### UI

Owns:

- chat presentation
- compose/send actions
- contact management workflow

Should treat the PC agent as its only backend.

## Trust Model

The dongle is the primary trust anchor for `v1`.

The PC is powerful but not fully trusted. It can be compromised, so the design should ensure:

- the PC can request operations
- the PC cannot extract the root secret through normal APIs
- sensitive operations can later require explicit user presence or approval

Other ESP nodes should be treated as role-dependent trust participants:

- `identity profile`: can hold long-lived high-value secrets
- `gateway profile`: may hold delegated credentials and transport state
- `light or relay profile`: should prefer replaceable, scoped, or ephemeral credentials

## Networking Model

Start with:

```text
User A Agent <-> encrypted transport <-> User B Agent
```

Then evolve to:

```text
local ESP nodes
    |
gateway agent
    |
encrypted overlay
    |
remote gateway agent
    |
remote ESP nodes
```

This keeps the internet-facing complexity in the agent layer instead of forcing small ESP nodes to solve NAT traversal and global routing early.

## Swarm Logic Direction

The long-term architecture should support a `logical swarm`, not just a set of point-to-point links.

That swarm should be organized around roles:

- `identity cluster`: user-owned trust anchors and recovery-capable devices
- `gateway cluster`: ingress and egress points between local ESP domains and remote overlay links
- `worker cluster`: constrained devices that originate, consume, or temporarily hold encrypted envelopes
- `relay cluster`: optional intermediate nodes for reachability, buffering, and delayed transport

The important design rule is:

`messages move through the swarm as encrypted envelopes, while authority stays concentrated in identity nodes.`

## Why Not Start With Full Mesh

Doing all of this at once would couple too many difficult problems:

- embedded crypto lifecycle
- routing
- discovery
- relay fallback
- offline delivery
- NAT traversal
- key recovery

V1 should validate identity handling and host integration first, while keeping role boundaries clean enough for later swarm expansion.
