# Host Identity Firmware

This target turns a classic `ESP32` board connected through `USB-UART` into a second hardware-backed identity endpoint.

## Intended Use

- board class: `ESP32-WROOM` or similar host-attached module
- transport: `UART0` over `CP210x` or similar USB-UART bridge
- role: `identity`
- profile: `host-attached-node`

## Notes

- it speaks the same JSON command protocol as the `T-Dongle-S3`
- it stores a local `ES256/P-256` identity in `NVS`
- it shares the serial console with boot logs, so the host transport must tolerate mixed log and JSON lines

## Build And Flash

From the project root:

```powershell
.\tools\build-host-identity.ps1
.\tools\flash-host-identity.ps1 -Port COM8
```

Typical local receiver setup:

```powershell
node .\agent\src\cli.js serve --port COM8 --listen 8788 --state-dir .\agent\state-receiver --agent-name receiver --remote-url http://127.0.0.1:8790 --target-agent sender
```
