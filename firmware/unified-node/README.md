# Unified Node Firmware

This project is the first step toward one reusable firmware base for multiple ESP messenger boards.

## Current Board Profiles

- `tdongle-s3`
  - target: `esp32s3`
  - transport: `USB Serial/JTAG`
  - profile: `identity-token`
  - declared outputs: `ST7735 80x160 display`, `RGB LED`

- `host-identity-esp32`
  - target: `esp32`
  - transport: `UART0`
  - profile: `host-attached-node`
  - output probe: best-effort common `I2C` OLED scan for `0x3C/0x3D`
  - output probe: best-effort common `SPI` `ILI9341` probe on several typical ESP32 pin presets

## Commands

The unified firmware supports the existing identity protocol plus:

- `GET_PLATFORM_IO`
- `TEST_OUTPUT`

`GET_PLATFORM_IO` reports:

- board/device identity
- chip and profile
- declared or probed output devices
- GPIO platform summary

It does not yet return a full live GPIO attachment map.

Current output behavior:

- `tdongle-s3`: declares onboard `display` and `rgb-led`
- `host-identity-esp32`: performs a best-effort OLED probe on common `I2C` pin/address combinations
- `host-identity-esp32`: performs a best-effort `ILI9341` probe on common `SPI` pin presets and will prefer the detected TFT for the attached status screen when present

`TEST_OUTPUT` currently supports:

- `tdongle-s3`: `display`, `rgb-led`, or `all`
- `host-identity-esp32`: `display`, `oled`, or `all`

For `tdongle-s3`, the `display` test now also performs a short PWM backlight sweep before and during the color pattern so brightness control is visible, not just panel init.

After a `TEST_OUTPUT` run, the firmware now restores the normal attached status screen after a short delay, so temporary test patterns do not remain stuck on the display or OLED.

## Build

```powershell
.\tools\build-unified-node.ps1 -Board tdongle-s3
.\tools\build-unified-node.ps1 -Board host-identity-esp32
```

Each board profile uses its own generated `sdkconfig.<board>` file, so `esp32s3` and `esp32` targets do not overwrite each other's configuration.

## Flash

```powershell
.\tools\flash-unified-node.ps1 -Board tdongle-s3 -Port COM9
.\tools\flash-unified-node.ps1 -Board host-identity-esp32 -Port COM8
```
