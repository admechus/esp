# Transport Layer Notes

This directory currently contains concrete transport implementations used by the working prototype.

Stage 1 adds a documented direction toward a `TransportAdapter` abstraction, but does not rewire runtime delivery yet.

Planned adapter kinds:

- `local-http-agent`
- `local-http-relay`
- `file-bundle`

Future adapter kinds:

- `yggdrasil-direct`
- `tcp-direct`
- `serial-bridge`
- `lora-bridge`
- `ble-bridge`

The current code should remain behaviorally stable while these abstractions are introduced incrementally.
