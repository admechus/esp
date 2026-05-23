[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "setup-env.ps1") -Quiet

$checks = @(
    @{ Name = "IDF_PATH"; Value = $env:IDF_PATH },
    @{ Name = "idf.py.exe"; Value = (Get-Command idf.py.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue) },
    @{ Name = "cmake"; Value = (Get-Command cmake -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue) },
    @{ Name = "ninja"; Value = (Get-Command ninja -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue) },
    @{ Name = "xtensa-esp32s3-elf-gcc"; Value = (Get-Command xtensa-esp32s3-elf-gcc -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue) },
    @{ Name = "riscv32-esp-elf-gcc"; Value = (Get-Command riscv32-esp-elf-gcc -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue) },
    @{ Name = "esptool.exe"; Value = (Get-Command esptool.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue) },
    @{ Name = "ESP Python"; Value = $env:ESP_PYTHON_EXE },
    @{ Name = "Arduino ESP32"; Value = $env:ARDUINO_ESP32_ROOT }
)

foreach ($check in $checks) {
    $status = if ($check.Value) { "OK" } else { "MISSING" }
    "{0,-22} {1,-8} {2}" -f $check.Name, $status, $check.Value
}
