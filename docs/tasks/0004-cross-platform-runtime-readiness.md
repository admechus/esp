# Task 0004: Cross-Platform Runtime Readiness

## Goal

Audit runtime maturity work for cross-platform readiness before deeper runtime
configuration and lifecycle work.

## Current Support Status

Cross-platform today:

- runtime profiles
- profile-backed manual transport operations
- local HTTP agent and relay transports
- file-bundle transport
- transport metadata passports
- transport diagnostics and visibility helpers
- manual transport targeting
- explicit manual transport health checks
- transport smoke validation

Windows-first today:

- `COM` port discovery
- Windows serial JSON transport
- ESP hardware serial workflows
- CLI examples using `COM` ports

Planned later:

- Linux and Unix serial discovery
- Linux serial JSON transport
- Raspberry Pi deployment notes
- old laptop field-node notes

## Audit Findings

### Runtime profiles

- `agent/src/runtime/runtimeProfiles.js` is largely platform-neutral.
- profile-backed operational merge behavior remains platform-neutral because it is
  field-based and transport-metadata driven rather than host-platform driven.
- Profile field names such as `profileName`, `transport`, `remoteUrl`,
  `targetAgent`, and `filePath` are host-platform agnostic.
- Validation behavior is transport-metadata driven and does not assume Windows.
- JSON loading uses Node path resolution through `resolve(filePath)`, which is
  cross-platform.
- Current example values are mostly host-neutral, though Windows-style file path
  examples still appear in some transport metadata and diagnostics output.

### CLI

- Profile-oriented commands such as `validate-profile`, `list-transports`, and
  `check-transport` are cross-platform in structure.
- HTTP-oriented commands and examples using `127.0.0.1` are cross-platform.
- Serial-oriented commands and usage examples are Windows-first because they use
  `COMx` names directly.
- `list-ports` is currently Windows-first because runtime port discovery delegates
  to the Windows-specific serial discovery module.

### Transport layer

- `local-http-agent` is cross-platform.
- `local-http-relay` is cross-platform.
- `file-bundle` is cross-platform.
- transport metadata, diagnostics, manual health checks, and manual targeting are
  cross-platform by design.
- serial hardware access is currently Windows-first because it depends on
  `windowsComDiscovery.js` and `windowsSerialJsonTransport.js`.

## Manual-Only Boundaries Preserved

This audit does not introduce:

- automatic profile discovery
- automatic profile selection
- environment variable loading
- transport auto-selection
- routing
- fallback
- capability negotiation
- platform auto-detection

## Recommended Future Linux and Unix Tasks

1. Add a Unix serial discovery module that can scan likely device paths such as
   `/dev/ttyUSB*`, `/dev/ttyACM*`, and `/dev/serial/by-id`.
2. Add a Unix serial JSON transport that mirrors the Windows serial JSON contract
   without changing runtime ownership boundaries.
3. Refactor runtime port listing behind a small host-serial discovery seam so CLI
   `list-ports` can stay stable while implementations differ by platform.
4. Expand CLI and README examples so host-neutral commands stay generic and
   serial examples are clearly labeled by platform.
5. Add Raspberry Pi deployment notes for always-on relay or gateway operation.
6. Add old laptop field-node notes for Linux host usage with HTTP and file-bundle
   transports first, then serial workflows.

## Summary

The current runtime maturity layer is already mostly cross-platform at the HTTP,
file, profile, and diagnostics levels. The remaining Windows-first surface is
centered on serial hardware discovery and serial command transport, which should
be treated as a separate host-platform support track rather than mixed into
transport abstraction logic.
