# Task 0006: Runtime State Path and Environment Audit

## Goal

Clarify where runtime state lives, which paths are cwd-derived, which are
explicitly user-controlled, and how that affects future Windows, Linux,
Raspberry Pi, VPS, and field-node deployments.

## Runtime Path Inventory

Agent runtime paths:

- default `stateDir`
  - derived from `resolve(process.cwd(), "agent", "state")`
- state files under `stateDir`
  - `peers.json`
  - `inbox.json`
  - `outbox-log.json`
  - `receipts.json`
- cache files under `stateDir`
  - `identity-cache.json`
  - `device-info-cache.json`
  - `platform-io-cache.json`
- artifact directories under `stateDir`
  - `outbox/`
  - `transfers/`

Relay path expectations:

- default relay state dir
  - derived from `resolve(process.cwd(), "agent", "state-relay")`
- relay files under that directory
  - `relay-queue.json`
  - `relay-transfers.json`

Profile file expectations:

- profile files are manual and explicit only
- `--profile <path>` is required
- profile paths are resolved against the current working directory

## Path Classification

Deterministic paths:

- any path produced after `stateDir` is explicitly provided
- any cache or artifact path derived from an explicit `stateDir`
- relay file names inside a resolved relay state dir

Cwd-derived paths:

- default agent `stateDir`
- default relay state dir
- profile path resolution base

User-controlled paths:

- `--state-dir`
- `--file`
- `--profile`

## Current Diagnostics

Read-only runtime path diagnostics now expose:

- current `cwd`
- resolved agent `stateDir`
- state dir source: `cwd-derived-default` or `explicit`
- resolved relay state dir expectation
- resolved state files
- resolved cache files
- resolved artifact paths
- relay queue and transfer file expectations
- profile path notes
- warnings for potentially surprising cwd-derived nesting

CLI visibility:

- `node src/cli.js runtime-paths`

This command is diagnostics only.
It does not move, migrate, or repair state.

## Cwd Dependency Findings

- launching from the repository root and from `agent/` produces different default
  state locations
- this is observable today and can be surprising for operators
- diagnostics now make the difference explicit without changing behavior

Example surprising case:

- when launched from `D:\esp\agent`
- default agent state resolves to `D:\esp\agent\agent\state`

## Environment Findings

### Windows

- current serial workflows are already Windows-first
- cwd-derived state resolution works, but operators should prefer explicit
  `--state-dir` for repeatable lab setups

### Linux

- HTTP, file-bundle, runtime profiles, and diagnostics remain portable
- cwd-derived state behavior will be the same class of issue unless explicit
  state dirs are used

### Raspberry Pi

- long-running relay or gateway-style deployment should prefer explicit
  persistent state directories
- this avoids accidental dependence on shell launch location

### VPS

- HTTP/file-bundle/profile flows are portable
- service-style execution should use explicit state roots rather than cwd-derived
  defaults

## Recommendations

1. Prefer explicit `--state-dir` for repeatable operational setups.
2. Keep cwd-derived defaults for now, but treat them as convenience defaults only.
3. Revisit default state-root design later when introducing service-style Linux,
   Raspberry Pi, or VPS deployment guidance.
4. Do not introduce automatic migration or relocation without a separate runtime
   maturity step.
