# Task 0012: Yggdrasil Two-Host Validation Completion

## Goal

Record the successful real-world completion of Stage 5 and capture the Windows deployment knowledge gained during the first two-host Yggdrasil validation.

## Stage Status

Stage 5 is now considered complete.

Validated capabilities:

- runtime diagnostics
- hardware-backed sender and receiver agents
- transport diagnostics
- Yggdrasil readiness checks
- Yggdrasil environment discovery
- Yggdrasil connectivity diagnostics
- Yggdrasil node introspection
- static peer establishment
- route propagation
- real two-host HTTP validation
- diagnostics-only `/health` probing over Yggdrasil

Still intentionally out of scope for Stage 5:

- bundle delivery
- message delivery
- transport synchronization
- automatic routing
- relay behavior changes

## Successful Validation Chain

Validated path:

`HP -> Windows -> Yggdrasil -> static peer -> IPv6 routing -> HTTP -> Receiver Agent -> GET /health -> HTTP 200`

Successfully confirmed in the lab:

- two physical Windows hosts
- independent Yggdrasil installations
- static IPv4 peering
- peer establishment
- session establishment
- route and path visibility
- ICMP reachability over Yggdrasil
- TCP reachability over Yggdrasil
- HTTP connectivity over Yggdrasil
- diagnostics-only remote health validation through `node src/cli.js yggdrasil-health`

## Practical Deployment Findings

### 1. UTF-8 BOM breaks Yggdrasil config

Windows editors may save `C:\ProgramData\Yggdrasil\yggdrasil.conf` with a UTF-8 BOM.

Observed behavior:

- Yggdrasil rejects the configuration
- the failure can be confusing if the file otherwise looks correct

Current diagnostics expectation:

- detect BOM presence
- recommend re-saving the file as UTF-8 without BOM

### 2. IPv6 binding must stay enabled

Windows may have IPv6 disabled on the Wi-Fi adapter that carries the Yggdrasil underlay.

Operational impact:

- Yggdrasil validation becomes misleading or partially broken
- host reachability can fail even when static peers look correct

Current diagnostics expectation:

- inspect adapter IPv6 bindings
- surface active connection profiles
- provide remediation guidance when Wi-Fi IPv6 is disabled

### 3. Static listener must be explicit

Validated Windows listener configuration:

```yaml
Listen:
  - tls://0.0.0.0:12345
```

Current diagnostics expectation:

- verify listener presence in config
- verify the listener is actually active on the host

### 4. Static peer configuration is sufficient for first validation

Validated peer shape:

```text
tls://<IPv4>:12345
```

Current diagnostics expectation:

- verify static peer entries exist
- correlate peer and session counts with the local node view

### 5. Windows Firewall can silently block node.exe

Critical deployment finding:

- Windows automatically created both `Allow` and `Block` rules for `C:\Program Files\nodejs\node.exe`
- the Yggdrasil interface landed in the `Public` profile
- the `Block` rules prevented inbound HTTP traffic from the remote Yggdrasil peer
- disabling only the conflicting `Block` rules restored remote `/health` access immediately

Current diagnostics expectation:

- inspect enabled firewall rules for `node.exe`
- detect conflicting allow/block pairs
- highlight `Public` inbound block rules
- remind the operator that Yggdrasil often uses the `Public` profile on Windows

## Stage 5 Doctor Diagnostics

A new diagnostics-only command now captures the main deployment findings:

```text
node src/cli.js doctor [--remote-url http://[200:db8::1]:8788]
node src/cli.js firewall-check [--remote-url http://[200:db8::1]:8788]
```

What it inspects:

- Yggdrasil installation visibility
- `yggdrasilctl` visibility
- local service state
- BOM in `yggdrasil.conf`
- static listener configuration
- static peer configuration
- IPv6 adapter bindings
- connection profile visibility
- local peers, sessions, and paths
- active listener state
- Windows Firewall conflicts for `node.exe`
- optional diagnostics-only remote `/health` availability

Boundaries remain strict:

- no bundle delivery
- no `/transport/accept-bundle`
- no peer mutation
- no route mutation
- no service control
- no config mutation

## Recommended Windows Deployment Notes

For receiver-side HTTP validation over Yggdrasil, bind the agent to IPv6 explicitly:

```text
node src/cli.js serve --host :: --listen 8788 --state-dir <explicit-state> --agent-name receiver
```

Before Stage 6 bundle delivery work, verify:

- `yggdrasilctl getself`
- `yggdrasilctl getpeers`
- `yggdrasilctl getsessions`
- `yggdrasilctl getpaths`
- `node src/cli.js yggdrasil-health --remote-url "http://[<remote-ygg-ipv6>]:8788"`
- `node src/cli.js doctor --remote-url "http://[<remote-ygg-ipv6>]:8788"`

## Next Milestone

Stage 6:

`Controlled Bundle Delivery over Yggdrasil`

Goals for the next stage:

- first end-to-end bundle transfer
- delivery confirmation
- integrity validation
- transport logging
- still no automatic synchronization or routing