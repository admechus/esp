# Tools

Project-local environment helpers for `ESP-IDF` and `Arduino ESP32`.

## Recommended Usage

In PowerShell, load the environment into the current session:

```powershell
. .\tools\setup-env.ps1
```

Validate what became available:

```powershell
.\tools\check-env.ps1
```

Run `idf.py` without manually preparing the shell:

```powershell
.\tools\idf.ps1 --version
.\tools\idf.ps1 set-target esp32s3
```

Flash the dongle with the project default port:

```powershell
.\tools\flash-dongle.ps1
.\tools\flash-dongle.ps1 -Port COM9
```

Build and flash the classic `ESP32` host identity node:

```powershell
.\tools\build-host-identity.ps1
.\tools\flash-host-identity.ps1 -Port COM8
```

Build and flash the unified firmware base for either board profile:

```powershell
.\tools\build-unified-node.ps1 -Board tdongle-s3
.\tools\build-unified-node.ps1 -Board host-identity-esp32
.\tools\flash-unified-node.ps1 -Board tdongle-s3 -Port COM9
.\tools\flash-unified-node.ps1 -Board host-identity-esp32 -Port COM8
```

Run `esptool` with the same environment:

```powershell
.\tools\esptool.ps1 --chip esp32s3 version
```

Run the local lab stack without retyping every role command:

```powershell
.\tools\lab-stack.ps1 -Action start
.\tools\lab-stack.ps1 -Action status
.\tools\lab-stack.ps1 -Action restart
.\tools\lab-stack.ps1 -Action stop
```

By default, `start` and `restart` open separate PowerShell windows for each role, which is the most reliable mode for this lab on Windows. If you want the hidden background variant, pass `-LaunchMode background`.

By default this manages:

- `sender` on `COM9` / `127.0.0.1:8787`
- `receiver` on `COM8` / `127.0.0.1:8788`
- `relay` on `127.0.0.1:8790`
- `unified shell` on `127.0.0.1:8796`

It stores its PID metadata and logs under `tools/runtime/`.

## Local Overrides

If the framework or tools move, copy [tools/esp-env.local.example.ps1](C:/Users/Keal/Documents/Codex/2026-05-14/esp/tools/esp-env.local.example.ps1) to `tools/esp-env.local.ps1` and set the paths there.
